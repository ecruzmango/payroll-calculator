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
  error: null,
  // Errors stay quiet until the worker actually tries to send.
  attempted: false
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
  state.attempted = false;
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

// Typical shift boundaries. Filling these in when a worker first taps an empty
// field means the phone's picker opens on the right side of noon — an empty
// time input otherwise starts at 12:00 AM, so "salió" needed two extra spins.
const DEFAULT_START = '07:00';
const DEFAULT_END = '17:00';

function renderHoursForm() {
  const worker = state.data.workers.find(w => w.id === state.workerId);
  const week = state.data.weeks.find(w => w.weekOf === state.weekOf);
  const other = state.data.weeks.find(w => w.weekOf !== state.weekOf);
  const dates = datesForWeek(state.weekOf);
  const prior = priorSubmission();

  const totalNode = el('span', { id: 'total' }, '0 h');
  const missingNode = el('p', { className: 'missing-hint' }, '');
  const sendBtn = el('button', { className: 'primary', id: 'send' }, 'Enviar mis horas');
  sendBtn.addEventListener('click', () => {
    // Only now does an unfinished day become an error. Turning inputs red the
    // instant someone picks a start time tells them they are doing something
    // wrong when they are simply halfway through.
    state.attempted = true;
    refresh();

    const firstBad = state.data.days.find(d => state.errors[d]);
    if (firstBad) {
      // Seven days do not fit on screen, so point at the problem rather than
      // leaving them to hunt for it.
      document
        .querySelector(`[aria-label="Entrada ${DAY_LABELS[firstBad]}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    submit();
  });

  /**
   * One day, built ONCE and then patched in place.
   *
   * Re-rendering on every input event destroyed the element the phone's time
   * picker was attached to, so the picker slammed shut the moment the wheel
   * moved — iOS fires `input` continuously while scrolling.
   */
  function makeDay(day) {
    const date = dates[day];

    const field = (which, fallback) => {
      const input = el('input', {
        type: 'time',
        value: state.times[day]?.[which] ?? '',
        'aria-label': `${which === 'start' ? 'Entrada' : 'Salida'} ${DAY_LABELS[day]}`,
        oninput: e => {
          state.times[day] = { ...state.times[day], [which]: e.target.value };
          refresh();
        }
      });

      input.addEventListener('focus', () => {
        if (input.value) return;
        input.value = fallback;
        state.times[day] = { ...state.times[day], [which]: fallback };
        refresh();
      });

      return input;
    };

    const startInput = field('start', DEFAULT_START);
    const endInput = field('end', DEFAULT_END);
    const hoursNode = el('span', { className: 'day-hours' }, '');
    const noteNode = el('div', { className: 'day-note' }, '');

    // A visible words-not-symbols control. The ✕ was both easy to miss and
    // ambiguous — it could as easily have meant "delete this day".
    const clearBtn = el(
      'button',
      {
        type: 'button',
        className: 'day-clear',
        onclick: () => {
          state.times[day] = { start: '', end: '' };
          startInput.value = '';
          endInput.value = '';
          refresh();
        }
      },
      'No trabajé'
    );

    const node = el(
      'div',
      { className: 'day-block' },
      el(
        'div',
        { className: 'day-head' },
        el('strong', {}, DAY_LABELS[day]),
        el('span', { className: 'day-date' }, `${date.getDate()}/${date.getMonth() + 1}`),
        hoursNode,
        clearBtn
      ),
      el(
        'div',
        { className: 'time-pair' },
        el('label', {}, el('span', {}, 'Entró'), startInput),
        el('label', {}, el('span', {}, 'Salió'), endInput)
      ),
      noteNode
    );

    const update = check => {
      const issue = check.errors[day];
      const worked = hoursFromRange(state.times[day]?.start, state.times[day]?.end);
      const filled = Boolean(state.times[day]?.start || state.times[day]?.end);
      // Red only once they have tried to send; before that it is just a note.
      const isError = Boolean(issue) && state.attempted;

      hoursNode.textContent = worked ? `${formatTotal(worked)} h` : '';
      noteNode.textContent =
        issue ??
        (crossesMidnight(state.times[day]?.start, state.times[day]?.end)
          ? 'Termina al día siguiente'
          : '');
      noteNode.className = `day-note${isError ? ' is-error' : ''}`;
      node.className = `day-block${worked ? ' has-hours' : ''}`;
      startInput.className = isError && !state.times[day]?.start ? 'bad' : '';
      endInput.className = isError && !state.times[day]?.end ? 'bad' : '';
      clearBtn.hidden = !filled;
    };

    return { node, update };
  }

  const days = state.data.days.map(makeDay);

  /** Recompute everything derived and patch the DOM. Never rebuilds inputs. */
  function refresh() {
    const check = validateTimesMap(state.times);
    state.errors = check.errors;

    days.forEach(d => d.update(check));
    totalNode.textContent = `${formatTotal(totalHours(check.hours))} h`;

    const incomplete = state.data.days.filter(d => check.errors[d]).map(d => DAY_LABELS[d]);
    const nothing = state.data.days.every(d => !state.times[d]?.start && !state.times[d]?.end);

    // Naming the unfinished days beats a disabled button with no explanation.
    missingNode.textContent = incomplete.length
      ? `Completa la entrada y la salida de: ${incomplete.join(', ')}.`
      : nothing
        ? 'Añade al menos un día para enviar.'
        : '';

    // Deliberately NOT disabled for incomplete days: a dead button explains
    // nothing, whereas pressing it can say exactly which day is unfinished.
    sendBtn.disabled = state.sending || nothing;
    sendBtn.className = `primary${incomplete.length ? ' is-blocked' : ''}`;
    sendBtn.textContent = state.sending
      ? 'Enviando…'
      : prior
        ? 'Actualizar mis horas'
        : 'Enviar mis horas';
  }

  refresh();

  return [
    el('h1', {}, `Hola, ${worker.name}`),
    el('p', { className: 'sub' }, state.data.listName),

    // The week has to be impossible to miss: a worker filling in the wrong one
    // silently sends the right numbers against the wrong dates.
    weekBanner(week),

    el(
      'p',
      { className: 'howto' },
      'Elige a qué hora entraste y saliste cada día. Si no trabajaste, toca «No trabajé».'
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
      days.map(d => d.node),
      el('div', { className: 'total-line' }, el('span', {}, 'Total'), totalNode)
    ),

    missingNode,
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
