import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DAYS, DAY_LABELS } from '../constants.js';
import { getTotalHours, getTotalPay, getDayTotal, numericValue } from './validation.js';
import { formatWeekRange, formatDayHeader } from './week.js';

const money = n => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hours = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Build the document without writing it, so it can be rendered in tests. */
export function buildPayrollPdf(workers, weekOf, listName = 'Pagos') {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  const headers = [
    'Nombre',
    'Salario',
    ...DAYS.map(d => formatDayHeader(weekOf, d, DAY_LABELS[d])),
    'Total Horas',
    'Total Pago'
  ];

  const body = workers.map(w => [
    // No manual newline injection: autoTable's linebreak overflow wraps long
    // names correctly, whereas replace(' ', '\n') only ever split the first space.
    w.name,
    w.wage === '' ? '' : money(numericValue(w.wage)),
    ...DAYS.map(day => (w.hours[day] === '' ? '' : hours(numericValue(w.hours[day])))),
    hours(getTotalHours(w)),
    money(getTotalPay(w))
  ]);

  const totals = [
    'TOTAL',
    '-',
    ...DAYS.map(day => hours(getDayTotal(workers, day))),
    hours(workers.reduce((sum, w) => sum + getTotalHours(w), 0)),
    money(workers.reduce((sum, w) => sum + getTotalPay(w), 0))
  ];

  doc.setFontSize(13);
  doc.text(listName, 6, 11);

  doc.setFontSize(9);
  const subtitle = `Semana del ${formatWeekRange(weekOf)}`;
  doc.text(subtitle, 6, 16);

  const printed = `Generado: ${new Date().toLocaleDateString('es-ES')}`;
  doc.text(printed, pageWidth - doc.getTextWidth(printed) - 6, 11);

  // Constrain the table to the printable width and let autoTable distribute the
  // columns. This fits deterministically in one pass — the previous version
  // re-rendered the table from inside didDrawPage, which could recurse and drop
  // the first page.
  const margin = { left: 6, right: 6 };
  autoTable(doc, {
    head: [headers],
    body: [...body, totals],
    startY: 20,
    theme: 'grid',
    tableWidth: pageWidth - margin.left - margin.right,
    margin,
    headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
    styles: { fontSize: 8, overflow: 'linebreak', cellPadding: 1.8, valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 30, halign: 'left' },
      [headers.length - 2]: { fontStyle: 'bold' },
      [headers.length - 1]: { fontStyle: 'bold' }
    },
    didParseCell: data => {
      if (data.row.index === body.length && data.section === 'body') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [235, 235, 235];
      }
    }
  });

  return doc;
}

export function exportPayrollPdf(workers, weekOf, listName = 'Pagos') {
  const slug = listName.replace(/\s+/g, '-').toLowerCase();
  buildPayrollPdf(workers, weekOf, listName).save(`${slug}-${weekOf}.pdf`);
}
