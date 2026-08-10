import { DAY_LABELS, isPartialNumber, hoursIssue, totalHours } from '/shared/hours-rules.js';
import { datesForWeek } from '/shared/week.js';

const token = location.pathname.split('/').pop();
const app = document.getElementById('app');
const REMEMBER_KEY = `horas:worker:${token}`;

const state = {
  data: null,
  workerId: null,
  weekOf: null,
  hours: {},
  errors: {},
  sending: false,
  error: null
};

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children.flat()) {
    if (child != null) node.append(child.nodeType ? child : String(child));
  }
  return node;
};

const emptyHours = () => Object.fromEntries(state.data.days.map(d => [d, '']));

async function boot() {
  try {
    const res = await fetch(`/api/form/${encodeURIComponent(token)}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'No se pudo cargar.');
    state.data = await res.json();
  } catch (err) {
    app.replaceChildren(
      el('div', { className: 'banner bad' }, err.message || 'No se pudo cargar el formulario.')
    );
    return;
  }

  state.weekOf = state.data.weeks[0].weekOf;
  state.hours = emptyHours();

  // Returning workers skip the name step — the phone remembers who they are.
  const remembered = localStorage.getItem(REMEMBER_KEY);
  if (remembered && state.data.workers.some(w => w.id === remembered)) {
    selectWorker(remembered, { render: false });
  }

  render();
}

function selectWorker(workerId, { render: shouldRender = true } = {}) {
  state.workerId = workerId;
  try {
    localStorage.setItem(REMEMBER_KEY, workerId);
  } catch {
    /* private browsing: they just pick their name each time */
  }
  loadExistingHours();
  if (shouldRender) render();
}

/** Prefill with whatever this worker last sent for the selected week. */
function loadExistingHours() {
  const prior = state.data.alreadySubmitted[`${state.workerId}:${state.weekOf}`];
  state.hours = prior ? { ...emptyHours(), ...prior.hours } : emptyHours();
  state.errors = {};
}

function priorSubmission() {
  return state.data.alreadySubmitted[`${state.workerId}:${state.weekOf}`] ?? null;
}

// ---- Screens -------------------------------------------------------------

function renderNamePicker() {
  const week = state.data.weeks.find(w => w.weekOf === state.weekOf);

  return [
    el('h1', {}, state.data.listName),
    el('p', { className: 'sub' }, `Semana del ${week.label}`),
    el('h2', {}, '¿Quién eres?'),
    el(
      'div',
      { className: 'card' },
      el(
        'div',
        { className: 'name-list' },
        state.data.workers.map(w => {
          const prior = state.data.alreadySubmitted[`${w.id}:${state.weekOf}`];
          return el(
            'button',
            { className: 'name-btn', onclick: () => selectWorker(w.id) },
            el('span', {}, w.name),
            prior ? el('span', { className: 'done' }, `✓ ${prior.total} h enviadas`) : null
          );
        })
      )
    )
  ];
}

function renderHoursForm() {
  const worker = state.data.workers.find(w => w.id === state.workerId);
  const week = state.data.weeks.find(w => w.weekOf === state.weekOf);
  const other = state.data.weeks.find(w => w.weekOf !== state.weekOf);
  const dates = datesForWeek(state.weekOf);
  const prior = priorSubmission();

  const total = totalHours(state.hours);
  const hasError = Object.keys(state.errors).length > 0;
  const nothingEntered = state.data.days.every(d => String(state.hours[d] ?? '').trim() === '');

  const dayRows = state.data.days.flatMap(day => {
    const date = dates[day];
    const issue = state.errors[day];

    const input = el('input', {
      type: 'text',
      inputMode: 'decimal',
      value: state.hours[day] ?? '',
      placeholder: '0',
      className: issue ? 'bad' : '',
      'aria-label': DAY_LABELS[day]
    });

    input.addEventListener('input', e => {
      const raw = e.target.value;
      if (!isPartialNumber(raw)) {
        e.target.value = state.hours[day] ?? '';
        return;
      }
      state.hours[day] = raw;
      const problem = hoursIssue(raw);
      if (problem) state.errors[day] = problem;
      else delete state.errors[day];
      updateLiveTotal();
      e.target.className = state.errors[day] ? 'bad' : '';
    });

    return [
      el(
        'div',
        { className: 'day-row' },
        el(
          'div',
          { className: 'day-name' },
          el('strong', {}, DAY_LABELS[day]),
          el('span', {}, `${date.getDate()}/${date.getMonth() + 1}`)
        ),
        input
      ),
      issue ? el('div', { className: 'day-error' }, issue) : null
    ];
  });

  const sendBtn = el(
    'button',
    {
      className: 'primary',
      id: 'send',
      disabled: state.sending || hasError || nothingEntered
    },
    state.sending ? 'Enviando…' : prior ? 'Actualizar mis horas' : 'Enviar mis horas'
  );
  sendBtn.addEventListener('click', submit);

  return [
    el('h1', {}, `Hola, ${worker.name}`),
    el('p', { className: 'sub' }, `${state.data.listName} · Semana del ${week.label}`),

    state.error ? el('div', { className: 'banner bad' }, state.error) : null,

    prior
      ? el(
          'div',
          { className: 'banner info' },
          `Ya enviaste ${prior.total} horas para esta semana. Puedes corregirlas y enviar de nuevo.`
        )
      : null,

    el(
      'div',
      { className: 'card' },
      dayRows,
      el(
        'div',
        { className: 'total-line' },
        el('span', {}, 'Total'),
        el('span', { id: 'total' }, `${formatTotal(total)} h`)
      )
    ),

    sendBtn,

    el(
      'div',
      { style: 'text-align:center' },
      other
        ? el(
            'button',
            {
              className: 'link',
              onclick: () => {
                state.weekOf = other.weekOf;
                state.error = null;
                loadExistingHours();
                render();
              }
            },
            `¿Enviar la semana del ${other.label}?`
          )
        : null,
      el(
        'button',
        {
          className: 'link',
          onclick: () => {
            state.workerId = null;
            state.error = null;
            try {
              localStorage.removeItem(REMEMBER_KEY);
            } catch {
              /* nothing to do */
            }
            render();
          }
        },
        'No soy yo, cambiar de nombre'
      )
    )
  ];
}

function renderDone(result) {
  return el(
    'div',
    { className: 'done-screen' },
    el('div', { className: 'done-mark' }, '✅'),
    el('h1', {}, '¡Listo!'),
    el('p', { className: 'sub' }, `Recibimos tus horas, ${result.workerName}.`),
    el('div', { className: 'done-total' }, `${formatTotal(result.total)} horas`),
    el('p', { className: 'sub' }, `Semana del ${result.weekLabel}`),
    el(
      'button',
      {
        className: 'link',
        onclick: () => {
          state.error = null;
          refreshAndRender();
        }
      },
      'Corregir mis horas'
    )
  );
}

const formatTotal = n => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

/** Update just the total while typing, so the whole form doesn't lose focus. */
function updateLiveTotal() {
  const node = document.getElementById('total');
  if (node) node.textContent = `${formatTotal(totalHours(state.hours))} h`;
  const send = document.getElementById('send');
  if (send) {
    const nothing = state.data.days.every(d => String(state.hours[d] ?? '').trim() === '');
    send.disabled = state.sending || Object.keys(state.errors).length > 0 || nothing;
  }
}

function render(node) {
  const content = node ?? (state.workerId ? renderHoursForm() : renderNamePicker());
  // Conditional sections yield null; replaceChildren would render those as the
  // literal text "null", so they have to be dropped here as well as in el().
  app.replaceChildren(...[content].flat().filter(Boolean));
}

async function submit() {
  state.sending = true;
  state.error = null;
  render();

  try {
    const res = await fetch(`/api/form/${encodeURIComponent(token)}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerId: state.workerId, weekOf: state.weekOf, hours: state.hours })
    });
    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      state.sending = false;
      state.errors = payload.errors ?? {};
      state.error = payload.error ?? 'No se pudo enviar. Intenta de nuevo.';
      render();
      return;
    }

    state.sending = false;
    render(renderDone(payload));
  } catch {
    state.sending = false;
    state.error = 'Sin conexión. Revisa tu internet e intenta de nuevo.';
    render();
  }
}

async function refreshAndRender() {
  const res = await fetch(`/api/form/${encodeURIComponent(token)}`);
  state.data = await res.json();
  loadExistingHours();
  render();
}

boot();
