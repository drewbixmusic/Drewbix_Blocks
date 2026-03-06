/**
 * FeModelPanel — shows stored Feature Engineering models in the inspector.
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
};

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
          <div style={S.empty}>No stored models — run with a Model Name to create one.</div>
        ) : (
          modelNames.map((nm, idx) => {
            const m        = registry[nm];
            const isActive = nm === activeModelName;
            const isLast   = idx === modelNames.length - 1;
            const nIndiv   = Object.keys(m.indivSpecs || {}).length;
            const nCo      = Object.keys(m.coSpecs   || {}).length;
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
                  <span>Features: <b style={S.statVal}>{(m.features || []).length}</b></span>
                  <span>Indiv xforms: <b style={{ color: '#ec4899' }}>{nIndiv}</b></span>
                  <span>Co-xforms: <b style={{ color: '#f9a8d4' }}>{nCo}</b></span>
                  {m.updated && <span style={{ gridColumn: '1/-1' }}>Updated: <b style={S.statVal}>{new Date(m.updated).toLocaleDateString()}</b></span>}
                </div>
                {/* Per-feature best transforms */}
                {nIndiv > 0 && (
                  <div style={{ marginTop: 5 }}>
                    <div style={{ fontSize: 8, color: '#475569', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Best transforms</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                      {Object.entries(m.indivSpecs || {}).map(([feat, spec]) => (
                        <span key={feat} style={{ fontSize: 7, background: '#1a0a12', border: '1px solid #2a1020', borderRadius: 3, padding: '1px 4px', color: '#f9a8d4' }}>
                          {feat} → {spec.type?.replace('_', ' ')}
                        </span>
                      ))}
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
