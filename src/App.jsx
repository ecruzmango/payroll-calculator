import React, { useState, useRef } from 'react';
import { saveAs } from 'file-saver';
import Papa from 'papaparse';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function PayrollManager() {
  const [workers, setWorkers] = useState([]);
  const [days, setDays] = useState(['sabado', 'domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes']);
  const tableRef = useRef(null);

  const handleCsvUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const parsed = result.data.map(row => ({
          name: row.name || '',
          wage: row.wage || '',
          hours: days.reduce((acc, day) => ({ ...acc, [day]: '' }), {})
        }));
        setWorkers(parsed);
      }
    });
  };

  const handleAddWorker = () => {
    setWorkers([...workers, {
      name: '',
      wage: '',
      hours: days.reduce((acc, day) => ({ ...acc, [day]: '' }), {})
    }]);
  };

  const removeWorker = (index) => {
    const confirmed = window.confirm("¿Estás seguro de que quieres eliminar este trabajador?");
    if (confirmed) {
      setWorkers(workers.filter((_, i) => i !== index));
    }
  };

  const updateWorker = (index, key, value) => {
    const updated = [...workers];
    updated[index][key] = key === 'wage'
      ? (value === '' ? '' : parseFloat(value) || 0)
      : value;
    setWorkers(updated);
  };

  const updateHour = (index, day, value) => {
    const updated = [...workers];
    updated[index].hours[day] = value === '' ? '' : Math.max(0, parseFloat(value) || 0);
    setWorkers(updated);
  };

  const exportCSV = () => {
    const csvData = workers.map(w => ({
      name: w.name,
      wage: w.wage,
      ...w.hours
    }));
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, 'trabajadores.csv');
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    const headers = ['Nombre', 'Salario', ...days.map(d => d.charAt(0).toUpperCase() + d.slice(1)), 'Total Horas', 'Total Pago'];
    const body = workers.map((w, i) => [
      w.name,
      w.wage === '' ? '' : `$${parseFloat(w.wage).toFixed(2)}`,
      ...days.map(day => w.hours[day] === '' ? '' : parseFloat(w.hours[day]).toFixed(2)),
      getTotalHours(w).toFixed(2),
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
          <button onClick={handleAddWorker}>Agregar Trabajador</button>
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
                {workers.map((worker, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        value={worker.name}
                        onChange={e => updateWorker(i, 'name', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={worker.wage}
                        min="0"
                        onChange={e => updateWorker(i, 'wage', e.target.value)}
                      />
                    </td>
                    {days.map(day => (
                      <td key={day}>
                        <input
                          type="number"
                          value={worker.hours[day]}
                          onChange={e => updateHour(i, day, e.target.value)}
                          data-row={i}
                          data-day={day}
                          onKeyDown={(e) => {
                            if (["ArrowUp", "ArrowDown"].includes(e.key)) {
                              e.preventDefault();
                            }
                            const row = i;
                            const col = days.indexOf(day);
                            if (e.key === 'ArrowRight') {
                              const nextDay = days[col + 1];
                              const next = document.querySelector(`[data-row="${row}"][data-day="${nextDay}"]`);
                              next?.focus();
                            } else if (e.key === 'ArrowLeft') {
                              const prevDay = days[col - 1];
                              const prev = document.querySelector(`[data-row="${row}"][data-day="${prevDay}"]`);
                              prev?.focus();
                            }
                          }}
                        />
                      </td>
                    ))}
                    <td>{getTotalHours(worker).toFixed(2)}</td>
                    <td>${getTotalPay(worker).toFixed(2)}</td>
                    <td><button onClick={() => removeWorker(i)}>🗑️</button></td>
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
