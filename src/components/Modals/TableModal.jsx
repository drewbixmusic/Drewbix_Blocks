import React, { useState, useMemo } from 'react';
import { useStore } from '../../core/state.js';

const ROWS_PER_PAGE_OPTS = [25, 50, 100, 250];

export default function TableModal() {
  const { tableModal, closeTableModal } = useStore();
  const [page, setPage]       = useState(0);
  const [rpp, setRpp]         = useState(50);
  const [sortCol, setSortCol] = useState('');
  const [sortDir, setSortDir] = useState('asc');

  // All hooks must be called unconditionally — derive data from tableModal safely
  const rows  = tableModal?.rows  ?? [];
  const title = tableModal?.title ?? 'Table';

  const cols = useMemo(() => {
    const keys = new Set();
    rows.slice(0, 50).forEach(r => Object.keys(r).forEach(k => { if (!k.startsWith('_')) keys.add(k); }));
    return [...keys];
  }, [rows]);

  const sorted = useMemo(() => {
    if (!sortCol) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol];
      const an = Number(av), bn = Number(bv);
      if (!isNaN(an) && !isNaN(bn)) return sortDir === 'asc' ? an - bn : bn - an;
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }, [rows, sortCol, sortDir]);

  // Early return after all hooks have been called
  if (!tableModal) return null;

  const totalPages = Math.max(1, Math.ceil(sorted.length / rpp));
  const pageRows   = sorted.slice(page * rpp, (page + 1) * rpp);

  const toggleSort = col => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
    setPage(0);
  };

  const isNum = v => v !== null && v !== '' && !isNaN(Number(v));

  return (
    <div id="tbl-overlay" className="show">
      <div id="tbl-modal">
        <div id="tbl-modal-header">
          <span id="tbl-modal-title">{title}</span>
          <span id="tbl-modal-meta">{rows.length} rows · {cols.length} cols</span>
          <button id="tbl-modal-close" onClick={closeTableModal}>×</button>
        </div>
        <div id="tbl-controls">
          <label>Rows per page:</label>
          <select id="tbl-rpp" value={rpp} onChange={e => { setRpp(Number(e.target.value)); setPage(0); }}>
            {ROWS_PER_PAGE_OPTS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="tbl-page-btn" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>‹</button>
            <span id="tbl-page-info">Page {page + 1} / {totalPages}</span>
            <button className="tbl-page-btn" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>›</button>
          </div>
        </div>
        <div id="tbl-scroll-wrap">
          <table id="tbl-table">
            <thead>
              <tr>
                {cols.map(c => (
                  <th
                    key={c}
                    onClick={() => toggleSort(c)}
                    className={sortCol === c ? (sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : ''}
                  >
                    {c} <span className="sort-arrow">{sortCol === c ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, ri) => (
                <tr key={ri}>
                  {cols.map(c => (
                    <td key={c} className={isNum(row[c]) ? 'num' : ''}>
                      {row[c] === null || row[c] === undefined ? '' : String(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
