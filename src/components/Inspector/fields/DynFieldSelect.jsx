import React from 'react';
import { getUpstreamFields } from '../../../utils/data.js';
import { useStore } from '../../../core/state.js';

/**
 * A select that populates its options from the output headers of upstream nodes.
 * Falls back to a free-text input if no upstream fields are available.
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

  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      <select
        className="field-select"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">-- select --</option>
        {fields.map(f => <option key={f} value={f}>{f}</option>)}
      </select>
    </div>
  );
}
