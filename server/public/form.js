import {
  DAY_LABELS,
  totalHours,
  hoursFromRange,
  crossesMidnight,
  validateTimesMap
} from '/shared/hours-rules.js';
import { datesForWeek, relativeWeekName, currentWeekOf } from '/shared/week.js';

const token = location.pathname.split('/').pop();
const app = document.getElementById('app');
const REMEMBER_KEY = `horas:worker:${token}`;

const state = {
  data: null,
  workerId: null,
  weekOf: null,
  // { sabado: { start: '07:00', end: '15:30' } } — the times are the record,
  // and the hours are always derived from them.
  times: {},
  errors: {},
  sending: false,
  error: null
};

const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    // Hyphenated names (aria-*, data-*) are attributes, not properties.
    // Assigning them directly creates a stray JS property and renders nothing.
    if (key.includes('-')) node.setAttribute(key, value);
    else node[key] = value;
  }
  for (const child of children.flat()) {
    if (child != null) node.append(child.nodeType ? child : String(child));
  }
  return node;
};

const emptyTimes = () => Object.fromEntries(state.data.days.map(d => [d, { start: '', end: '' }]));

/** Hours derived from whatever is currently entered. */
const derivedHours = () => validateTimesMap(state.times).hours;

/**
 * The week these hours belong to, stated plainly.
 *
 * Green only when it really is the current calendar week. The server's
 * `isCurrent` flag means "this list's default week", which is not the same
 * thing — if the owner is still collecting last week, that default *is* a past
 * week, and colouring it green while labelling it "Semana pasada" would tell
 * the worker two opposite things at once.
 */
function weekBanner(week) {
  const isThisWeek = week.weekOf === currentWeekOf();
  return el(
    'div',
    { className: `week-banner${isThisWeek ? '' : ' is-other'}` },
    el('strong', {}, isThisWeek ? 'Horas de esta semana' : `Horas de ${relativeWeekName(week.weekOf).toLowerCase()}`),
    el('span', {}, week.label)
  );
}

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
  state.times = emptyTimes();

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
  const times = emptyTimes();
  // Older submissions hold only a total, with no times to restore.
  if (prior?.times) {
    for (const day of state.data.days) {
      if (prior.times[day]) times[day] = { ...prior.times[day] };
    }
  }
  state.times = times;
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
    weekBanner(week),
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

  const hours = derivedHours();
  const total = totalHours(hours);
  const hasError = Object.keys(state.errors).length > 0;
  const nothingEntered = state.data.days.every(
    d => !state.times[d]?.start && !state.times[d]?.end
  );

  /**
   * One day: when they started, when they finished, and the resulting hours.
   *
   * `input type="time"` rather than two long <select>s. On a phone it opens the
   * native hour/minute picker — the same "choose an hour and a minute" the owner
   * asked for — without a 96-item list to scroll, and it handles 12h/24h
   * display according to the worker's own phone settings.
   */
  const dayRows = state.data.days.map(day => {
    const date = dates[day];
    const issue = state.errors[day];
    const worked = hoursFromRange(state.times[day]?.start, state.times[day]?.end);

    const timeField = which =>
      el('input', {
        type: 'time',
        value: state.times[day]?.[which] ?? '',
        className: issue ? 'bad' : '',
        'aria-label': `${which === 'start' ? 'Entrada' : 'Salida'} ${DAY_LABELS[day]}`,
        oninput: e => {
          state.times[day] = { ...state.times[day], [which]: e.target.value };
          const check = validateTimesMap(state.times);
          state.errors = check.errors;
          renderKeepingFocus(e.target);
        }
      });

    return el(
      'div',
      { className: `day-block${worked ? ' has-hours' : ''}${issue ? ' has-error' : ''}` },
      el(
        'div',
        { className: 'day-head' },
        el('strong', {}, DAY_LABELS[day]),
        el('span', { className: 'day-date' }, `${date.getDate()}/${date.getMonth() + 1}`),
        el(
          'span',
          { className: 'day-hours' },
          worked ? `${formatTotal(worked)} h` : ''
        )
      ),
      el(
        'div',
        { className: 'time-pair' },
        el('label', {}, el('span', {}, 'Entró'), timeField('start')),
        el('label', {}, el('span', {}, 'Salió'), timeField('end'))
      ),
      crossesMidnight(state.times[day]?.start, state.times[day]?.end)
        ? el('div', { className: 'day-note' }, 'Termina al día siguiente')
        : null,
      issue ? el('div', { className: 'day-error' }, issue) : null
    );
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
    el('p', { className: 'sub' }, state.data.listName),

    // The week has to be impossible to miss: a worker filling in the wrong one
    // silently sends the right numbers against the wrong dates.
    weekBanner(week),

    el(
      'p',
      { className: 'howto' },
      'Elige a qué hora entraste y saliste cada día. Deja el día vacío si no trabajaste.'
    ),

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
            `Cambiar a ${relativeWeekName(other.weekOf).toLowerCase()} (${other.label})`
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
    el('p', { className: 'sub' }, 'Si la semana no es la correcta, vuelve y envíala de nuevo.'),
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

/**
 * Re-render, then put the cursor back where it was.
 * Changing one time changes that day's hours, the running total and possibly an
 * error message, so a full re-render is the simplest correct answer — as long
 * as focus survives it.
 */
function renderKeepingFocus(activeEl) {
  const label = activeEl?.getAttribute('aria-label');
  render();
  if (!label) return;
  const again = document.querySelector(`[aria-label="${CSS.escape(label)}"]`);
  again?.focus();
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
      body: JSON.stringify({ workerId: state.workerId, weekOf: state.weekOf, times: state.times })
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
