import { DAYS, DAY_LABELS } from '../constants.js';
import {
  getTotalHours,
  getTotalPay,
  getDayTotal,
  hoursIssue,
  wageIssue,
  isPartialNumber
} from '../lib/validation.js';
import { formatDayHeader } from '../lib/week.js';

const money = n => `$${n.toFixed(2)}`;

export default function PayrollTable({
  workers,        // already in display order
  weekOf,
  onUpdateWorker,
  onUpdateHour,
  onRemoveWorker
}) {
  // Arrow-key navigation must follow what is on screen. The previous version
  // indexed into the unsorted array, so up/down jumped to the wrong row whenever
  // a sort was active.
  const orderedIds = workers.map(w => w.id);

  const focusCell = (rowId, day) => {
    document.querySelector(`[data-row="${rowId}"][data-day="${day}"]`)?.focus();
  };

  const handleHourKeyDown = (e, workerId, day) => {
    const rowIdx = orderedIds.indexOf(workerId);
    const colIdx = DAYS.indexOf(day);

    if (e.key === 'ArrowRight' && colIdx < DAYS.length - 1) {
      focusCell(workerId, DAYS[colIdx + 1]);
    } else if (e.key === 'ArrowLeft' && colIdx > 0) {
      focusCell(workerId, DAYS[colIdx - 1]);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextRow =
        e.key === 'ArrowDown'
          ? Math.min(rowIdx + 1, orderedIds.length - 1)
          : Math.max(rowIdx - 1, 0);
      focusCell(orderedIds[nextRow], day);
    }
  };

  // Reject letters and '-' as they are typed, but allow partial decimals like
  // "1." so the value can be held as a string until it is parsed for totals.
  const handleNumericChange = (raw, commit) => {
    if (isPartialNumber(raw)) commit(raw);
  };

  return (
    <div className="scroll-container">
      <table className="w-full border">
        <thead className="sticky-header">
          <tr>
            <th className="col-name">Nombre</th>
            <th>Salario</th>
            {DAYS.map(day => (
              <th key={day}>{formatDayHeader(weekOf, day, DAY_LABELS[day])}</th>
            ))}
            <th>Total Horas</th>
            <th>Total Pago</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {workers.map(worker => {
            const wIssue = wageIssue(worker.wage);
            return (
              <tr key={worker.id}>
                <td className="col-name">
                  <input
                    type="text"
                    value={worker.name}
                    placeholder="Nombre"
                    onChange={e => onUpdateWorker(worker.id, 'name', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={wIssue ? 'has-issue' : ''}
                    title={wIssue ?? ''}
                    value={worker.wage}
                    placeholder="0.00"
                    onChange={e =>
                      handleNumericChange(e.target.value, v =>
                        onUpdateWorker(worker.id, 'wage', v)
                      )
                    }
                  />
                </td>
                {DAYS.map(day => {
                  const issue = hoursIssue(worker.hours[day]);
                  return (
                    <td key={day}>
                      <input
                        type="text"
                        inputMode="decimal"
                        className={issue ? 'has-issue' : ''}
                        title={issue ?? ''}
                        value={worker.hours[day]}
                        data-row={worker.id}
                        data-day={day}
                        onChange={e =>
                          handleNumericChange(e.target.value, v =>
                            onUpdateHour(worker.id, day, v)
                          )
                        }
                        onKeyDown={e => handleHourKeyDown(e, worker.id, day)}
                      />
                    </td>
                  );
                })}
                <td>{getTotalHours(worker).toFixed(2)}</td>
                <td>{money(getTotalPay(worker))}</td>
                <td>
                  <button
                    className="btn-icon"
                    onClick={() => onRemoveWorker(worker.id)}
                    aria-label={`Eliminar ${worker.name || 'trabajador'}`}
                  >
                    🗑️
                  </button>
                </td>
              </tr>
            );
          })}

          {workers.length > 0 && (
            <tr className="font-bold">
              <td className="col-name">TOTAL</td>
              <td>-</td>
              {DAYS.map(day => (
                <td key={day}>{getDayTotal(workers, day).toFixed(2)}</td>
              ))}
              <td>{workers.reduce((sum, w) => sum + getTotalHours(w), 0).toFixed(2)}</td>
              <td>{money(workers.reduce((sum, w) => sum + getTotalPay(w), 0))}</td>
              <td>-</td>
            </tr>
          )}

          {workers.length === 0 && (
            <tr>
              <td colSpan={DAYS.length + 5} className="empty-row">
                No hay trabajadores todavía. Usa «Agregar Trabajador» o sube un CSV.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
