/**
 * DataImportPanel — inspector panel for the data_import block.
 * Handles file upload (CSV/Excel/JSON) and web URL scraping (HTML tables).
 * Parsed data is stored in cfg._importedData so runDataImport can pass it downstream.
 */
import React, { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { useStore } from '../../core/state.js';

const CORS_PROXIES = [
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

// ── CSV parser (handles quoted fields) ────────────────────────────────────
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const parse = line => {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  return lines.map(l => parse(l));
}

// ── rowsFromMatrix: convert 2D array to objects ────────────────────────────
function matrixToRows(matrix, hasHeader, customHeaders) {
  if (!matrix.length) return [];
  let headers, dataRows;
  if (hasHeader) {
    headers = matrix[0].map((h, i) => String(h || `col${i+1}`).trim());
    dataRows = matrix.slice(1);
  } else {
    headers = customHeaders?.length ? customHeaders : matrix[0].map((_, i) => `col${i+1}`);
    dataRows = matrix;
  }
  return dataRows
    .filter(r => r.some(c => c !== '' && c != null))
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r[i] ?? ''; });
      return obj;
    });
}

// ── Parse Excel buffer ─────────────────────────────────────────────────────
function parseExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' });
  return wb.SheetNames.map(name => {
    const ws = wb.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    return { name, matrix };
  });
}

// ── Extract HTML tables ────────────────────────────────────────────────────
function extractHtmlTables(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const tables = Array.from(doc.querySelectorAll('table'));
  return tables.map((tbl, idx) => {
    const caption = tbl.querySelector('caption')?.textContent?.trim() || `Table ${idx+1}`;
    const rows = Array.from(tbl.querySelectorAll('tr'));
    const matrix = rows.map(tr =>
      Array.from(tr.querySelectorAll('th,td')).map(td => td.textContent.trim())
    );
    return { name: caption, matrix };
  });
}

