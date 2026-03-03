import React from 'react';

export default function SelectField({ label, value, opts, onChange }) {
  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      <select
        className="field-select"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
      >
        {(opts || []).map(o => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}
