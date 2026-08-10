import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DAYS, MAX_SLOTS } from '../constants.js';
import { loadState, saveState, makeSlot } from '../lib/storage.js';
import { makeWorker } from '../lib/validation.js';
import { addWeeks } from '../lib/week.js';
import { newId } from '../../shared/id.js';

const emptyHours = () => DAYS.reduce((acc, day) => ({ ...acc, [day]: '' }), {});

/**
 * Owns the whole saved document: up to MAX_SLOTS named worker lists, which one
 * is selected, and persistence. Every worker action applies to the active slot.
 *
 * Numeric fields are stored as the raw strings the user typed; parsing happens
 * in the total helpers. See the note in lib/validation.js.
 */
export function usePayroll() {
  const [initial] = useState(loadState);
  const [slots, setSlots] = useState(initial.state.slots);
  const [activeSlotId, setActiveSlotId] = useState(initial.state.activeSlotId);
  const [storageError, setStorageError] = useState(null);
  const [loadProblems, setLoadProblems] = useState(initial.problems);
  const [savedAt, setSavedAt] = useState(null);

  // Only write when the content actually differs from what is already stored.
  // A mount-time flag is not enough: StrictMode runs effects twice in dev, and
  // the second pass would overwrite saved data that failed to load cleanly.
  const lastSaved = useRef(
    JSON.stringify({ activeSlotId: initial.state.activeSlotId, slots: initial.state.slots })
  );
  useEffect(() => {
    const payload = JSON.stringify({ activeSlotId, slots });
    if (payload === lastSaved.current) return;

    const error = saveState({ activeSlotId, slots });
    setStorageError(error);
    if (!error) {
      lastSaved.current = payload;
      setSavedAt(Date.now());
    }
  }, [slots, activeSlotId, initial]);

  const activeSlot = useMemo(
    () => slots.find(s => s.id === activeSlotId) ?? slots[0],
    [slots, activeSlotId]
  );

  /** Apply a change to the active slot and stamp its updatedAt. */
  const patchActive = useCallback(
    updater => {
      setSlots(prev =>
        prev.map(s => (s.id === activeSlotId ? { ...s, ...updater(s), updatedAt: Date.now() } : s))
      );
    },
    [activeSlotId]
  );

  const patchWorkers = useCallback(
    fn => patchActive(slot => ({ workers: fn(slot.workers) })),
    [patchActive]
  );

  // ---- Worker actions (scoped to the active slot) ----

  const addWorker = useCallback(
    () => patchWorkers(ws => [...ws, makeWorker()]),
    [patchWorkers]
  );

  const removeWorker = useCallback(
    id => patchWorkers(ws => ws.filter(w => w.id !== id)),
    [patchWorkers]
  );

  const updateWorker = useCallback(
    (id, key, value) => patchWorkers(ws => ws.map(w => (w.id === id ? { ...w, [key]: value } : w))),
    [patchWorkers]
  );

  const updateHour = useCallback(
    (id, day, value) =>
      patchWorkers(ws =>
        ws.map(w => (w.id === id ? { ...w, hours: { ...w.hours, [day]: value } } : w))
      ),
    [patchWorkers]
  );

  const replaceWorkers = useCallback(next => patchWorkers(() => next), [patchWorkers]);

  /** Store the form token and manager secret after activating the shared link. */
  const setSlotServer = useCallback(server => patchActive(() => ({ server })), [patchActive]);

  /**
   * Write a worker's submitted hours into the table. Applied deliberately, one
   * submission at a time, so nothing reaches payroll without being looked at.
   */
  const applySubmittedHours = useCallback(
    (workerId, hours) =>
      patchWorkers(ws =>
        ws.map(w =>
          w.id === workerId ? { ...w, hours: { ...emptyHours(), ...hours } } : w
        )
      ),
    [patchWorkers]
  );

  const setWeekOf = useCallback(weekOf => patchActive(() => ({ weekOf })), [patchActive]);

  /** Advance to the next week: keep names, wages and phones; clear the hours. */
  const startNextWeek = useCallback(
    () =>
      patchActive(slot => ({
        weekOf: addWeeks(slot.weekOf, 1),
        workers: slot.workers.map(w => ({ ...w, hours: emptyHours() }))
      })),
    [patchActive]
  );

  // ---- Slot actions ----

  const canAddSlot = slots.length < MAX_SLOTS;

  const createSlot = useCallback(
    name => {
      if (slots.length >= MAX_SLOTS) return;
      const slot = makeSlot({ name: name || `Lista ${slots.length + 1}` });
      setSlots(prev => [...prev, slot]);
      setActiveSlotId(slot.id);
    },
    [slots.length]
  );

  /**
   * Copy the active list — same people and wages, no hours. The copy gets no
   * server credentials: it is a different list and needs its own form link.
   */
  const duplicateActiveSlot = useCallback(() => {
    if (slots.length >= MAX_SLOTS || !activeSlot) return;
    const slot = makeSlot({
      name: `${activeSlot.name} (copia)`.slice(0, 40),
      weekOf: activeSlot.weekOf,
      workers: activeSlot.workers.map(w => ({ ...w, id: newId(), hours: emptyHours() }))
    });
    setSlots(prev => [...prev, slot]);
    setActiveSlotId(slot.id);
  }, [slots.length, activeSlot]);

  const renameSlot = useCallback((id, name) => {
    const clean = String(name).trim().slice(0, 40);
    if (!clean) return;
    setSlots(prev => prev.map(s => (s.id === id ? { ...s, name: clean } : s)));
  }, []);

  /** Delete a list. The last remaining one is never removed, only emptied. */
  const deleteSlot = useCallback(
    id => {
      // Computed outside the updater: setSlots' callback can run twice under
      // StrictMode, and selecting a slot from inside it would be a side effect.
      if (slots.length === 1) {
        // Emptied rather than removed, and its form credentials are dropped too:
        // the caller has just deleted the list on the server, so the old token
        // is dead and activating again must mint a fresh one.
        setSlots([{ ...slots[0], workers: [], server: null, updatedAt: Date.now() }]);
        return;
      }
      const next = slots.filter(s => s.id !== id);
      setSlots(next);
      if (id === activeSlotId) setActiveSlotId(next[0].id);
    },
    [slots, activeSlotId]
  );

  return {
    slots,
    activeSlot,
    activeSlotId,
    canAddSlot,
    selectSlot: setActiveSlotId,
    createSlot,
    duplicateActiveSlot,
    renameSlot,
    deleteSlot,

    workers: activeSlot?.workers ?? [],
    weekOf: activeSlot?.weekOf,
    setWeekOf,
    addWorker,
    removeWorker,
    updateWorker,
    updateHour,
    replaceWorkers,
    startNextWeek,
    setSlotServer,
    applySubmittedHours,

    storageError,
    savedAt,
    loadProblems,
    dismissLoadProblems: () => setLoadProblems([])
  };
}
