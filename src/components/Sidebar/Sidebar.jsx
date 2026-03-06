import React from 'react';
import { useStore } from '../../core/state.js';
import PaletteTab    from './PaletteTab.jsx';
import AccountsTab   from './AccountsTab.jsx';
import SavedTab      from './SavedTab.jsx';
import FunctionsTab  from './FunctionsTab.jsx';
import ParamsTab     from './ParamsTab.jsx';
import '../../styles/sidebar.css';

const TABS = [
  { id: 'modules', label: 'Modules' },
  { id: 'params',  label: 'Params' },
  { id: 'creds',   label: 'Accounts' },
  { id: 'saved',   label: 'Saved' },
  { id: 'funcs',   label: 'Functions' },
];

export default function Sidebar() {
  const { sidebarTab, sidebarVisible, setSidebarTab, toggleSidebar } = useStore();

  return (
    <>
      {/* Collapsed bezel tab — only shows when sidebar is hidden */}
      {!sidebarVisible && (
        <div
          onClick={toggleSidebar}
          title="Show sidebar"
          style={{
            position: 'fixed', left: 0, top: '50%', transform: 'translateY(-50%)',
            zIndex: 200, background: 'var(--bg1)', border: '1px solid var(--border)',
            borderLeft: 'none', borderRadius: '0 6px 6px 0',
            padding: '10px 5px', cursor: 'pointer', display: 'flex', alignItems: 'center',
            color: 'var(--muted)', fontSize: 14, userSelect: 'none',
            boxShadow: '2px 0 8px rgba(0,0,0,0.3)',
          }}
        >›</div>
      )}

      <div id="sidebar" className={sidebarVisible ? 'show' : 'hidden'}>
        {/* Panel hide button at top */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '4px 6px 0', flexShrink: 0 }}>
          <button
            onClick={toggleSidebar}
            title="Hide sidebar"
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 4, color: 'var(--muted)', cursor: 'pointer',
              fontSize: 13, padding: '2px 7px', fontFamily: 'var(--font)',
              lineHeight: 1.4,
            }}
          >‹ hide</button>
        </div>

        <div className="tab-bar">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`tab-btn${sidebarTab === t.id ? ' active' : ''}`}
              onClick={() => setSidebarTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {sidebarTab === 'modules'  && <PaletteTab />}
        {sidebarTab === 'params'   && <ParamsTab />}
        {sidebarTab === 'creds'    && <AccountsTab />}
        {sidebarTab === 'saved'    && <SavedTab />}
        {sidebarTab === 'funcs'    && <FunctionsTab />}
      </div>
    </>
  );
}
