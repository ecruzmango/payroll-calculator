import React, { useState, useRef } from 'react';
import { saveAs } from 'file-saver';
import Papa from 'papaparse';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function PayrollManager() {
  const [workers, setWorkers] = useState([]);
  const [days, setDays] = useState(['sabado', 'domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes']);
  const [sortOrder, setSortOrder] = useState('created');
  const tableRef = useRef(null);

  const handleCsvUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const parsed = result.data.map((row) => ({
          id: crypto.randomUUID(),
          name: row.name || '',
          wage: row.wage || '',
          hours: days.reduce((acc, day) => ({ ...acc, [day]: row[day] || '' }), {})
        }));
        setWorkers(parsed);
      }
    });
  };

  const handleAddWorker = () => {
    setWorkers([...workers, {
      id: crypto.randomUUID(),
      name: '',
      wage: '',
      hours: days.reduce((acc, day) => ({ ...acc, [day]: '' }), {})
    }]);
  };

  const removeWorker = (id) => {
    const confirmed = window.confirm("¿Estás seguro de que quieres eliminar este trabajador?");
    if (confirmed) {
      setWorkers(workers.filter(w => w.id !== id));
    }
  };

  const updateWorker = (id, key, value) => {
    setWorkers(workers.map(w =>
      w.id === id
        ? { ...w, [key]: key === 'wage'
          ? (value === '' ? '' : parseFloat(value) || 0)
          : value }
        : w
    ));
  };

  const updateHour = (id, day, value) => {
    setWorkers(workers.map(w =>
      w.id === id
        ? {
            ...w,
            hours: {
              ...w.hours,
              [day]: value === '' ? '' : Math.max(0, parseFloat(value) || 0)
            }
          }
        : w
    ));
  };

  const exportCSV = () => {
    const csvData = workers.map(w => ({
      name: w.name,
      wage: w.wage,
    }));
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, 'trabajadores.csv');
  };

  const updateCsvFile = () => {
    const csvData = workers.map(w => ({
      name: w.name,
      wage: w.wage,
      ...w.hours
    }));
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, 'trabajadores.csv'); // use same file name
  };

