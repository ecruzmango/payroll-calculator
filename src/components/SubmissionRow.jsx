import { useState } from 'react';
import { DAYS, DAY_LABELS } from '../constants.js';
import {
  totalHours,
  formatTime,
  hoursFromRange,
  crossesMidnight,
  validateTimesMap,
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
 * One submitted week, collapsed to a line until the owner opens it.
 *
 * The owner adjusts the *times*, not a bare total — "you left at 15:00, not
 * 15:30" is a conversation you can have with a worker, whereas "I changed your
 * 8.5 to 8" is not. Hours are always derived from the times, so the two can
 * never disagree.
 *
 * Editing only affects what is written into the table. The worker's original
 * submission is never overwritten, so there is always a record of what was
 * claimed versus what was paid.
 */
export default function SubmissionRow({ submission, workerName, onApply, onUndo }) {
  const [open, setOpen] = useState(false);
  const [editedTimes, setEditedTimes] = useState(null);
  const [editedHours, setEditedHours] = useState(null); // legacy rows without times

  // Older submissions predate time capture and can only be edited as numbers.
  const hasTimes = Boolean(submission.times);
  const times = editedTimes ?? { ...emptyTimes(), ...(submission.times ?? {}) };
  const check = validateTimesMap(times);

  const hours = hasTimes ? check.hours : (editedHours ?? submission.hours);
  const total = totalHours(hours);
  const originalTotal = totalHours(submission.hours);
  const changed = Math.abs(total - originalTotal) > 0.001;
  const invalid = hasTimes ? !check.ok : DAYS.some(d => hoursIssue(hours[d]));

  const setTime = (day, which, value) => {
    setEditedTimes({ ...times, [day]: { ...times[day], [which]: value } });
  };

  const reset = () => {
    setEditedTimes(null);
    setEditedHours(null);
  };

  const apply = () => {
    onApply(submission, hours);
    setOpen(false);
  };

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
            {/* Applying is one click and writes straight into payroll, so it
                has to be reversible rather than merely confirmed. */}
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
              ? 'Ajusta la hora de entrada o salida si hace falta. Las horas se recalculan solas y lo que envió el trabajador no se modifica.'
              : 'Este envío no incluye horarios. Ajusta las horas directamente.'}
          </p>

          <div className="review-grid">
            {DAYS.map(day => {
              const issue = check.errors[day];
              const worked = hasTimes
                ? hoursFromRange(times[day]?.start, times[day]?.end)
                : Number(hours[day]) || 0;
              const wasChanged = (hours[day] ?? '') !== (submission.hours[day] ?? '');
              const original = submission.times?.[day];

              return (
                <div key={day} className={`review-day${issue ? ' has-issue' : ''}`}>
                  <div className="review-day-head">
                    <span className="review-day-name">{DAY_LABELS[day]}</span>
                    <span className={`review-day-hours${wasChanged ? ' is-edited' : ''}`}>
                      {worked ? `${worked} h` : '—'}
                    </span>
                  </div>

                  {hasTimes ? (
                    <>
                      {/* Stacked, not side by side: a time input with its
                          picker icon needs ~110px, and two of those do not fit
                          in a seventh of the card — they render as "07:". */}
                      <div className="review-times-edit">
                        <label>
                          <span>Entró</span>
                          <input
                            type="time"
                            value={times[day]?.start ?? ''}
                            aria-label={`Entrada ${DAY_LABELS[day]}`}
                            onChange={e => setTime(day, 'start', e.target.value)}
                          />
                        </label>
                        <label>
                          <span>Salió</span>
                          <input
                            type="time"
                            value={times[day]?.end ?? ''}
                            aria-label={`Salida ${DAY_LABELS[day]}`}
                            onChange={e => setTime(day, 'end', e.target.value)}
                          />
                        </label>
                      </div>
                      {/* What the worker actually put, so the owner can see
                          exactly what they changed and by how much. */}
                      {wasChanged && original && (
                        <div className="review-original">
                          Envió {formatTime(original.start)} – {formatTime(original.end)}
                        </div>
                      )}
                      {crossesMidnight(times[day]?.start, times[day]?.end) && (
                        <div className="review-original">Termina al día siguiente</div>
                      )}
                      {issue && <div className="review-issue">{issue}</div>}
                    </>
                  ) : (
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
                  )}
                </div>
              );
            })}
          </div>

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
            <button onClick={apply} disabled={invalid}>
              Aplicar a la tabla
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
