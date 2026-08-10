import { currentWeekOf, formatWeekRange, datesForWeek, toISODate, isValidISODate } from '../../shared/week.js';
import { DAYS } from '../../shared/hours-rules.js';
import {
  allLists,
  markNotified,
  getWorkers,
  latestSubmissions,
  newSecret,
  purgeInactiveLists
} from './db.js';

// Day of the week the owner should send the link. Default 5 = Friday, the last
// day of the Saturday-to-Friday payroll week: workers know their hours by then,
// and the form's "current week" is still the week being reported.
const REMINDER_DAY = Number(process.env.REMINDER_DAY ?? 5);

// Optional. Any URL that accepts a POST — an email service, IFTTT, or ntfy.sh,
// which gives real phone notifications for free with no account. Leave unset
// and the reminder simply appears in the app instead.
const WEBHOOK_URL = process.env.REMINDER_WEBHOOK_URL ?? '';


// Lists untouched for this long are deleted. A list in weekly use is refreshed
// every time the owner syncs or a worker submits, so only abandoned ones age out.
const PURGE_AFTER_DAYS = Number(process.env.PURGE_AFTER_DAYS ?? 60);

/**
 * Hours of the day to push a reminder, once REMINDER_DAY has arrived.
 * e.g. "6,12,18" nudges at 6am, noon and 6pm. Each fires at most once a day,
 * and all of them stop as soon as every worker has submitted.
 *
 * These are hours in the server's timezone — set TZ (see below) or they will
 * be UTC, which is not the owner's morning.
 */
const REMINDER_TIMES = [
  ...new Set(
    (process.env.REMINDER_TIMES ?? '8')
      .split(',')
      .map(s => Number(s.trim()))
      .filter(n => Number.isInteger(n) && n >= 0 && n <= 23)
  )
].sort((a, b) => a - b);

/**
 * The most recent reminder hour that has already passed today, or null before
 * the first one.
 *
 * Deliberately "has passed" rather than "is exactly now": on a free host the
 * service sleeps, so the hourly check can miss the exact hour. This way a late
 * wake still delivers the nudge, just late, instead of skipping it entirely.
 */
function currentSlot(now) {
  const passed = REMINDER_TIMES.filter(h => h <= now.getHours());
  return passed.length ? passed[passed.length - 1] : null;
}

const slotKey = (weekOf, now, slot) => `${weekOf}|${toISODate(now)}|${slot}`;

/** The message the owner sends to the crew. Kept here so app and push agree. */
export function reminderMessage(weekOf, link) {
  const dates = datesForWeek(weekOf);
  const first = dates[DAYS[0]];
  const last = dates[DAYS[DAYS.length - 1]];
  const range = `${first.getDate()}/${first.getMonth() + 1} al ${last.getDate()}/${last.getMonth() + 1}`;
  return `Hola 👋 Ya puedes registrar tus horas de la semana del ${range}.\n${link}`;
}

/**
 * Whether this week's link still needs sending.
 *
 * Derived rather than scheduled: a cron job that fires once can be missed if the
 * process is asleep, and then the week is silently skipped. Computing it means
 * the reminder is simply true until the owner marks it done.
 */
export function reminderState(list) {
  // The owner's list is the source of truth for which week is being collected.
  // Computing it here independently produced a reminder that named a different
  // week than the app's own inbox. Falls back for lists synced before this.
  const weekOf = isValidISODate(list?.week_of) ? list.week_of : currentWeekOf();
  const today = new Date().getDay();

  const alreadySent = list.reminded_week === weekOf;
  const dayReached = today === REMINDER_DAY || isPastReminderDay(today);

  return {
    weekOf,
    weekLabel: formatWeekRange(weekOf),
    due: dayReached && !alreadySent,
    alreadySent,
    reminderDay: REMINDER_DAY
  };
}

/**
 * True once the reminder day has passed within the payroll week. The week runs
 * Saturday(6) -> Friday(5), so position in the week is what matters, not the
 * raw day number.
 */
function isPastReminderDay(todayDow) {
  const position = d => (d - 6 + 7) % 7; // Saturday = 0 ... Friday = 6
  return position(todayDow) > position(REMINDER_DAY);
}

export const pushConfigured = () => Boolean(WEBHOOK_URL);

/**
 * Make a string safe to put in an HTTP header. Header values are ByteStrings,
 * so any character above U+00FF throws when fetch builds the request — which
 * would kill the whole notification over a stray accent.
 */
const headerSafe = s =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents: é -> e
    .replace(/[^\x20-\x7E]/g, '');   // drop anything still non-ASCII

/**
 * Send the reminder push for a list.
 *
 * `test` sends the same notification on demand, ignoring the day of the week
 * and the once-per-week guard. A test deliberately does not record itself as
 * sent — otherwise trying it out would silence the real reminder — and omits
 * the "Ya lo envié" button, which would do the same thing if tapped.
 */
