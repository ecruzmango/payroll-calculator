import Papa from 'papaparse';
import { saveAs } from 'file-saver';
import { DAYS } from '../constants.js';
import { normalizeWorker } from './validation.js';

/**
 * Parse a CSV file into workers. Resolves with { workers, problems } — it never
 * rejects on bad rows, so one malformed cell cannot discard the whole import.
 */
export function importWorkersFromCsv(file) {
  return new Promise(resolve => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: h => String(h).trim().toLowerCase(),
      complete: result => {
        // e.row is a 0-based index into the data rows; +2 accounts for that and
        // for the header line, matching the "Fila N" labels used below.
        const problems = result.errors
          .slice(0, 5)
          .map(e => `Fila ${(e.row ?? 0) + 2}: ${e.message}`);

        const headers = result.meta.fields ?? [];
        if (!headers.includes('name')) {
          problems.push('El archivo no tiene una columna "name". No se importó nada.');
          resolve({ workers: null, problems });
          return;
        }

        const missingDays = DAYS.filter(d => !headers.includes(d));
        if (missingDays.length) {
          problems.push(`Faltan columnas de días: ${missingDays.join(', ')}. Se dejaron vacías.`);
        }

        const workers = [];
        result.data.forEach((row, i) => {
          const isBlank = Object.values(row).every(v => String(v ?? '').trim() === '');
          if (isBlank) return;
          const { worker, problems: p } = normalizeWorker(row, { source: `Fila ${i + 2}` });
          problems.push(...p);
          workers.push(worker);
        });

        if (!workers.length) problems.push('El archivo no tenía filas con datos.');

        resolve({ workers: workers.length ? workers : null, problems });
      },
      error: err => resolve({ workers: null, problems: [`No se pudo leer el archivo: ${err.message}`] })
    });
  });
}

export function exportWorkersToCsv(workers, weekOf, listName = 'trabajadores') {
  const csv = Papa.unparse(
    workers.map(w => ({
      name: w.name,
      wage: w.wage,
      phone: w.phone,
      ...DAYS.reduce((acc, d) => ({ ...acc, [d]: w.hours[d] }), {})
    }))
  );
  saveAs(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `${listName}-${weekOf}.csv`);
}
