import React, { useState, useMemo, useRef } from 'react';
import { MOD, CATS } from '../../core/registry.js';

const catOrder = ['market', 'account', 'write', 'transform', 'gate', 'tsFunc', 'dataproc', 'viz'];

export default function PaletteTab() {
  const [search, setSearch]           = useState('');
  // All expanded by default — user collapses categories they don't need
  const [collapsed, setCollapsed]     = useState({});
  const dragItem                      = useRef(null);

  const onDragStart = (e, moduleId) => {
    e.dataTransfer.setData('moduleId', moduleId);
    e.dataTransfer.effectAllowed = 'copy';
    dragItem.current = moduleId;
  };

  // Touch drag support for mobile
  const onTouchStart = (e, moduleId) => {
    dragItem.current = moduleId;
  };

  const toggleCat = catKey =>
    setCollapsed(c => ({ ...c, [catKey]: !c[catKey] }));

  const q = search.trim().toLowerCase();

  const filteredMods = useMemo(() => {
    if (!q) return null; // null = show by category
    return Object.entries(MOD).filter(([id, m]) =>
      m.label.toLowerCase().includes(q) ||
      id.toLowerCase().includes(q) ||
      (CATS[m.cat]?.l || '').toLowerCase().includes(q)
    );
  }, [q]);

  return (
    <div className="sidebar-scroll">
      {/* Search box */}
      <div style={{ padding: '8px 10px 4px', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1 }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍  Search modules…"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#0a1118', border: '1px solid #1e2a1e',
            borderRadius: 6, padding: '6px 10px',
            color: 'var(--text)', fontSize: 12,
            fontFamily: 'var(--font)', outline: 'none',
          }}
        />
      </div>

      {/* Search results */}
      {filteredMods && (
        filteredMods.length === 0
          ? <div style={{ padding: '16px 12px', color: 'var(--dim)', fontSize: 11, textAlign: 'center' }}>No modules match "{search}"</div>
          : filteredMods.map(([id, m]) => (
            <ModItem key={id} id={id} m={m} onDragStart={onDragStart} onTouchStart={onTouchStart} />
          ))
      )}

      {/* Categorised list (shown when no search) */}
      {!filteredMods && catOrder.map(catKey => {
        const cat  = CATS[catKey];
        const mods = Object.entries(MOD).filter(([, m]) => m.cat === catKey);
        if (!mods.length) return null;
        const isCollapsed = collapsed[catKey];
        return (
          <div key={catKey}>
            <div
              className="cat-header"
              style={{ color: cat.c, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              onClick={() => toggleCat(catKey)}
            >
              <span>{cat.l}</span>
              <span style={{ fontSize: 9, opacity: 0.4, marginRight: 4, transition: 'opacity 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
                onMouseLeave={e => e.currentTarget.style.opacity = '0.4'}
              >{isCollapsed ? '▶' : '▼'}</span>
            </div>
            {!isCollapsed && mods.map(([id, m]) => (
              <ModItem key={id} id={id} m={m} onDragStart={onDragStart} onTouchStart={onTouchStart} />
            ))}
          </div>
        );
      })}

      {!filteredMods && <div className="sidebar-hint">Drag a module onto the canvas</div>}
    </div>
  );
}

function ModItem({ id, m, onDragStart, onTouchStart }) {
  return (
    <div
      className="mod-item"
      draggable
      onDragStart={e => onDragStart(e, id)}
      onTouchStart={e => onTouchStart(e, id)}
      style={{ '--item-color': m.color }}
      title={m.label}
    >
      <span className="mod-icon">{m.icon}</span>
      <div>
        <div className="mod-label">{m.label}</div>
      </div>
    </div>
  );
}
