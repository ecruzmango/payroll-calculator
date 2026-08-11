import { Router } from 'express';
import { DAYS, validateHoursMap, validateTimesMap, totalHours } from '../../shared/hours-rules.js';
import { currentWeekOf, addWeeks, formatWeekRange, isValidISODate } from '../../shared/week.js';
import {
  newToken,
  newSecret,
  getListById,
  getListByToken,
  getWorkers,
  upsertList,
  insertSubmission,
  latestSubmissions,
  markApplied,
  markReminded,
  consumeAckToken,
  deleteList
} from './db.js';
import { reminderState, reminderMessage, sendReminderPush, pushConfigured } from './reminders.js';

export const router = Router();

// Express 4 does not catch a rejected promise from an async handler: the
// request would hang until it timed out. Wrapping every handler funnels those
// failures into the error middleware instead. Must run before routes are added.
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
for (const method of ['get', 'post', 'put', 'delete']) {
  const original = router[method].bind(router);
  router[method] = (path, ...handlers) => original(path, ...handlers.map(wrap));
}

const MAX_WORKERS = 200;
const MAX_NAME = 80;

/**
 * Weeks a worker is allowed to report: the one the owner's list is on, plus the
 * one before it as a grace period for late submissions.
 *
 * Anchored to the list rather than to today's date, so the form, the reminder
 * and the owner's inbox always name the same week.
 */
function offeredWeeks(list) {
  const current = isValidISODate(list?.week_of) ? list.week_of : currentWeekOf();
  const previous = addWeeks(current, -1);
  return [
    { weekOf: current, label: formatWeekRange(current), isCurrent: true },
    { weekOf: previous, label: formatWeekRange(previous), isCurrent: false }
  ];
}

// ---- Rate limiting -------------------------------------------------------
// A public URL is an abuse target. This is intentionally simple: an in-memory
// fixed window, which resets on restart. Good enough for one small crew; swap
// for a shared store if this ever runs on more than one instance.
const hits = new Map();
function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (entry.count >= max) {
      return res.status(429).json({ error: 'Demasiados intentos. Espera un momento.' });
    }
    entry.count += 1;
    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits) if (now > entry.resetAt) hits.delete(key);
}, 60_000).unref();

// ---- Manager endpoints ---------------------------------------------------

/**
 * Create or update a list. The first call creates it and returns the manager
 * secret exactly once; later calls must present that secret.
 */
router.put('/lists/:listId', rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  const { listId } = req.params;
  const name = String(req.body?.name ?? '').trim().slice(0, MAX_NAME);
  const rawWorkers = Array.isArray(req.body?.workers) ? req.body.workers : [];
  // The app's active week. It, not the server's clock, decides which week
  // workers report against.
  const weekOf = isValidISODate(req.body?.weekOf) ? req.body.weekOf : null;

  if (!name) return res.status(400).json({ error: 'Falta el nombre de la lista.' });
  if (rawWorkers.length > MAX_WORKERS) {
    return res.status(400).json({ error: `Máximo ${MAX_WORKERS} trabajadores.` });
  }

  // Only named workers can be picked on the form, so unnamed rows are dropped.
  const workers = rawWorkers
    .filter(w => typeof w?.id === 'string' && String(w?.name ?? '').trim())
    .map(w => ({ id: w.id, name: String(w.name).trim().slice(0, MAX_NAME) }));

  const existing = await getListById(listId);
  if (existing) {
    const secret = req.get('x-manager-secret');
    if (!secret || secret !== existing.manager_secret) {
      return res.status(403).json({ error: 'Credencial incorrecta para esta lista.' });
    }
    const updated = await upsertList({ id: listId, name, weekOf }, workers);
    return res.json({
      listId,
      token: updated.token,
      workerCount: workers.length,
      created: false
    });
  }

  const created = await upsertList(
    { id: listId, name, weekOf, token: newToken(), managerSecret: newSecret() },
    workers
  );
  res.status(201).json({
    listId,
    token: created.token,
    managerSecret: created.manager_secret, // returned once, at creation
    workerCount: workers.length,
    created: true
  });
});

async function requireManager(req, res, next) {
  const list = await getListById(req.params.listId);
  if (!list) return res.status(404).json({ error: 'Lista no encontrada.' });
  const secret = req.get('x-manager-secret');
  if (!secret || secret !== list.manager_secret) {
    return res.status(403).json({ error: 'Credencial incorrecta para esta lista.' });
  }
  req.list = list;
  next();
}

/** Everything submitted for a week, newest per worker, for the inbox. */
router.get('/lists/:listId/submissions', requireManager, async (req, res) => {
  const weekOf = isValidISODate(req.query.weekOf) ? req.query.weekOf : currentWeekOf();
  const submissions = (await latestSubmissions(req.list.id, weekOf)).map(s => ({
    ...s,
    total: totalHours(s.hours)
  }));

  const workers = await getWorkers(req.list.id);
  const submittedIds = new Set(submissions.map(s => s.workerId));

  res.json({
    weekOf,
    weekLabel: formatWeekRange(weekOf),
    token: req.list.token,
    submissions,
    missing: workers.filter(w => !submittedIds.has(w.id))
  });
});

