import React, { useState } from 'react';
import { useStore } from '../../core/state.js';

export default function FunctionsTab() {
  const { functions, saveFunction, deleteFunction } = useStore();
  const [newName, setNewName] = useState('');
  const fnList = Object.values(functions);

  const handleSave = () => {
    const name = newName.trim();
    if (!name) return;
    saveFunction(name);
    setNewName('');
  };

  return (
    <div className="sidebar-scroll">
      <div className="cred-section">
        {fnList.length === 0 && (
          <div className="empty-state-side">No sub-flow functions saved yet.</div>
        )}
        {fnList.map(fn => (
          <div key={fn.name} className="flow-card">
            <div className="flow-card-name">ƒ {fn.name}</div>
            <div className="flow-card-meta">
              {fn.nodes?.length ?? 0} nodes
            </div>
            <div className="flow-card-btns">
              <button
                className="mini-btn"
                style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                onClick={() => deleteFunction(fn.name)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            className="cred-input"
            style={{ flex: 1 }}
            placeholder="Function name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <button
            className="mini-btn"
            style={{ borderColor: 'var(--cyan)', color: 'var(--cyan)', flexShrink: 0, padding: '3px 10px' }}
            onClick={handleSave}
          >
            Save
          </button>
        </div>
        <div style={{ fontSize: 9, color: 'var(--dim)', marginTop: 4 }}>
          Saves the current canvas as a reusable sub-flow
        </div>
      </div>
    </div>
  );
}
