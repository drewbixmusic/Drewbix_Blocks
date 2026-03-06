import React from 'react';
import { useStore } from '../../core/state.js';
import PaletteTab    from './PaletteTab.jsx';
import AccountsTab   from './AccountsTab.jsx';
import SavedTab      from './SavedTab.jsx';
import FunctionsTab  from './FunctionsTab.jsx';
import ParamsTab     from './ParamsTab.jsx';
import '../../styles/sidebar.css';

// Row 1: Accounts · Saved · Functions  |  Row 2: Modules · Params · (spacer)
const TABS = [
  { id: 'creds',   label: 'Accounts' },
  { id: 'saved',   label: 'Saved' },
  { id: 'funcs',   label: 'Functions' },
  { id: 'modules', label: 'Modules' },
  { id: 'params',  label: 'Params' },
];

export default function Sidebar() {
  const { sidebarTab, sidebarVisible, setSidebarTab, toggleSidebar } = useStore();

  return (
    <>
      {/* Collapsed bezel — visible arrow tab when sidebar hidden */}
      {!sidebarVisible && (
        <div
          onClick={toggleSidebar}
          title="Show sidebar"
          style={{
            position: 'fixed', left: 0, top: '50%', transform: 'translateY(-50%)',
            zIndex: 200, background: '#1e3a2e', border: '1px solid #4ade80',
            borderLeft: 'none', borderRadius: '0 8px 8px 0',
            padding: '12px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center',
            color: '#4ade80', fontSize: 18, userSelect: 'none', fontWeight: 700,
            boxShadow: '3px 0 12px rgba(0,0,0,0.5)',
          }}
        >›</div>
      )}

      <div id="sidebar" className={sidebarVisible ? 'show' : 'hidden'}>
        {/* Panel hide button at top */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '5px 8px 2px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
          <button
            onClick={toggleSidebar}
            title="Hide sidebar"
            style={{
              background: '#1e3a2e', border: '1px solid #4ade80',
              borderRadius: 5, color: '#4ade80', cursor: 'pointer',
              fontSize: 12, padding: '3px 10px', fontFamily: 'var(--font)',
              fontWeight: 600, lineHeight: 1.4,
            }}
          >‹‹ hide</button>
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