const exportPDF = () => {
  const doc = new jsPDF();
  const headers = [
    'Nombre',
    'Salario',
    ...days.map(d => `${d.charAt(0).toUpperCase() + d.slice(1)}`),
    'Total Horas',
    'Total Pago'
  ];

  const body = workers.map((w) => [
    w.name,
    w.wage === '' ? '' : `$${parseFloat(w.wage).toFixed(2)}`,
    ...days.map(day => {
      const hours = parseFloat(w.hours[day]) || 0;
      return `${day.charAt(0).toUpperCase() + day.slice(1)} ${hours.toFixed(1)} \nhoras`;
    }),
    'Horas Total3\n' + getTotalHours(w).toFixed(2),
    `$${getTotalPay(w).toFixed(2)}`
  ]);

  const totals = [
    'TOTAL',
    '-',
    ...days.map(day =>
      workers.reduce((sum, w) => sum + (parseFloat(w.hours[day]) || 0), 0).toFixed(2)
    ),
    workers.reduce((sum, w) => sum + getTotalHours(w), 0).toFixed(2),
    `$${workers.reduce((sum, w) => sum + getTotalPay(w), 0).toFixed(2)}`
  ];

  autoTable(doc, {
    head: [headers],
    body: [...body, totals],
    startY: 20,
    styles: { 
      halign: 'center',
      lineColor: [0, 0, 0], // Black color for borders
      lineWidth: 0.5 // Bold border width
    },
    headStyles: { 
      fillColor: [41, 128, 185], 
      textColor: 255, 
      fontStyle: 'bold',
      lineColor: [0, 0, 0],
      lineWidth: 0.5
    },
    bodyStyles: {
      lineColor: [0, 0, 0],
      lineWidth: 0.5
    },
    tableLineColor: [0, 0, 0], // Outer table border
    tableLineWidth: 0.5, // Outer table border width
    theme: 'grid' // This ensures all cell borders are drawn
  });

  doc.save('trabajadores.pdf');
};

  const getTotalHours = (w) =>
    days.reduce((acc, d) => acc + (parseFloat(w.hours[d]) || 0), 0);

  const getTotalPay = (w) =>
    getTotalHours(w) * (parseFloat(w.wage) || 0);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold">Pagos</h1>
      <div className="card">
        <div className="card-content space-y-4">
          <input type="file" accept=".csv" onChange={handleCsvUpload} />

          <div className="flex gap-4">
            <button onClick={handleAddWorker}>Agregar Trabajador</button>
            <select onChange={(e) => setSortOrder(e.target.value)} value={sortOrder}>
              <option value="az">Nombre A-Z</option>
              <option value="za">Nombre Z-A</option>
              <option value="created">Orden Original</option>
            </select>
            <button onClick={updateCsvFile}>Actualizar Archivo CSV</button>
          </div>

          <div className="overflow-auto">
            <table ref={tableRef} className="w-full border">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Salario</th>
                  {days.map(day => <th key={day}>{day}</th>)}
                  <th>Total Horas</th>
                  <th>Total Pago</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {[...workers].sort((a, b) => {
                  if (sortOrder === 'az') return a.name.localeCompare(b.name);
                  if (sortOrder === 'za') return b.name.localeCompare(a.name);
                  return 0;
                }).map((worker) => (
                  <tr key={worker.id}>
                    <td>
                      <input
                        value={worker.name}
                        onChange={e => updateWorker(worker.id, 'name', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={worker.wage}
                        min="0"
                        onChange={e => updateWorker(worker.id, 'wage', e.target.value)}
                      />
                    </td>
                    {days.map(day => (
                      <td key={day}>
                        <input
                          type="number"
                          value={worker.hours[day]}
                          onChange={e => updateHour(worker.id, day, e.target.value)}
                          data-row={worker.id}
                          data-day={day}
                          onKeyDown={(e) => {
                            const rowIds = workers.map(w => w.id);
                            const currentRowIndex = rowIds.indexOf(worker.id);
                            const col = days.indexOf(day);

                            if (e.key === 'ArrowRight') {
                              const nextDay = days[col + 1];
                              const next = document.querySelector(`[data-row="${worker.id}"][data-day="${nextDay}"]`);
                              next?.focus();
                            } else if (e.key === 'ArrowLeft') {
                              const prevDay = days[col - 1];
                              const prev = document.querySelector(`[data-row="${worker.id}"][data-day="${prevDay}"]`);
                              prev?.focus();
                            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                              e.preventDefault();
                              const newRowIndex = e.key === 'ArrowDown'
                                ? Math.min(currentRowIndex + 1, rowIds.length - 1)
                                : Math.max(currentRowIndex - 1, 0);

                              const next = document.querySelector(
                                `[data-row="${rowIds[newRowIndex]}"][data-day="${day}"]`
                              );
                              next?.focus();
                            }
                          }}
                        />
                      </td>
                    ))}
                    <td>{getTotalHours(worker).toFixed(2)}</td>
                    <td>${getTotalPay(worker).toFixed(2)}</td>
                    <td><button onClick={() => removeWorker(worker.id)}>🗑️</button></td>
                  </tr>
                ))}
                {workers.length > 0 && (
                  <tr className="font-bold">
                    <td>TOTAL</td>
                    <td>-</td>
                    {days.map(day => (
                      <td key={day}>
                        {workers.reduce((sum, w) => sum + (parseFloat(w.hours[day]) || 0), 0).toFixed(2)}
                      </td>
                    ))}
                    <td>{workers.reduce((sum, w) => sum + getTotalHours(w), 0).toFixed(2)}</td>
                    <td>${workers.reduce((sum, w) => sum + getTotalPay(w), 0).toFixed(2)}</td>
                    <td>-</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex gap-4 mt-4">
            <button onClick={exportCSV}>Descargar CSV</button>
            <button onClick={exportPDF}>Descargar PDF</button>
          </div>
        </div>
      </div>
    </div>
  );
}
