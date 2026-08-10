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
