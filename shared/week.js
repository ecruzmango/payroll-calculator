import { DAYS } from './hours-rules.js';

// The payroll week runs Saturday -> Friday, matching the column order in DAYS.
const WEEK_START_DOW = 6; // Date.getDay(): 0 = Sunday, 6 = Saturday

/** ISO date string (YYYY-MM-DD) for a Date, in local time. */
export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse YYYY-MM-DD as a local date (not UTC, which would shift the day). */
export function fromISODate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isValidISODate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return false;
  const d = fromISODate(iso);
  return !Number.isNaN(d.getTime()) && toISODate(d) === iso;
}

/** The Saturday on or before `date`. */
export function startOfPayrollWeek(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = (d.getDay() - WEEK_START_DOW + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

export function currentWeekOf() {
  return toISODate(startOfPayrollWeek());
}

export function addWeeks(weekOfISO, n) {
  const d = fromISODate(weekOfISO);
  d.setDate(d.getDate() + n * 7);
  return toISODate(d);
}

/** Map of day key -> Date for the week beginning at weekOfISO. */
export function datesForWeek(weekOfISO) {
  const start = fromISODate(weekOfISO);
  return DAYS.reduce((acc, day, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    acc[day] = d;
    return acc;
  }, {});
}

/** "9 – 15 de agosto de 2026" */
export function formatWeekRange(weekOfISO, locale = 'es-ES') {
  const start = fromISODate(weekOfISO);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();

  const dayOnly = new Intl.DateTimeFormat(locale, { day: 'numeric' });
  const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' });
  const full = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' });

  if (sameMonth && sameYear) return `${dayOnly.format(start)} – ${full.format(end)}`;
  if (sameYear) return `${dayMonth.format(start)} – ${full.format(end)}`;
  return `${full.format(start)} – ${full.format(end)}`;
}

/**
 * How a week reads relative to today: "Esta semana", "Semana pasada", etc.
 *
 * Raw dates alone force people to work out which week they are looking at every
 * single time. A relative name is what stops the owner picking the wrong one.
 */
export function relativeWeekName(weekOfISO, today = new Date()) {
  const current = toISODate(startOfPayrollWeek(today));
  const diff = Math.round(
    (fromISODate(weekOfISO) - fromISODate(current)) / (7 * 24 * 60 * 60 * 1000)
  );

  if (diff === 0) return 'Esta semana';
  if (diff === -1) return 'Semana pasada';
  if (diff === 1) return 'Próxima semana';
  if (diff < -1) return `Hace ${Math.abs(diff)} semanas`;
  return `En ${diff} semanas`;
}

/** "Esta semana · 8 – 14 de agosto de 2026" */
export function fullWeekLabel(weekOfISO, today = new Date()) {
  return `${relativeWeekName(weekOfISO, today)} · ${formatWeekRange(weekOfISO)}`;
}

/** Today, spelled out: "lunes 10 de agosto". */
export function formatToday(today = new Date(), locale = 'es-ES') {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(today);
}

/**
 * The weeks offered in the owner's picker: a couple ahead, several behind.
 * Choosing from named weeks removes the guesswork a raw date field creates.
 */
export function selectableWeeks(today = new Date(), { back = 5, forward = 1 } = {}) {
  const current = toISODate(startOfPayrollWeek(today));
  const weeks = [];
  for (let i = forward; i >= -back; i--) {
    const weekOf = addWeeks(current, i);
    weeks.push({ weekOf, name: relativeWeekName(weekOf, today), range: formatWeekRange(weekOf) });
  }
  return weeks;
}

/** Short per-column label, e.g. "Sábado 9/8". Used in the table header. */
export function formatDayHeader(weekOfISO, day, label) {
  const date = datesForWeek(weekOfISO)[day];
  if (!date) return label;
  return `${label} ${date.getDate()}/${date.getMonth() + 1}`;
}