/**
 * The "Ya lo envié" button on a push notification. Authenticated by a
 * single-use token rather than the manager secret, so the worst a leaked
 * notification allows is silencing one week's reminder.
 */
router.post('/reminder-ack/:ackToken', rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  const list = await consumeAckToken(req.params.ackToken);
  if (!list) return res.status(404).json({ error: 'Este botón ya se usó.' });

  const { weekOf } = reminderState(list);
  await markReminded(list.id, weekOf);
  res.json({ ok: true, weekOf });
});

/** Whether this week's link still needs sending, plus the text to send. */
router.get('/lists/:listId/reminder', requireManager, (req, res) => {
  const state = reminderState(req.list);
  const origin = `${req.protocol}://${req.get('host')}`;
  res.json({
    ...state,
    pushConfigured: pushConfigured(),
    link: `${origin}/t/${req.list.token}`,
    message: reminderMessage(state.weekOf, `${origin}/t/${req.list.token}`)
  });
});

/**
 * Send the weekly notification right now, whatever day it is, so the owner can
 * confirm it arrives. Records nothing, so the real reminder still fires.
 */
router.post('/lists/:listId/reminder/test', requireManager, async (req, res) => {
  const baseUrl = process.env.PUBLIC_URL ?? `${req.protocol}://${req.get('host')}`;
  const result = await sendReminderPush(req.list, baseUrl, { test: true });

  if (!result.sent) {
    const message =
      result.reason === 'no-webhook'
        ? 'No hay notificaciones configuradas en el servidor (REMINDER_WEBHOOK_URL).'
        : `No se pudo enviar la notificación: ${result.reason}`;
    return res.status(400).json({ error: message });
  }
  res.json(result);
});

/** The owner has sent this week's link; stop showing the reminder. */
router.post('/lists/:listId/reminder/sent', requireManager, async (req, res) => {
  const { weekOf } = reminderState(req.list);
  await markReminded(req.list.id, weekOf);
  res.json({ ok: true, weekOf });
});

/**
 * Delete a list and everything under it. Called when the owner deletes the list
 * in the app — without this the server keeps the roster and keeps firing weekly
 * reminders for a crew that no longer exists.
 */
router.delete('/lists/:listId', requireManager, async (req, res) => {
  await deleteList(req.list.id);
  res.json({ ok: true });
});

router.post('/lists/:listId/submissions/applied', requireManager, async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(Number.isInteger);
  await markApplied(req.list.id, ids);
  res.json({ applied: ids.length });
});

// ---- Public (worker) endpoints -------------------------------------------

/** What the form needs to render: who is on the list and which weeks are open. */
router.get('/form/:token', rateLimit({ windowMs: 60_000, max: 60 }), async (req, res) => {
  const list = await getListByToken(req.params.token);
  if (!list) return res.status(404).json({ error: 'Este enlace no es válido.' });

  const weeks = offeredWeeks(list);
  const alreadySubmitted = {};
  for (const week of weeks) {
    for (const s of await latestSubmissions(list.id, week.weekOf)) {
      alreadySubmitted[`${s.workerId}:${week.weekOf}`] = {
        hours: s.hours,
        times: s.times,
        total: totalHours(s.hours),
        submittedAt: s.submittedAt
      };
    }
  }

  res.json({
    listName: list.name,
    days: DAYS,
    weeks,
    workers: await getWorkers(list.id),
    alreadySubmitted
  });
});

router.post('/form/:token/submit', rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  const list = await getListByToken(req.params.token);
  if (!list) return res.status(404).json({ error: 'Este enlace no es válido.' });

  const { workerId, weekOf } = req.body ?? {};

  const worker = (await getWorkers(list.id)).find(w => w.id === workerId);
  if (!worker) return res.status(400).json({ error: 'Selecciona tu nombre.' });

  // Only the weeks the form offers are accepted, so a stale tab cannot write
  // into an arbitrary week.
  if (!offeredWeeks(list).some(w => w.weekOf === weekOf)) {
    return res.status(400).json({ error: 'Esa semana ya no se puede enviar.' });
  }

  // Re-validated here: the form's own check is a convenience, not a guarantee.
  // When times are sent, the hours are DERIVED from them server-side rather
  // than taken from the client, so the stored total always matches the times.
  const sentTimes = req.body?.times;
  const result = sentTimes ? validateTimesMap(sentTimes) : validateHoursMap(req.body?.hours);
  if (!result.ok) return res.status(400).json({ error: 'Revisa las horas.', errors: result.errors });

  const { hours } = result;
  const times = sentTimes ? result.times : null;

  await insertSubmission({ listId: list.id, workerId, weekOf, hours, times });

  res.json({
    ok: true,
    workerName: worker.name,
    total: totalHours(hours),
    weekLabel: formatWeekRange(weekOf)
  });
});
