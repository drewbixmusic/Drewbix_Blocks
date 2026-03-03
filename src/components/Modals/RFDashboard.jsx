import React from 'react';
import { useStore } from '../../core/state.js';

export default function RFDashboard() {
  const { rfDashboard, closeRFDashboard } = useStore();

  if (!rfDashboard) return null;

  const {
    rfResults = {},
    depVars   = [],
    testSet   = new Set(),
    storedModel,
    effectiveMode = 'New',
  } = rfDashboard;

  return (
    <div id="rf-overlay" className="show">
      <div id="rf-modal">
        <div id="rf-modal-header">
          <span id="rf-modal-title">Random Forest Dashboard</span>
          <button id="rf-modal-close" onClick={closeRFDashboard}>×</button>
        </div>
        <div id="rf-modal-body">

          {/* Mode summary */}
          <div style={{ marginBottom: 12, fontSize: 11, color: 'var(--muted)' }}>
            Mode: <span style={{ color: 'var(--cyan)' }}>{effectiveMode}</span>
            {effectiveMode === 'Stored' && storedModel && (
              <span style={{ marginLeft: 10 }}>Using stored model: <span style={{ color: 'var(--amber)' }}>{storedModel.name}</span></span>
            )}
          </div>

          {/* Per-dep-var stats */}
          {depVars.map(dv => {
            const r = rfResults[dv] || {};
            return (
              <div key={dv} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 5, padding: '10px 12px', marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--cyan)', marginBottom: 6, fontWeight: 600 }}>
                  Dep. Var: {dv}
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: 11, marginBottom: 8, flexWrap: 'wrap' }}>
                  <div>Train R²: <span style={{ color: 'var(--green)' }}>{r.trainR2 ?? '—'}</span></div>
                  <div>Test R²:  <span style={{ color: 'var(--amber)' }}>{r.testR2  ?? '—'}</span></div>
                  <div>Train N:  <span style={{ color: 'var(--text)'  }}>{r.nTrain  ?? '—'}</span></div>
                  <div>Test N:   <span style={{ color: 'var(--text)'  }}>{r.nTest   ?? '—'}</span></div>
                  <div>Eng Feats:<span style={{ color: 'var(--purple)'}}>{r.nEng    ?? 0}</span></div>
                </div>

                {/* Feature importance */}
                {r.importance && Object.keys(r.importance).length > 0 && (
                  <div>
                    <div style={{ fontSize: 9, color: 'var(--dim)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
                      Feature Importance
                    </div>
                    {Object.entries(r.importance)
                      .sort(([, a], [, b]) => b - a)
                      .slice(0, 10)
                      .map(([feat, imp]) => (
                        <div key={feat} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                          <div style={{ fontSize: 10, color: 'var(--text)', width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{feat}</div>
                          <div style={{ flex: 1, background: 'var(--border)', borderRadius: 2, height: 4 }}>
                            <div style={{ width: `${Math.min(100, imp * 100)}%`, background: 'var(--cyan)', height: '100%', borderRadius: 2 }} />
                          </div>
                          <div style={{ fontSize: 9, color: 'var(--muted)', width: 40, textAlign: 'right' }}>{(imp * 100).toFixed(1)}%</div>
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
