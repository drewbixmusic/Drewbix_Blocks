import React from 'react';
import { getUpstreamFields } from '../../../utils/data.js';
import { useStore } from '../../../core/state.js';

/**
 * Multi-select chip picker that lists upstream column names.
 * Used for 'fieldpick' and 'colorder' field types.
 */
export default function FieldPickField({ label, value, nodeId, onChange }) {
  const { nodes, edges, configs } = useStore();
  const upstream = getUpstreamFields(nodeId, edges, nodes, configs);

  // value is an array of selected field names (for fieldpick)
  // or an array of { name, visible } objects (for colorder)
  const isColOrder = Array.isArray(value) && value.length > 0 && typeof value[0] === 'object';
  const selected   = isColOrder
    ? value.filter(c => c.visible !== false).map(c => c.name)
    : (Array.isArray(value) ? value : []);

  const allFields = upstream.length
    ? upstream
    : selected; // fall back to whatever is already selected

  const toggle = field => {
    if (isColOrder) {
      // Toggle visible flag
      const existing = Array.isArray(value) ? value : [];
      const item = existing.find(c => c.name === field);
      if (item) {
        onChange(existing.map(c => c.name === field ? { ...c, visible: !c.visible } : c));
      } else {
        onChange([...existing, { name: field, visible: true }]);
      }
    } else {
      const arr = Array.isArray(value) ? value : [];
      onChange(
        arr.includes(field) ? arr.filter(f => f !== field) : [...arr, field]
      );
    }
  };

  const isOn = field => isColOrder
    ? (value?.find(c => c.name === field)?.visible !== false)
    : selected.includes(field);

  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      {!allFields.length ? (
        <div style={{ fontSize: 10, color: 'var(--dim)' }}>Connect an upstream node to select fields</div>
      ) : (
        <div className="multi-chips">
          {allFields.map(f => (
            <button
              key={f}
              className={`chip${isOn(f) ? ' on' : ''}`}
              onClick={() => toggle(f)}
            >
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
