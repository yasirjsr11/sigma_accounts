const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const LOGO_PATH = path.join(__dirname, '../public/img/logo.png');
const LOGO_RATIO = 1712 / 4855; // height / width of the source logo asset

async function toExcelBuffer(report) {
  const wb = new ExcelJS.Workbook();
  // Excel forbids * ? : \ / [ ] in sheet names (e.g. "Cancelled / Terminated") — sanitise
  const ws = wb.addWorksheet(String(report.title || 'Report').replace(/[*?:\\/\[\]]/g, '-').slice(0, 31));

  // Company logo as default header, then title, then the column headers/data below it
  try {
    const logoBuffer = fs.readFileSync(LOGO_PATH);
    const imageId = wb.addImage({ buffer: logoBuffer, extension: 'png' });
    const logoWidth = 160, logoHeight = Math.round(logoWidth * LOGO_RATIO);
    ws.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: logoWidth, height: logoHeight } });
    ws.getRow(1).height = Math.max(40, logoHeight * 0.75);
  } catch (e) { /* logo asset missing - continue without it */ }
  ws.addRow([]); // row 1: reserved for the logo image
  const titleRow = ws.addRow([report.title]);
  titleRow.font = { bold: true, size: 14 };
  // Optional (2026-09-29): subtitle lines + summary sections placed before the main table.
  (report.subtitle_lines || []).forEach(t => { const r = ws.addRow([t]); r.font = { italic: true, color: { argb: 'FF556677' } }; });
  ws.addRow([]); // spacer row
  for (const sec of (report.pre_sections || [])) {
    const t = ws.addRow([sec.title]); t.font = { bold: true, size: 12 };
    const h = ws.addRow(sec.columns); h.font = { bold: true };
    h.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF3FA' } }; });
    for (const r of sec.rows) ws.addRow(r);
    ws.addRow([]);
  }
  if (report.main_title) { const mt = ws.addRow([report.main_title]); mt.font = { bold: true, size: 12 }; }

  const headerRow = ws.addRow(report.columns);
  headerRow.font = { bold: true };
  headerRow.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEEFF' } }; });
  // Optional: real Excel date cells for named columns (blank stays blank)
  const dateIdx = (report.excel_date_cols || []).map(c => report.columns.indexOf(c)).filter(i => i >= 0);
  for (const row of report.rows) {
    const out = dateIdx.length ? row.map((v, i) => {
      if (!dateIdx.includes(i)) return v;
      const m = typeof v === 'string' && v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : (v === null || v === undefined ? '' : v);
    }) : row;
    const xr = ws.addRow(out);
    dateIdx.forEach(i => { const c = xr.getCell(i + 1); if (c.value instanceof Date) c.numFmt = 'dd/mm/yyyy'; });
  }
  ws.columns.forEach(col => {
    let max = 10;
    col.eachCell({ includeEmpty: true }, cell => {
      const len = cell.value ? String(cell.value).length : 0;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 40);
  });
  return wb.xlsx.writeBuffer();
}

// PDF shows ISO dates as DD/MM/YYYY (Excel keeps raw values)
function pdfText(cell) {
  if (cell === null || cell === undefined) return '';
  const t = String(cell);
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : t;
}

function toPdfBuffer(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Company logo as default header
    try {
      const logoWidth = 110, logoHeight = logoWidth * LOGO_RATIO;
      doc.image(LOGO_PATH, doc.page.margins.left, doc.page.margins.top, { width: logoWidth });
      doc.y = doc.page.margins.top + logoHeight + 8;
    } catch (e) { /* logo asset missing - continue without it */ }

    doc.fontSize(16).text(report.title, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(8).fillColor('#666').text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    (report.subtitle_lines || []).forEach(t => doc.fontSize(8).fillColor('#666').text(t, { align: 'center' }));
    doc.moveDown(1);

    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    let y = doc.y;
    let colWidth = usableWidth / (report.columns.length || 1);
    let header = null;          // repeated at the top of each new page (2026-09-29)
    let colXs = null;           // per-column widths for the main table (optional)

    const drawRow = (cells, opts = {}) => {
      const startY = y;
      doc.fontSize(8).fillColor(opts.bold ? '#000' : '#222').font(opts.bold ? 'Helvetica-Bold' : 'Helvetica');
      let maxH = 14;
      const cw = i => (colXs ? colXs[i] : colWidth);
      const cx = i => doc.page.margins.left + (colXs ? colXs.slice(0, i).reduce((a, b) => a + b, 0) : i * colWidth);
      cells.forEach((cell, i) => {
        const text = pdfText(cell);
        const h = doc.heightOfString(text, { width: cw(i) - 4 });
        if (h + 4 > maxH) maxH = h + 4;
      });
      if (!opts.noBreak && startY + maxH > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage(); y = doc.page.margins.top;
        if (header && !opts.isHeader) drawRow(header, { bold: true, isHeader: true, noBreak: true });
        return drawRow(cells, opts);
      }
      cells.forEach((cell, i) => {
        doc.text(pdfText(cell), cx(i), startY, { width: cw(i) - 4 });
      });
      y = startY + maxH;
      doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).strokeColor('#ddd').stroke();
      y += 2;
    };
    const sectionTitle = t => {
      if (y > doc.page.height - doc.page.margins.bottom - 60) { doc.addPage(); y = doc.page.margins.top; }
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f2d5e').text(t, doc.page.margins.left, y);
      y = doc.y + 4;
    };

    // Optional summary sections before the main table
    for (const sec of (report.pre_sections || [])) {
      sectionTitle(sec.title);
      colWidth = Math.min(usableWidth / (sec.columns.length || 1), 170);
      header = sec.columns;
      drawRow(sec.columns, { bold: true, isHeader: true });
      for (const r of sec.rows) drawRow(r);
      y += 10;
    }
    if (report.main_title) sectionTitle(report.main_title);
    colWidth = usableWidth / (report.columns.length || 1);
    // Optional relative column widths (e.g. a wide Client column)
    const W = Array.isArray(report.col_weights) && report.col_weights.length === report.columns.length ? report.col_weights : null;
    if (W) { const tot = W.reduce((a, b) => a + b, 0); colXs = W.map(w => usableWidth * w / tot); }
    header = report.columns;
    drawRow(report.columns, { bold: true, isHeader: true });
    for (const row of report.rows) drawRow(row);

    doc.end();
  });
}

module.exports = { toExcelBuffer, toPdfBuffer };
