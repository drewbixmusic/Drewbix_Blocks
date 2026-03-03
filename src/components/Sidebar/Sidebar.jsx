import React from 'react';
import { useStore } from '../../core/state.js';
import PaletteTab   from './PaletteTab.jsx';
import AccountsTab  from './AccountsTab.jsx';
import SavedTab     from './SavedTab.jsx';
import FunctionsTab from './FunctionsTab.jsx';
import '../../styles/sidebar.css';

const TABS = [
  { id: 'modules', label: 'Modules' },
  { id: 'creds',   label: 'Accounts' },
  { id: 'saved',   label: 'Saved' },
  { id: 'funcs',   label: 'Functions' },
];

export default function Sidebar() {
  const { sidebarTab, sidebarVisible, setSidebarTab } = useStore();

  return (
    <div id="sidebar" className={sidebarVisible ? '' : 'hidden'}>
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
      {sidebarTab === 'creds'    && <AccountsTab />}
      {sidebarTab === 'saved'    && <SavedTab />}
      {sidebarTab === 'funcs'    && <FunctionsTab />}
    </div>
  );
}