export async function sendReminderPush(list, baseUrl, { test = false, slot = null } = {}) {
  if (!WEBHOOK_URL) return { sent: false, reason: 'no-webhook' };

  const state = reminderState(list);
  const workers = await getWorkers(list.id);
  const submitted = new Set((await latestSubmissions(list.id, state.weekOf)).map(s => s.workerId));
  const missing = workers.filter(w => !submitted.has(w.id));

  const link = `${baseUrl}/t/${list.token}`;

  // Who is actually outstanding, by name. "2 of 5" tells the owner there is a
  // problem; naming them tells the owner who to go and ask.
  const names = missing.map(w => w.name);
  const shown = names.slice(0, 4).join(', ');
  const whoIsMissing =
    missing.length === workers.length
      ? 'Nadie ha enviado sus horas todavía.'
      : `Faltan: ${shown}${names.length > 4 ? ` y ${names.length - 4} más` : ''}.`;

  // The body is a status report rather than the raw message: the "Copiar
  // mensaje" button opens a page that puts the message on the clipboard, so
  // the notification itself is free to say something more useful.
  const body = [
    test ? 'ESTO ES UNA PRUEBA.' : null,
    whoIsMissing,
    `Semana del ${state.weekLabel}.`,
    'Toca "Copiar mensaje" y pégalo en tu lista de difusión.'
  ]
    .filter(Boolean)
    .join('\n');

  const title =
    (test ? 'PRUEBA - ' : '') +
    `${list.name}: faltan ${missing.length} de ${workers.length}`;

  const ackToken = test ? null : newSecret();

  // ntfy renders these as buttons on the notification itself. Every value is
  // percent-encoded, so no stray comma or semicolon can break the header's own
  // delimiters. Other webhook targets ignore this header.
  const actions = [
    // Opens a one-purpose page that puts the message on the clipboard.
    // Not a wa.me link: that opens the contact picker, which does not list
    // broadcast lists. Not the payroll app either: its data lives in the
    // owner's desktop browser, so on a phone it would open empty.
    `view, Copiar mensaje, ${baseUrl}/enviar/${list.token}${ackToken ? `?ack=${encodeURIComponent(ackToken)}` : ''}, clear=false`,
    ackToken
      ? `http, Ya lo envie, ${baseUrl}/api/reminder-ack/${encodeURIComponent(ackToken)}, method=POST, clear=true`
      : null
  ]
    .filter(Boolean)
    .join('; ');

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        // Accents and dashes belong in the body, which is UTF-8 and renders
        // fine; headerSafe is the backstop so a stray one can never throw.
        Title: headerSafe(title),
        Actions: headerSafe(actions)
      },
      body
    });
    if (!res.ok) return { sent: false, reason: `http-${res.status}` };

    if (!test) await markNotified(list.id, slot, ackToken);
    return { sent: true, weekLabel: state.weekLabel, missing: missing.length, total: workers.length };
  } catch (err) {
    // A failed push must never take the server down; the in-app banner still shows.
    console.error(`[reminder] webhook failed for ${list.name}:`, err.message);
    return { sent: false, reason: err.message };
  }
}

/**
 * The scheduled path: at most one push per reminder hour, per list, per day.
 *
 * Every guard here exists to avoid pestering the owner about something already
 * handled: the day must have arrived, the owner must not have marked it sent,
 * the slot must not have fired, the list must have workers, and somebody must
 * actually still be missing.
 */
async function notifyIfDue(list, baseUrl) {
  const state = reminderState(list);
  if (!state.due) return; // day not reached, or owner already marked it sent

  const now = new Date();
  const slot = currentSlot(now);
  if (slot === null) return; // before today's first reminder hour

  const key = slotKey(state.weekOf, now, slot);
  if (list.notified_slot === key) return; // this slot already fired

  const workers = await getWorkers(list.id);
  if (!workers.length) return; // nothing to chase on an empty list

  const submitted = new Set((await latestSubmissions(list.id, state.weekOf)).map(s => s.workerId));
  if (workers.every(w => submitted.has(w.id))) {
    // Everyone has sent their hours — later nudges would be pure noise.
    return;
  }

  await sendReminderPush(list, baseUrl, { slot: key });
}

/**
 * Check hourly. Cheap, and self-correcting if the process restarts.
 *
 * The purge runs even when no webhook is configured — an abandoned list should
 * not linger just because nobody set up notifications.
 */
export function startReminderLoop(baseUrl) {
  const tick = async () => {
    try {
      const cutoff = Date.now() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000;
      for (const list of await purgeInactiveLists(cutoff)) {
        console.log(`[purge] removed inactive list «${list.name}» (>${PURGE_AFTER_DAYS} days)`);
      }
      if (WEBHOOK_URL) {
        for (const list of await allLists()) await notifyIfDue(list, baseUrl);
      }
    } catch (err) {
      // A database blip must not kill the interval; it retries in an hour.
      console.error('[reminder] tick failed:', err.message);
    }
  };

  tick();
  setInterval(tick, 60 * 60 * 1000).unref();

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  console.log(
    WEBHOOK_URL
      ? `[reminder] push enabled — ${days[REMINDER_DAY]} at ${REMINDER_TIMES.join('h, ')}h (${zone ?? 'UNKNOWN'})`
      : '[reminder] no REMINDER_WEBHOOK_URL set — reminders show in the app only'
  );

  // The whole schedule, and the Saturday-to-Friday week itself, is computed in
  // the server's timezone. Two ways this goes wrong:
  //   - TZ unset: hosts default to UTC, moving the week boundary into Friday
  //     evening for the Americas.
  //   - TZ set to an abbreviation like "CDT": not a valid IANA name, so the
  //     zone resolves to undefined and date handling silently misbehaves.
  if (!zone) {
    console.warn(
      `[reminder] TZ="${process.env.TZ}" is not a valid timezone. ` +
        'Use an IANA name such as America/Chicago or America/Mexico_City.'
    );
  } else if (zone === 'UTC' && !process.env.TZ) {
    console.warn('[reminder] timezone is UTC — set TZ (e.g. TZ=America/Chicago)');
  }
  console.log(`[purge] inactive lists removed after ${PURGE_AFTER_DAYS} days`);
}
