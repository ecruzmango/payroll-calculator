import { formatWeekRange, startOfPayrollWeek, toISODate, fromISODate } from '../lib/week.js';

/**
 * The app holds one active week at a time, so there is deliberately no
 * week-to-week navigation here — arrows would relabel the same hours and look
 * like history that does not exist. The date picker corrects which week the
 * current numbers belong to; "Empezar nueva semana" clears them and moves on.
 */
export default function WeekBar({ weekOf, onChangeWeek, onStartNextWeek, hasWorkers }) {
  // Snap any chosen date back to the Saturday that starts its payroll week.
  const handleDateChange = value => {
    if (!value) return;
    onChangeWeek(toISODate(startOfPayrollWeek(fromISODate(value))));
  };

  return (
    <div className="week-bar">
      <div className="week-label">
        <span className="week-range">Semana del {formatWeekRange(weekOf)}</span>
        <span className="week-sub">sábado a viernes</span>
      </div>

      <div className="week-actions">
        <label className="week-picker">
          <span>Cambiar semana</span>
          <input type="date" value={weekOf} onChange={e => handleDateChange(e.target.value)} />
        </label>
        <button type="button" onClick={onStartNextWeek} disabled={!hasWorkers}>
          Empezar nueva semana
        </button>
      </div>
    </div>
  );
}
