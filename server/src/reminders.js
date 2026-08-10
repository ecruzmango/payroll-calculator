import { currentWeekOf, formatWeekRange, datesForWeek } from '../../shared/week.js';
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
  const weekOf = currentWeekOf();
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
export async function sendReminderPush(list, baseUrl, { test = false } = {}) {
  if (!WEBHOOK_URL) return { sent: false, reason: 'no-webhook' };

  const state = reminderState(list);
  const workers = await getWorkers(list.id);
  const submitted = new Set((await latestSubmissions(list.id, state.weekOf)).map(s => s.workerId));
  const missing = workers.filter(w => !submitted.has(w.id));

  const link = `${baseUrl}/t/${list.token}`;

  // The body is ONLY the message to forward, nothing else. WhatsApp broadcast
  // lists cannot be opened from a URL, so sending always ends in a manual paste
  // into the saved list — which means long-pressing this notification to copy
  // it has to yield exactly the right text, with no surrounding commentary.
  const body = reminderMessage(state.weekOf, link);

  // Context goes in the title instead, where it cannot contaminate a copy.
  const title =
    (test ? 'PRUEBA - ' : '') +
    `Horas ${list.name} - faltan ${missing.length} de ${workers.length}`;

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

    if (!test) await markNotified(list.id, state.weekOf, ackToken);
    return { sent: true, weekLabel: state.weekLabel, missing: missing.length, total: workers.length };
  } catch (err) {
    // A failed push must never take the server down; the in-app banner still shows.
    console.error(`[reminder] webhook failed for ${list.name}:`, err.message);
    return { sent: false, reason: err.message };
  }
}

/** The scheduled path: only when due, and only once per week per list. */
async function notifyIfDue(list, baseUrl) {
  const state = reminderState(list);
  if (!state.due) return;
  if (list.notified_week === state.weekOf) return; // already pushed this week
  await sendReminderPush(list, baseUrl);
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

  console.log(
    WEBHOOK_URL
      ? '[reminder] weekly push enabled'
      : '[reminder] no REMINDER_WEBHOOK_URL set — reminders show in the app only'
  );
  console.log(`[purge] inactive lists removed after ${PURGE_AFTER_DAYS} days`);
}
