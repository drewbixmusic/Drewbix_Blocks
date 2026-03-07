import React from 'react';
import { useStore } from '../../../core/state.js';
import { getFieldsForPort, getUpstreamFields } from '../../../utils/data.js';

/**
 * A checkbox-list selector that populates its options from a named input port's
 * upstream headers.  Falls back to all upstream fields when the port has no connection.
 *
 * Props:
 *   label     — display label
 *   value     — array of currently selected field names ([] = nothing selected)
 *   nodeId    — the node this field belongs to
 *   port      — the input port name to look up (e.g. 'perf')
 *   onChange  — called with the new array of selected field names
 */
export default function MultiDynFieldSelect({ label, value, nodeId, port, onChange }) {
  const { nodes, edges, configs } = useStore();

  const selected = Array.isArray(value) ? value : [];

  // Get fields from the specific port if connected; fall back to all upstream fields
  const portFields = port ? getFieldsForPort(nodeId, port, edges, nodes, configs) : [];
  const allFields  = getUpstreamFields(nodeId, edges, nodes, configs);
  const fields = portFields.length ? portFields : allFields;

  const portConnected = portFields.length > 0;

  const toggle = f => {
    const next = selected.includes(f) ? selected.filter(v => v !== f) : [...selected, f];
    onChange(next);
  };

  const selectAll  = () => onChange(fields);
  const clearAll   = () => onChange([]);

  const base = {
    fontFamily: 'var(--font)', fontSize: 11, color: 'var(--text)',
    background: 'transparent', border: 'none', cursor: 'pointer',
    padding: '2px 6px', borderRadius: 3,
  };

  if (!fields.length) {
    return (
      <div className="field-group">
        <label className="field-label">{label}</label>
        <div style={{ color: 'var(--dim)', fontSize: 10, padding: '4px 2px' }}>
          {port ? `Connect a node to the "${port}" input to populate options.` : 'No upstream fields detected.'}
        </div>
      </div>
    );
  }

  return (
    <div className="field-group">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <label className="field-label" style={{ margin: 0 }}>{label}</label>
        <div style={{ display: 'flex', gap: 2 }}>
          <button style={{ ...base, color: 'var(--cyan)', fontSize: 10 }} onClick={selectAll}>all</button>
          <button style={{ ...base, color: 'var(--dim)',  fontSize: 10 }} onClick={clearAll}>none</button>
        </div>
      </div>
      {portConnected && (
        <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 4 }}>
          From "{port}" input ({fields.length} fields)
        </div>
      )}
      <div style={{
        maxHeight: 180, overflowY: 'auto',
        border: '1px solid var(--border)', borderRadius: 4,
        background: 'var(--bg0)',
      }}>
        {fields.map(f => {
          const on = selected.includes(f);
          return (
            <div
              key={f}
              onClick={() => toggle(f)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '4px 8px', cursor: 'pointer',
                background: on ? 'var(--cyan)18' : 'transparent',
                borderBottom: '1px solid var(--border)22',
              }}
              onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'var(--bg2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = on ? 'var(--cyan)18' : 'transparent'; }}
            >
              <span style={{
                width: 12, height: 12, borderRadius: 2, flexShrink: 0,
                border: `1px solid ${on ? 'var(--cyan)' : 'var(--border)'}`,
                background: on ? 'var(--cyan)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {on && <span style={{ color: '#000', fontSize: 9, lineHeight: 1 }}>✓</span>}
              </span>
              <span style={{ fontSize: 11, color: on ? 'var(--cyan)' : 'var(--muted)' }}>{f}</span>
            </div>
          );
        })}
      </div>
      {selected.length > 0 && (
        <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 3 }}>
          {selected.length} field{selected.length !== 1 ? 's' : ''} selected
        </div>
      )}
    </div>
  );
}
