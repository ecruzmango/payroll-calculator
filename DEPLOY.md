# Deploying

Two pieces go live: the **payroll app** (a static site, used by the owner) and
the **hours server** (used by workers). Both run on Render's free plan, with the
database on Turso's free plan.

Total cost: nothing.

---

## 0. Commit first

Nothing is deployable until it's in git. From the project root:

```bash
git add -A && git commit -m "Worker hours form, weekly reminder, saved lists"
```

`server/.env` and `server/data/` are gitignored and must stay that way — `.env`
holds your notification topic, which acts as a password.

Push to GitHub; Render deploys from there.

---

## 1. Create the database (Turso)

Render's free plan wipes the filesystem on every deploy and restart. A local
SQLite file would take every form link and pending submission with it, so the
database lives outside the server.

1. Sign up at [turso.tech](https://turso.tech) — the free plan is far larger
   than this app will ever need.
2. Create a database. Name it something like `payroll`.
3. Copy two values from its dashboard:
   - the **database URL**, starting `libsql://`
   - an **auth token**

Nothing else is needed. The server creates its own tables on first start.

---

## 2. Deploy the server

In Render: **New → Web Service**, point it at your repo.

| Setting | Value |
|---|---|
| Root directory | `server` |
| Build command | `npm ci` |
| Start command | `npm start` |
| Plan | Free |
| Health check path | `/health` |

Environment variables:

| Key | Value |
|---|---|
| `DB_URL` | the `libsql://…` URL from Turso |
| `DB_AUTH_TOKEN` | the Turso auth token |
| `REMINDER_WEBHOOK_URL` | your ntfy URL, e.g. `https://ntfy.sh/pagos-…` |
| `REMINDER_DAY` | `5` (Friday) |
| `REMINDER_TIMES` | `6,12,18` — hours to nudge on that day |
| `TZ` | `America/Mexico_City` — **required**, or everything runs on UTC |
| `NODE_VERSION` | `22` |

Deploy, then visit the service URL. You should see **✓ Funcionando**.

Two variables are still missing — they need the app's URL, which does not exist
yet. Come back in step 4.

---

## 3. Deploy the app

**New → Static Site**, same repo.

| Setting | Value |
|---|---|
| Root directory | *(leave blank)* |
| Build command | `npm ci && npm run build` |
| Publish directory | `dist` |

Environment variable:

| Key | Value |
|---|---|
| `VITE_API_URL` | your server's URL from step 2, e.g. `https://payroll-server.onrender.com` |

**No trailing slash.** `https://host/` produces `https://host//api/…`, which
404s before the CORS middleware runs — so the browser blocks the response and
the app reports a connection failure rather than a 404. The code strips them
now, but the habit is worth keeping.

Add a rewrite rule so refreshing a page works: **Redirects/Rewrites** →
source `/*`, destination `/index.html`, type **Rewrite**.

`VITE_API_URL` is baked in at build time, so changing it later needs a rebuild,
not just a restart.

---

## 4. Point the two at each other

Back in the **server**'s environment variables, now that you know the app's URL:

| Key | Value |
|---|---|
| `ALLOWED_ORIGIN` | the app's URL, e.g. `https://payroll-app.onrender.com` |
| `PUBLIC_URL` | the server's own URL, e.g. `https://payroll-server.onrender.com` |

`ALLOWED_ORIGIN` must match the app's address exactly — no trailing slash. If it
is wrong the app reports *"No se pudo conectar con el servidor de horas"*, which
is the browser blocking a cross-origin request, not a server that is down.

`PUBLIC_URL` is what goes inside the links sent to workers, so a wrong value
produces links that lead nowhere.

Save and let the server redeploy.

---

## 5. First run

1. Open the app's URL. It starts empty — the roster lives in the browser, and
   this is a new one. Add your workers and wages, or upload your CSV.
2. Press **Activar formulario**. This mints a fresh link; the old
   `192.168.1.115` one is dead.
3. Press **Probar aviso** and check the notification arrives.
4. Send the new link to your broadcast list.

Bookmark the app URL on the owner's computer. Everything they do lives in that
browser, so it should always be the same one.

---

## What HTTPS fixes for free

Two bugs during local testing were caused by plain `http://` on a LAN address,
and both disappear once deployed:

- **Blank page** — `crypto.randomUUID()` only exists in a secure context.
- **Copy buttons failing** — `navigator.clipboard` likewise.

Both have fallbacks now, but on HTTPS the primary path is used.

---

## 6. Stop the server sleeping

Render's free plan sleeps a service after ~15 minutes without traffic, and
waking it takes about 50 seconds. The first worker to tap the link each morning
would sit staring at a blank tab.

A service only sleeps if nothing talks to it, so point a free uptime monitor at
the health endpoint:

1. Sign up at [UptimeRobot](https://uptimerobot.com) (free) or
   [cron-job.org](https://cron-job.org).
2. New monitor → **HTTP(S)** → `https://your-server.onrender.com/health`
3. Interval: **5 minutes**.

That is the whole fix — no code changes, no cost.

**One constraint:** Render's free tier provides a monthly pool of instance hours
(750 at the time of writing). A service kept awake all month uses roughly 730 of
them, so this fits — but only for *one* free web service on the account. Static
sites do not count. Adding a second always-awake free service would exceed it.

Note this is working around a tier designed to sleep, not a supported feature.
It is widely done and not blocked, but it is Render's call.

If that ever stops working, the permanent fixes are **Cloudflare Workers**
(free, no cold start by design, but the server needs porting from Express to
Hono) or **Fly.io** (~$2–3/month, wakes in a second or two, no tricks needed).

---

## Known trade-offs of the free plan

**Reminder timing.** While the server is asleep the hourly reminder check does
not run. "Due" is *computed* rather than scheduled, so nothing is permanently
missed — but the Friday push can arrive late, whenever the service next wakes.
Keeping it awake (step 6) removes this too. The in-app banner is unaffected and
always correct.

**Backups.** Turso keeps the data, but take a copy before any big change:

```bash
turso db shell payroll .dump > backup.sql
```

The payroll itself — names, wages, hours — lives in the owner's browser, not
here, so also keep downloading the weekly CSV and PDF.
