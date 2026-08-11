/**
 * Rules shared by the manager app and the employee form.
 *
 * This file is imported by the React app (through src/lib/validation.js) and
 * served verbatim to the employee form, which is plain HTML with no build step.
 * Keep it dependency-free and plain ESM so both sides can use it unchanged —
 * if the two ever disagree about what "8,5 hours" means, payroll is wrong.
 */

// Storage keys stay ASCII so they survive CSV round-trips and URL params.
export const DAYS = ['sabado', 'domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes'];

export const DAY_LABELS = {
  sabado: 'Sábado',
  domingo: 'Domingo',
  lunes: 'Lunes',
  martes: 'Martes',
  miercoles: 'Miércoles',
  jueves: 'Jueves',
  viernes: 'Viernes'
};

// A worker cannot log more than this in a single day. Values above it are
// flagged rather than silently clamped, so a typo stays visible.
export const MAX_HOURS_PER_DAY = 24;

/**
 * Parse a user- or CSV-supplied number. Accepts comma decimal separators and
 * stray whitespace. Returns null when there is no usable number.
 */
export function parseNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).trim().replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Numeric value of a field for arithmetic. Unparseable or negative -> 0. */
export function numericValue(raw) {
  const n = parseNumber(raw);
  if (n === null || n < 0) return 0;
  return n;
}

/** Characters allowed while typing a decimal. Blocks letters and '-'. */
export function isPartialNumber(raw) {
  return raw === '' || /^\d*[.,]?\d*$/.test(String(raw));
}

/**
 * Why a single hours value should be flagged, or null when it is fine.
 * Flagged values still count toward totals so the bad number stays visible.
 */
export function hoursIssue(raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = parseNumber(raw);
  if (n === null) return 'No es un número';
  if (n < 0) return 'No puede ser negativo';
  if (n > MAX_HOURS_PER_DAY) return `Más de ${MAX_HOURS_PER_DAY} horas en un día`;
  return null;
}

/**
 * Validate a full week of submitted hours. Used by the employee form before
 * sending and by the server before storing — the server must never trust the
 * client's own check.
 */
export function validateHoursMap(hours) {
  const errors = {};
  const clean = {};

  for (const day of DAYS) {
    const raw = hours?.[day] ?? '';
    const str = String(raw).trim();
    if (str === '') {
      clean[day] = '';
      continue;
    }
    const issue = hoursIssue(str);
    if (issue) {
      errors[day] = issue;
      continue;
    }
    clean[day] = str.replace(',', '.');
  }

  return { ok: Object.keys(errors).length === 0, errors, hours: clean };
}

export function totalHours(hours) {
  return DAYS.reduce((sum, day) => sum + numericValue(hours?.[day]), 0);
}

// ---- Start/end times -----------------------------------------------------
// Workers enter when they started and finished rather than a total, which is
// both easier to remember and far easier for the owner to sanity-check.

/** "07:30" -> 450 minutes past midnight. null if not a valid time. */
export function minutesOfTime(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * "15:30" -> "3:30 p.m.", for display only.
 *
 * es-MX with hour12 forced. Spanish locales default to 24-hour, which reads as
 * military time to the people using this; es-ES also renders "p. m." with an
 * extra space, which is wider than it needs to be in a dropdown.
 */
export function formatTime(value, locale = 'es-MX') {
  const mins = minutesOfTime(value);
  if (mins === null) return '';
  const d = new Date(2000, 0, 1, Math.floor(mins / 60), mins % 60);
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(d);
}

/**
 * Decimal hours between two times, rounded to 2dp.
 *
 * An end earlier than the start is read as crossing midnight rather than an
 * error — night shifts are real — but callers surface that explicitly so a
 * mistyped time cannot quietly become a 15-hour day.
 */
export function hoursFromRange(start, end) {
  const from = minutesOfTime(start);
  const to = minutesOfTime(end);
  if (from === null || to === null || from === to) return null;

  const span = to > from ? to - from : to + 24 * 60 - from;
  return Math.round((span / 60) * 100) / 100;
}

export const crossesMidnight = (start, end) => {
  const from = minutesOfTime(start);
  const to = minutesOfTime(end);
  return from !== null && to !== null && to < from;
};

/**
 * Every quarter hour of the day, as {value, label} for a <select>.
 *
 * A <select> rather than `input[type=time]` with `step`: browsers treat step as
 * a validation hint and still let the minute column land on any value, so an
 * owner aiming for 6:15 could end up with 6:24. A list of allowed times cannot
 * be wrong.
 */
export function quarterHourOptions(locale = 'es-MX') {
  const options = [];
  for (let mins = 0; mins < 24 * 60; mins += 15) {
    const h = String(Math.floor(mins / 60)).padStart(2, '0');
    const m = String(mins % 60).padStart(2, '0');
    const value = `${h}:${m}`;
    options.push({ value, label: formatTime(value, locale) });
  }
  return options;
}

/**
 * Validate a week of {start,end} pairs and derive the hours from them.
 * The server recomputes with this rather than trusting any total sent by the
 * client — the times are the record, the hours are derived.
 */
export function validateTimesMap(times) {
  const errors = {};
  const clean = {};
  const hours = {};

  for (const day of DAYS) {
    const start = String(times?.[day]?.start ?? '').trim();
    const end = String(times?.[day]?.end ?? '').trim();

    if (!start && !end) {
      clean[day] = null;
      hours[day] = '';
      continue;
    }
    if (!start || !end) {
      errors[day] = 'Falta la hora de entrada o de salida';
      continue;
    }
    if (minutesOfTime(start) === null || minutesOfTime(end) === null) {
      errors[day] = 'Hora no válida';
      continue;
    }

    const worked = hoursFromRange(start, end);
    if (worked === null) {
      errors[day] = 'La entrada y la salida no pueden ser iguales';
      continue;
    }
    if (worked > MAX_HOURS_PER_DAY) {
      errors[day] = `Más de ${MAX_HOURS_PER_DAY} horas en un día`;
      continue;
    }

    clean[day] = { start, end };
    hours[day] = String(worked);
  }

  return { ok: Object.keys(errors).length === 0, errors, times: clean, hours };
}
