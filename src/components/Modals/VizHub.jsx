/**
 * VizHub — unified visualization modal with tabs.
 * Replaces the four separate modals (Table, Chart, ChartGrid, RFDashboard).
 * Each visualization opened by the engine pushes a tab to state.vizTabs.
 */
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useStore } from '../../core/state.js';
import { renderChartToContext } from '../../utils/chartRenderer.js';

// ── Table renderer ─────────────────────────────────────────────────────────────
const ROWS_PER_PAGE_OPTS = [25, 50, 100, 250];

function TableView({ data }) {
  const rows  = data?.rows  ?? [];
  const [page, setPage]       = useState(0);
  const [rpp, setRpp]         = useState(50);
  const [sortCol, setSortCol] = useState('');
  const [sortDir, setSortDir] = useState('asc');

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

  const totalPages = Math.max(1, Math.ceil(sorted.length / rpp));
  const pageRows   = sorted.slice(page * rpp, (page + 1) * rpp);

  const toggleSort = col => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
    setPage(0);
  };

  const isNum = v => v !== null && v !== '' && !isNaN(Number(v));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div id="tbl-controls" style={{ flexShrink: 0 }}>
        <label>Rows per page:</label>
        <select id="tbl-rpp" value={rpp} onChange={e => { setRpp(Number(e.target.value)); setPage(0); }}>
          {ROWS_PER_PAGE_OPTS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--muted)' }}>{rows.length} rows · {cols.length} cols</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="tbl-page-btn" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>‹</button>
          <span id="tbl-page-info">Page {page + 1} / {totalPages}</span>
          <button className="tbl-page-btn" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>›</button>
        </div>
      </div>
      <div id="tbl-scroll-wrap" style={{ flex: 1, overflow: 'auto' }}>
        <table id="tbl-table">
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c} onClick={() => toggleSort(c)} className={sortCol === c ? (sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : ''}>
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
  );
}

// ── Chart renderer ─────────────────────────────────────────────────────────────
function ChartView({ data }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const W = canvas.offsetWidth || 800;
    const H = canvas.offsetHeight || 500;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const { datasets = [], cfg = {}, title } = data;
    const rows = datasets.flat();
    renderChartToContext(ctx, W, H, rows, { ...cfg, title: title || cfg.title || '' });
  });
  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

// ── ChartGrid renderer ─────────────────────────────────────────────────────────
function ChartCell({ groupKey, rows, cfg, cellH }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth || 300;
    const H = cellH;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    renderChartToContext(ctx, W, H, rows, { ...cfg, title: groupKey });
  });
  return (
    <div style={{ background: '#080810', border: '1px solid #1e1e3a', borderRadius: 5, overflow: 'hidden', height: cellH }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}

function ChartGridView({ data }) {
  if (!data) return null;
  const rows  = data.rows || [];
  const cfg   = data.cfg  || {};
  const keyField = cfg.key_field || 'symbol';
  const colsCfg  = cfg.cols || 'auto';

  const seen = new Set(), keys = [];
  rows.forEach(r => {
    const k = String(r[keyField] ?? '');
    if (k && !seen.has(k)) { seen.add(k); keys.push(k); }
  });

  if (!keys.length) {
    return <div style={{ padding: 20, color: 'var(--dim)', textAlign: 'center', fontSize: 12 }}>No data — check key_field "{keyField}"</div>;
  }

  let cols;
  if (colsCfg === 'auto') {
    const n = keys.length;
    cols = n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 2 : n <= 6 ? 3 : n <= 12 ? 4 : n <= 20 ? 5 : 6;
  } else {
    cols = parseInt(colsCfg) || 2;
  }
  cols = Math.min(cols, keys.length);

  return (
    <div id="chart-grid-body" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, overflow: 'auto', flex: 1 }}>
      {keys.map(key => (
        <ChartCell
          key={key}
          groupKey={key}
          rows={rows.filter(r => String(r[keyField] ?? '') === key)}
          cfg={cfg}
          cellH={240}
        />
      ))}
    </div>
  );
}

