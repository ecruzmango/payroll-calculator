import React, { useState, useRef } from 'react';
import { saveAs } from 'file-saver';
import Papa from 'papaparse';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function PayrollManager() {
  const [workers, setWorkers] = useState([]);
  const [days] = useState(['sabado', 'domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes']);
  const [sortOrder, setSortOrder] = useState('created');
  const tableRef = useRef(null);

  const handleCsvUpload = e => {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: result => {
        const parsed = result.data.map(row => ({
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
    setWorkers([
      ...workers,
      {
        id: crypto.randomUUID(),
        name: '',
        wage: '',
        hours: days.reduce((acc, day) => ({ ...acc, [day]: '' }), {})
      }
    ]);
  };

  const removeWorker = id => {
    if (window.confirm("¿Estás seguro de que quieres eliminar este trabajador?")) {
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

  // traditional function uses function add(a,b) {}
  // and arrow function is used as: const add = (a,b) => 
  const exportCSV = () => {
    const csv = Papa.unparse(
      workers.map(w => ({
        name: w.name,
        wage: w.wage,
        ...w.hours
      }))
    );
    saveAs(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'trabajadores.csv');
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    const headers = [
      'Nombre',
      'Salario',
      // the ... is known as the spread operator which transforms each element in the array and returns a new array || ARR1 [1,2,3] SO ARR2 [ARR1, 4,5,6]
      ...days.map(d => d.charAt(0).toUpperCase() + d.slice(1)),
      'Total Horas',
      'Total Pago'
    ];

    // TODO: Build table body rows (one per worker)
    //
    const body = workers.map(w => [
      w.name.replace(' ', '\n'),
      w.wage === '' ? '' : `$${parseFloat(w.wage).toFixed(2)}`,
      ...days.map(day => {
        const dayName = day.charAt(0).toUpperCase() + day.slice(1);
        const h = parseFloat(w.hours[day]) || 0;

        return `${dayName}\n${h.toFixed(1)}`;
      }),
      getTotalHours(w).toLocaleString('en-US', { minimumFractionDigits: 2 }),
      `$${getTotalPay(w).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    ]);


    // TODO: add table Rows
    const totals = [
      'TOTAL',
      '-',
      ...days.map(day =>
        workers.reduce((sum, w) => sum + (parseFloat(w.hours[day]) || 0), 0)
        .toLocaleString('en-US', { minimumFractionDigits: 2})
      ),

      workers.reduce((sum, w) => sum + getTotalHours(w), 0).toLocaleString('en-US', { minimumFractionDigits: 2}),
      `$${workers.reduce((sum, w) => sum + getTotalPay(w), 0).toLocaleString('en-US', { minimumFractionDigits: 2})}`
    ];

    // TODO: autoTable generates a table inside the PDF 
    // head = the column headers (wrapped in an array because it supports multiple rows)
    // body = the worker data rows + totals row
    // startY = 20 → Starts table 20px down from top
    // theme = 'grid' → Makes a boxy table layout
    // headStyles → Style for the header row (blue background, white text)


    // set the date of day
    const today = new Date();
    const formattedDate = today.toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    });
    const pageWidth = doc.internal.pageSize.getWidth();
    const dateText = `Fecha: ${formattedDate}`;
    const dateWidth = doc.getTextWidth(dateText);

    doc.setFontSize(10);
    doc.text(dateText, pageWidth - dateWidth - 11, 10); //14 = right margin

  // Try larger font, and fallback if overflow is detected
  let fontSize = 9;

  const autoTableOptions = {
    head: [headers],
    body: [...body, totals],
    startY: 12,
    theme: 'grid',
    headStyles: {
      fillColor: [41, 128, 185],
      textColor: 255,
      fontStyle: 'bold'
    },
    styles: {
      fontSize: fontSize,
      overflow: 'linebreak',
      cellPadding: 2
    },
    tableWidth: 'auto',  // maximize available space
    margin: { left: 5, right: 5 },
    didDrawPage: (data) => {
      const tableWidth = data.table.width;
      const overflow = tableWidth > pageWidth - 10;

      if (overflow) {
        // Reduce font size and re-render table
        doc.deletePage(doc.internal.getCurrentPageInfo().pageNumber); // Clear page
        fontSize = 7; // Shrink font

        autoTable(doc, {
          ...autoTableOptions,
          styles: {
            ...autoTableOptions.styles,
            fontSize: fontSize
          }
        });
      }
    }
  };

  autoTable(doc, autoTableOptions);

  doc.save('trabajadores.pdf');
};

  const getTotalHours = w => days.reduce((sum, d) => sum + (parseFloat(w.hours[d]) || 0), 0);
  const getTotalPay = w => getTotalHours(w) * (parseFloat(w.wage) || 0);
return (
  <div className="p-6 space-y-6">
    <h1 className="text-xl font-bold">Pagos</h1>

    <div className="card">
      <div className="card-content space-y-4">
        <input type="file" accept=".csv" onChange={handleCsvUpload} />

        <div className="flex gap-4">
          <button onClick={handleAddWorker}>Agregar Trabajador</button>
          <select value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
            <option value="az">Nombre A-Z</option>
            <option value="za">Nombre Z-A</option>
            <option value="created">Orden Original</option>
          </select>
          <button onClick={exportCSV}>Actualizar Archivo CSV</button>
        </div>

        {/* scroll-container with fixed height and vertical scroll */}
        <div className="scroll-container">
          <table ref={tableRef} className="w-full border">
            <thead className="sticky-header">
              <tr>
                <th>Nombre</th>
                <th>Salario</th>
                {days.map(day => (
                  <th key={day}>
                    {day.charAt(0).toUpperCase() + day.slice(1)}
                  </th>
                ))}
                <th>Total Horas</th>
                <th>Total Pago</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {[...workers]
                .sort((a, b) => {
                  if (sortOrder === 'az') return a.name.localeCompare(b.name);
                  if (sortOrder === 'za') return b.name.localeCompare(a.name);
                  return 0;
                })
                .map(worker => (
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
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        value={worker.wage}
                        onChange={e => updateWorker(worker.id, 'wage', e.target.value)}
                        onWheel={e => e.preventDefault()}
                      />
                    </td>
                    {days.map(day => (
                      <td key={day}>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.1"
                          min="0"
                          value={worker.hours[day]}
                          onChange={e => updateHour(worker.id, day, e.target.value)}
                          data-row={worker.id}
                          data-day={day}
                          onWheel={e => e.preventDefault()}
                          onKeyDown={e => {
                            const ids = workers.map(w => w.id);
                            const rowIdx = ids.indexOf(worker.id);
                            const colIdx = days.indexOf(day);

                            if (e.key === 'ArrowRight') {
                              document
                                .querySelector(
                                  `[data-row="${worker.id}"][data-day="${days[colIdx+1]}"]`
                                )
                                ?.focus();
                            } else if (e.key === 'ArrowLeft') {
                              document
                                .querySelector(
                                  `[data-row="${worker.id}"][data-day="${days[colIdx-1]}"]`
                                )
                                ?.focus();
                            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                              e.preventDefault();
                              const newRow = e.key === 'ArrowDown'
                                ? Math.min(rowIdx + 1, ids.length - 1)
                                : Math.max(rowIdx - 1, 0);
                              document
                                .querySelector(
                                  `[data-row="${ids[newRow]}"][data-day="${day}"]`
                                )
                                ?.focus();
                            }
                          }}
                        />
                      </td>
                    ))}
                    <td>{getTotalHours(worker).toFixed(2)}</td>
                    <td>${getTotalPay(worker).toFixed(2)}</td>
                    <td>
                      <button onClick={() => removeWorker(worker.id)}>🗑️</button>
                    </td>
                  </tr>
                ))}
              {workers.length > 0 && (
                <tr className="font-bold">
                  <td>TOTAL</td>
                  <td>-</td>
                  {days.map(day => (
                    <td key={day}>
                      {workers
                        .reduce((sum, w) => sum + (parseFloat(w.hours[day]) || 0), 0)
                        .toFixed(2)}
                    </td>
                  ))}
                  <td>{workers.reduce((sum, w) => sum + getTotalHours(w), 0).toFixed(2)}</td>
                  <td>
                    $
                    {workers
                      .reduce((sum, w) => sum + getTotalPay(w), 0)
                      .toFixed(2)}
                  </td>
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