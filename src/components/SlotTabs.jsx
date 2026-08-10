import { MAX_SLOTS } from '../constants.js';

function savedLabel(savedAt) {
  if (!savedAt) return 'Guardado en este navegador';
  const t = new Date(savedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return `Guardado ${t}`;
}

/**
 * The saved worker lists. Which one is in use has to be obvious at a glance —
 * every edit below writes into the highlighted tab.
 */
export default function SlotTabs({
  slots,
  activeSlotId,
  canAddSlot,
  savedAt,
  onSelect,
  onCreate,
  onDuplicate,
  onRename,
  onDelete
}) {
  const activeSlot = slots.find(s => s.id === activeSlotId);

  const handleRename = () => {
    const name = window.prompt('Nombre de la lista:', activeSlot?.name ?? '');
    if (name !== null) onRename(activeSlotId, name);
  };

  const handleDelete = () => {
    const last = slots.length === 1;
    const message = last
      ? `Se borrarán todos los trabajadores de «${activeSlot.name}». Es la única lista, así que no se elimina.\n\n¿Continuar?`
      : `¿Eliminar la lista «${activeSlot.name}» y todos sus trabajadores?`;
    if (window.confirm(message)) onDelete(activeSlotId);
  };

  return (
    <div className="slot-bar">
      <div className="slot-tabs" role="tablist" aria-label="Listas de trabajadores">
        {slots.map(slot => {
          const isActive = slot.id === activeSlotId;
          return (
            <button
              key={slot.id}
              role="tab"
              aria-selected={isActive}
              className={`slot-tab${isActive ? ' is-active' : ''}`}
              onClick={() => onSelect(slot.id)}
            >
              <span className="slot-tab-name">{slot.name}</span>
              <span className="slot-tab-meta">
                {slot.workers.length} {slot.workers.length === 1 ? 'trabajador' : 'trabajadores'}
              </span>
              {isActive && <span className="slot-tab-badge">En uso</span>}
            </button>
          );
        })}

        {canAddSlot && (
          <button className="slot-tab slot-tab-add" onClick={() => onCreate()} title="Crear una lista nueva">
            + Nueva lista
          </button>
        )}
      </div>

      <div className="slot-actions">
        <span className="slot-saved" title="Los cambios se guardan solos en este navegador">
          ✓ {savedLabel(savedAt)}
        </span>
        <button className="btn-secondary btn-small" onClick={handleRename}>
          Renombrar
        </button>
        <button
          className="btn-secondary btn-small"
          onClick={onDuplicate}
          disabled={!canAddSlot}
          title={canAddSlot ? 'Copiar los trabajadores a una lista nueva' : `Máximo ${MAX_SLOTS} listas`}
        >
          Duplicar
        </button>
        <button className="btn-secondary btn-small btn-danger" onClick={handleDelete}>
          Eliminar
        </button>
      </div>
    </div>
  );
}
