/**
 * Model name for rand_forest: dropdown of stored model names + "(New)" with text input.
 * Stored names are selectable for Stored/Merge; new name is used for New/Replace/Merge.
 */
import React from 'react';
import { useStore } from '../../../core/state.js';

const NEW_PLACEHOLDER = '(New)';

export default function RfModelNameField({ label, value, onChange }) {
  const { rfRegistry } = useStore();
  const registry = rfRegistry || {};
  const storedNames = Object.keys(registry);
  const isStored = value && storedNames.includes(value);
  const selectValue = isStored ? value : NEW_PLACEHOLDER;

  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <select
          className="field-select"
          value={selectValue}
          onChange={e => {
            const v = e.target.value;
            if (v !== NEW_PLACEHOLDER) onChange(v);
          }}
        >
          <option value={NEW_PLACEHOLDER}>{NEW_PLACEHOLDER}</option>
          {storedNames.map(nm => (
            <option key={nm} value={nm}>{nm}</option>
          ))}
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
