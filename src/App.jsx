import React, { useEffect } from 'react';
import { useStore } from './core/state.js';
import { loadStartupData, loadPersistedState, loadFlowObject } from './utils/serialization.js';
import { loadDefaultFlow } from './services/flowsService.js';
import { supabase, isSupabaseConfigured } from './services/supabase.js';

import Topbar    from './components/Topbar/Topbar.jsx';
import Sidebar   from './components/Sidebar/Sidebar.jsx';
import Canvas    from './components/Canvas/Canvas.jsx';
import Inspector from './components/Inspector/Inspector.jsx';
import VizHub    from './components/Modals/VizHub.jsx';

export default function App() {
  const { setSavedFlows, setAccounts, setActiveAccount } = useStore();

  useEffect(() => {
    // 1. Restore saved flows and accounts from localStorage
    const persisted = loadPersistedState();
    if (persisted.savedFlows?.length)  setSavedFlows(persisted.savedFlows);
    if (persisted.accounts?.length)    setAccounts(persisted.accounts);
    if (persisted.activeAccountId)     setActiveAccount(persisted.activeAccountId);

    // 2. Load default flow: Supabase first (if authenticated), else static JSON
    const loadFlow = async () => {
      if (isSupabaseConfigured && supabase) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const data = await loadDefaultFlow();
          if (data) {
            loadFlowObject(data);
            return;
          }
        }
      }
      const obj = await loadStartupData();
      if (obj) loadFlowObject(obj);
    };
    loadFlow().catch(() => {});
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div id="app">
      <Topbar />
      <div id="body">
        <Sidebar />
        <Canvas />
        <Inspector />
      </div>

      {/* Unified visualization hub (replaces 4 separate modals) */}
      <VizHub />
    </div>
  );
}
