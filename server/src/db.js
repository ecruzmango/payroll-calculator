import { createClient } from '@libsql/client';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * One client for both environments.
 *
 * Locally DB_URL is a `file:` path and this is plain SQLite on disk. In
 * production it is a `libsql://` Turso URL, so the data lives off the server
 * and survives redeploys — Render wipes the filesystem every time it restarts,
 * which would otherwise destroy every form link and pending submission.
 */
const DEFAULT_FILE = fileURLToPath(new URL('../data/payroll.db', import.meta.url));
const DB_URL = process.env.DB_URL ?? `file:${DEFAULT_FILE}`;

if (DB_URL.startsWith('file:')) {
  // fileURLToPath, not URL.pathname: pathname percent-encodes, so any space in
  // the project path would create a directory literally named "My%20Folder".
  mkdirSync(dirname(DB_URL.slice('file:'.length)), { recursive: true });
}

export const db = createClient({
  url: DB_URL,
  authToken: process.env.DB_AUTH_TOKEN
});

/** Create tables and apply column additions. Must run before serving. */
export async function initSchema() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS lists (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      token          TEXT NOT NULL UNIQUE,
      manager_secret TEXT NOT NULL,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    )`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS workers (
      list_id  TEXT NOT NULL,
      id       TEXT NOT NULL,
      name     TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (list_id, id)
    )`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS submissions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id      TEXT NOT NULL,
      worker_id    TEXT NOT NULL,
      week_of      TEXT NOT NULL,
      hours        TEXT NOT NULL,
      submitted_at INTEGER NOT NULL,
      applied_at   INTEGER
    )`);

  // Start/end times, added after workers moved from typing a total to picking
  // when they clocked in and out. `hours` stays the derived value so every
  // existing submission and the owner's table keep working unchanged.
  const subInfo = await db.execute('PRAGMA table_info(submissions)');
  if (!subInfo.rows.map(r => r.name).includes('times')) {
    await db.execute('ALTER TABLE submissions ADD COLUMN times TEXT');
  }

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_submissions_lookup
      ON submissions (list_id, week_of, worker_id, submitted_at DESC)`);

  // Added after the first release, so existing databases need the columns.
  // SQLite has no "ADD COLUMN IF NOT EXISTS", hence the pragma check.
  const info = await db.execute('PRAGMA table_info(lists)');
  const columns = info.rows.map(r => r.name);

  //   week_of       — the payroll week the owner's list is on (source of truth)
  //   reminded_week — the week the owner marked as sent
  //   notified_week — legacy: the week a push fired for, before per-slot times
  //   notified_slot — the last "week|date|hour" a push fired for
  //   ack_token     — single-use token behind the "Ya lo envié" button
  for (const column of ['week_of', 'reminded_week', 'notified_week', 'notified_slot', 'ack_token']) {
    if (!columns.includes(column)) {
      await db.execute(`ALTER TABLE lists ADD COLUMN ${column} TEXT`);
    }
  }
}

/** ~72 bits of entropy, URL-safe. Long enough that links are not guessable. */
export const newToken = () => randomBytes(9).toString('base64url');
export const newSecret = () => randomBytes(24).toString('base64url');

const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0] ?? null;
const all = async (sql, args = []) => (await db.execute({ sql, args })).rows;

export const getListById = id => one('SELECT * FROM lists WHERE id = ?', [id]);
export const getListByToken = token => one('SELECT * FROM lists WHERE token = ?', [token]);
export const allLists = () => all('SELECT * FROM lists');

export const getWorkers = listId =>
  all('SELECT id, name FROM workers WHERE list_id = ? ORDER BY position', [listId]);

/**
 * Create or update a list and its roster.
 * Only names and ids are stored — wages never reach the server.
 */
