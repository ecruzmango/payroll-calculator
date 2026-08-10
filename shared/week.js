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

/** Short per-column label, e.g. "Sábado 9/8". Used in the table header. */
export function formatDayHeader(weekOfISO, day, label) {
  const date = datesForWeek(weekOfISO)[day];
  if (!date) return label;
  return `${label} ${date.getDate()}/${date.getMonth() + 1}`;
}
