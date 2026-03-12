/**
 * FE Dashboard — Feature Engineering results visualization.
 * Shows per-feature transform winners, OOS R² per target, forward-selection
 * membership, and a per-target summary panel.
 *
 * Data shape received from featureEng.js:
 *   { depVars, featNames, winnerMap, featureTargetMap, fwdSelScores, feRsqRows, setNames }
 */
import React, { useMemo, useState } from 'react';

const TX_LABEL = {
  base: 'base',
  inv:  '1/x',
  log:  'log',
  sqrt: '√x',
  sq:   'x²',
  abs:  '|x|',
};

// Colour ramp: 0→red, 0.5→amber, 1→green
function r2Color(v) {
  if (v == null) return 'var(--muted)';
  if (v < 0.05)  return '#ef4444';
  if (v < 0.15)  return 'var(--amber)';
  return 'var(--green)';
}

function fmtR2(v) {
  if (v == null) return '—';
  return typeof v === 'number' ? v.toFixed(3) : v;
}

// Mini bar inside a cell, max width relative to column max
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
    winnerMap        = {},
    featureTargetMap = {},
    fwdSelScores     = {},
    feRsqRows        = [],
    setNames         = [],
  } = data;

  const hasFwdSel = Object.keys(featureTargetMap).length > 0;

  // Sorted rows: features kept for at least one target first, sorted by Net RSQ desc, then dropped ones
  const tableRows = useMemo(() => {
    const fromRsq = feRsqRows.length ? feRsqRows : featNames.map((feat, i) => {
      const winner = winnerMap[feat];
      const row = { independent_variable: feat, xform: winner?.type || 'base', rank: i + 1 };
      const dvMap = {};
      for (const dv of depVars) {
        const v = fwdSelScores[dv]?.[feat] ?? winner?.scores?.[dv] ?? null;
        row[dv] = v != null ? Math.round(v * 1000) / 1000 : null;
        if (v != null) dvMap[dv] = v;
      }
      const vals = Object.values(dvMap).filter(v => v != null);
      const mn = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
      const sorted = [...vals].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      row.Net_RSQ = mn != null ? Math.round(((mn + (sorted.length ? med : mn)) / 2) * 1000) / 1000 : null;
      return row;
    });

    const withTarget  = fromRsq.filter(r => !hasFwdSel || (featureTargetMap[r.independent_variable]?.length > 0));
    const withoutTarget = fromRsq.filter(r => hasFwdSel && !(featureTargetMap[r.independent_variable]?.length > 0));

    withTarget.sort((a, b) => (b.Net_RSQ ?? -1) - (a.Net_RSQ ?? -1));
    withoutTarget.sort((a, b) => (b.Net_RSQ ?? -1) - (a.Net_RSQ ?? -1));

    return [...withTarget, ...withoutTarget];
  }, [feRsqRows, featNames, winnerMap, depVars, fwdSelScores, featureTargetMap, hasFwdSel]);

  // Per-dv column maxima for bar scaling
  const dvMaxes = useMemo(() => {
    const m = {};
    for (const dv of depVars) {
      m[dv] = Math.max(...tableRows.map(r => r[dv] ?? 0), 0.01);
    }
    return m;
  }, [tableRows, depVars]);
  const netMax = Math.max(...tableRows.map(r => r.Net_RSQ ?? 0), 0.01);

  // Per-target kept features, sorted by fwdSelScore desc
  const targetSummaries = useMemo(() => {
    return depVars.map(dv => {
      const keptFeats = Object.entries(featureTargetMap)
        .filter(([, dvs]) => dvs.includes(dv))
        .map(([f]) => f)
        .sort((a, b) => (fwdSelScores[dv]?.[b] ?? 0) - (fwdSelScores[dv]?.[a] ?? 0));
      return { dv, keptFeats };
    });
  }, [depVars, featureTargetMap, fwdSelScores]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: '12px 16px' }}>

      {/* ── Header info ── */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, fontSize: 11, color: 'var(--muted)' }}>
        <span>Features: <span style={{ color: 'var(--text)' }}>{featNames.length}</span></span>
        <span>Targets: <span style={{ color: 'var(--cyan)' }}>{depVars.join(', ') || '—'}</span></span>
        {setNames.length > 0 && <span>Sets: <span style={{ color: 'var(--text)' }}>{setNames.length}</span> ({setNames.slice(0, 4).join(', ')}{setNames.length > 4 ? ' …' : ''})</span>}
        {hasFwdSel && <span style={{ color: 'var(--green)' }}>Forward selection applied</span>}
      </div>

      {/* ── Main feature table ── */}
      <div style={{ overflowX: 'auto', marginBottom: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: 'var(--bg3)', color: 'var(--dim)', fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              <th style={{ padding: '5px 8px', textAlign: 'left', width: 28, borderBottom: '1px solid var(--border)' }}>#</th>
              <th style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Feature</th>
              <th style={{ padding: '5px 8px', textAlign: 'center', borderBottom: '1px solid var(--border)', width: 52 }}>xform</th>
              {hasFwdSel && <th style={{ padding: '5px 8px', textAlign: 'center', borderBottom: '1px solid var(--border)', width: 70 }}>Targets</th>}
              {depVars.map(dv => (
                <th key={dv} style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid var(--border)', minWidth: 80 }}>{dv}</th>
              ))}
              <th style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid var(--border)', minWidth: 80 }}>Net RSQ</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, i) => {
              const feat     = row.independent_variable;
              const keptDvs  = featureTargetMap[feat] || [];
              const isDropped = hasFwdSel && keptDvs.length === 0;
              return (
                <tr
                  key={feat}
                  style={{
                    background: i % 2 === 0 ? 'var(--bg1)' : 'var(--bg2)',
                    opacity: isDropped ? 0.45 : 1,
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <td style={{ padding: '4px 8px', color: 'var(--muted)', fontSize: 9 }}>{row.rank ?? i + 1}</td>
                  <td style={{ padding: '4px 8px', color: isDropped ? 'var(--muted)' : 'var(--text)', fontWeight: 500, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {feat}
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                    <span style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px', fontSize: 9, color: 'var(--cyan)' }}>
                      {TX_LABEL[row.xform] || row.xform || 'base'}
                    </span>
                  </td>
                  {hasFwdSel && (
                    <td style={{ padding: '4px 8px', textAlign: 'center', fontSize: 9, color: isDropped ? 'var(--muted)' : 'var(--green)' }}>
                      {isDropped ? <span style={{ color: '#ef4444' }}>dropped</span> : keptDvs.join(', ')}
                    </td>
                  )}
                  {depVars.map(dv => (
                    <R2Cell key={dv} value={row[dv]} max={dvMaxes[dv]} />
                  ))}
                  <R2Cell value={row.Net_RSQ} max={netMax} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Per-target summary ── */}
      {hasFwdSel && targetSummaries.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: 'var(--dim)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
            Per-Target Feature Sets (forward selection)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(240px, 1fr))`, gap: 10 }}>
            {targetSummaries.map(({ dv, keptFeats }) => (
              <div key={dv} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 5, padding: '8px 10px' }}>
                <div style={{ fontSize: 11, color: 'var(--cyan)', fontWeight: 600, marginBottom: 6 }}>{dv}</div>
                {keptFeats.length === 0 ? (
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>No features kept</div>
                ) : (
                  keptFeats.map((f, idx) => {
                    const score = fwdSelScores[dv]?.[f];
                    const max   = Math.max(...keptFeats.map(x => fwdSelScores[dv]?.[x] ?? 0), 0.01);
                    const pct   = max > 0 ? Math.min(100, ((score ?? 0) / max) * 100) : 0;
                    return (
                      <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                        <span style={{ fontSize: 9, color: 'var(--muted)', width: 14, textAlign: 'right', flexShrink: 0 }}>{idx + 1}</span>
                        <div style={{ fontSize: 10, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</div>
                        <div style={{ width: 32, background: 'var(--border)', borderRadius: 2, height: 4, flexShrink: 0 }}>
                          <div style={{ width: `${pct}%`, background: 'var(--amber)', height: '100%', borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 9, color: 'var(--amber)', width: 34, textAlign: 'right', flexShrink: 0 }}>{fmtR2(score)}</span>
                      </div>
                    );
                  })
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
