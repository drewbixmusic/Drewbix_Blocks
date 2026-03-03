import React, { useState, useCallback } from 'react';
import { useStore } from '../../core/state.js';
import { runFlow }  from '../../core/engine.js';
import { downloadFlowJSON, importFlowFromFile, loadFlowObject, getFlowObject } from '../../utils/serialization.js';
import { saveFlow } from '../../services/flowsService.js';
import { supabase, isSupabaseConfigured } from '../../services/supabase.js';
import DiagnosticsModal from '../Modals/DiagnosticsModal.jsx';
import '../../styles/topbar.css';

export default function Topbar() {
  const {
    flowName, setFlowName,
    zoom, setZoom, resetViewport,
    toggleSidebar, toggleInspector,
    saveCurrentFlow, saveFunction, clearCanvas,
    nodes, edges, configs, pan, functions,
    runLog,
  } = useStore();

  const [running,       setRunning]       = useState(false);
  const [toast,         setToast]         = useState('');
  const [showDiag,      setShowDiag]      = useState(false);
  const [showLog,       setShowLog]       = useState(false);
  const [showSaveFlow,  setShowSaveFlow]  = useState(false);
  const [saveFlowName,  setSaveFlowName]  = useState('');

  const showToast = msg => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  const handleRun = useCallback(async () => {
    setRunning(true);
    try {
      await runFlow(false);
      showToast('Run complete');
    } catch (err) {
      showToast('Error: ' + err.message);
    } finally {
      setRunning(false);
    }
  }, []);

  const handleDryRun = useCallback(async () => {
    setRunning(true);
    try {
      await runFlow(true);
      showToast('Dry run complete');
    } catch (err) {
      showToast('Dry run error: ' + err.message);
    } finally {
      setRunning(false);
    }
  }, []);

  const handleSave = useCallback(async () => {
    saveCurrentFlow();
    if (isSupabaseConfigured && supabase) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const flow = getFlowObject();
        const { ok } = await saveFlow(flowName || 'My Flow', flow);
        if (ok) showToast('Flow saved to cloud');
        else showToast('Flow saved locally');
        return;
      }
    }
    showToast('Flow saved');
  }, [saveCurrentFlow, flowName]);

  const handleExport = useCallback(() => {
    downloadFlowJSON(getFlowObject());
    showToast('Exported');
  }, []);

  const handleImport = useCallback(() => {
    importFlowFromFile(obj => {
      loadFlowObject(obj);
      showToast(`Loaded: ${obj.name || 'flow'}`);
    });
  }, []);

  const handleClear = useCallback(() => {
    if (nodes.length === 0 || confirm('Clear all nodes?')) clearCanvas();
  }, [nodes.length, clearCanvas]);

  const handleOpenSaveFlow = useCallback(() => {
    setSaveFlowName(flowName || '');
    setShowSaveFlow(true);
  }, [flowName]);

  const handleConfirmSaveFlow = useCallback(() => {
    const name = saveFlowName.trim();
    if (!name) { showToast('Enter a function name'); return; }
    const exists = !!functions[name];
    if (exists && !confirm(`Replace existing function "${name}"?`)) return;
    saveFunction(name);
    setShowSaveFlow(false);
    showToast(`Saved as function: ${name}`);
  }, [saveFlowName, functions, saveFunction]);

  return (
    <>
      <div id="topbar">
        <div id="logo">⬡ DREWBIX</div>
        <input
          id="flow-name"
          value={flowName}
          onChange={e => setFlowName(e.target.value)}
          placeholder="Flow name…"
        />

        {/* Run controls */}
        <button className="tb-btn green" onClick={handleRun} disabled={running}>
          {running ? '⟳' : '▶'} <span className="label">Run</span>
        </button>
        <button className="tb-btn amber" onClick={handleDryRun} disabled={running}>
          ⚡ <span className="label">Dry Run</span>
        </button>

        <div id="tb-spacer" />

        {/* Diagnostics / log */}
        <button className="tb-btn amber" onClick={() => setShowDiag(true)} title="Flow diagnostics">
          ◈ <span className="label">Diagnostics</span>
        </button>
        <button className="tb-btn indigo" onClick={() => setShowLog(true)} title="Run log">
          ≡ <span className="label">Log</span>
        </button>

        {/* Flow operations */}
        <button className="tb-btn cyan"   onClick={handleSave}>💾 <span className="label">Save</span></button>
        <button className="tb-btn purple" onClick={handleOpenSaveFlow}>ƒ <span className="label">Save Flow</span></button>
        <button className="tb-btn indigo" onClick={handleExport}>⬇ <span className="label">Export</span></button>
        <button className="tb-btn purple" onClick={handleImport}>⬆ <span className="label">Import</span></button>
        <button className="tb-btn red"    onClick={handleClear}>🗑 <span className="label">Clear</span></button>

        {/* Viewport */}
        <span id="zoom-label">{Math.round(zoom * 100)}%</span>
        <button className="tb-btn" onClick={() => setZoom(zoom * 1.15)}>+</button>
        <button className="tb-btn" onClick={() => setZoom(zoom / 1.15)}>−</button>
        <button className="tb-btn" onClick={resetViewport} title="Reset view">⊡</button>

        {/* Panel toggles */}
        <button id="mobile-menu-btn" className="tb-btn" onClick={toggleSidebar}>☰</button>
        <button id="insp-toggle-btn" className="tb-btn" onClick={toggleInspector}>⊞</button>
      </div>

      {/* Diagnostics modal */}
      {showDiag && <DiagnosticsModal onClose={() => setShowDiag(false)} />}

      {/* Run log modal */}
      {showLog && (
        <div style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          background: '#0d0d1a', border: '2px solid var(--indigo)',
          borderRadius: 8, zIndex: 9999,
          width: 'min(640px,92vw)', maxHeight: '70vh',
          display: 'flex', flexDirection: 'column',
          fontFamily: 'var(--font)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px', background: '#111122',
            borderBottom: '1px solid var(--border)', flexShrink: 0,
          }}>
            <span style={{ color: 'var(--indigo)', fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>≡ RUN LOG</span>
            <button onClick={() => setShowLog(false)} style={{
              background: 'transparent', border: 'none',
              color: 'var(--red)', fontSize: 20, cursor: 'pointer',
            }}>×</button>
          </div>
          <pre style={{
            margin: 0, padding: '12px 16px', overflow: 'auto',
            fontSize: 10, color: 'var(--text)', flex: 1,
            whiteSpace: 'pre-wrap',
          }}>
            {runLog.length ? runLog.join('\n') : '(no run yet — press ▶ Run)'}
          </pre>
        </div>
      )}

      {/* Save Flow dialog */}
      {showSaveFlow && (
        <div style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          background: '#0d0d1a', border: '2px solid var(--purple)',
          borderRadius: 8, zIndex: 9999,
          width: 'min(420px,92vw)',
          fontFamily: 'var(--font)',
          boxShadow: '0 16px 60px rgba(0,0,0,0.6)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px', background: '#110d1a',
            borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ color: 'var(--purple)', fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>ƒ SAVE FLOW AS FUNCTION</span>
            <button onClick={() => setShowSaveFlow(false)} style={{ background: 'transparent', border: 'none', color: 'var(--red)', fontSize: 20, cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ padding: '16px 16px 20px' }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>
              Saves the current canvas as a reusable function block. You can call it from a "For Each" or link it to other flows.
            </div>
            <input
              value={saveFlowName}
              onChange={e => setSaveFlowName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleConfirmSaveFlow()}
              placeholder="Function name…"
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--bg2)', border: '1px solid var(--border)',
                borderRadius: 4, color: 'var(--text)',
                fontFamily: 'var(--font)', fontSize: 12,
                padding: '7px 10px', marginBottom: 8,
              }}
            />
            {functions[saveFlowName?.trim()] && (
              <div style={{ fontSize: 10, color: 'var(--amber)', marginBottom: 10 }}>
                ⚠ A function named "{saveFlowName.trim()}" already exists. Confirm will replace it.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowSaveFlow(false)}
                style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--muted)', cursor: 'pointer', fontSize: 11, padding: '5px 14px', fontFamily: 'var(--font)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSaveFlow}
                style={{ background: 'var(--purple)', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 11, padding: '5px 18px', fontFamily: 'var(--font)', fontWeight: 700 }}
              >
                Save Function
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 6,
          padding: '8px 18px', fontSize: 11, color: 'var(--text)', zIndex: 700,
        }}>
          {toast}
        </div>
      )}
    </>
  );
}
