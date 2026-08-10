import { MAX_SLOTS } from '../constants.js';
import { normalizeWorker } from './validation.js';
import { currentWeekOf, isValidISODate } from './week.js';
import { newId } from '../../shared/id.js';

const STORAGE_KEY = 'payroll-calculator:state';

// Bump when the saved shape changes, and add a step to MIGRATIONS.
//   1: { weekOf, workers }              — a single implicit list
//   2: { activeSlotId, slots: [...] }   — up to MAX_SLOTS named lists
//   3: slots gain `server` — the form token and manager secret, once activated
export const SCHEMA_VERSION = 3;

export function makeSlot({ name, weekOf, workers = [], server = null } = {}) {
  return {
    id: newId(),
    name: name || 'Lista 1',
    weekOf: weekOf || currentWeekOf(),
    workers,
    // { token, managerSecret } once the shared form has been activated.
    // The secret is the only copy — losing it means re-creating the list.
    server,
    updatedAt: Date.now()
  };
}

function emptyState() {
  const slot = makeSlot({ name: 'Lista 1' });
  return { schemaVersion: SCHEMA_VERSION, activeSlotId: slot.id, slots: [slot] };
}

/**
 * Version -> function producing the next version. Each step only reshapes; it
 * never drops worker data, so an upgrade is never lossy.
 */
const MIGRATIONS = {
  // The single pre-slot list becomes the first slot, and stays selected.
  1: state => {
    const slot = makeSlot({
      name: 'Lista 1',
      weekOf: state.weekOf,
      workers: Array.isArray(state.workers) ? state.workers : []
    });
    return { schemaVersion: 2, activeSlotId: slot.id, slots: [slot] };
  },

  // No list has a form yet, so every slot starts unactivated.
  2: state => ({
    ...state,
    schemaVersion: 3,
    slots: state.slots.map(s => ({ ...s, server: s.server ?? null }))
  })
};

function migrate(state) {
  let current = state;
  while (current.schemaVersion < SCHEMA_VERSION) {
    const step = MIGRATIONS[current.schemaVersion];
    if (!step) return null; // unknown version: fall back to a clean slate
    current = step(current);
  }
  return current;
}

function normalizeSlot(raw, index, problems) {
  const source = `Lista ${index + 1}`;
  const workers = (Array.isArray(raw?.workers) ? raw.workers : []).map(w => {
    const { worker, problems: p } = normalizeWorker(w, { source });
    problems.push(...p);
    return worker;
  });

  const server =
    raw?.server && typeof raw.server.token === 'string' && typeof raw.server.managerSecret === 'string'
      ? { token: raw.server.token, managerSecret: raw.server.managerSecret }
      : null;

  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : newId(),
    name: String(raw?.name ?? '').trim() || `Lista ${index + 1}`,
    weekOf: isValidISODate(raw?.weekOf) ? raw.weekOf : currentWeekOf(),
    workers,
    server,
    updatedAt: Number(raw?.updatedAt) || Date.now()
  };
}

/**
 * Restore saved state. Never throws — a corrupt or foreign payload yields a
 * clean single list plus a note, rather than a blank screen from a crash.
 */
export function loadState() {
  let parsed;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { state: emptyState(), problems: [] };
    parsed = JSON.parse(raw);
  } catch {
    return {
      state: emptyState(),
      problems: ['No se pudieron leer los datos guardados. Se empezó con una lista vacía.']
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      state: emptyState(),
      problems: ['Los datos guardados tenían un formato desconocido. Se empezó con una lista vacía.']
    };
  }

  const versioned = migrate({ schemaVersion: Number(parsed.schemaVersion) || 0, ...parsed });
  if (!versioned || !Array.isArray(versioned.slots)) {
    return {
      state: emptyState(),
      problems: ['Los datos guardados no se pudieron abrir. Se empezó con una lista vacía.']
    };
  }

  const problems = [];
  let slots = versioned.slots.slice(0, MAX_SLOTS).map((s, i) => normalizeSlot(s, i, problems));
  if (versioned.slots.length > MAX_SLOTS) {
    problems.push(`Solo se pueden abrir ${MAX_SLOTS} listas. Se ignoraron las demás.`);
  }
  if (!slots.length) slots = [makeSlot({ name: 'Lista 1' })];

  const activeSlotId = slots.some(s => s.id === versioned.activeSlotId)
    ? versioned.activeSlotId
    : slots[0].id;

  return { state: { schemaVersion: SCHEMA_VERSION, activeSlotId, slots }, problems };
}

/** Persist state. Returns an error message on failure (e.g. quota), else null. */
export function saveState(state) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        activeSlotId: state.activeSlotId,
        slots: state.slots
      })
    );
    return null;
  } catch {
    return 'No se pudieron guardar los cambios en este navegador.';
  }
}

export function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing useful to do here */
  }
}
