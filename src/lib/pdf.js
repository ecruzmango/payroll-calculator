import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DAYS, DAY_LABELS } from '../constants.js';
import { getTotalHours, getTotalPay, getDayTotal, numericValue } from './validation.js';
import { formatWeekRange, datesForWeek } from './week.js';

const money = n => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Hours drop trailing zeros ("8", "9.5", "8.25"): the seven day columns are
// what limit the font size on a portrait page, and "8.00" is twice as wide as "8".
const hours = n => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Portrait US Letter, so the page prints 1:1 instead of an A4 page being shrunk
// by the printer's "fit to page".
const PAGE = { orientation: 'portrait', unit: 'mm', format: 'letter' };
// mm on every side — still clear of most printers' unprintable edge.
const MARGIN = 8;
// Room kept at the bottom of every page for the page number.
const FOOTER_SPACE = 8;
// The summary is a small strip: the worker rows are what gets printed big,
// because the owner cuts the page into one slip per worker.
const SUMMARY_GAP = 5;
const SUMMARY_HEIGHT = 10;
// The table uses the largest font (pt) that fits the page width without
// breaking a number across lines, and keeps everything on one page. Below
// MIN_FONT it spills onto more pages instead of shrinking further.
const MAX_FONT = 16;
const MIN_FONT = 7;
const FONT_STEP = 0.5;
// A font size only counts as fitting if the name column keeps at least this
// share of the table width (or the full width of the longest name, if smaller),
// so names don't get squeezed into three-line stacks.
const NAME_MIN_SHARE = 0.15;
// Vertical cell padding per pt of font: a little room to cut each slip along
// the grid line first, then tighter before giving up a font size to fit a long
// roster on one page.
const ROW_PADDING = [0.2, 0.14, 0.1];
// The header row is set smaller than the body so full day names ("Miércoles")
// don't force the worker rows down to a small size.
const HEAD_SCALE = 0.65;

const INK = [33, 37, 41];
const MUTED = [110, 116, 128];
const ACCENT = [58, 79, 255];     // the app's button blue
const HEAD = [36, 46, 120];
const STRIPE = [246, 247, 251];
const TOTAL_FILL = [232, 235, 255];
const RULE = [222, 225, 232];
const GRID = [125, 130, 140];      // dark enough to survive a cheap printer
const GRID_WIDTH = 0.3;

function buildContent(workers, weekOf) {
  const dates = datesForWeek(weekOf);
  // Day name with the date underneath keeps the seven day columns narrow
  // enough for portrait.
  const headers = [
    'Nombre',
    'Salario',
    ...DAYS.map(d => `${DAY_LABELS[d]}\n${dates[d].getDate()}/${dates[d].getMonth() + 1}`),
    'Total\nHoras',
    'Total\nPago'
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

  const totalHours = workers.reduce((sum, w) => sum + getTotalHours(w), 0);
  const totalPay = workers.reduce((sum, w) => sum + getTotalPay(w), 0);
  const totals = [
    'TOTAL',
    '',
    ...DAYS.map(day => hours(getDayTotal(workers, day))),
    hours(totalHours),
    money(totalPay)
  ];

  return { headers, body, totals, summary: { count: workers.length, totalHours, totalPay } };
}

/** Title, week and print date with an accent rule underneath. Returns where the table starts. */
function drawHeading(doc, listName, weekOf) {
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...INK);
  doc.text(listName, MARGIN, MARGIN + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...MUTED);
  doc.text(`Semana del ${formatWeekRange(weekOf)}`, MARGIN, MARGIN + 12.5);

  doc.setFontSize(9);
  doc.text(`Generado: ${new Date().toLocaleDateString('es-ES')}`, pageWidth - MARGIN, MARGIN + 6, { align: 'right' });

  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, MARGIN + 16, pageWidth - MARGIN, MARGIN + 16);

  return MARGIN + 21;
}

/** A compact strip under the table: head count, hours and — highlighted — the amount to pay. */
function drawSummary(doc, { count, totalHours, totalPay }, y) {
  const width = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const gap = 4;
  const cardWidth = (width - gap * 2) / 3;
  const middle = y + SUMMARY_HEIGHT / 2;
  const cards = [
    { label: 'Trabajadores', value: String(count) },
    { label: 'Total de horas', value: hours(totalHours) },
    { label: 'Total a pagar', value: money(totalPay), highlight: true }
  ];

  cards.forEach((card, i) => {
    const x = MARGIN + i * (cardWidth + gap);
    doc.setFillColor(...(card.highlight ? ACCENT : STRIPE));
    doc.setDrawColor(...(card.highlight ? ACCENT : RULE));
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, cardWidth, SUMMARY_HEIGHT, 2, 2, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...(card.highlight ? [225, 230, 255] : MUTED));
    doc.text(card.label.toUpperCase(), x + 4, middle, { baseline: 'middle' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...(card.highlight ? [255, 255, 255] : INK));
    doc.text(card.value, x + cardWidth - 4, middle, { align: 'right', baseline: 'middle' });
  });
}

