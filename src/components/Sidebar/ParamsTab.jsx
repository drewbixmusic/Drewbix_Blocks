import React, { useState } from 'react';
import { useStore } from '../../core/state.js';
import { nodeDef, LABEL_CFG } from '../../core/registry.js';

// Inline mini-field renderers (simple versions that work without full Inspector context)
function MiniField({ type, value, onChange, opts }) {
  const base = {
    width: '100%', boxSizing: 'border-box', background: 'var(--bg0)',
    border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)',
    padding: '4px 7px', fontFamily: 'var(--font)', fontSize: 11, outline: 'none',
  };
  if (type === 'sel' || type === 'sidechain') {
    return (
      <select style={base} value={value} onChange={e => onChange(e.target.value)}>
        {(opts || []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (type === 'bool') {
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        {['true', 'false'].map(v => (
          <button
            key={v}
            onClick={() => onChange(v === 'true')}
            style={{
              flex: 1, padding: '3px 0', borderRadius: 3, fontFamily: 'var(--font)', fontSize: 10,
              cursor: 'pointer', border: '1px solid var(--border)',
              background: String(value) === v ? 'var(--cyan)22' : 'transparent',
              color: String(value) === v ? 'var(--cyan)' : 'var(--muted)',
            }}
          >{v}</button>
        ))}
      </div>
    );
  }
  if (type === 'number') {
    return <input type="number" style={base} value={value} onChange={e => onChange(Number(e.target.value))} />;
  }
  return <input type="text" style={base} value={value ?? ''} onChange={e => onChange(e.target.value)} />;
}

// Modal shown when user clicks a node while in pick mode
function FieldPickerModal({ node, def, cfg, onPick, onClose }) {
  const fields = def ? { ...LABEL_CFG, ...def.cfg } : LABEL_CFG;
  const pickable = Object.entries(fields).filter(([, fd]) =>
    ['text', 'number', 'sel', 'bool', 'sidechain'].includes(fd.t)
  );
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#0d1117', border: '1px solid var(--border)', borderRadius: 8,
        width: 340, maxWidth: '92vw', boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: def?.color || '#fff', fontWeight: 700, fontSize: 13 }}>
            {def?.icon} {def?.label || node.moduleId}
            <span style={{ color: 'var(--muted)', fontSize: 10, marginLeft: 8 }}>{node.id}</span>
          </span>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--red)', fontSize: 18, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: '10px 12px', maxHeight: 360, overflowY: 'auto' }}>
          {pickable.length === 0 && (
            <div style={{ color: 'var(--dim)', fontSize: 11, textAlign: 'center', padding: 16 }}>No pinnable fields on this block</div>
          )}
          {pickable.map(([key, fd]) => (
            <div
              key={key}
              onClick={() => onPick(key, fd)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 5, cursor: 'pointer',
                marginBottom: 4, border: '1px solid var(--border)',
                background: '#111827',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#1e2a1e'}
              onMouseLeave={e => e.currentTarget.style.background = '#111827'}
            >
              <span style={{ fontSize: 11, color: 'var(--text)', flex: 1 }}>{fd.l}</span>
              <span style={{ fontSize: 9, color: 'var(--muted)', background: 'var(--bg2)', borderRadius: 3, padding: '1px 5px' }}>{fd.t}</span>
              <span style={{ fontSize: 10, color: 'var(--cyan)' }}>+ pin</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ParamsTab() {
  const {
    pinnedParams, removePinnedParam, addPinnedParam,
    paramPickMode, setParamPickMode,
    nodes, configs, setConfig, functions,
  } = useStore();

  const [pickingNode, setPickingNode] = useState(null);

  // Listen for node-click events from Canvas while in pick mode
  React.useEffect(() => {
    if (!paramPickMode) return;
    const handler = e => {
      const { nodeId } = e.detail || {};
      if (!nodeId) return;
      const node = nodes.find(n => n.id === nodeId);
      if (node) setPickingNode(node);
      setParamPickMode(false);
    };
    window.addEventListener('drewbix:paramPickNode', handler);
    return () => window.removeEventListener('drewbix:paramPickNode', handler);
  }, [paramPickMode, nodes, setParamPickMode]);

  const handlePick = (key, fd) => {
    const node = pickingNode;
    if (!node) return;
    const label = `${nodeDef(node, functions)?.label || node.moduleId} · ${fd.l}`;
    addPinnedParam({ id: `pp_${node.id}_${key}_${Date.now()}`, nodeId: node.id, fieldKey: key, label });
    setPickingNode(null);
  };

  return (
    <div className="sidebar-scroll">
      {/* Header / add button */}
      <div style={{ padding: '10px 10px 6px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Pinned Parameters</div>
        <button
          onClick={() => setParamPickMode(true)}
          style={{
            width: '100%', padding: '7px 0', borderRadius: 5, cursor: 'pointer',
            border: paramPickMode ? '1px solid var(--cyan)' : '1px dashed var(--border)',
            background: paramPickMode ? 'var(--cyan)18' : 'transparent',
            color: paramPickMode ? 'var(--cyan)' : 'var(--muted)',
            fontFamily: 'var(--font)', fontSize: 11, transition: 'all 0.15s',
          }}
        >
          {paramPickMode ? '👆 Click a block on canvas…' : '+ Add Parameter'}
        </button>
        {paramPickMode && (
          <button
            onClick={() => setParamPickMode(false)}
            style={{ width: '100%', marginTop: 4, padding: '4px 0', borderRadius: 4, border: 'none', background: 'transparent', color: 'var(--dim)', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 10 }}
          >Cancel</button>
        )}
      </div>

      {/* Pinned param list */}
      {pinnedParams.length === 0 ? (
        <div style={{ padding: '24px 16px', color: 'var(--dim)', fontSize: 11, textAlign: 'center' }}>
          No pinned parameters yet.<br />
          <span style={{ fontSize: 10 }}>Click "Add Parameter", then click a block on the canvas.</span>
        </div>
      ) : (
        <div style={{ padding: '6px 8px' }}>
          {pinnedParams.map(pp => {
            const node = nodes.find(n => n.id === pp.nodeId);
            const def  = node ? nodeDef(node, functions) : null;
            const cfg  = (node && configs[node.id]) || {};
            const allFields = def ? { ...LABEL_CFG, ...def.cfg } : LABEL_CFG;
            const fd   = allFields[pp.fieldKey];
            if (!node || !fd) {
              return (
                <div key={pp.id} style={{ padding: '6px 8px', marginBottom: 6, border: '1px solid var(--border)', borderRadius: 5, background: '#111' }}>
                  <div style={{ fontSize: 10, color: 'var(--red)', marginBottom: 4 }}>⚠ Block removed: {pp.label}</div>
                  <button onClick={() => removePinnedParam(pp.id)} style={{ fontSize: 9, background: 'transparent', border: 'none', color: 'var(--dim)', cursor: 'pointer' }}>Remove</button>
                </div>
              );
            }
            return (
              <div key={pp.id} style={{
                padding: '8px 10px', marginBottom: 6, border: `1px solid ${def?.color || 'var(--border)'}33`,
                borderRadius: 6, background: '#111827',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 10, color: def?.color || 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '85%' }}>{pp.label}</span>
                  <button
                    onClick={() => removePinnedParam(pp.id)}
                    title="Remove"
                    style={{ background: 'transparent', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: 13, lineHeight: 1, flexShrink: 0 }}
                  >×</button>
                </div>
                <MiniField
                  type={fd.t}
                  value={cfg[pp.fieldKey] ?? fd.d ?? ''}
                  opts={fd.opts}
                  onChange={v => setConfig(pp.nodeId, pp.fieldKey, v)}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Field picker modal */}
      {pickingNode && (
        <FieldPickerModal
          node={pickingNode}
          def={nodeDef(pickingNode, functions)}
          cfg={configs[pickingNode.id] || {}}
          onPick={handlePick}
          onClose={() => setPickingNode(null)}
        />
      )}
    </div>
  );
}
