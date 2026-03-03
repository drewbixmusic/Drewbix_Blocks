import React from 'react';
import { getUpstreamFields } from '../../../utils/data.js';
import { useStore } from '../../../core/state.js';

const OPS = ['==', '!=', '>', '<', '>=', '<=', 'in', 'not_in',
  'starts_with', 'not_starts_with', 'ends_with', 'not_ends_with',
  'contains', 'not_contains', 'is_true', 'is_false'];

export default function CondRowsField({ label, value, nodeId, onChange }) {
  const { nodes, edges, configs } = useStore();
  const fields   = getUpstreamFields(nodeId, edges, nodes, configs);
  const rows     = Array.isArray(value) ? value : [];

  const update = (i, patch) => {
    const next = rows.map((r, ri) => ri === i ? { ...r, ...patch } : r);
    onChange(next);
  };

  const add = () => onChange([...rows, { field: '', op: '==', value: '' }]);

  const remove = i => onChange(rows.filter((_, ri) => ri !== i));

  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      {rows.map((row, i) => (
        <div key={i} className="cond-row">
          {fields.length ? (
            <select value={row.field || ''} onChange={e => update(i, { field: e.target.value })}>
              <option value="">field…</option>
              {fields.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          ) : (
            <input value={row.field || ''} onChange={e => update(i, { field: e.target.value })} placeholder="field" />
          )}
          <select value={row.op || '=='} onChange={e => update(i, { op: e.target.value })}>
            {OPS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          {!['is_true', 'is_false'].includes(row.op) && (
            <input value={row.value || ''} onChange={e => update(i, { value: e.target.value })} placeholder="value" />
          )}
          <button className="cond-del" onClick={() => remove(i)}>×</button>
        </div>
      ))}
      <button className="cond-add" onClick={add}>+ condition</button>
    </div>
  );
}
