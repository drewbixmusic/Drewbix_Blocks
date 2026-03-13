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
    kFoldResults,
  } = rfDashboard;

  const isKFold = !!kFoldResults;

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
            Mode: <span style={{ color: 'var(--cyan)' }}>{effectiveMode}{isKFold ? ' · K-Fold' : ''}</span>
            {isKFold && (
              <span style={{ marginLeft: 10 }}>
                Folds: <span style={{ color: 'var(--amber)' }}>{kFoldResults.nFolds}</span>
                {kFoldResults.autoDetected && <span style={{ marginLeft: 6, color: 'var(--dim)' }}>(auto-detected)</span>}
              </span>
            )}
            {effectiveMode === 'Stored' && storedModel && (
              <span style={{ marginLeft: 10 }}>Using stored model: <span style={{ color: 'var(--amber)' }}>{storedModel.name}</span></span>
            )}
          </div>

          {/* Per-dep-var stats */}
          {depVars.map(dv => {
            const r = rfResults[dv] || {};
            const foldW  = kFoldResults?.foldWeights?.[dv] || [];
            const valR2s = kFoldResults?.foldValR2s?.[dv]  || [];
            const mods   = kFoldResults?.modNames           || [];
            const maxW   = foldW.length ? Math.max(...foldW, 1e-9) : 1;
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

                {/* K-fold blend weights table */}
                {isKFold && foldW.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 9, color: 'var(--dim)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
                      Fold Blend Weights (OOS-based)
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '80px 70px 1fr 55px', gap: '2px 8px',
                      fontSize: 10, color: 'var(--muted)', borderBottom: '1px solid var(--border)', paddingBottom: 3, marginBottom: 4 }}>
                      <span>Fold</span><span>OOS R²</span><span>Blend Weight</span><span style={{ textAlign: 'right' }}>Wt %</span>
                    </div>
                    {foldW.map((w, fi) => (
                      <div key={fi} style={{ display: 'grid', gridTemplateColumns: '80px 70px 1fr 55px', gap: '2px 8px',
                        alignItems: 'center', fontSize: 10, marginBottom: 3 }}>
                        <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {mods[fi] ?? `Fold ${fi + 1}`}
                        </span>
                        <span style={{ color: valR2s[fi] != null ? 'var(--amber)' : 'var(--muted)' }}>
                          {valR2s[fi] != null ? Number(valR2s[fi]).toFixed(4) : '—'}
                        </span>
                        <div style={{ background: 'var(--border)', borderRadius: 2, height: 6 }}>
                          <div style={{ width: `${Math.min(100, (w / maxW) * 100)}%`, background: 'var(--cyan)', height: '100%', borderRadius: 2 }} />
                        </div>
                        <span style={{ textAlign: 'right', color: 'var(--muted)' }}>
                          {(w * 100).toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Feature importance */}
                {r.importance && Object.keys(r.importance).length > 0 && (
                  <div>
                    <div style={{ fontSize: 9, color: 'var(--dim)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
                      Pilot Permutation Importance (avg across folds)
                    </div>
                    {Object.entries(r.importance)
                      .sort(([, a], [, b]) => b - a)
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