// ── RF Dashboard renderer ──────────────────────────────────────────────────────
function RFDashboardView({ data }) {
  if (!data) return null;
  const {
    rfResults = {},
    depVars   = [],
    storedModel,
    storedOverallR2 = {},
    effectiveMode = 'New',
  } = data;

  return (
    <div style={{ overflowY: 'auto', padding: '12px 16px' }}>
      <div style={{ marginBottom: 12, fontSize: 11, color: 'var(--muted)' }}>
        Mode: <span style={{ color: 'var(--cyan)' }}>{effectiveMode}</span>
        {effectiveMode === 'Stored' && storedModel && (
          <span style={{ marginLeft: 10 }}>Using stored model: <span style={{ color: 'var(--amber)' }}>{storedModel.name}</span></span>
        )}
      </div>
      {depVars.map(dv => {
        const r = rfResults[dv] || {};
        const isStored = effectiveMode === 'Stored';
        return (
          <div key={dv} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 5, padding: '10px 12px', marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--cyan)', marginBottom: 6, fontWeight: 600 }}>Dep. Var: {dv}</div>
            <div style={{ display: 'flex', gap: 16, fontSize: 11, marginBottom: 8, flexWrap: 'wrap' }}>
              {isStored ? (
                <div>Stored R² (on current data): <span style={{ color: 'var(--amber)' }}>{storedOverallR2[dv] ?? '—'}</span></div>
              ) : (
                <>
                  <div>Train R²: <span style={{ color: 'var(--green)' }}>{r.trainR2 ?? '—'}</span></div>
                  <div>Test R²:  <span style={{ color: 'var(--amber)' }}>{r.testR2  ?? '—'}</span></div>
                  <div>Train N:  <span style={{ color: 'var(--text)' }}>{r.nTrain  ?? '—'}</span></div>
                  <div>Test N:   <span style={{ color: 'var(--text)' }}>{r.nTest   ?? '—'}</span></div>
                  <div>Eng Feats:<span style={{ color: 'var(--purple)' }}>{r.nEng   ?? 0}</span></div>
                </>
              )}
            </div>
            {r.importance && Object.keys(r.importance).length > 0 && (
              <div>
                <div style={{ fontSize: 9, color: 'var(--dim)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Feature Importance</div>
                {Object.entries(r.importance).sort(([, a], [, b]) => b - a).slice(0, 10).map(([feat, imp]) => (
                  <div key={feat} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <div style={{ fontSize: 10, color: 'var(--text)', width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{feat}</div>
                    <div style={{ flex: 1, background: 'var(--border)', borderRadius: 2, height: 4 }}>
                      <div style={{ width: `${Math.min(100, imp * 100)}%`, background: 'var(--cyan)', height: '100%', borderRadius: 2 }} />
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--muted)', width: 40, textAlign: 'right' }}>{(imp * 100).toFixed(1)}%</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── MV Dashboard ─────────────────────────────────────────────────────────────
function MVDashboardView({ data }) {
  if (!data) return null;
  const { modelResults = {}, depVars = [], storedModel, effectiveMode = 'New' } = data;
  return (
    <div style={{ overflowY: 'auto', padding: '12px 16px' }}>
      <div style={{ marginBottom: 12, fontSize: 11, color: 'var(--muted)' }}>
        Mode: <span style={{ color: 'var(--cyan)' }}>{effectiveMode}</span>
        {effectiveMode === 'Stored' && storedModel && (
          <span style={{ marginLeft: 10 }}>Using stored model: <span style={{ color: 'var(--amber)' }}>{storedModel.name}</span></span>
        )}
      </div>
      {depVars.map(dv => {
        const r = modelResults[dv] || {};
        const isStored = effectiveMode === 'Stored';
        const coeffEntries = r.coeffMap ? Object.entries(r.coeffMap).sort(([,a],[,b]) => Math.abs(b)-Math.abs(a)) : [];
        return (
          <div key={dv} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 5, padding: '10px 12px', marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--cyan)', marginBottom: 6, fontWeight: 600 }}>Dep. Var: {dv}</div>
            <div style={{ display: 'flex', gap: 16, fontSize: 11, marginBottom: 8, flexWrap: 'wrap' }}>
              {isStored ? (
                <div>Stored Train R²: <span style={{ color: 'var(--green)' }}>{storedModel?.trainR2?.[dv] ?? '—'}</span></div>
              ) : (
                <>
                  <div>Train R²: <span style={{ color: 'var(--green)' }}>{r.trainR2 ?? '—'}</span></div>
                  <div>Test R²:  <span style={{ color: 'var(--amber)' }}>{r.testR2 ?? '—'}</span></div>
                  <div>Features: <span style={{ color: 'var(--purple)' }}>{r.selectedFeats?.length ?? 0}</span></div>
                  <div>Intercept: <span style={{ color: 'var(--text)' }}>{r.intercept ?? '—'}</span></div>
                </>
              )}
            </div>
            {coeffEntries.length > 0 && (
              <div>
                <div style={{ fontSize: 9, color: 'var(--dim)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Coefficients (top 10)</div>
                {coeffEntries.slice(0,10).map(([feat, coeff]) => {
                  const maxAbs = Math.max(...coeffEntries.map(([,v])=>Math.abs(v)), 1e-9);
                  return (
                    <div key={feat} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <div style={{ fontSize: 10, color: 'var(--text)', width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{feat}</div>
                      <div style={{ flex: 1, background: 'var(--border)', borderRadius: 2, height: 4 }}>
                        <div style={{ width: `${Math.min(100, Math.abs(coeff)/maxAbs*100)}%`, background: coeff >= 0 ? 'var(--cyan)' : 'var(--amber)', height: '100%', borderRadius: 2 }} />
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--muted)', width: 60, textAlign: 'right' }}>{coeff}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── VizHub main modal ─────────────────────────────────────────────────────────
export default function VizHub() {
  const { vizTabs, vizHubOpen, vizActiveTab, setVizActiveTab, closeVizTab, closeVizHub } = useStore();

  if (!vizHubOpen || vizTabs.length === 0) return null;

  const activeIdx = Math.min(vizActiveTab, vizTabs.length - 1);
  const activeTab = vizTabs[activeIdx];

  function renderContent(tab) {
    switch (tab.type) {
      case 'table':       return <TableView       data={tab.data} />;
      case 'chart':       return <ChartView       data={tab.data} />;
      case 'chart_grid':  return <ChartGridView   data={tab.data} />;
      case 'rf_dashboard':return <RFDashboardView data={tab.data} />;
      case 'mv_dashboard':return <MVDashboardView data={tab.data} />;
      default:            return <div style={{ padding: 20, color: 'var(--dim)' }}>Unknown tab type: {tab.type}</div>;
    }
  }

  const typeIcon = { table: '⊞', chart: '⌗', chart_grid: '⊞⊞', rf_dashboard: '🌳', mv_dashboard: '∑β' };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) closeVizHub(); }}
    >
      <div
        style={{
          background: 'var(--bg1)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          width: '92vw',
          height: '88vh',
          maxWidth: 1400,
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
      >
        {/* ── Top bar: tabs + close all ─── */}
        <div
          style={{
            display: 'flex', alignItems: 'stretch',
            background: 'var(--bg2)',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
            overflowX: 'auto',
          }}
        >
          {vizTabs.map((tab, idx) => (
            <div
              key={tab.id}
              onClick={() => setVizActiveTab(idx)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '7px 14px',
                cursor: 'pointer',
                borderRight: '1px solid var(--border)',
                background: idx === activeIdx ? 'var(--bg1)' : 'transparent',
                borderBottom: idx === activeIdx ? '2px solid var(--cyan)' : '2px solid transparent',
                fontSize: 11,
                color: idx === activeIdx ? 'var(--text)' : 'var(--muted)',
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
            >
              <span>{typeIcon[tab.type] || '☐'}</span>
              <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.title}</span>
              <button
                onClick={e => { e.stopPropagation(); closeVizTab(tab.id); }}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--dim)', cursor: 'pointer',
                  fontSize: 13, padding: '0 2px', lineHeight: 1,
                }}
              >×</button>
            </div>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', padding: '0 10px', flexShrink: 0 }}>
            <button
              onClick={closeVizHub}
              style={{
                background: 'transparent', border: '1px solid var(--border)',
                borderRadius: 4, color: 'var(--muted)',
                cursor: 'pointer', fontSize: 10, padding: '3px 10px',
                fontFamily: 'var(--font)',
              }}
            >
              Close All
            </button>
          </div>
        </div>

        {/* ── Content area ─── */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeTab && renderContent(activeTab)}
        </div>
      </div>
    </div>
  );
}
