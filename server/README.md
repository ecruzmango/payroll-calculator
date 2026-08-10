# Servidor de horas

Collects weekly hours from workers through a single shared link, so the owner
doesn't have to type them in from WhatsApp messages.

## Running it

```bash
cd server
npm install
npm start
```

The manager app (Vite, port 5173) talks to this on port 3001 by default.
Run both during development.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3001` | Port to listen on |
| `DB_URL` | `file:server/data/payroll.db` | Database. A `file:` path locally, a `libsql://` Turso URL in production |
| `DB_AUTH_TOKEN` | *(unset)* | Turso auth token; not needed for a local file |
| `ALLOWED_ORIGIN` | `http://localhost:5173,http://127.0.0.1:5173` | Origins allowed to call the manager API, comma-separated |
| `VITE_API_URL` *(frontend)* | `http://localhost:3001` | Where the manager app looks for this server |
| `REMINDER_DAY` | `5` (Friday) | Day of week the owner should send the link, `0`=Sunday |
| `REMINDER_WEBHOOK_URL` | *(unset)* | Optional. POSTed to when a reminder is due, for phone push |
| `PUBLIC_URL` | `http://localhost:$PORT` | This server's public address, used in pushed messages |

To test on a phone over your local network, allow both origins:

```bash
ALLOWED_ORIGIN="http://localhost:5173,http://192.168.1.115:5173" npm start
```

## Weekly reminder

The app shows a banner when this week's link still needs sending, with the
message pre-written and a one-tap WhatsApp button. Clicking either that or
**Ya lo envié** silences it until next week.

"Due" is **computed**, not scheduled: it is true once `REMINDER_DAY` has been
reached in the current payroll week and the owner hasn't marked it sent. A cron
job that fires once can be missed while the process is asleep, silently skipping
a week; this cannot.

For a real notification on the owner's phone, set `REMINDER_WEBHOOK_URL` to
anything that accepts a `POST` — an email service, or [ntfy.sh](https://ntfy.sh),
which needs no account:

```bash
REMINDER_WEBHOOK_URL=https://ntfy.sh/pagos-mi-cuadrilla-9f3k npm start
```

Install the ntfy app, subscribe to the same topic, and the reminder arrives as a
push notification. Pick an unguessable topic name — anyone who knows it can read
the messages. Without this variable the reminder only appears in the app.

When deploying, `ALLOWED_ORIGIN` must be the manager app's real URL and
`VITE_API_URL` must be this server's real URL, or the two can't talk.

## How it fits together

1. The owner clicks **Activar formulario** in the manager app. That `PUT`s the
   roster (names and ids only) and gets back a link plus a manager secret.
2. The owner sends that link once, by WhatsApp broadcast. It never changes.
3. A worker opens it, taps their name, types seven numbers, taps send.
4. The owner clicks **Buscar envíos**, reviews what came in, and clicks
   **Aplicar** to write the hours into the table.

## What is and isn't stored here

Stored: list names, worker names, submitted hours, timestamps.

**Not stored: wages, pay totals, phone numbers, or emails.** Those never leave
the owner's browser. A breach of this database exposes names and hours worked —
not what anyone earns.

## Security notes

- Form tokens are 72 bits of random, URL-safe. Not guessable, but anyone with
  the link can submit as anyone on that list — the same trust model as a paper
  timesheet on a clipboard. The review-then-apply step in the manager app is
  what protects payroll.
- The manager secret is returned **once**, at creation, and stored in the
  owner's browser. If it's lost, clicking *Sincronizar* recreates the list with
  a new link, and the old link stops working.
- Rate limiting is in-memory and per-instance. Fine for one small crew on one
  server; needs a shared store if this is ever scaled out.
- Submissions are append-only. The newest one per worker per week wins, and
  earlier attempts are kept, so a correction never destroys the original.

## Database

One client covers both environments. Locally `DB_URL` is a `file:` path and this
is ordinary SQLite on disk. In production it points at Turso, so the data lives
off the server — Render's free plan wipes the filesystem on every deploy, which
would otherwise destroy every form link and pending submission.

Tables are created automatically at startup, including columns added after the
first release, so there is no migration step to run.

## Deploying

See [../DEPLOY.md](../DEPLOY.md).

## Not done yet

- No automatic purge of old *submissions* (whole inactive lists are purged
  after `PURGE_AFTER_DAYS`, but individual old submissions accumulate).
- Rate limiting is per-instance and in memory.
