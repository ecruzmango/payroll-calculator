import { useMemo, useState } from 'react';
import { DAYS, DAY_LABELS } from '../constants.js';
import {
  totalHours,
  formatTime,
  hoursFromRange,
  crossesMidnight,
  validateTimesMap,
  quarterHourOptions,
  isPartialNumber,
  hoursIssue
} from '../../shared/hours-rules.js';

const timeAgo = ts => {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(ts).toLocaleDateString('es-ES');
};

const show = v => (v === '' || v === undefined || v === null ? '–' : v);
const emptyTimes = () => Object.fromEntries(DAYS.map(d => [d, { start: '', end: '' }]));

/**
 * A time dropdown restricted to quarter hours.
 *
 * If the worker submitted something off-grid (they typed 15:22 on their phone)
 * that exact value is added to the list, so merely opening the editor can never
 * silently round somebody's day.
 */
function TimeSelect({ value, onChange, label, options }) {
  const list = value && !options.some(o => o.value === value)
    ? [{ value, label: `${formatTime(value)} (enviado)` }, ...options]
    : options;

  return (
    <select
      className="time-select"
      value={value ?? ''}
      aria-label={label}
      onChange={e => onChange(e.target.value)}
    >
      <option value="">—</option>
      {list.map(o => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * One submitted week, collapsed to a line until the owner opens it.
 *
 * The owner adjusts the *times*, not a bare total — "you left at 15:00, not
 * 15:30" is a conversation you can have with a worker, whereas "I changed your
 * 8.5 to 8" is not. Hours are always derived from the times.
 *
 * Editing only affects what is written into the table. The worker's original
 * submission is never overwritten, so there is always a record of what was
 * claimed versus what was paid.
 */
export default function SubmissionRow({ submission, workerName, onApply, onUndo }) {
  const [open, setOpen] = useState(false);
  const [editedTimes, setEditedTimes] = useState(null);
  const [editedHours, setEditedHours] = useState(null); // legacy rows without times

  const options = useMemo(() => quarterHourOptions(), []);

  // Older submissions predate time capture and can only be edited as numbers.
  const hasTimes = Boolean(submission.times);
  const times = editedTimes ?? { ...emptyTimes(), ...(submission.times ?? {}) };
  const check = validateTimesMap(times);

  const hours = hasTimes ? check.hours : (editedHours ?? submission.hours);
  const total = totalHours(hours);
  const originalTotal = totalHours(submission.hours);
  const changed = Math.abs(total - originalTotal) > 0.001;
  const invalid = hasTimes ? !check.ok : DAYS.some(d => hoursIssue(hours[d]));

  const setTime = (day, which, value) =>
    setEditedTimes({ ...times, [day]: { ...times[day], [which]: value } });

  const clearDay = day => setEditedTimes({ ...times, [day]: { start: '', end: '' } });

  const reset = () => {
    setEditedTimes(null);
    setEditedHours(null);
  };

  const apply = () => onApply(submission, hours);

  /**
   * Closes the editor keeping the changes. Deliberately does not apply:
   * confirming an edit and committing it to payroll are two different
   * decisions, and merging them meant every correction went straight through.
   */
  const doneEditing = () => setOpen(false);

  return (
    <div className={`inbox-row${submission.appliedAt ? ' is-applied' : ''}`}>
      <div className="inbox-summary">
        <div className="inbox-who">
          <strong>{workerName}</strong>
          <span>{timeAgo(submission.submittedAt)}</span>
        </div>

        <div className="inbox-hours">
          {DAYS.map(d => (
            <span
              key={d}
              className={`pill${(hours[d] ?? '') !== (submission.hours[d] ?? '') ? ' is-edited' : ''}`}
              title={DAY_LABELS[d]}
            >
              {show(hours[d])}
            </span>
          ))}
        </div>

        <div className="inbox-total">
          {total} h
          {changed && <span className="was">antes {originalTotal} h</span>}
        </div>

        {submission.appliedAt ? (
          <div className="inbox-actions">
            <span className="applied-mark">✓ Aplicado</span>
            {/* Applying writes straight into payroll off one click, so it has
                to be reversible rather than merely confirmed. */}
            <button className="btn-secondary btn-small" onClick={() => onUndo(submission)}>
              Deshacer
            </button>
          </div>
        ) : (
          <div className="inbox-actions">
            <button className="btn-secondary btn-small" onClick={() => setOpen(o => !o)}>
              {open ? 'Cerrar' : 'Revisar'}
            </button>
            <button className="btn-small" onClick={apply} disabled={invalid}>
              Aplicar
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="review">
          <p className="review-help">
            {hasTimes
              ? 'Ajusta la entrada o la salida. Las horas se recalculan solas y lo que envió el trabajador no se modifica.'
              : 'Este envío no incluye horarios. Ajusta las horas directamente.'}
          </p>

          {/* A table, not a grid of cards: seven cards wrapped onto two rows and
              made the week impossible to compare at a glance. One row per day
              reads top to bottom in the same order as the days themselves. */}
          <table className="review-table">
            <thead>
              <tr>
                <th>Día</th>
                <th>Entró</th>
                <th>Salió</th>
                <th className="num">Horas</th>
                <th>Envió</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {DAYS.map(day => {
                const issue = check.errors[day];
                const worked = hasTimes
                  ? hoursFromRange(times[day]?.start, times[day]?.end)
                  : Number(hours[day]) || 0;
                const wasChanged = (hours[day] ?? '') !== (submission.hours[day] ?? '');
                const original = submission.times?.[day];
                const filled = Boolean(times[day]?.start || times[day]?.end);

                return (
                  <tr key={day} className={issue ? 'has-issue' : ''}>
                    <td className="review-day-name">{DAY_LABELS[day]}</td>

                    {hasTimes ? (
                      <>
                        <td>
                          <TimeSelect
                            value={times[day]?.start}
                            options={options}
                            label={`Entrada ${DAY_LABELS[day]}`}
                            onChange={v => setTime(day, 'start', v)}
                          />
                        </td>
                        <td>
                          <TimeSelect
                            value={times[day]?.end}
                            options={options}
                            label={`Salida ${DAY_LABELS[day]}`}
                            onChange={v => setTime(day, 'end', v)}
                          />
                        </td>
                      </>
                    ) : (
                      <td colSpan={2}>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={hours[day] ?? ''}
                          placeholder="0"
                          onChange={e =>
                            isPartialNumber(e.target.value) &&
                            setEditedHours({ ...hours, [day]: e.target.value })
                          }
                        />
                      </td>
                    )}

                    <td className={`num${wasChanged ? ' is-edited' : ''}`}>
                      {worked ? `${worked} h` : '—'}
                    </td>

                    {/* What the worker actually claimed, so any change is visible
                        next to the value that replaced it. */}
                    <td className="review-sent">
                      {issue ? (
                        <span className="review-issue">{issue}</span>
                      ) : crossesMidnight(times[day]?.start, times[day]?.end) ? (
                        'Termina al día siguiente'
                      ) : original ? (
                        `${formatTime(original.start)} – ${formatTime(original.end)}`
                      ) : (
                        '—'
                      )}
                    </td>

                    <td>
                      {hasTimes && filled && (
                        <button
                          className="btn-secondary btn-small"
                          onClick={() => clearDay(day)}
                          title="No trabajó este día"
                        >
                          Borrar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="review-foot">
            {(editedTimes || editedHours) && (
              <button className="btn-secondary btn-small" onClick={reset}>
                Deshacer cambios
              </button>
            )}
            <span className="review-total">
              Total <strong>{total} h</strong>
              {changed && <span className="was"> antes {originalTotal} h</span>}
            </span>
            <button onClick={doneEditing} disabled={invalid}>
              {changed ? 'Guardar cambios' : 'Cerrar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
