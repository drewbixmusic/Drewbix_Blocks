// ── Data Export Module ─────────────────────────────────────────────────────
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const normalize = v => (Array.isArray(v) ? v : v?.data || v?._rows || []);

// ── CSV download ──────────────────────────────────────────────────────────
function downloadCSV(rows, filename) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = v => { const s = String(v ?? ''); return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [headers.map(escape).join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))];
  trigger(lines.join('\n'), `${filename}.csv`, 'text/csv');
}

// ── JSON download ─────────────────────────────────────────────────────────
function downloadJSON(rows, filename) {
  trigger(JSON.stringify(rows, null, 2), `${filename}.json`, 'application/json');
}

// ── Excel download (multi-sheet) ──────────────────────────────────────────
function downloadExcel(datasets, filename) {
  const wb = XLSX.utils.book_new();
  datasets.forEach(({ name, rows }) => {
    if (!rows.length) return;
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, String(name).substring(0, 31));
  });
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// ── PDF download (table per page) ────────────────────────────────────────
function downloadPDF(datasets, filename) {
  const doc = new jsPDF({ orientation: 'landscape' });
  datasets.forEach(({ name, rows }, idx) => {
    if (!rows.length) return;
    if (idx > 0) doc.addPage();
    doc.setFontSize(10);
    doc.text(String(name), 14, 12);
    const headers = Object.keys(rows[0]);
    autoTable(doc, {
      startY: 18,
      head: [headers],
      body: rows.map(r => headers.map(h => String(r[h] ?? ''))),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [6, 182, 212] },
    });
  });
  doc.save(`${filename}.pdf`);
}

// ── PNG export (canvas snapshot via VizHub) ──────────────────────────────
// This is triggered as a side effect; we dispatch a custom event to let VizHub handle it.
function exportPNG(filename) {
  window.dispatchEvent(new CustomEvent('drewbix:exportPNG', { detail: { filename } }));
}

// ── Trigger download ──────────────────────────────────────────────────────
function trigger(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Main run function ─────────────────────────────────────────────────────
export async function runDataExport(node, { cfg, inputs }) {
  const format   = (cfg.format || 'CSV').toUpperCase();
  const filename = (cfg.filename || 'export').trim().replace(/[^a-zA-Z0-9._-]/g, '_');

  // Collect all connected data inputs keyed by port name
  const datasets = Object.entries(inputs)
    .map(([port, val]) => ({ name: port === 'data' ? filename : port, rows: normalize(val) }))
    .filter(d => d.rows.length > 0);

  if (!datasets.length) {
    return { data: [], _rows: [], _exportMsg: 'No data to export.' };
  }

  switch (format) {
    case 'CSV':
      datasets.forEach(({ name, rows }) => downloadCSV(rows, datasets.length > 1 ? `${filename}_${name}` : filename));
      break;
    case 'JSON':
      datasets.forEach(({ name, rows }) => downloadJSON(rows, datasets.length > 1 ? `${filename}_${name}` : filename));
      break;
    case 'EXCEL':
      downloadExcel(datasets, filename);
      break;
    case 'PDF':
      downloadPDF(datasets, filename);
      break;
    case 'PNG':
      exportPNG(filename);
      break;
    default:
      downloadCSV(datasets[0].rows, filename);
  }

  const totalRows = datasets.reduce((s, d) => s + d.rows.length, 0);
  return {
    data: [],
    _rows: [],
    _exportMsg: `Exported ${totalRows} rows as ${format}`,
  };
}
