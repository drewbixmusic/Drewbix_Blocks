import React from 'react';
import { getUpstreamFields } from '../../../utils/data.js';
import { useStore } from '../../../core/state.js';

/**
 * A select that populates its options from the output headers of upstream nodes.
 * Falls back to a free-text input if no upstream fields are available.
 * If the stored value is no longer in the upstream headers it is shown as stale
 * (orange, labelled "⚠ … (stale)") so the user can spot and clear it.
 */
export default function DynFieldSelect({ label, value, nodeId, onChange }) {
  const { nodes, edges, configs } = useStore();
  const fields = getUpstreamFields(nodeId, edges, nodes, configs);

  if (!fields.length) {
    return (
      <div className="field-group">
        <label className="field-label">{label}</label>
        <input
          className="field-input"
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder="field name…"
        />
      </div>
    );
  }

  const isStale = value && !fields.includes(value);

  return (
    <div className="field-group">
      <label className="field-label">
        {label}
        {isStale && (
          <span style={{ marginLeft: 6, fontSize: 9, color: '#f97316', fontWeight: 600 }}>
            ⚠ stale
          </span>
        )}
      </label>
      <select
        className="field-select"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        style={isStale ? { borderColor: '#f97316', color: '#f97316' } : undefined}
      >
        <option value="">-- select --</option>
        {isStale && (
          <option value={value} style={{ color: '#f97316' }}>
            ⚠ {value} (stale — select a new field)
          </option>
        )}
        {fields.map(f => <option key={f} value={f}>{f}</option>)}
      </select>
    </div>
  );
}
