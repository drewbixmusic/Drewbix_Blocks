/**
 * VizHub — unified visualization modal with tabs.
 * Replaces the four separate modals (Table, Chart, ChartGrid, RFDashboard).
 * Each visualization opened by the engine pushes a tab to state.vizTabs.
 */
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
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

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const { datasets = [], cfg = {}, title } = data;
    const rows = datasets.flat();
    renderChartToContext(ctx, W, H, rows, { ...cfg, title: title || cfg.title || '' });
  }, [data]);

  useEffect(() => {
    draw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

// ── ChartGrid renderer ─────────────────────────────────────────────────────────
function ChartCell({ groupKey, rows, cfg, cellH }) {
  const canvasRef = useRef(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    if (!W) return; // not yet laid out — ResizeObserver will trigger when ready
    const H = cellH;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    renderChartToContext(ctx, W, H, rows, { ...cfg, title: groupKey });
  }, [rows, cfg, groupKey, cellH]);

  useEffect(() => {
    draw();
    // Watch for container resize (e.g. panel open/close, window resize)
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

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
    const sampleFields = rows.length ? Object.keys(rows[0]).filter(k => !k.startsWith('_')).slice(0, 8).join(', ') : 'none';
    return (
      <div style={{ padding: 20, color: 'var(--dim)', textAlign: 'center', fontSize: 12 }}>
        No data — key_field <span style={{ color: 'var(--amber)' }}>"{keyField}"</span> not found in rows.
        <br />
        <span style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, display: 'block' }}>
          Available fields: {sampleFields || 'none'}{rows.length > 0 ? ' …' : ''}
        </span>
      </div>
    );
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

// ── Shared per-key R² section ─────────────────────────────────────────────────
function PerKeyR2Section({ keyR2 = {}, depVars = [] }) {
  const [open, setOpen] = React.useState(false);
  const hasData = Object.values(keyR2).some(m => Object.keys(m).length > 0);
  if (!hasData) return null;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 5, marginTop: 10 }}>
      <div
        onClick={() => setOpen(v => !v)}
        style={{ cursor: 'pointer', padding: '6px 10px', display: 'flex', alignItems: 'center',
          background: 'var(--bg2)', borderRadius: open ? '5px 5px 0 0' : 5, fontSize: 11, userSelect: 'none' }}
      >
        <span style={{ marginRight: 6, color: 'var(--cyan)' }}>{open ? '▾' : '▸'}</span>
        <span style={{ color: 'var(--text)', fontWeight: 600 }}>Per-Key R²</span>
        <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 10 }}>({open ? 'collapse' : 'expand'})</span>
      </div>
      {open && (
        <div style={{ padding: '8px 12px' }}>
          {depVars.map(dv => {
            const keyMap = keyR2[dv] || {};
            const entries = Object.entries(keyMap); // already sorted best→worst
            if (!entries.length) return null;
            const maxR2 = Math.max(...entries.map(([, v]) => v || 0), 0.01);
            return (
              <div key={dv} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: 'var(--cyan)', marginBottom: 6, fontWeight: 600 }}>{dv}</div>
                {entries.map(([key, r2]) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <div style={{ fontSize: 10, color: 'var(--text)', width: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{key}</div>
                    <div style={{ flex: 1, background: 'var(--border)', borderRadius: 2, height: 5 }}>
                      <div style={{ width: `${Math.min(100, (r2/maxR2)*100)}%`, background: 'var(--amber)', height: '100%', borderRadius: 2 }} />
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--muted)', width: 42, textAlign: 'right' }}>{typeof r2 === 'number' ? r2.toFixed(3) : '—'}</div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Collapsible fold breakdown section for K-fold mode
function FoldBreakdownSection({ foldResults = [], foldWeightsByDV = {}, dv }) {
  const [open, setOpen] = React.useState(false);
  const folds = foldResults.filter(fr => fr.dvResults?.[dv]);
  if (!folds.length) return null;
  const weights = foldWeightsByDV[dv] || [];
  const maxW = Math.max(...weights, 0.001);
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 4, marginTop: 8 }}>
      <div onClick={() => setOpen(v => !v)} style={{ cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center', background: 'var(--bg3)', borderRadius: open ? '4px 4px 0 0' : 4, fontSize: 10, userSelect: 'none' }}>
        <span style={{ marginRight: 5, color: 'var(--cyan)' }}>{open ? '▾' : '▸'}</span>
        <span style={{ color: 'var(--text)' }}>Fold Breakdown ({folds.length} folds)</span>
        <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 9 }}>fold weights = val R² (normalised)</span>
      </div>
      {open && (
        <div style={{ padding: '6px 10px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 55px 55px 40px', gap: '3px 8px', fontSize: 9, marginBottom: 4, color: 'var(--dim)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
            <span>Fold</span><span>Blend Weight</span><span>Train R²</span><span>Val R²</span><span>Trees</span>
          </div>
          {folds.map((fr, idx) => {
            const res = fr.dvResults[dv];
            const w   = weights[fr.foldIdx] ?? weights[idx] ?? 0;
            return (
              <div key={fr.foldIdx} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 55px 55px 40px', gap: '2px 8px', fontSize: 10, marginBottom: 3, alignItems: 'center' }}>
                <span style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`Fold ${fr.foldIdx + 1} – modifier: ${fr.valMod ?? '?'}`}>
                  [{fr.valMod ?? fr.foldIdx + 1}]
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ flex: 1, background: 'var(--border)', borderRadius: 2, height: 5 }}>
                    <div style={{ width: `${maxW > 0 ? Math.min(100, (w / maxW) * 100) : 0}%`, background: 'var(--amber)', height: '100%', borderRadius: 2 }} />
                  </div>
                  <span style={{ color: 'var(--amber)', fontSize: 9, width: 32, textAlign: 'right' }}>{(w * 100).toFixed(1)}%</span>
                </div>
                <span style={{ color: 'var(--green)', fontSize: 9 }}>{res.trainR2 ?? '—'}</span>
                <span style={{ color: 'var(--amber)', fontSize: 9 }}>{res.valR2 ?? '—'}</span>
                <span style={{ color: 'var(--muted)', fontSize: 9 }}>{res.nTrees ?? '—'}</span>
              </div>
            );
          })}
        </div>
      )}
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
    keyR2 = {},
    kFoldResults,
  } = data;

  const isKFold = !!kFoldResults;
  const kf      = kFoldResults || {};

  return (
    <div style={{ overflowY: 'auto', padding: '12px 16px' }}>
      {/* Header bar */}
      <div style={{ marginBottom: 10, fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>Mode: <span style={{ color: 'var(--cyan)' }}>{effectiveMode}</span></span>
        {isKFold && (
          <>
            <span style={{ color: 'var(--muted)' }}>
              K-fold Enhanced — <span style={{ color: 'var(--text)' }}>{kf.nFolds}</span> folds
              {kf.autoDetected ? <span style={{ color: 'var(--green)', marginLeft: 4 }}>(auto-detected)</span> : ''}
            </span>
            <span style={{ color: 'var(--muted)' }}>
              Total trees ≈ <span style={{ color: 'var(--text)' }}>{kf.totalTrees ?? '?'}</span>
            </span>
          </>
        )}
        {effectiveMode === 'Stored' && storedModel && (
          <span>Using stored model: <span style={{ color: 'var(--amber)' }}>{storedModel.name}</span></span>
        )}
      </div>

      {depVars.map(dv => {
        const r        = rfResults[dv] || {};
        const isStored = effectiveMode === 'Stored';
        const cvR2     = kf.cvR2?.[dv];
        const inBagR2  = kf.inBagR2?.[dv];
        return (
          <div key={dv} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 5, padding: '10px 12px', marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--cyan)', marginBottom: 6, fontWeight: 600 }}>Dep. Var: {dv}</div>

            {/* R² summary row */}
            <div style={{ display: 'flex', gap: 16, fontSize: 11, marginBottom: 8, flexWrap: 'wrap' }}>
              {isStored ? (
                <div>Stored R² (on current data): <span style={{ color: 'var(--amber)' }}>{storedOverallR2[dv] ?? '—'}</span></div>
              ) : isKFold ? (
                <>
                  <div title="Average in-bag (training) R² across folds">
                    In-Bag R²: <span style={{ color: 'var(--green)' }}>{inBagR2 ?? r.trainR2 ?? '—'}</span>
                  </div>
                  <div title="Out-of-sample R² — each row predicted by the fold that held it out; the most honest performance estimate">
                    OOS R²: <span style={{ color: 'var(--amber)', fontWeight: 600 }}>{cvR2 ?? r.testR2 ?? '—'}</span>
                  </div>
                  {typeof inBagR2 === 'number' && typeof cvR2 === 'number' && inBagR2 > 0 && (
                    <div title="Relative overfit = |train−OOS| / train">
                      Overfit: <span style={{ color: Math.abs(inBagR2 - cvR2) / inBagR2 > 0.25 ? '#ef4444' : 'var(--muted)' }}>
                        {(Math.abs(inBagR2 - cvR2) / inBagR2 * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>Train R²: <span style={{ color: 'var(--green)' }}>{r.trainR2 ?? '—'}</span></div>
                  <div>Test R²:  <span style={{ color: 'var(--amber)' }}>{r.testR2  ?? '—'}</span></div>
                  <div>Train N:  <span style={{ color: 'var(--text)' }}>{r.nTrain  ?? '—'}</span></div>
                  <div>Test N:   <span style={{ color: 'var(--text)' }}>{r.nTest   ?? '—'}</span></div>
                  {r.nEng > 0 && <div>Eng Feats: <span style={{ color: 'var(--purple)' }}>{r.nEng}</span></div>}
                </>
              )}
            </div>

            {/* Pilot permutation importance (k-fold) or gini importance (standard) */}
            {r.importance && Object.keys(r.importance).length > 0 && (
              <div style={{ marginBottom: isKFold && kf.foldResults?.length > 0 ? 6 : 0 }}>
                <div style={{ fontSize: 9, color: 'var(--dim)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
                  {isKFold ? 'Pilot Permutation Importance (avg across folds)' : 'Gini Feature Importance'}
                </div>
                {Object.entries(r.importance).sort(([, a], [, b]) => b - a).slice(0, 12).map(([feat, imp]) => {
                  const maxImp = Math.max(...Object.values(r.importance));
                  return (
                    <div key={feat} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <div style={{ fontSize: 10, color: 'var(--text)', width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{feat}</div>
                      <div style={{ flex: 1, background: 'var(--border)', borderRadius: 2, height: 4 }}>
                        <div style={{ width: `${maxImp > 0 ? Math.min(100, (imp / maxImp) * 100) : 0}%`, background: isKFold ? 'var(--amber)' : 'var(--cyan)', height: '100%', borderRadius: 2 }} />
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--muted)', width: 42, textAlign: 'right' }}>{(imp * 100).toFixed(2)}%</div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Fold breakdown (k-fold only) */}
            {isKFold && kf.foldResults?.length > 0 && (
              <FoldBreakdownSection foldResults={kf.foldResults} foldWeightsByDV={kf.foldWeights || {}} dv={dv} />
            )}

            {/* Pruning analytics (k-fold + REP only) */}
            {isKFold && (() => {
              const ps = kf.pruneStats?.[dv];
              if (!ps || ps.nodesBefore === 0) return null;
              const pruned = ps.nodesBefore - ps.nodesAfter;
              const pct    = ps.nodesBefore > 0 ? (pruned / ps.nodesBefore * 100).toFixed(1) : '0.0';
              const barW   = Math.min(100, parseFloat(pct));
              return (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 9, color: 'var(--dim)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>REP Pruning</div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span>Before: <span style={{ color: 'var(--text)' }}>{ps.nodesBefore.toLocaleString()}</span></span>
                    <span>After: <span style={{ color: 'var(--cyan)' }}>{ps.nodesAfter.toLocaleString()}</span></span>
                    <span>Pruned: <span style={{ color: 'var(--amber)' }}>{pruned.toLocaleString()} ({pct}%)</span></span>
                  </div>
                  <div style={{ background: 'var(--border)', borderRadius: 2, height: 5 }}>
                    <div style={{ width: `${barW}%`, background: 'var(--amber)', height: '100%', borderRadius: 2, transition: 'width 0.3s' }} />
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>
                    {pct}% of all nodes pruned across folds — lower = trees were already lean; higher = REP removed overfit branches
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })}
      <PerKeyR2Section keyR2={keyR2} depVars={depVars} />
    </div>
  );
}

// ── MV Dashboard ─────────────────────────────────────────────────────────────
function MVDashboardView({ data }) {
  if (!data) return null;
  const { modelResults = {}, depVars = [], storedModel, effectiveMode = 'New', currentR2 = {}, keyR2 = {}, segmentResults = {} } = data;
  const isSegEnsemble = Object.keys(segmentResults).length > 0;

  return (
    <div style={{ overflowY: 'auto', padding: '12px 16px' }}>
      <div style={{ marginBottom: 12, fontSize: 11, color: 'var(--muted)' }}>
        Mode: <span style={{ color: 'var(--cyan)' }}>{effectiveMode}{isSegEnsemble ? ' · Segment Ensemble' : ''}</span>
        {effectiveMode === 'Stored' && storedModel && (
          <span style={{ marginLeft: 10 }}>Using stored model: <span style={{ color: 'var(--amber)' }}>{storedModel.name}</span></span>
        )}
      </div>
      {depVars.map(dv => {
        const r = modelResults[dv] || {};
        const isStored = effectiveMode === 'Stored';
        const storedCoeffs = storedModel?.coefficients?.[dv];
        const storedFeats  = storedModel?.featureSet?.[dv] || [];
        const segs         = segmentResults[dv];
        const blendWeights = segs?._blendWeights ?? segs?.map?.(() => null);
        // For segment ensemble: don't show single coeffMap — handled below in segment table
        const showCoeffs   = !isSegEnsemble;
        const coeffEntries = isStored
          ? (storedCoeffs?.coeffMap ? Object.entries(storedCoeffs.coeffMap).sort(([,a],[,b]) => Math.abs(b)-Math.abs(a)) : [])
          : (r.coeffMap ? Object.entries(r.coeffMap).sort(([,a],[,b]) => Math.abs(b)-Math.abs(a)) : []);
        return (
          <div key={dv} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 5, padding: '10px 12px', marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--cyan)', marginBottom: 6, fontWeight: 600 }}>Dep. Var: {dv}</div>
            <div style={{ display: 'flex', gap: 16, fontSize: 11, marginBottom: 8, flexWrap: 'wrap' }}>
              {isStored ? (
                <>
                  <div>R² on current data: <span style={{ color: 'var(--amber)' }}>{currentR2[dv] ?? '—'}</span></div>
                  <div>Stored Train R²: <span style={{ color: 'var(--green)' }}>{storedModel?.trainR2?.[dv] ?? '—'}</span></div>
                  <div>Stored Test R²: <span style={{ color: 'var(--cyan)' }}>{storedModel?.testR2?.[dv] ?? '—'}</span></div>
                  <div>Features: <span style={{ color: 'var(--purple)' }}>{storedFeats.length}</span></div>
                  {storedCoeffs?.intercept != null && !storedCoeffs?.segments && (
                    <div>Intercept: <span style={{ color: 'var(--text)' }}>{storedCoeffs.intercept}</span></div>
                  )}
                </>
              ) : isSegEnsemble ? (
                <>
                  <div>Avg Train R²: <span style={{ color: 'var(--green)' }}>{r.trainR2 ?? '—'}</span></div>
                  <div>OOS R² (blend): <span style={{ color: 'var(--amber)' }}>{r.testR2 ?? '—'}</span></div>
                  <div>Segments: <span style={{ color: 'var(--purple)' }}>{segs?.length ?? 0}</span></div>
                  <div>Features (union): <span style={{ color: 'var(--text)' }}>{r.selectedFeats?.length ?? 0}</span></div>
                </>
              ) : (
                <>
                  <div>Train R²: <span style={{ color: 'var(--green)' }}>{r.trainR2 ?? '—'}</span></div>
                  <div>Test R²:  <span style={{ color: 'var(--amber)' }}>{r.testR2 ?? '—'}</span></div>
                  <div>Features: <span style={{ color: 'var(--purple)' }}>{r.selectedFeats?.length ?? 0}</span></div>
                  <div>Intercept: <span style={{ color: 'var(--text)' }}>{r.intercept ?? '—'}</span></div>
                </>
              )}
            </div>

            {/* Segment breakdown table */}
            {isSegEnsemble && segs?.length > 0 && (() => {
              const maxW = Math.max(...(segs._blendWeights || [0]), 1e-9);
              return (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 9, color: 'var(--dim)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
                    Segment Models
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '60px 70px 70px 1fr 50px', gap: '2px 8px',
                    fontSize: 10, color: 'var(--muted)', borderBottom: '1px solid var(--border)', paddingBottom: 3, marginBottom: 4 }}>
                    <span>Segment</span><span>Train R²</span><span>OOS R²</span><span>Blend Weight</span><span style={{textAlign:'right'}}>Rows</span>
                  </div>
                  {segs.map((seg, si) => {
                    const w = segs._blendWeights?.[si] ?? (1/segs.length);
                    return (
                      <div key={si} style={{ display: 'grid', gridTemplateColumns: '60px 70px 70px 1fr 50px', gap: '2px 8px', alignItems: 'center',
                        fontSize: 10, marginBottom: 3 }}>
                        <span style={{ color: 'var(--text)' }}>[{seg.mod}]</span>
                        <span style={{ color: 'var(--green)' }}>{seg.trainR2 ?? '—'}</span>
                        <span style={{ color: seg.oosR2 != null ? 'var(--amber)' : 'var(--muted)' }}>{seg.oosR2 ?? '—'}</span>
                        <div style={{ flex: 1, background: 'var(--border)', borderRadius: 2, height: 6 }}>
                          <div style={{ width: `${Math.min(100, (w/maxW)*100)}%`, background: 'var(--cyan)', height: '100%', borderRadius: 2 }} />
                        </div>
                        <span style={{ textAlign: 'right', color: 'var(--muted)' }}>{seg.n}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {showCoeffs && coeffEntries.length > 0 && (
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
      <PerKeyR2Section keyR2={keyR2} depVars={depVars} />
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
