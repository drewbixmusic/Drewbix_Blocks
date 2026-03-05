import React from 'react';
import { useStore } from '../../../core/state.js';

const NEW_PLACEHOLDER = '(New)';

export default function MvModelNameField({ label, value, onChange }) {
  const { mvRegistry } = useStore();
  const storedNames = Object.keys(mvRegistry || {});
  const isStored = value && storedNames.includes(value);
  const selectValue = isStored ? value : NEW_PLACEHOLDER;

  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <select
          className="field-select"
          value={selectValue}
          onChange={e => { if (e.target.value !== NEW_PLACEHOLDER) onChange(e.target.value); }}
        >
          <option value={NEW_PLACEHOLDER}>{NEW_PLACEHOLDER}</option>
          {storedNames.map(nm => <option key={nm} value={nm}>{nm}</option>)}
        </select>
        {selectValue === NEW_PLACEHOLDER && (
          <input
            type="text"
            className="field-input"
            placeholder="Enter new model name"
            value={value || ''}
            onChange={e => onChange(e.target.value.trim())}
            style={{ width: '100%', padding: '4px 8px', fontSize: 12 }}
          />
        )}
      </div>
    </div>
  );
}
