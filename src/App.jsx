import { useMemo, useState } from 'react';
import Toolbar from './components/Toolbar.jsx';
import WeekBar from './components/WeekBar.jsx';
import SlotTabs from './components/SlotTabs.jsx';
import FormPanel from './components/FormPanel.jsx';
import PayrollTable from './components/PayrollTable.jsx';
import Notice from './components/Notice.jsx';
import { usePayroll } from './hooks/usePayroll.js';
import { importWorkersFromCsv, exportWorkersToCsv } from './lib/csv.js';
import { deleteRemoteList } from './lib/api.js';
import { exportPayrollPdf } from './lib/pdf.js';
import { collectIssues } from './lib/validation.js';

export default function PayrollManager() {
  const {
    slots,
    activeSlot,
    activeSlotId,
    canAddSlot,
    selectSlot,
    createSlot,
    duplicateActiveSlot,
    renameSlot,
    deleteSlot,
    workers,
    weekOf,
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
    dismissLoadProblems
  } = usePayroll();

  const [sortOrder, setSortOrder] = useState('created');
  const [importProblems, setImportProblems] = useState([]);
  const [deleteWarning, setDeleteWarning] = useState(null);

  const sortedWorkers = useMemo(() => {
    if (sortOrder === 'created') return workers;
    const copy = [...workers];
    copy.sort((a, b) =>
      sortOrder === 'az' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
    );
    return copy;
  }, [workers, sortOrder]);

  const issues = useMemo(() => collectIssues(workers), [workers]);

  const handleCsvFile = async file => {
    const { workers: imported, problems } = await importWorkersFromCsv(file);
    setImportProblems(problems);
    if (!imported) return;

    if (
      workers.length > 0 &&
      !window.confirm(
        `Se importarán ${imported.length} trabajadores en «${activeSlot.name}» y se reemplazarán los ${workers.length} actuales. ¿Continuar?`
      )
    ) {
      return;
    }

    replaceWorkers(imported);
  };

  /**
   * Delete a list locally and on the server. If the server can't be reached the
   * local delete still goes through — the owner asked for it — but they are told,
   * because a list left on the server keeps sending weekly reminders.
   */
  const handleDeleteSlot = async id => {
    const slot = slots.find(s => s.id === id);
    if (slot?.server) {
      try {
        await deleteRemoteList({ listId: id, managerSecret: slot.server.managerSecret });
      } catch {
        setDeleteWarning(
          `Se eliminó «${slot.name}» de este navegador, pero no se pudo avisar al servidor. ` +
            'Vuelve a intentarlo cuando haya conexión para que deje de mandar recordatorios.'
        );
      }
    }
    deleteSlot(id);
  };

  const handleRemoveWorker = id => {
    const worker = workers.find(w => w.id === id);
    const label = worker?.name.trim() || 'este trabajador';
    if (window.confirm(`¿Estás seguro de que quieres eliminar a ${label}?`)) {
      removeWorker(id);
    }
  };

  const handleStartNextWeek = () => {
    if (
      window.confirm(
        'Se borrarán todas las horas y se avanzará a la siguiente semana. Los nombres y salarios se mantienen.\n\n¿Descargaste el PDF o CSV de esta semana?'
      )
    ) {
      startNextWeek();
    }
  };

  const exportName = `${activeSlot.name.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div className="page space-y-6">
      <h1>Pagos</h1>

      <div className="card">
        <div className="card-content">
          <Notice
            tone="error"
            title="Datos guardados"
            messages={loadProblems}
            onDismiss={dismissLoadProblems}
          />
          <Notice
            tone="error"
            title="No se pudo guardar"
            messages={storageError ? [storageError] : []}
          />
          <Notice
            tone="warn"
            title="Problemas al importar el CSV"
            messages={importProblems}
            onDismiss={() => setImportProblems([])}
          />
          <Notice
            tone="warn"
            title="Lista eliminada"
            messages={deleteWarning ? [deleteWarning] : []}
            onDismiss={() => setDeleteWarning(null)}
          />
          <Notice tone="warn" title="Revisa estos valores" messages={issues} />

          <SlotTabs
            slots={slots}
            activeSlotId={activeSlotId}
            canAddSlot={canAddSlot}
            savedAt={savedAt}
            onSelect={selectSlot}
            onCreate={createSlot}
            onDuplicate={duplicateActiveSlot}
            onRename={renameSlot}
            onDelete={handleDeleteSlot}
          />

          <FormPanel
            slot={activeSlot}
            weekOf={weekOf}
            workers={workers}
            onServerChange={setSlotServer}
            onApply={applySubmittedHours}
          />

          <WeekBar
            weekOf={weekOf}
            onChangeWeek={setWeekOf}
            onStartNextWeek={handleStartNextWeek}
            hasWorkers={workers.length > 0}
          />

          <Toolbar
            sortOrder={sortOrder}
            onSortChange={setSortOrder}
            onAddWorker={addWorker}
            onCsvFile={handleCsvFile}
            onExportCsv={() => exportWorkersToCsv(workers, weekOf, exportName)}
            onExportPdf={() => exportPayrollPdf(sortedWorkers, weekOf, activeSlot.name)}
            hasWorkers={workers.length > 0}
          />

          <PayrollTable
            workers={sortedWorkers}
            weekOf={weekOf}
            onUpdateWorker={updateWorker}
            onUpdateHour={updateHour}
            onRemoveWorker={handleRemoveWorker}
          />
        </div>
      </div>
    </div>
  );
}
