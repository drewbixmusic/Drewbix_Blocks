/**
 * RFModelPanel — shows the stored RF model registry inside the inspector
 * for rand_forest nodes. Mirrors the original HTML "Stored Models" panel.
 */
import React from 'react';
import { useStore } from '../../core/state.js';

const S = {
  wrap:    { marginTop: 8, marginBottom: 4 },
  hdr:     { fontSize: 9, color: '#84cc16', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '4px 6px', background: '#0a1a0a', borderRadius: '4px 4px 0 0', border: '1px solid #1e2a1e', borderBottom: 'none' },
  list:    { border: '1px solid #1e2a1e', borderRadius: '0 0 4px 4px', overflow: 'hidden' },
  card:    { padding: '6px 8px', borderBottom: '1px solid #1e2a1e' },
  cardLast:{ padding: '6px 8px' },
  nameRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 },
  name:    { fontSize: 10, fontWeight: 700 },
  stats:   { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2px 8px', fontSize: 8, color: '#475569' },
  statVal: { color: '#94a3b8', fontWeight: 600 },
  delBtn:  { marginLeft: 'auto', background: 'transparent', border: 'none', color: '#475569', fontSize: 11, cursor: 'pointer', padding: '0 2px', lineHeight: 1 },
  empty:   { fontSize: 9, color: 'var(--dim)', fontStyle: 'italic', padding: '6px 8px' },
};

export default function RFModelPanel({ activeModelName }) {
  const { rfRegistry, setRfRegistry } = useStore();
  const registry = rfRegistry || {};
  const modelNames = Object.keys(registry);

  const deleteModel = name => {
    if (!confirm(`Delete stored RF model "${name}"?`)) return;
    const newReg = { ...registry };
    delete newReg[name];
    setRfRegistry(newReg);
  };

  return (
    <div style={S.wrap}>
      <div style={S.hdr}>Stored Models</div>
      <div style={S.list}>
        {modelNames.length === 0 ? (
          <div style={S.empty}>No stored models yet — run with a Model Name to create one.</div>
        ) : (
          modelNames.map((nm, idx) => {
            const m       = registry[nm];
            const isActive = nm === activeModelName;
            const totalTrees = Object.values(m.trees || {}).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
            const dvReg  = m.featureRegistries || m.featureRegistry || {};
            const firstDv = Object.values(dvReg)[0] || {};
            const featCount = Object.keys(firstDv).length;
            const isLast  = idx === modelNames.length - 1;
            return (
              <div key={nm} style={isLast ? S.cardLast : S.card}>
                <div style={S.nameRow}>
                  <span style={{ ...S.name, color: isActive ? '#84cc16' : '#94a3b8' }}>
                    {isActive ? '▶ ' : ''}{nm}
                  </span>
                  <button style={S.delBtn} title="Delete model" onClick={() => deleteModel(nm)}>🗑</button>
                </div>
                <div style={S.stats}>
                  <span>Runs: <b style={S.statVal}>{m.runCount || 0}</b></span>
                  <span>Samples: <b style={S.statVal}>{m.totalSamples || 0}</b></span>
                  <span>Trees: <b style={S.statVal}>{totalTrees}</b></span>
                  <span>Dep vars: <b style={S.statVal}>{(m.depVars || []).length}</b></span>
                  <span>Features: <b style={S.statVal}>{featCount}</b></span>
                  {m.updated && <span>Updated: <b style={S.statVal}>{new Date(m.updated).toLocaleDateString()}</b></span>}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
