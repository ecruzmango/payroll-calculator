// Week maths moved to shared/ so the server and the employee form apply the
// same Saturday-to-Friday definition. Re-exported so existing imports work.
export {
  toISODate,
  fromISODate,
  isValidISODate,
  startOfPayrollWeek,
  currentWeekOf,
  addWeeks,
  datesForWeek,
  formatWeekRange,
  formatDayHeader,
  relativeWeekName,
  fullWeekLabel,
  formatToday,
  selectableWeeks
} from '../../shared/week.js';
