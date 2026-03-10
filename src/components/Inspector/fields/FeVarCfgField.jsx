/**
 * FeVarCfgField — Variable selection for Feature Engineering: Targets, Features, Modifiers.
 * Mutually exclusive: a variable can only be in one category. Targets and modifiers auto-unselect from features.
 * Modifiers are used only in cross-feature transforms (feature × modifier), not as base or base xforms.
 */
import React from 'react';
import { useStore } from '../../../core/state.js';
import { getUpstreamFields } from '../../../utils/data.js';

const S = {
  wrap:    { marginBottom: 10 },
  lbl:     { fontSize: 10, color: 'var(--muted)', marginBottom: 5 },
  secHdr:  { fontSize: 9, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3, marginTop: 8 },
  list:    { maxHeight: 100, overflowY: 'auto', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 0' },
  row:     { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px', cursor: 'pointer', userSelect: 'none' },
  cb:      { accentColor: 'var(--cyan)', cursor: 'pointer', flexShrink: 0 },
  field:   { fontSize: 10, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  empty:   { fontSize: 9, color: 'var(--dim)', padding: '8px 12px', textAlign: 'center' },
};

export default function FeVarCfgField({ label, value, nodeId, onChange }) {
  const { nodes, edges, configs } = useStore();

  const val = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  const dep = Array.isArray(val.dep) ? val.dep : [];
  const modifiers = Array.isArray(val.modifiers) ? val.modifiers : [];
  const indep = Array.isArray(val.indep) ? val.indep : [];

  const dataEdges = edges.filter(e => e.to === nodeId && e.toPort === 'data');
  const upstreamFields = getUpstreamFields(nodeId, dataEdges, nodes, configs);
  const hasLiveFields = upstreamFields.length > 0;

  const savedNames = indep.map(iv => iv.name);
  const allNames = hasLiveFields
    ? [...new Set([...upstreamFields, ...dep, ...modifiers, ...savedNames])]
    : [...new Set([...savedNames, ...dep, ...modifiers])];

  const enabledMap = {};
  indep.forEach(iv => { enabledMap[iv.name] = iv.enabled !== false; });
  allNames.forEach(f => { if (!(f in enabledMap)) enabledMap[f] = true; });

  // Enforce exclusivity: dep and modifiers take precedence; those are disabled in features
  const inDep = new Set(dep);
  const inModifiers = new Set(modifiers);
  const featureEnabled = f => !inDep.has(f) && !inModifiers.has(f) && (enabledMap[f] !== false);

  function buildIndep(newEnabledMap, newDep, newModifiers) {
    const exclude = new Set([...newDep, ...newModifiers]);
    return allNames.map(f => ({ name: f, enabled: exclude.has(f) ? false : (newEnabledMap[f] !== false) }));
  }

  const toggleDep = f => {
    const newDep = dep.includes(f) ? dep.filter(d => d !== f) : [...dep, f];
    const newModifiers = modifiers.filter(m => m !== f);
    onChange({ dep: newDep, modifiers: newModifiers, indep: buildIndep(enabledMap, newDep, newModifiers) });
  };

  const toggleModifier = f => {
    const newModifiers = modifiers.includes(f) ? modifiers.filter(m => m !== f) : [...modifiers, f];
    const newDep = dep.filter(d => d !== f);
    onChange({ dep: newDep, modifiers: newModifiers, indep: buildIndep(enabledMap, newDep, newModifiers) });
  };

  const toggleIndep = f => {
    if (inDep.has(f) || inModifiers.has(f)) return;
    const newMap = { ...enabledMap, [f]: !enabledMap[f] };
    onChange({ dep, modifiers, indep: buildIndep(newMap, dep, modifiers) });
  };

  const selectAllIndep = () => {
    const exclude = new Set([...dep, ...modifiers]);
    const newMap = Object.fromEntries(allNames.map(f => [f, !exclude.has(f)]));
    onChange({ dep, modifiers, indep: buildIndep(newMap, dep, modifiers) });
  };
  const clearAllIndep = () => {
    onChange({ dep, modifiers, indep: allNames.map(f => ({ name: f, enabled: false })) });
  };

  const nFeatures = allNames.filter(f => featureEnabled(f)).length;

  return (
    <div style={S.wrap}>
      <div style={S.lbl}>{label}</div>

      {/* Targets — cannot be features or modifiers */}
      <div style={S.secHdr}>Target / Dependent (Y) — {dep.length} selected</div>
      <div style={S.list}>
        {allNames.length === 0 ? <div style={S.empty}>Run upstream nodes first</div>
          : allNames.map(f => (
              <label key={f} style={S.row}>
                <input style={S.cb} type="checkbox" checked={dep.includes(f)} onChange={() => toggleDep(f)} />
                <span style={{ ...S.field, color: dep.includes(f) ? 'var(--cyan)' : 'var(--text)' }}>{f}</span>
              </label>
            ))}
      </div>

      {/* Features — excluded if in targets or modifiers */}
      <div style={{ ...S.secHdr, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Features / Independent (X) — {nFeatures}/{allNames.length}</span>
        <span style={{ display: 'flex', gap: 6 }}>
          <button onClick={selectAllIndep} style={{ fontSize: 8, padding: '1px 5px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--muted)', cursor: 'pointer' }}>all</button>
          <button onClick={clearAllIndep}  style={{ fontSize: 8, padding: '1px 5px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--muted)', cursor: 'pointer' }}>none</button>
        </span>
      </div>
      <div style={S.list}>
        {allNames.length === 0 ? <div style={S.empty}>Run upstream nodes first</div>
          : allNames.map(f => {
              const disabled = inDep.has(f) || inModifiers.has(f);
              const on = !disabled && featureEnabled(f);
              return (
                <label key={f} style={{ ...S.row, opacity: disabled ? 0.4 : 1 }} title={disabled ? `In ${inDep.has(f) ? 'targets' : 'modifiers'} — clear there first` : ''}>
                  <input style={S.cb} type="checkbox" checked={on} disabled={disabled} onChange={() => !disabled && toggleIndep(f)} />
                  <span style={S.field}>{f}</span>
                </label>
              );
            })}
      </div>

      {/* Modifiers — only for co-transforms; cannot be features or targets */}
      <div style={S.secHdr}>Modifiers — {modifiers.length} selected (co-transforms only)</div>
      <div style={S.list}>
        {allNames.length === 0 ? <div style={S.empty}>Run upstream nodes first</div>
          : allNames.map(f => (
              <label key={f} style={S.row}>
                <input style={S.cb} type="checkbox" checked={modifiers.includes(f)} onChange={() => toggleModifier(f)} />
                <span style={{ ...S.field, opacity: modifiers.includes(f) ? 1 : 0.5 }}>{f}</span>
              </label>
            ))}
      </div>
    </div>
  );
}
