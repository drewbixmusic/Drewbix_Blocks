import React from 'react';

export default function BoolField({ label, value, onChange }) {
  const on = value === true || value === 'true';
  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      <div className="bool-row">
        <button className={`bool-btn${on ? ' on' : ''}`}  onClick={() => onChange(true)}>Yes</button>
        <button className={`bool-btn${!on ? ' on' : ''}`} onClick={() => onChange(false)}>No</button>
      </div>
    </div>
  );
}