// ── Main component ─────────────────────────────────────────────────────────
export default function DataImportPanel({ nodeId, cfg, onConfigChange }) {
  const { setRunResult, setRunStatus } = useStore();
  const [mode, setMode]           = useState('file'); // 'file' | 'web'
  const [url, setUrl]             = useState('');
  const [status, setStatus]       = useState('');
  const [tables, setTables]       = useState([]); // [{name, matrix}]
  const [selectedTable, setSelectedTable] = useState(0);
  const [hasHeader, setHasHeader] = useState(true);
  const [customHeaders, setCustomHeaders] = useState([]);
  const [preview, setPreview]     = useState(null); // {name, matrix}
  const [step, setStep]           = useState('idle'); // 'idle' | 'preview' | 'done'
  const [datasetName, setDatasetName] = useState('');
  const fileRef = useRef();

  const importedRows = cfg._importedData || [];
  const importedName = cfg._importedName || '';

  const applyRows = useCallback((matrix, name) => {
    setPreview({ name, matrix });
    setStep('preview');
    setDatasetName(name);
    setCustomHeaders(matrix[0]?.map((_, i) => `col${i+1}`) || []);
  }, []);

  // ── File upload ───────────────────────────────────────────────────────────
  const handleFile = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus(`Reading ${file.name}...`);
    try {
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'json') {
        const text = await file.text();
        let parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) parsed = [parsed];
        const headers = Array.from(new Set(parsed.flatMap(Object.keys)));
        const matrix = [headers, ...parsed.map(r => headers.map(h => r[h] ?? ''))];
        applyRows(matrix, file.name.replace(/\.[^.]+$/, ''));
      } else if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
        const text = await file.text();
        const matrix = parseCSV(text);
        applyRows(matrix, file.name.replace(/\.[^.]+$/, ''));
      } else if (['xlsx', 'xls', 'ods'].includes(ext)) {
        const buf = await file.arrayBuffer();
        const sheets = parseExcel(new Uint8Array(buf));
        if (sheets.length === 1) {
          applyRows(sheets[0].matrix, sheets[0].name || file.name.replace(/\.[^.]+$/, ''));
        } else {
          setTables(sheets);
          setPreview(sheets[0]);
          setSelectedTable(0);
          setStep('preview');
          setDatasetName(sheets[0].name);
          setCustomHeaders(sheets[0].matrix[0]?.map((_, i) => `col${i+1}`) || []);
        }
      } else if (ext === 'pdf') {
        setStatus('PDF data extraction is not supported. Please export your PDF data as CSV or Excel first.');
        return;
      } else {
        setStatus('Unsupported file type. Supported: CSV, Excel (.xlsx/.xls), JSON.');
        return;
      }
      setStatus('');
    } catch (err) {
      setStatus(`Error reading file: ${err.message}`);
    }
    e.target.value = '';
  };

  // ── Web URL import ────────────────────────────────────────────────────────
  const handleWebImport = async () => {
    if (!url.trim()) return;
    setStatus('Fetching URL…');
    setStep('idle');
    let html = null;
    for (const proxy of CORS_PROXIES) {
      try {
        const res = await fetch(proxy(url), { signal: AbortSignal.timeout(12000) });
        if (res.ok) { html = await res.text(); break; }
      } catch { /* try next */ }
    }
    if (!html) {
      setStatus('Could not fetch the URL (CORS blocked or unreachable). Try downloading the page and importing as a file.');
      return;
    }
    const found = extractHtmlTables(html);
    if (!found.length) {
      setStatus('No HTML tables found on that page.');
      return;
    }
    setTables(found);
    setPreview(found[0]);
    setSelectedTable(0);
    setStep('preview');
    setDatasetName(found[0].name);
    setCustomHeaders(found[0].matrix[0]?.map((_, i) => `col${i+1}`) || []);
    setStatus('');
  };

  // ── Switch selected table ─────────────────────────────────────────────────
  const switchTable = idx => {
    setSelectedTable(idx);
    setPreview(tables[idx]);
    setDatasetName(tables[idx]?.name || `Table ${idx+1}`);
    setCustomHeaders(tables[idx]?.matrix[0]?.map((_, i) => `col${i+1}`) || []);
    setHasHeader(true);
  };

  // ── Confirm import — stores data in config AND immediately sets run result ──
  const confirmImport = () => {
    if (!preview) return;
    const mat  = preview.matrix;
    const rows = matrixToRows(mat, hasHeader, customHeaders);
    const name = datasetName || 'imported';
    // 1. Persist data in node config so engine can use it on Run
    onConfigChange({ _importedData: rows, _importedName: name });
    // 2. Immediately populate run result so downstream blocks see data without needing a full Run
    if (rows.length && nodeId) {
      const headers = Object.keys(rows[0]).filter(k => !k.startsWith('_'));
      setRunResult(nodeId, { data: rows, _rows: rows, _headers: headers });
      setRunStatus(nodeId, 'done');
    }
    setStep('done');
    setStatus('');
    setPreview(null);
    setTables([]);
  };

  // ── Preview table ─────────────────────────────────────────────────────────
  const renderPreview = () => {
    if (!preview) return null;
    const mat = preview.matrix.slice(0, 6); // show up to 6 rows
    const firstRow = hasHeader ? (mat[0] || []) : customHeaders;
    return (
      <div style={{ marginTop: 8 }}>
        {tables.length > 1 && (
          <div style={{ marginBottom: 6 }}>
            <div style={lbl}>Select Table / Sheet</div>
            <select value={selectedTable} onChange={e => switchTable(Number(e.target.value))} style={sel}>
              {tables.map((t, i) => <option key={i} value={i}>{t.name}</option>)}
            </select>
          </div>
        )}

        <div style={{ overflowX: 'auto', border: '1px solid #1e293b', borderRadius: 4, marginBottom: 6 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 9, minWidth: '100%' }}>
            <thead>
              <tr>
                {firstRow.map((h, i) => (
                  <th key={i} style={{ padding: '3px 6px', borderBottom: '1px solid #334155', background: '#0f172a', color: '#84cc16', textAlign: 'left', whiteSpace: 'nowrap' }}>
                    {hasHeader ? String(h) : (
                      <input
                        value={customHeaders[i] || ''}
                        onChange={e => { const ch = [...customHeaders]; ch[i] = e.target.value; setCustomHeaders(ch); }}
                        style={{ width: 60, background: 'transparent', border: 'none', color: '#84cc16', fontSize: 9, outline: 'none' }}
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(hasHeader ? mat.slice(1) : mat).slice(0, 5).map((row, ri) => (
                <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : '#0a0f1a' }}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ padding: '2px 6px', color: '#94a3b8', borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap' }}>
                      {String(cell).substring(0, 40)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 8, color: '#475569', padding: '2px 6px' }}>
            Showing up to 5 rows of {(hasHeader ? preview.matrix.length - 1 : preview.matrix.length)} total rows
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#94a3b8', cursor: 'pointer' }}>
            <input type="checkbox" checked={hasHeader} onChange={e => setHasHeader(e.target.checked)} />
            First row is headers
          </label>
        </div>

        <div style={{ marginBottom: 6 }}>
          <div style={lbl}>Dataset Name</div>
          <input value={datasetName} onChange={e => setDatasetName(e.target.value)} style={{ ...sel, width: '100%' }} />
        </div>

        <button onClick={confirmImport} style={btnGreen}>✔ Confirm Import</button>
        <button onClick={() => { setStep('idle'); setPreview(null); setTables([]); }} style={{ ...btnGreen, background: 'transparent', border: '1px solid #334155', color: '#94a3b8', marginLeft: 6 }}>✕ Cancel</button>
      </div>
    );
  };

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {['file', 'web'].map(m => (
          <button key={m} onClick={() => { setMode(m); setStep('idle'); }}
            style={{ flex: 1, padding: '5px 0', background: mode === m ? '#1e3a2e' : 'transparent', border: `1px solid ${mode === m ? '#4ade80' : '#334155'}`, borderRadius: 4, color: mode === m ? '#4ade80' : '#64748b', fontSize: 10, cursor: 'pointer' }}>
            {m === 'file' ? '📁 File Upload' : '🌐 Web URL'}
          </button>
        ))}
      </div>

      {mode === 'file' && step !== 'preview' && (
        <>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.ods,.json" onChange={handleFile} style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()} style={btnGreen}>
            📂 Choose File (CSV / Excel / JSON)
          </button>
        </>
      )}

      {mode === 'web' && step !== 'preview' && (
        <div>
          <div style={lbl}>Web Page URL</div>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/data-page" style={{ ...sel, width: '100%', marginBottom: 6 }} />
          <button onClick={handleWebImport} style={btnGreen}>🌐 Fetch Tables</button>
        </div>
      )}

      {status && <div style={{ marginTop: 6, fontSize: 9, color: status.includes('Error') || status.includes('not') || status.includes('Could') ? '#f87171' : '#84cc16', wordBreak: 'break-word' }}>{status}</div>}

      {step === 'preview' && renderPreview()}

      {/* Already imported summary */}
      {importedRows.length > 0 && step !== 'preview' && (
        <div style={{ marginTop: 10, padding: '6px 8px', background: '#0a1a0a', border: '1px solid #1e2a1e', borderRadius: 4 }}>
          <div style={{ fontSize: 9, color: '#84cc16', fontWeight: 700, marginBottom: 2 }}>✓ Data Loaded: {importedName}</div>
          <div style={{ fontSize: 9, color: '#94a3b8' }}>
            {importedRows.length} rows · {Object.keys(importedRows[0] || {}).length} columns
          </div>
          <div style={{ fontSize: 8, color: '#475569', marginTop: 2 }}>
            Columns: {Object.keys(importedRows[0] || {}).join(', ').substring(0, 80)}
          </div>
          <button onClick={() => { onConfigChange({ _importedData: [], _importedName: '' }); setRunResult(nodeId, { data: [], _rows: [], _headers: [] }); setRunStatus(nodeId, undefined); setStep('idle'); }}
            style={{ marginTop: 6, background: 'transparent', border: '1px solid #334155', borderRadius: 3, color: '#f87171', fontSize: 9, padding: '2px 8px', cursor: 'pointer' }}>
            Clear Data
          </button>
        </div>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const lbl = { fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 };
const sel = { background: '#0f172a', border: '1px solid #334155', borderRadius: 4, color: '#e2e8f0', padding: '4px 8px', fontSize: 10, fontFamily: 'inherit', boxSizing: 'border-box' };
const btnGreen = { background: '#1e3a2e', border: '1px solid #4ade80', borderRadius: 4, color: '#4ade80', fontSize: 10, padding: '5px 12px', cursor: 'pointer', fontWeight: 600 };
