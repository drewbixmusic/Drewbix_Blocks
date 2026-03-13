/**
 * FE Dashboard — Feature Engineering results visualization.
 *
 * Data shape:
 *   { depVars, featNames, coKeys, winnerMap, coTxMap,
 *     featureTargetMap, fwdSelScores, coSelScores, feRsqRows, setNames }
 *
 * Table shows both individual features and co-transforms ranked by Net RSQ.
 * Rows dropped by forward-selection are dimmed at the bottom.
 * Per-target summary panels list kept features + co-transforms in rank order.
 */
import React, { useMemo } from 'react';

const TX_LABEL = {
  base: 'base',
  inv:  '1/x',
  log:  'log',
  sqrt: '√x',
  sq:   'x²',
  abs:  '|x|',
  '×':  '×',
  '÷':  '÷',
};

function r2Color(v) {
  if (v == null) return 'var(--muted)';
  if (v < 0.05)  return '#ef4444';
  if (v < 0.15)  return 'var(--amber)';
  return 'var(--green)';
}

function fmtR2(v) {
  if (v == null || v === '') return '—';
  return typeof v === 'number' ? v.toFixed(3) : v;
}

function R2Cell({ value, max }) {
  const pct = max > 0 ? Math.min(100, ((value ?? 0) / max) * 100) : 0;
  return (
    <td style={{ padding: '4px 8px', textAlign: 'right', whiteSpace: 'nowrap', minWidth: 72 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
        <div style={{ width: 36, background: 'var(--border)', borderRadius: 2, height: 4, flexShrink: 0 }}>
          <div style={{ width: `${pct}%`, background: r2Color(value), height: '100%', borderRadius: 2 }} />
        </div>
        <span style={{ fontSize: 10, color: r2Color(value), width: 36, textAlign: 'right' }}>{fmtR2(value)}</span>
      </div>
    </td>
  );
}

export default function FEDashboardView({ data }) {
  if (!data) return <div style={{ padding: 20, color: 'var(--dim)' }}>No FE data available.</div>;

  const {
    depVars          = [],
    featNames        = [],
    coKeys           = [],
    winnerMap        = {},
    coTxMap          = {},
    featureTargetMap = {},
    fwdSelScores     = {},
    coSelScores      = {},
    feRsqRows        = [],
    setNames         = [],
  } = data;

  const hasFwdSel = Object.keys(featureTargetMap).length > 0;
  const hasCoTx   = coKeys.length > 0;

  // Build display rows from feRsqRows (already sorted + ranked by engine).
  // Fall back to computing them client-side when feRsqRows not populated.
  const allRows = useMemo(() => {
    if (feRsqRows.length) return feRsqRows;
    const rows = [];
    // individual
    for (const feat of featNames) {
      const winner = winnerMap[feat];
      const row = { independent_variable: feat, xform: winner?.type || 'base', kind: 'indiv' };
      const dvMap = {};
      for (const dv of depVars) {
        const v = fwdSelScores[dv]?.[feat] ?? winner?.scores?.[dv] ?? null;
        row[dv] = v != null ? Math.round(v * 1000) / 1000 : null;
        if (v != null) dvMap[dv] = v;
      }
      const vals = Object.values(dvMap).filter(v => v != null);
      const mn   = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
      const s2   = [...vals].sort((a, b) => a - b);
      const mid  = Math.floor(s2.length / 2);
      const med  = s2.length % 2 ? s2[mid] : (s2[mid - 1] + s2[mid]) / 2;
      row.Net_RSQ = mn != null ? Math.round(((mn + (s2.length ? med : mn)) / 2) * 1000) / 1000 : null;
      rows.push(row);
    }
    // co-transforms
    for (const key of coKeys) {
      const entry = coTxMap[key];
      if (!entry) continue;
      const row = { independent_variable: key, xform: entry.op, kind: 'co' };
      const dvMap = {};
      for (const dv of depVars) {
        const v = coSelScores[dv]?.[key] ?? entry.scores?.[dv] ?? null;
        row[dv] = v != null ? Math.round(v * 1000) / 1000 : null;
        if (v != null) dvMap[dv] = v;
      }
      const vals = Object.values(dvMap).filter(v => v != null);
      const mn   = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
      const s2   = [...vals].sort((a, b) => a - b);
      const mid  = Math.floor(s2.length / 2);
      const med  = s2.length % 2 ? s2[mid] : (s2[mid - 1] + s2[mid]) / 2;
      row.Net_RSQ = mn != null ? Math.round(((mn + (s2.length ? med : mn)) / 2) * 1000) / 1000 : null;
      rows.push(row);
    }
    rows.sort((a, b) => (b.Net_RSQ ?? -1) - (a.Net_RSQ ?? -1));
    rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
  }, [feRsqRows, featNames, coKeys, winnerMap, coTxMap, depVars, fwdSelScores, coSelScores]);

  // Split into kept and dropped
  const keptRows    = allRows.filter(r => !hasFwdSel || (featureTargetMap[r.independent_variable]?.length > 0));
  const droppedRows = allRows.filter(r =>  hasFwdSel && !(featureTargetMap[r.independent_variable]?.length > 0));
  const tableRows   = [...keptRows, ...droppedRows];

  // Per-dv column maxima
  const dvMaxes = useMemo(() => {
    const m = {};
    for (const dv of depVars) m[dv] = Math.max(...tableRows.map(r => r[dv] ?? 0), 0.01);
    return m;
  }, [tableRows, depVars]);
  const netMax = Math.max(...tableRows.map(r => r.Net_RSQ ?? 0), 0.01);

  // Per-target summary: kept individual features + kept co-transforms
  const targetSummaries = useMemo(() => {
    return depVars.map(dv => {
      const allKept = Object.entries(featureTargetMap)
        .filter(([, dvs]) => dvs.includes(dv))
        .map(([k]) => k);

      // sort: co-transforms (have '×' or '÷' in key) after individuals, both by score desc
      const indivKept = allKept.filter(k => !coKeys.includes(k))
        .sort((a, b) => (fwdSelScores[dv]?.[b] ?? 0) - (fwdSelScores[dv]?.[a] ?? 0));
      const coKept = allKept.filter(k => coKeys.includes(k))
        .sort((a, b) => (coSelScores[dv]?.[b] ?? 0) - (coSelScores[dv]?.[a] ?? 0));

      return { dv, indivKept, coKept };
    });
  }, [depVars, featureTargetMap, fwdSelScores, coSelScores, coKeys]);

  // Counts for header
  const nKeptIndiv = keptRows.filter(r => r.kind === 'indiv').length;
  const nKeptCo    = keptRows.filter(r => r.kind === 'co').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: '12px 16px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, fontSize: 11, color: 'var(--muted)' }}>
        <span>Features: <span style={{ color: 'var(--text)' }}>{featNames.length}</span></span>
        <span>Targets: <span style={{ color: 'var(--cyan)' }}>{depVars.join(', ') || '—'}</span></span>
        {setNames.length > 0 && (
          <span>Sets: <span style={{ color: 'var(--text)' }}>{setNames.length}</span>
            {' '}({setNames.slice(0, 4).join(', ')}{setNames.length > 4 ? ' …' : ''})
          </span>
        )}
        {hasFwdSel && (
          <>
            <span style={{ color: 'var(--green)' }}>
              {nKeptIndiv} indiv{nKeptCo > 0 ? ` + ${nKeptCo} co-tx` : ''} kept
            </span>
            {droppedRows.length > 0 && (
              <span style={{ color: 'var(--muted)' }}>{droppedRows.length} dropped</span>
            )}
          </>
        )}
      </div>

      {/* ── Main ranked table ── */}
      <div style={{ overflowX: 'auto', marginBottom: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: 'var(--bg3)', color: 'var(--dim)', fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              <th style={{ padding: '5px 8px', textAlign: 'left', width: 28, borderBottom: '1px solid var(--border)' }}>#</th>
              <th style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Feature / Co-Transform</th>
              <th style={{ padding: '5px 8px', textAlign: 'center', borderBottom: '1px solid var(--border)', width: 52 }}>xform</th>
              {hasCoTx && <th style={{ padding: '5px 8px', textAlign: 'center', borderBottom: '1px solid var(--border)', width: 38 }}>type</th>}
              {hasFwdSel && <th style={{ padding: '5px 8px', textAlign: 'center', borderBottom: '1px solid var(--border)', width: 70 }}>Targets</th>}
              {depVars.map(dv => (
                <th key={dv} style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid var(--border)', minWidth: 80 }}>{dv}</th>
              ))}
              <th style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid var(--border)', minWidth: 80 }}>Net RSQ</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, i) => {
              const id       = row.independent_variable;
              const keptDvs  = featureTargetMap[id] || [];
              const isDropped = hasFwdSel && keptDvs.length === 0;
              const isCo     = row.kind === 'co';
              return (
                <tr key={id} style={{
                  background: i % 2 === 0 ? 'var(--bg1)' : 'var(--bg2)',
                  opacity: isDropped ? 0.4 : 1,
                  borderBottom: '1px solid var(--border)',
                }}>
                  <td style={{ padding: '4px 8px', color: 'var(--muted)', fontSize: 9 }}>{row.rank ?? i + 1}</td>
                  <td style={{ padding: '4px 8px', color: isDropped ? 'var(--muted)' : isCo ? 'var(--purple)' : 'var(--text)', fontWeight: isCo ? 400 : 500, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {id}
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                    <span style={{ background: isCo ? '#1e1050' : 'var(--bg3)', border: `1px solid ${isCo ? '#6d28d9' : 'var(--border)'}`, borderRadius: 3, padding: '1px 5px', fontSize: 9, color: isCo ? '#a78bfa' : 'var(--cyan)' }}>
                      {TX_LABEL[row.xform] || row.xform || 'base'}
                    </span>
                  </td>
                  {hasCoTx && (
                    <td style={{ padding: '4px 8px', textAlign: 'center', fontSize: 8, color: isCo ? '#a78bfa' : 'var(--muted)' }}>
                      {isCo ? 'co' : '—'}
                    </td>
                  )}
                  {hasFwdSel && (
                    <td style={{ padding: '4px 8px', textAlign: 'center', fontSize: 9, color: isDropped ? 'var(--muted)' : 'var(--green)' }}>
                      {isDropped ? <span style={{ color: '#ef4444' }}>dropped</span> : keptDvs.join(', ')}
                    </td>
                  )}
                  {depVars.map(dv => <R2Cell key={dv} value={row[dv]} max={dvMaxes[dv]} />)}
                  <R2Cell value={row.Net_RSQ} max={netMax} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Per-target summaries ── */}
      {hasFwdSel && targetSummaries.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: 'var(--dim)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
            Per-Target Feature Sets
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {targetSummaries.map(({ dv, indivKept, coKept }) => {
              const allKept = [...indivKept, ...coKept];
              return (
                <div key={dv} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 5, padding: '8px 10px' }}>
                  <div style={{ fontSize: 11, color: 'var(--cyan)', fontWeight: 600, marginBottom: 6 }}>
                    {dv}
                    <span style={{ fontSize: 9, color: 'var(--muted)', marginLeft: 6 }}>
                      {indivKept.length} indiv{coKept.length > 0 ? ` + ${coKept.length} co` : ''}
                    </span>
                  </div>
                  {allKept.length === 0 ? (
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>No features kept</div>
                  ) : (
                    allKept.map((f, idx) => {
                      const isCo  = coKept.includes(f);
                      const score = isCo ? coSelScores[dv]?.[f] : fwdSelScores[dv]?.[f];
                      const allScores = allKept.map(x => (coKept.includes(x) ? coSelScores[dv]?.[x] : fwdSelScores[dv]?.[x]) ?? 0);
                      const maxS  = Math.max(...allScores, 0.01);
                      const pct   = maxS > 0 ? Math.min(100, ((score ?? 0) / maxS) * 100) : 0;
                      return (
                        <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                          <span style={{ fontSize: 9, color: 'var(--muted)', width: 14, textAlign: 'right', flexShrink: 0 }}>{idx + 1}</span>
                          <div style={{ fontSize: 10, color: isCo ? '#a78bfa' : 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</div>
                          <div style={{ width: 32, background: 'var(--border)', borderRadius: 2, height: 4, flexShrink: 0 }}>
                            <div style={{ width: `${pct}%`, background: isCo ? '#6d28d9' : 'var(--amber)', height: '100%', borderRadius: 2 }} />
                          </div>
                          <span style={{ fontSize: 9, color: isCo ? '#a78bfa' : 'var(--amber)', width: 34, textAlign: 'right', flexShrink: 0 }}>{fmtR2(score)}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
