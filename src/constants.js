// Day keys, labels and the per-day cap live in shared/hours-rules.js so the
// employee form applies exactly the same rules. Re-exported here so existing
// imports keep working.
export { DAYS, DAY_LABELS, MAX_HOURS_PER_DAY } from '../shared/hours-rules.js';

// How many saved worker lists the app keeps. Kept small on purpose: the tab
// strip has to stay readable, and this is a roster manager, not a filesystem.
export const MAX_SLOTS = 4;
