import React from 'react';

export default function TextareaField({ label, value, onChange, placeholder }) {
  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      <textarea
        className="field-textarea"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || ''}
      />
    </div>
  );
}
