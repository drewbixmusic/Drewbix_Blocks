import React, { useState, useEffect } from 'react';
import { useStore } from '../../core/state.js';
import { loadFlowObject } from '../../utils/serialization.js';
import { listFlows, loadFlowById, deleteFlow } from '../../services/flowsService.js';
import { supabase, isSupabaseConfigured } from '../../services/supabase.js';

export default function SavedTab() {
  const { savedFlows, loadSavedFlow, deleteSavedFlow, setSavedFlows } = useStore();
  const [cloudFlows, setCloudFlows] = useState([]);
  const [cloudSession, setCloudSession] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCloudSession(!!session);
      if (session) {
        listFlows().then(setCloudFlows);
      }
    });
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setCloudSession(!!session);
        if (session) listFlows().then(setCloudFlows);
        else setCloudFlows([]);
      });
    });
    return () => subscription?.unsubscribe();
  }, []);

  const fmt = ts => ts ? new Date(ts).toLocaleDateString() : '';
  const flows = cloudSession && cloudFlows.length > 0 ? cloudFlows : savedFlows;
  const isCloud = cloudSession && cloudFlows.length > 0;

  const handleLoad = async (f) => {
    if (isCloud) {
      const data = await loadFlowById(f.id);
      if (data) loadFlowObject(data);
    } else {
      loadSavedFlow(f.id);
    }
  };

  const handleDelete = async (f) => {
    if (isCloud) {
      if (!confirm(`Delete flow "${f.name}"?`)) return;
      const { ok } = await deleteFlow(f.id);
      if (ok) setCloudFlows(prev => prev.filter(x => x.id !== f.id));
    } else {
      deleteSavedFlow(f.id);
    }
  };

  if (!flows.length) {
    return (
      <div className="sidebar-scroll">
        <div className="empty-state-side">
          No saved flows yet.<br/>Use Save in the toolbar.
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar-scroll">
      {flows.map(f => (
        <div key={f.id} className="flow-card">
          <div className="flow-card-name">{f.name}</div>
          <div className="flow-card-meta">
            {f.nodes?.length ?? '—'} nodes · {fmt(f.updated_at || f.savedAt)}
          </div>
          <div className="flow-card-btns">
            <button
              className="mini-btn"
              style={{ borderColor: 'var(--cyan)', color: 'var(--cyan)' }}
              onClick={() => handleLoad(f)}
            >
              Load
            </button>
            <button
              className="mini-btn"
              style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
              onClick={() => handleDelete(f)}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