export async function upsertList(list, workers) {
  const now = Date.now();
  const existing = await getListById(list.id);

  const statements = existing
    ? [
        {
          sql: 'UPDATE lists SET name = ?, week_of = ?, updated_at = ? WHERE id = ?',
          args: [list.name, list.weekOf ?? existing.week_of, now, list.id]
        }
      ]
    : [
        {
          sql: `INSERT INTO lists (id, name, week_of, token, manager_secret, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [list.id, list.name, list.weekOf ?? null, list.token, list.managerSecret, now, now]
        }
      ];

  // Replace the roster wholesale; submissions are keyed by worker id and are
  // deliberately left untouched, so removing a worker never deletes their hours.
  statements.push({ sql: 'DELETE FROM workers WHERE list_id = ?', args: [list.id] });
  workers.forEach((w, i) =>
    statements.push({
      sql: 'INSERT INTO workers (list_id, id, name, position) VALUES (?, ?, ?, ?)',
      args: [list.id, w.id, w.name, i]
    })
  );

  await db.batch(statements, 'write');
  return getListById(list.id);
}

export async function insertSubmission({ listId, workerId, weekOf, hours, times }) {
  await db.execute({
    sql: `INSERT INTO submissions (list_id, worker_id, week_of, hours, times, submitted_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [listId, workerId, weekOf, JSON.stringify(hours), times ? JSON.stringify(times) : null, Date.now()]
  });
}

/**
 * The newest submission per worker for a week. Re-sending is how a worker
 * corrects a mistake, so only the latest counts — but every attempt is kept.
 */
export async function latestSubmissions(listId, weekOf) {
  const rows = await all(
    `SELECT s.* FROM submissions s
     WHERE s.list_id = ? AND s.week_of = ?
       AND s.submitted_at = (
         SELECT MAX(s2.submitted_at) FROM submissions s2
         WHERE s2.list_id = s.list_id AND s2.week_of = s.week_of AND s2.worker_id = s.worker_id
       )
     ORDER BY s.submitted_at DESC`,
    [listId, weekOf]
  );

  return rows.map(r => ({
    id: Number(r.id),
    workerId: r.worker_id,
    weekOf: r.week_of,
    hours: JSON.parse(r.hours),
    times: r.times ? JSON.parse(r.times) : null,
    submittedAt: Number(r.submitted_at),
    appliedAt: r.applied_at === null ? null : Number(r.applied_at)
  }));
}

export async function markApplied(listId, ids) {
  if (!ids.length) return;
  const now = Date.now();
  await db.batch(
    ids.map(id => ({
      sql: 'UPDATE submissions SET applied_at = ? WHERE id = ? AND list_id = ?',
      args: [now, id, listId]
    })),
    'write'
  );
}

/** Record that the owner has sent this week's reminder, so it stops nagging. */
export const markReminded = (listId, weekOf) =>
  db.execute({ sql: 'UPDATE lists SET reminded_week = ? WHERE id = ?', args: [weekOf, listId] });

/** Record which reminder slot last fired, and the ack token that went with it. */
export const markNotified = (listId, slotKey, ackToken) =>
  db.execute({
    sql: 'UPDATE lists SET notified_slot = ?, ack_token = ? WHERE id = ?',
    args: [slotKey ?? null, ackToken ?? null, listId]
  });

/** Consume an ack token from a notification button. Returns the list, or null. */
export async function consumeAckToken(token) {
  const list = await one('SELECT * FROM lists WHERE ack_token = ?', [token]);
  if (!list) return null;
  await db.execute({ sql: 'UPDATE lists SET ack_token = NULL WHERE id = ?', args: [list.id] });
  return list;
}

/** Remove a list and everything under it. */
export async function deleteList(listId) {
  // Rows are removed explicitly rather than by cascade: Turso does not enable
  // foreign keys by default, so relying on it would silently orphan rows.
  await db.batch(
    [
      { sql: 'DELETE FROM submissions WHERE list_id = ?', args: [listId] },
      { sql: 'DELETE FROM workers WHERE list_id = ?', args: [listId] },
      { sql: 'DELETE FROM lists WHERE id = ?', args: [listId] }
    ],
    'write'
  );
}

/**
 * Drop lists that nobody has touched in a long time.
 *
 * If the owner clears their browser, the manager secret is lost and the list
 * becomes unreachable — it cannot be deleted from the app, but would keep
 * firing weekly reminders forever. "Touched" means the owner synced it or a
 * worker submitted hours, so a list in genuine weekly use is never at risk.
 */
export async function purgeInactiveLists(cutoffMs) {
  const stale = await all(
    `SELECT id, name FROM lists
     WHERE updated_at < ?
       AND NOT EXISTS (
         SELECT 1 FROM submissions s
         WHERE s.list_id = lists.id AND s.submitted_at >= ?
       )`,
    [cutoffMs, cutoffMs]
  );

  for (const list of stale) await deleteList(list.id);
  return stale;
}
