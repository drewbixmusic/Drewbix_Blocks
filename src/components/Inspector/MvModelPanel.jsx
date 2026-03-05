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
  r2row:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px', fontSize: 8, color: '#475569', marginTop: 3 },
  delBtn:  { marginLeft: 'auto', background: 'transparent', border: 'none', color: '#475569', fontSize: 11, cursor: 'pointer', padding: '0 2px', lineHeight: 1 },
  empty:   { fontSize: 9, color: 'var(--dim)', fontStyle: 'italic', padding: '6px 8px' },
};

function p4avg(arr) {
  if (!arr.length) return 0;
  return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length * 1e4) / 1e4;
}

export default function MvModelPanel({ activeModelName }) {
  const { mvRegistry, setMvRegistry } = useStore();
  const registry = mvRegistry || {};
  const modelNames = Object.keys(registry);

  const deleteModel = name => {
    if (!confirm(`Delete stored MV model "${name}"?`)) return;
    const nr = { ...registry };
    delete nr[name];
    setMvRegistry(nr);
  };

  return (
    <div style={S.wrap}>
      <div style={S.hdr}>Stored MV Models</div>
      <div style={S.list}>
        {modelNames.length === 0 ? (
          <div style={S.empty}>No stored models yet — run with a Model Name to create one.</div>
        ) : (
          modelNames.map((nm, idx) => {
            const m = registry[nm];
            const isActive = nm === activeModelName;
            const isLast = idx === modelNames.length - 1;
            const dvList = m.depVars || [];
            const firstDv = dvList[0];
            const avgTrainR2 = dvList.length ? p4avg(dvList.map(dv => m.trainR2?.[dv] ?? 0)) : 0;
            const avgTestR2  = dvList.length ? p4avg(dvList.map(dv => m.testR2?.[dv]  ?? 0)) : 0;
            const featCount  = firstDv ? (m.featureSet?.[firstDv]?.length ?? 0) : 0;
            return (
              <div key={nm} style={isLast ? S.cardLast : S.card}>
                <div style={S.nameRow}>
                  <span style={{ ...S.name, color: isActive ? '#84cc16' : '#94a3b8' }}>
                    {isActive ? '▶ ' : ''}{nm}
                  </span>
                  <button style={S.delBtn} title="Delete model" onClick={() => deleteModel(nm)}>🗑</button>
                </div>
                <div style={S.stats}>
                  <span>Samples: <b style={S.statVal}>{m.totalSamples || 0}</b></span>
                  <span>Dep vars: <b style={S.statVal}>{dvList.length}</b></span>
                  <span>Features: <b style={S.statVal}>{featCount}</b></span>
                </div>
                <div style={S.r2row}>
                  <span>Train R²: <b style={{ color: '#4ade80', fontWeight: 600 }}>{avgTrainR2}</b></span>
                  <span>Test R²: <b style={{ color: '#fbbf24', fontWeight: 600 }}>{avgTestR2}</b></span>
                </div>
                {m.updated && <div style={{ fontSize: 8, color: '#475569', marginTop: 3 }}>Updated: {new Date(m.updated).toLocaleDateString()}</div>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
