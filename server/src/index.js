import express from 'express';
import { fileURLToPath } from 'node:url';
import { router } from './routes.js';
import { getListByToken, initSchema } from './db.js';
import { startReminderLoop, reminderState, reminderMessage } from './reminders.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

// Origins allowed to call the manager API, comma-separated. Both localhost and
// the machine's LAN address are permitted by default so that testing on a real
// phone works without the app suddenly failing when opened via localhost.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(express.json({ limit: '64kb' }));

app.use((req, res, next) => {
  const origin = req.get('Origin');
  // Echo back the caller's origin only when it is on the list. A wildcard would
  // let any site on the internet read this API using a visitor's browser.
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  }
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-Manager-Secret');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api', router);

// Shared rules, loaded directly by the form so it applies identical validation.
app.use(
  '/shared',
  express.static(fileURLToPath(new URL('../../shared', import.meta.url)), {
    setHeaders: res => res.set('Content-Type', 'application/javascript; charset=utf-8')
  })
);

app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

/**
 * There is no app at the root — the worker form lives at /t/<token> and the
 * manager app is served separately. Express's default "Cannot GET /" makes that
 * look like a failure, so say what this server is instead. No tokens are listed
 * here: the whole point of a token is that it isn't public.
 */
app.get('/', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Servidor de horas</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 34rem; margin: 3rem auto;
           padding: 0 1.5rem; line-height: 1.6; color: #16181d; }
    code { background: #eef0f4; padding: 0.15em 0.4em; border-radius: 4px; }
    .ok { color: #1a8a4a; font-weight: 600; }
    @media (prefers-color-scheme: dark) {
      body { background: #14161a; color: #f0f2f5; }
      code { background: #262b33; }
    }
  </style>
</head>
<body>
  <h1>Servidor de horas</h1>
  <p class="ok">✓ Funcionando</p>
  <p>Esta dirección no tiene página. El servidor solo atiende:</p>
  <ul>
    <li><code>/t/&lt;enlace&gt;</code> — el formulario que abren los trabajadores</li>
    <li><code>/api/…</code> — datos para la aplicación de pagos</li>
  </ul>
  <p>La aplicación de pagos se abre por separado, normalmente en
     <code>http://localhost:5173</code>.</p>
  <p>Para conseguir el enlace del formulario, abre la aplicación de pagos y pulsa
     <strong>Activar formulario</strong>.</p>
</body>
</html>`);
});

/** Simple liveness check, handy once this is deployed behind a host. */
app.get('/health', (req, res) => res.json({ ok: true }));

/**
 * The page the weekly notification opens on the owner's phone.
 *
 * A WhatsApp broadcast list cannot be targeted by any URL, so sending always
 * ends in a manual paste. All this page does is put the message on the
 * clipboard in one tap. It deliberately does not try to be the payroll app —
 * that lives in the owner's desktop browser and would be empty here.
 */
app.get('/enviar/:token', async (req, res) => {
  const list = await getListByToken(req.params.token);
  if (!list) {
    return res.status(404).set('Content-Type', 'text/html; charset=utf-8')
      .send('<!doctype html><meta charset="utf-8"><p style="font-family:system-ui;padding:2rem">Este enlace ya no es válido.</p>');
  }

  const state = reminderState(list);
  const origin = process.env.PUBLIC_URL ?? `${req.protocol}://${req.get('host')}`;
  const message = reminderMessage(state.weekOf, `${origin}/t/${list.token}`);
  const ack = typeof req.query.ack === 'string' ? req.query.ack : '';

  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Enviar horas</title>
  <link rel="stylesheet" href="/enviar.css">
</head>
<body>
<main>
  <h1>Mensaje de la semana</h1>
  <p class="sub">${escapeHtml(list.name)} &middot; ${escapeHtml(state.weekLabel)}</p>

  <textarea class="msg" id="msg" readonly>${escapeHtml(message)}</textarea>
  <button id="copy">Copiar mensaje</button>
  <div class="status" id="status" hidden></div>

  <ol>
    <li>Toca <strong>Copiar mensaje</strong>.</li>
    <li>Abre WhatsApp y entra en tu lista de difusión.</li>
    <li>Mantén pulsado el cuadro de texto y elige <strong>Pegar</strong>.</li>
  </ol>

  ${ack ? '<button class="secondary" id="ack">Ya lo envié</button>' : ''}
</main>
<script>
const msg = document.getElementById('msg');
const status = document.getElementById('status');
const show = (text, bad) => {
  status.textContent = text;
  status.classList.toggle('bad', Boolean(bad));
  status.hidden = false;
};

document.getElementById('copy').addEventListener('click', async () => {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(msg.value);
    } else {
      // No clipboard API without HTTPS; selecting the field still works.
      msg.removeAttribute('readonly');
      msg.focus();
      msg.setSelectionRange(0, msg.value.length);
      const ok = document.execCommand('copy');
      msg.setAttribute('readonly', '');
      if (!ok) throw new Error('copy refused');
    }
    show('\\u2713 Copiado. Ahora pégalo en tu lista de difusión.');
  } catch (e) {
    msg.focus();
    msg.setSelectionRange(0, msg.value.length);
    show('Ya está seleccionado: mantén pulsado y elige Copiar.', true);
  }
});

const ackBtn = document.getElementById('ack');
if (ackBtn) {
  ackBtn.addEventListener('click', async () => {
    ackBtn.disabled = true;
    try {
      const r = await fetch('/api/reminder-ack/' + encodeURIComponent(${JSON.stringify(ack)}), { method: 'POST' });
      show(r.ok ? '\\u2713 Marcado como enviado.' : 'Ese botón ya se usó.', !r.ok);
    } catch (e) {
      show('Sin conexión.', true);
      ackBtn.disabled = false;
    }
  });
}
</script>
</body>
</html>`);
});

/**
 * The worker-facing link. Serves the same page for any token; the page fetches
 * its own data. Unknown tokens still render, then show a clear error.
 */
app.get('/t/:token', async (req, res) => {
  const list = await getListByToken(req.params.token);

  // Open Graph tags make WhatsApp render a preview card instead of a bare URL,
  // which is a far bigger tap target and reads as legitimate rather than spam.
  const title = list ? `Registrar horas — ${escapeHtml(list.name)}` : 'Registrar horas';
  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${title}</title>
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="Toca aquí para enviar tus horas de esta semana.">
  <meta property="og:type" content="website">
  <link rel="stylesheet" href="/form.css">
</head>
<body>
  <main id="app" class="app"><p class="loading">Cargando…</p></main>
  <script type="module" src="/form.js"></script>
</body>
</html>`);
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// Last resort: anything that throws lands here rather than hanging the request.
// Details go to the log, never to the client.
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Error del servidor. Inténtalo de nuevo.' });
});

// Tables must exist before the first request; failing loudly here beats
// serving 500s from a half-initialised database.
await initSchema();

app.listen(PORT, () => {
  console.log(`Payroll server on http://localhost:${PORT}`);
  startReminderLoop(process.env.PUBLIC_URL ?? `http://localhost:${PORT}`);
});
