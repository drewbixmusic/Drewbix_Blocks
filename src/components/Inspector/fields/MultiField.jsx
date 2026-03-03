import React from 'react';

export default function MultiField({ label, value, opts, onChange }) {
  const selected = Array.isArray(value) ? value : [];
  const toggle = opt => {
    const next = selected.includes(opt)
      ? selected.filter(v => v !== opt)
      : [...selected, opt];
    onChange(next);
  };
  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      <div className="multi-chips">
        {(opts || []).map(o => (
          <button
            key={o}
            className={`chip${selected.includes(o) ? ' on' : ''}`}
            onClick={() => toggle(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
