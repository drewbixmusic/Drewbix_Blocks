import React from 'react';

export default function NumberField({ label, value, onChange }) {
  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      <input
        className="field-input"
        type="number"
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    </div>
  );
}
