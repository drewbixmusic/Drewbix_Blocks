import React, { useEffect, useState } from 'react';
import { useStore } from './core/state.js';
import { loadPersistedState, loadFlowObject } from './utils/serialization.js';
import { listFlows, loadFlowById } from './services/flowsService.js';
import { supabase, isSupabaseConfigured } from './services/supabase.js';

import Topbar           from './components/Topbar/Topbar.jsx';
import Sidebar          from './components/Sidebar/Sidebar.jsx';
import Canvas           from './components/Canvas/Canvas.jsx';
import Inspector        from './components/Inspector/Inspector.jsx';
import VizHub           from './components/Modals/VizHub.jsx';
import FlowPickerModal  from './components/Modals/FlowPickerModal.jsx';

export default function App() {
  const { setSavedFlows, setAccounts, setActiveAccount, setSidebarVisible, setInspectorVisible } = useStore();

  // null = not shown, 'loading' = fetching list, 'picking' = show picker
  const [pickerState, setPickerState] = useState(null);
  const [availableFlows, setAvailableFlows] = useState([]);

  useEffect(() => {
    // 1. Restore panel visibility + local accounts from localStorage
    const persisted = loadPersistedState();
    if (persisted.savedFlows?.length)  setSavedFlows(persisted.savedFlows);
    if (persisted.accounts?.length)    setAccounts(persisted.accounts);
    if (persisted.activeAccountId)     setActiveAccount(persisted.activeAccountId);
    if (persisted.sidebarVisible !== undefined)   setSidebarVisible(persisted.sidebarVisible);
    if (persisted.inspectorVisible !== undefined) setInspectorVisible(persisted.inspectorVisible);

    // 2. Load from Supabase if authenticated; no static JSON fallback
    const init = async () => {
      if (!isSupabaseConfigured || !supabase) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      setPickerState('loading');
      const flows = await listFlows();
      setAvailableFlows(flows);

      if (flows.length === 0) {
        // No saved flows — start with blank canvas
        setPickerState(null);
      } else if (flows.length === 1) {
        // Exactly one flow — auto-load it silently
        const data = await loadFlowById(flows[0].id);
        if (data) loadFlowObject(data);
        setPickerState(null);
      } else {
        // Multiple flows — let user choose
        setPickerState('picking');
      }
    };
    init().catch(() => setPickerState(null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePickFlow = async (id) => {
    setPickerState('loading');
    try {
      const data = await loadFlowById(id);
      if (data) loadFlowObject(data);
    } catch (e) {
      console.warn('[App] handlePickFlow:', e);
    }
    setPickerState(null);
  };

  const handlePickEmpty = () => setPickerState(null);

  return (
    <div id="app">
      <Topbar />
      <div id="body">
        <Sidebar />
        <Canvas />
        <Inspector />
      </div>

      <VizHub />

      {(pickerState === 'loading' || pickerState === 'picking') && (
        <FlowPickerModal
          flows={availableFlows}
          loading={pickerState === 'loading'}
          onSelect={handlePickFlow}
          onEmpty={handlePickEmpty}
        />
      )}
    </div>
  );
}
