import { useState } from 'react';
import { DAYS, DAY_LABELS } from '../constants.js';
import { totalHours, formatTime, isPartialNumber, hoursIssue } from '../../shared/hours-rules.js';

const timeAgo = ts => {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(ts).toLocaleDateString('es-ES');
};

const show = v => (v === '' || v === undefined || v === null ? '–' : v);

/**
 * One submitted week, collapsed to a single line until the owner opens it.
 *
 * Workers sometimes round their hours up, so the owner needs to adjust before
 * the numbers reach payroll. Editing happens here and only affects what gets
 * written into the table — the worker's original submission is never
 * overwritten, so there is always a record of what they actually claimed.
 */
export default function SubmissionRow({ submission, workerName, onApply }) {
  const [open, setOpen] = useState(false);
  const [edited, setEdited] = useState(null); // null until the owner changes something

  const hours = edited ?? submission.hours;
  const changed = edited !== null && DAYS.some(d => (edited[d] ?? '') !== (submission.hours[d] ?? ''));
  const total = totalHours(hours);
  const originalTotal = totalHours(submission.hours);
  const invalid = DAYS.some(d => hoursIssue(hours[d]));

  const setDay = (day, value) => {
    if (!isPartialNumber(value)) return;
    setEdited({ ...(edited ?? submission.hours), [day]: value });
  };

  const apply = () => {
    onApply(submission, hours);
    setOpen(false);
  };

  return (
    <div className={`inbox-row${submission.appliedAt ? ' is-applied' : ''}${open ? ' is-open' : ''}`}>
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
          <span className="applied-mark">✓ Aplicado</span>
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
            Ajusta las horas si hace falta. Se guarda lo que apliques; lo que envió el
            trabajador no se modifica.
          </p>

          <div className="review-grid">
            {DAYS.map(day => {
              const t = submission.times?.[day];
              const issue = hoursIssue(hours[day]);
              const wasChanged = (hours[day] ?? '') !== (submission.hours[day] ?? '');

              return (
                <div key={day} className="review-day">
                  <div className="review-day-name">{DAY_LABELS[day]}</div>
                  <div className="review-times">
                    {t ? `${formatTime(t.start)} – ${formatTime(t.end)}` : '—'}
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={issue ? 'has-issue' : wasChanged ? 'is-edited' : ''}
                    title={issue ?? ''}
                    value={hours[day] ?? ''}
                    placeholder="0"
                    onChange={e => setDay(day, e.target.value)}
                  />
                </div>
              );
            })}
          </div>

          <div className="review-foot">
            {changed && (
              <button className="btn-secondary btn-small" onClick={() => setEdited(null)}>
                Deshacer cambios
              </button>
            )}
            <span className="review-total">
              Total <strong>{total} h</strong>
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
