import React from 'react';

export default function TextField({ label, value, onChange, placeholder }) {
  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      <input
        className="field-input"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || ''}
      />
    </div>
  );
}