function drawPageNumbers(doc) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Página ${i} de ${pages}`, pageWidth / 2, pageHeight - MARGIN + 2, { align: 'center' });
  }
}

/**
 * Column widths at one font size: every number column gets exactly what its
 * widest value needs, the name column takes what's left (up to the longest
 * name), and any spare is shared out evenly. `roomy` is false when the name
 * column would end up narrower than NAME_MIN_SHARE allows.
 */
function columnWidths(doc, { headers, body, totals }, fontSize, cellPadding, tableWidth) {
  const last = headers.length - 1;
  const rows = [...body, totals];
  const measure = (text, bold, size = fontSize) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    return Math.max(...String(text).split('\n').map(line => doc.getTextWidth(line)));
  };
  // +0.5mm so rounding never tips a value onto a second line.
  const needed = col =>
    Math.max(
      measure(headers[col], true, fontSize * HEAD_SCALE),
      ...rows.map((row, i) => measure(row[col], col >= last - 1 || i === body.length))
    ) +
    cellPadding * 2 + 0.5;

  const widths = headers.map((_, col) => needed(col));
  const remainder = tableWidth - widths.slice(1).reduce((sum, w) => sum + w, 0);
  const roomy = remainder >= Math.min(widths[0], tableWidth * NAME_MIN_SHARE);

  widths[0] = Math.max(Math.min(remainder, widths[0]), 15);
  const spare = Math.max(remainder - widths[0], 0) / last;
  return { widths: widths.map((w, col) => (col === 0 ? w : w + spare)), roomy };
}

/**
 * Lay the heading and table out at one font size. Returns the document, the
 * table and whether it fits: one page with room for the summary, a roomy name
 * column, names on at most two lines and no number broken across lines.
 * Unless `force` is set, a size whose columns can't fit the width is rejected
 * without rendering.
 */
function layout(content, listName, weekOf, fontSize, rowPadding, force = false) {
  const { headers, body, totals } = content;
  const doc = new jsPDF(PAGE);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const startY = drawHeading(doc, listName, weekOf);

  const last = headers.length - 1;
  const align = col => (col === 0 ? 'left' : col === 1 || col === last ? 'right' : 'center');
  const padX = fontSize * 0.12;
  const padY = fontSize * rowPadding;
  const tableWidth = pageWidth - MARGIN * 2;
  const { widths, roomy } = columnWidths(doc, content, fontSize, padX, tableWidth);
  if (!roomy && !force) return { fits: false };

  let wrapped = false;
  const margin = { top: MARGIN, right: MARGIN, bottom: MARGIN + FOOTER_SPACE, left: MARGIN };
  autoTable(doc, {
    head: [headers],
    body: [...body, totals],
    startY,
    theme: 'plain',
    tableWidth,
    margin,
    styles: {
      font: 'helvetica',
      fontSize,
      textColor: INK,
      overflow: 'linebreak',
      valign: 'middle',
      cellPadding: { top: padY, bottom: padY, left: padX, right: padX },
      lineColor: GRID,
      lineWidth: GRID_WIDTH
    },
    headStyles: { fillColor: HEAD, textColor: 255, fontStyle: 'bold', fontSize: fontSize * HEAD_SCALE },
    alternateRowStyles: { fillColor: STRIPE },
    columnStyles: Object.fromEntries(
      widths.map((cellWidth, col) => [col, { cellWidth, fontStyle: col >= last - 1 ? 'bold' : 'normal' }])
    ),
    didParseCell: data => {
      data.cell.styles.halign = align(data.column.index);
      if (data.section === 'body' && data.row.index === body.length) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = TOTAL_FILL;
      }
    },
    didDrawCell: data => {
      // A heavier accent rule over the totals row; autoTable has only one line
      // colour per cell, so it's drawn on top of the grid.
      if (data.section === 'body' && data.row.index === body.length) {
        const { x, y, width } = data.cell;
        doc.setDrawColor(...ACCENT);
        doc.setLineWidth(0.7);
        doc.line(x, y, x + width, y);
      }
      // Headers are two lines by design and names may wrap once; numbers never.
      const maxLines = data.section === 'head' || data.column.index === 0 ? 2 : 1;
      if (data.cell.text.length > maxLines) wrapped = true;
    }
  });

  const table = doc.lastAutoTable;
  const bottom = pageHeight - MARGIN - FOOTER_SPACE;
  const fits = roomy && !wrapped && doc.getNumberOfPages() === 1 && table.finalY + SUMMARY_GAP + SUMMARY_HEIGHT <= bottom;
  return { doc, table, fits };
}

/** Build the document without writing it, so it can be rendered in tests. */
export function buildPayrollPdf(workers, weekOf, listName = 'Pagos') {
  const content = buildContent(workers, weekOf);

  let result = null;
  for (let size = MAX_FONT; size >= MIN_FONT && !result; size -= FONT_STEP) {
    for (const padding of ROW_PADDING) {
      const attempt = layout(content, listName, weekOf, size, padding);
      if (attempt.fits) {
        result = attempt;
        break;
      }
    }
  }
  // Too many workers for one page even at the smallest font: let autoTable
  // continue the table onto further pages.
  const { doc, table } = result ?? layout(content, listName, weekOf, MIN_FONT, ROW_PADDING.at(-1), true);

  let summaryY = table.finalY + SUMMARY_GAP;
  if (summaryY + SUMMARY_HEIGHT > doc.internal.pageSize.getHeight() - MARGIN - FOOTER_SPACE) {
    doc.addPage();
    summaryY = MARGIN;
  }
  drawSummary(doc, content.summary, summaryY);
  drawPageNumbers(doc);
  return doc;
}

export function exportPayrollPdf(workers, weekOf, listName = 'Pagos') {
  const slug = listName.replace(/\s+/g, '-').toLowerCase();
  buildPayrollPdf(workers, weekOf, listName).save(`${slug}-${weekOf}.pdf`);
}
