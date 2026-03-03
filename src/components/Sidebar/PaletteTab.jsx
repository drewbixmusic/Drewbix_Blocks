import React from 'react';
import { MOD, CATS } from '../../core/registry.js';

export default function PaletteTab() {
  const catOrder = ['market', 'account', 'write', 'transform', 'gate', 'tsFunc', 'dataproc', 'viz'];

  const onDragStart = (e, moduleId) => {
    e.dataTransfer.setData('moduleId', moduleId);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="sidebar-scroll">
      {catOrder.map(catKey => {
        const cat    = CATS[catKey];
        const mods   = Object.entries(MOD).filter(([, m]) => m.cat === catKey);
        if (!mods.length) return null;
        return (
          <div key={catKey}>
            <div className="cat-header" style={{ color: cat.c }}>{cat.l}</div>
            {mods.map(([id, m]) => (
              <div
                key={id}
                className="mod-item"
                draggable
                onDragStart={e => onDragStart(e, id)}
                style={{ '--item-color': m.color }}
                title={m.label}
              >
                <span className="mod-icon">{m.icon}</span>
                <div>
                  <div className="mod-label">{m.label}</div>
                </div>
              </div>
            ))}
          </div>
        );
      })}
      <div className="sidebar-hint">Drag a module onto the canvas</div>
    </div>
  );
}
