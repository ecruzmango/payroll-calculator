import {
  formatWeekRange,
  relativeWeekName,
  formatToday,
  selectableWeeks,
  currentWeekOf
} from '../lib/week.js';

/**
 * The app holds one active week at a time, and everything follows it — the
 * worker form, the reminder, the inbox. So which week is selected has to be
 * unmistakable.
 *
 * The picker lists named weeks rather than taking a date. A date field looked
 * editable but silently snapped to the Saturday that starts the payroll week,
 * so choosing "10 August" showed "8 August" and left the owner checking every
 * time whether it had understood them.
 */
export default function WeekBar({ weekOf, onChangeWeek, onStartNextWeek, hasWorkers }) {
  const weeks = selectableWeeks();
  // Keep an unusually old week selectable rather than silently dropping it.
  const options = weeks.some(w => w.weekOf === weekOf)
    ? weeks
    : [{ weekOf, name: relativeWeekName(weekOf), range: formatWeekRange(weekOf) }, ...weeks];

  const isCurrent = weekOf === currentWeekOf();
  const isPast = weekOf < currentWeekOf();

  return (
    <div className={`week-bar${isCurrent ? '' : ' is-off-week'}`}>
      <div className="week-label">
        <span className="week-range">
          <span className={`week-chip${isCurrent ? ' is-current' : ''}`}>
            {relativeWeekName(weekOf)}
          </span>
          {formatWeekRange(weekOf)}
        </span>
        <span className={`week-sub${isPast ? ' week-behind' : ''}`}>
          {isPast
            ? `Hoy es ${formatToday()}. Estás cobrando una semana pasada.`
            : `Hoy es ${formatToday()} · sábado a viernes`}
        </span>
      </div>

      <div className="week-actions">
        <label className="week-picker">
          <span>Semana</span>
          <select value={weekOf} onChange={e => onChangeWeek(e.target.value)}>
            {options.map(w => (
              <option key={w.weekOf} value={w.weekOf}>
                {w.name} · {w.range}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={onStartNextWeek} disabled={!hasWorkers}>
          Empezar nueva semana
        </button>
      </div>
    </div>
  );
}
