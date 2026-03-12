/**
 * FeModelPanel — shows stored Feature Engineering models in the inspector.
 * Displays winnerMap: feature → best transform type + Net RSQ.
 */
import React from 'react';
import { useStore } from '../../core/state.js';

const S = {
  wrap:    { marginTop: 8, marginBottom: 4 },
  hdr:     { fontSize: 9, color: '#ec4899', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '4px 6px', background: '#1a0a12', borderRadius: '4px 4px 0 0', border: '1px solid #2a1020', borderBottom: 'none' },
  list:    { border: '1px solid #2a1020', borderRadius: '0 0 4px 4px', overflow: 'hidden' },
  card:    { padding: '6px 8px', borderBottom: '1px solid #2a1020' },
  cardLast:{ padding: '6px 8px' },
  nameRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 },
  name:    { fontSize: 10, fontWeight: 700 },
  stats:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px', fontSize: 8, color: '#475569' },
  statVal: { color: '#94a3b8', fontWeight: 600 },
  delBtn:  { marginLeft: 'auto', background: 'transparent', border: 'none', color: '#475569', fontSize: 11, cursor: 'pointer', padding: '0 2px', lineHeight: 1 },
  empty:   { fontSize: 9, color: 'var(--dim)', fontStyle: 'italic', padding: '6px 8px' },
  chip:    { display: 'inline-block', fontSize: 7, background: '#1a0a12', border: '1px solid #2a1020', borderRadius: 3, padding: '1px 4px', color: '#f9a8d4', margin: '1px 2px 1px 0' },
};

const TX_LABEL = { base: 'base', inv: '1/x', log: 'log', sqrt: '√', sq: 'x²', abs: '|x|' };

export default function FeModelPanel({ activeModelName }) {
  const { feRegistry, setFeRegistry } = useStore();
  const registry   = feRegistry || {};
  const modelNames = Object.keys(registry);

  const deleteModel = name => {
    if (!confirm(`Delete stored FE model "${name}"?`)) return;
    const newReg = { ...registry };
    delete newReg[name];
    setFeRegistry(newReg);
  };

  return (
    <div style={S.wrap}>
      <div style={S.hdr}>Stored FE Models</div>
      <div style={S.list}>
        {modelNames.length === 0 ? (
          <div style={S.empty}>No stored models — set a Model Name and run in Feature Engineering mode.</div>
        ) : (
          modelNames.map((nm, idx) => {
            const m        = registry[nm];
            const isActive = nm === activeModelName;
            const isLast   = idx === modelNames.length - 1;
            const winnerMap = m.winnerMap || {};
            const feats     = Object.keys(winnerMap);

            // Count how many features used each transform
            const txCounts = {};
            feats.forEach(f => {
              const t = winnerMap[f]?.type || 'base';
              txCounts[t] = (txCounts[t] || 0) + 1;
            });

            return (
              <div key={nm} style={isLast ? S.cardLast : S.card}>
                <div style={S.nameRow}>
                  <span style={{ ...S.name, color: isActive ? '#ec4899' : '#94a3b8' }}>
                    {isActive ? '▶ ' : ''}{nm}
                  </span>
                  <button style={S.delBtn} title="Delete model" onClick={() => deleteModel(nm)}>🗑</button>
                </div>
                <div style={S.stats}>
                  <span>Targets: <b style={S.statVal}>{(m.depVars || []).length}</b></span>
                  <span>Features: <b style={S.statVal}>{feats.length}</b></span>
                  {Object.entries(txCounts).map(([t, n]) => (
                    <span key={t}>{TX_LABEL[t] || t}: <b style={{ color: '#ec4899' }}>{n}</b></span>
                  ))}
                  {m.updated && <span style={{ gridColumn: '1/-1' }}>Updated: <b style={S.statVal}>{new Date(m.updated).toLocaleDateString()}</b></span>}
                </div>

                {/* Per-feature winner chips */}
                {feats.length > 0 && (
                  <div style={{ marginTop: 5 }}>
                    <div style={{ fontSize: 8, color: '#475569', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Best transform per feature
                    </div>
                    <div>
                      {feats.map(f => {
                        const w = winnerMap[f];
                        const netR2 = w?.scores
                          ? (() => {
                              const vals = Object.values(w.scores).filter(v => v != null && isFinite(v));
                              if (!vals.length) return null;
                              const mn  = vals.reduce((s, v) => s + v, 0) / vals.length;
                              const sorted = [...vals].sort((a, b) => a - b);
                              const mid = Math.floor(sorted.length / 2);
                              const med = sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
                              return (mn + med) / 2;
                            })()
                          : null;
                        return (
                          <span key={f} style={S.chip} title={`Net R²: ${netR2 != null ? netR2.toFixed(4) : '—'}`}>
                            {f} → {TX_LABEL[w?.type] || w?.type || 'base'}
                            {netR2 != null ? ` (${netR2.toFixed(3)})` : ''}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
