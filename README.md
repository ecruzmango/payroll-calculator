# Payroll Calculator

Weekly wage tracking for a small crew. The owner keeps the roster and wages in
their browser; workers send their own hours through a link on their phone.

The payroll week runs **Saturday to Friday**, and the interface is in Spanish.

---

## The two halves

**The payroll app** (this folder) — the owner's screen. Up to four saved worker
lists, wages, hours, totals, CSV and PDF export. Everything is stored in the
browser via `localStorage`; wages never leave the machine.

**The hours server** ([`server/`](server/README.md)) — one shared link per list.
A worker opens it, taps their name, types seven numbers, and sends. The owner
reviews each submission and applies it to the table. The server stores only
names and hours — never wages, phone numbers, or pay.

---

## How a week goes

1. Friday, the app shows **Toca enviar el enlace de esta semana** (and pushes a
   notification if one is configured).
2. The owner copies the message and pastes it into a WhatsApp broadcast list.
3. Workers tap the link and send their hours.
4. The owner opens the app, checks the inbox, and clicks **Aplicar**. Anyone who
   hasn't submitted is listed by name.
5. Download the CSV and PDF, then **Empezar nueva semana** — names and wages
   stay, hours clear.

Nothing reaches the table on its own. These numbers become someone's paycheck,
so every submission is applied deliberately.

---

## Running it locally

Two terminals.

```bash
npm install && npm run dev
```

```bash
cd server && npm install && npm start
```

Then open http://localhost:5173. The server is not something you browse — it
exists so the app has somewhere to send the roster and read submissions from.

To try it on a real phone over your wifi, see
[server/README.md](server/README.md#configuration).

---

## Deploying

See [DEPLOY.md](DEPLOY.md). Free on Render plus Turso.

---

## Features

- Up to 4 saved worker lists, each with its own week and form link
- Autosaves to the browser; no file to remember to open
- Shared form link, permanent — send it once, or resend as a weekly reminder
- Review-then-apply inbox, plus a "who hasn't submitted" list
- Weekly reminder, in-app and optionally as a phone notification
- CSV import and export, PDF with per-day and per-worker totals
- Arrow-key navigation across the hours grid
- Bad values flagged rather than silently corrected

---

## Where the data lives

| What | Where | Survives |
|---|---|---|
| Names, wages, hours, totals | The owner's browser | Refresh and restart. **Not** clearing browser data |
| Submitted hours in flight | The server database | Redeploys |
| Weekly record | The CSV and PDF you download | Everything |

`localStorage` is not a file. Clearing browsing data deletes the roster with no
way back, so download the CSV each week — that is the backup.
