import { useRef } from 'react';

export default function Toolbar({
  sortOrder,
  onSortChange,
  onAddWorker,
  onCsvFile,
  onExportCsv,
  onExportPdf,
  hasWorkers
}) {
  const fileRef = useRef(null);

  const handleFile = e => {
    const file = e.target.files?.[0];
    if (file) onCsvFile(file);
    // Reset so selecting the same file twice still fires a change event.
    e.target.value = '';
  };

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button onClick={onAddWorker}>Agregar Trabajador</button>

        <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
          Subir CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="visually-hidden"
        />

        <select value={sortOrder} onChange={e => onSortChange(e.target.value)} aria-label="Orden">
          <option value="created">Orden Original</option>
          <option value="az">Nombre A-Z</option>
          <option value="za">Nombre Z-A</option>
        </select>
      </div>

      <div className="toolbar-group">
        <button className="btn-secondary" onClick={onExportCsv} disabled={!hasWorkers}>
          Descargar CSV
        </button>
        <button className="btn-secondary" onClick={onExportPdf} disabled={!hasWorkers}>
          Descargar PDF
        </button>
      </div>
    </div>
  );
}
