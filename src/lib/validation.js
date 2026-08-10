import { DAYS } from '../constants.js';
import { parseNumber, numericValue, isPartialNumber, hoursIssue } from '../../shared/hours-rules.js';
import { newId } from '../../shared/id.js';

// Numeric fields are held in state as the raw string the user typed, and parsed
// only when a total is computed. Parsing on every keystroke breaks partial input:
// parseFloat('1.') === 1, so typing "1.5" would collapse to "15".
//
// The parsing and per-day rules themselves live in shared/hours-rules.js, which
// the employee form loads directly, so both sides always agree.
export { parseNumber, numericValue, isPartialNumber, hoursIssue };

export function wageIssue(raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = parseNumber(raw);
  if (n === null) return 'No es un número';
  if (n < 0) return 'No puede ser negativo';
  return null;
}

/** Every problem in the current roster, for the warning banner. */
export function collectIssues(workers) {
  const issues = [];
  for (const w of workers) {
    const label = w.name.trim() || '(sin nombre)';
    const wIssue = wageIssue(w.wage);
    if (wIssue) issues.push(`${label} — Salario: ${wIssue}`);
    for (const day of DAYS) {
      const hIssue = hoursIssue(w.hours[day]);
      if (hIssue) issues.push(`${label} — ${day}: ${hIssue}`);
    }
  }
  return issues;
}

export function makeWorker(overrides = {}) {
  return {
    id: newId(),
    name: '',
    wage: '',
    // Reserved for a later phase (tap-to-WhatsApp for workers who haven't
    // submitted). Kept in the schema now so saved data needs no migration then.
    phone: '',
    hours: DAYS.reduce((acc, day) => ({ ...acc, [day]: '' }), {}),
    ...overrides
  };
}

/**
 * Coerce anything (parsed CSV row, restored localStorage entry) into a valid
 * worker. Returns the worker plus any problems found, so the caller can report
 * them instead of silently discarding data.
 */
export function normalizeWorker(raw, { source = 'datos' } = {}) {
  const problems = [];
  const input = raw && typeof raw === 'object' ? raw : {};

  const hours = {};
  for (const day of DAYS) {
    const value = input.hours?.[day] ?? input[day] ?? '';
    const str = String(value).trim();
    if (str === '') {
      hours[day] = '';
      continue;
    }
    const n = parseNumber(str);
    if (n === null) {
      problems.push(`${source}: "${str}" no es un número válido para ${day}`);
      hours[day] = '';
    } else if (n < 0) {
      problems.push(`${source}: horas negativas en ${day}, se usó 0`);
      hours[day] = '0';
    } else {
      // Keep what was typed (minus a comma separator) rather than String(n),
      // which would turn "8.50" into "8.5".
      hours[day] = str.replace(',', '.');
    }
  }

  const rawWage = String(input.wage ?? '').trim();
  let wage = '';
  if (rawWage !== '') {
    const stripped = rawWage.replace(/[$\s]/g, '');
    const n = parseNumber(stripped);
    if (n === null) {
      problems.push(`${source}: salario "${rawWage}" no es un número válido`);
    } else if (n < 0) {
      problems.push(`${source}: salario negativo, se usó 0`);
      wage = '0';
    } else {
      wage = stripped.replace(',', '.');
    }
  }

  const worker = makeWorker({
    id: typeof input.id === 'string' && input.id ? input.id : newId(),
    name: String(input.name ?? '').trim(),
    wage,
    phone: String(input.phone ?? '').trim(),
    hours
  });

  return { worker, problems };
}

export const getTotalHours = w => DAYS.reduce((sum, d) => sum + numericValue(w.hours[d]), 0);
export const getTotalPay = w => getTotalHours(w) * numericValue(w.wage);
export const getDayTotal = (workers, day) =>
  workers.reduce((sum, w) => sum + numericValue(w.hours[day]), 0);
