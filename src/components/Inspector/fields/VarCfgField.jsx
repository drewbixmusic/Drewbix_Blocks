/**
 * VarCfgField — Variable selection for RF / MV blocks.
 *
 * AUTO mode: features + targets ports are wired → locked display, no checkboxes.
 * MANUAL mode: neither port wired → editable dep/indep checkbox lists from passthru headers.
 */
import React from 'react';
import { useStore } from '../../../core/state.js';
import { getUpstreamFields } from '../../../utils/data.js';

const S = {
  wrap:    { marginBottom: 10 },
  lbl:     { fontSize: 10, color: 'var(--muted)', marginBottom: 5 },
  secHdr:  { fontSize: 9, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3, marginTop: 8 },
  list:    { maxHeight: 130, overflowY: 'auto', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 0' },
  row:     { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px', cursor: 'pointer', userSelect: 'none' },
  cb:      { accentColor: 'var(--cyan)', cursor: 'pointer', flexShrink: 0 },
  field:   { fontSize: 10, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  empty:   { fontSize: 9, color: 'var(--dim)', padding: '8px 12px', textAlign: 'center' },
  autoBox: { background: 'var(--bg2)', border: '1px solid #84cc1633', borderRadius: 4, padding: '8px 10px', marginTop: 4 },
  autoHdr: { fontSize: 9, color: '#84cc16', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 },
  chip:    { display: 'inline-block', fontSize: 8, background: '#84cc1622', color: '#84cc16', border: '1px solid #84cc1644', borderRadius: 3, padding: '1px 5px', margin: '2px 2px 0 0' },
  chipDim: { display: 'inline-block', fontSize: 8, background: 'var(--bg1)', color: 'var(--dim)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px', margin: '2px 2px 0 0' },
  note:    { fontSize: 9, color: '#84cc16', marginTop: 6, opacity: 0.7 },
};

export default function VarCfgField({ label, value, nodeId, featNodeId, targNodeId, onChange }) {
  const { nodes, edges, configs, runResults } = useStore();

  const val   = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  const dep   = Array.isArray(val.dep)   ? val.dep   : [];
  const indep = Array.isArray(val.indep) ? val.indep : [];

  // ── AUTO MODE: features/targets ports wired ──────────────────────────────────
  if (featNodeId || targNodeId) {
    const featData = featNodeId ? runResults[featNodeId] : null;
    const targData = targNodeId ? runResults[targNodeId] : null;

    const featPort = featData?.features;
    const ftMap    = featPort?.featureTargetMap || null;

    // All features ranked by Net_RSQ — only those selected for at least one target
    let autoFeats = [];
    if (featPort?.feRsqRows?.length) {
      autoFeats = [...featPort.feRsqRows]
        .filter(r => r.Net_RSQ != null)   // null Net_RSQ = not selected for any target
        .sort((a, b) => (a.rank || 999) - (b.rank || 999))
        .map(r => r.independent_variable).filter(Boolean);
    } else if (Array.isArray(featPort?._headers) && featPort._headers.length) {
      autoFeats = featPort._headers;
    } else if (Array.isArray(featData?._headers_features) && featData._headers_features.length) {
      autoFeats = featData._headers_features;
    }

    let autoDep = [];
    const targPort = targData?.targets;
    if (Array.isArray(targPort?._headers) && targPort._headers.length) {
      autoDep = targPort._headers;
    } else if (Array.isArray(targData?._headers_targets) && targData._headers_targets.length) {
      autoDep = targData._headers_targets;
    }

    // Build per-target feature lists when ftMap is available
    const perTargetFeats = ftMap && autoDep.length
      ? autoDep.map(dv => ({
          dv,
          feats: autoFeats.filter(f => (ftMap[f] || []).includes(dv)),
        }))
      : null;

    const hasPerTarget = perTargetFeats && perTargetFeats.some(pt => pt.feats.length > 0);

    return (
      <div style={S.wrap}>
        <div style={S.lbl}>{label}</div>
        <div style={S.autoBox}>
          <div style={S.autoHdr}>🔗 Auto-configured from Features / Targets ports</div>
          {(!autoFeats.length && !autoDep.length) ? (
            <div style={{ fontSize: 9, color: 'var(--dim)' }}>
              Run the upstream Feature Eng. block first to populate targets and features.
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 8, color: 'var(--muted)', marginBottom: 3 }}>TARGETS ({autoDep.length})</div>
                <div>{autoDep.map(f => <span key={f} style={S.chip}>{f}</span>)}</div>
              </div>
              {hasPerTarget ? (
                <div>
                  <div style={{ fontSize: 8, color: 'var(--muted)', marginBottom: 3 }}>
                    FEATURES BY TARGET
                  </div>
                  {perTargetFeats.map(({ dv, feats }) => (
                    <div key={dv} style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 8, color: 'var(--cyan)', marginBottom: 2 }}>
                        {dv} <span style={{ color: 'var(--muted)' }}>({feats.length})</span>
                      </div>
                      <div>
                        {feats.length === 0
                          ? <span style={{ fontSize: 8, color: 'var(--dim)', fontStyle: 'italic' }}>none selected</span>
                          : feats.map(f => <span key={f} style={S.chipDim}>{f}</span>)
                        }
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 8, color: 'var(--muted)', marginBottom: 3 }}>FEATURES ({autoFeats.length})</div>
                  <div>{autoFeats.map(f => <span key={f} style={S.chipDim}>{f}</span>)}</div>
                </div>
              )}
            </>
          )}
          <div style={S.note}>Disconnect features/targets ports to configure manually.</div>
        </div>
      </div>
    );
  }

  // ── MANUAL MODE: no ports wired — read from passthru headers ─────────────────
  const passthruEdges = edges.filter(e => e.to === nodeId && e.toPort === 'passthru');
  const upstreamFields = getUpstreamFields(nodeId, passthruEdges, nodes, configs);
  const hasLiveFields = upstreamFields.length > 0;

  const savedNames = indep.map(iv => iv.name);
  const allNames = hasLiveFields
    ? [...new Set([...upstreamFields])]
    : [...new Set([...savedNames])];

  const staleIndepSet = hasLiveFields ? new Set(savedNames.filter(n => !upstreamFields.includes(n))) : new Set();
  const staleDepSet   = hasLiveFields ? new Set(dep.filter(d => !upstreamFields.includes(d))) : new Set();

  const enabledMap = {};
  indep.filter(iv => !hasLiveFields || upstreamFields.includes(iv.name))
       .forEach(iv => { enabledMap[iv.name] = iv.enabled !== false; });
  allNames.forEach(f => { if (!(f in enabledMap)) enabledMap[f] = true; });

  const buildIndep = (map) => allNames.map(f => ({ name: f, enabled: map[f] !== false }));
  const toggleDep   = f => { const d = dep.includes(f) ? dep.filter(x=>x!==f) : [...dep,f]; onChange({ dep: d, indep: buildIndep(enabledMap) }); };
  const toggleIndep = f => { onChange({ dep, indep: buildIndep({ ...enabledMap, [f]: !enabledMap[f] }) }); };
  const allEnabled  = allNames.filter(f => enabledMap[f] !== false);
  const depListNames = hasLiveFields ? [...new Set([...upstreamFields, ...dep.filter(d => staleDepSet.has(d))])] : allNames;

  return (
    <div style={S.wrap}>
      <div style={S.lbl}>{label}</div>

      <div style={S.secHdr}>
        Target / Dependent (Y) — {dep.filter(d => !staleDepSet.has(d)).length} selected
        {staleDepSet.size > 0 && <span style={{ color: '#f97316', marginLeft: 6 }}>({staleDepSet.size} stale)</span>}
      </div>
      <div style={S.list}>
        {depListNames.length === 0
          ? <div style={S.empty}>Connect passthru port to see fields</div>
          : depListNames.map(f => {
              const isStale = staleDepSet.has(f);
              return (
                <label key={f} style={{ ...S.row, opacity: isStale ? 0.55 : 1 }}>
                  <input style={S.cb} type="checkbox" checked={dep.includes(f)} onChange={() => toggleDep(f)} />
                  <span style={{ ...S.field, color: dep.includes(f) ? (isStale ? '#f97316' : 'var(--cyan)') : 'var(--text)' }}>
                    {isStale ? `⚠ ${f}` : f}
                  </span>
                </label>
              );
            })
        }
      </div>

      <div style={{ ...S.secHdr, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>
          Features / Independent (X) — {allEnabled.length}/{allNames.length} enabled
          {staleIndepSet.size > 0 && <span style={{ color: '#f97316', marginLeft: 6 }}>({staleIndepSet.size} stale)</span>}
        </span>
        <span style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => onChange({ dep, indep: buildIndep(Object.fromEntries(allNames.map(f=>[f,true]))) })}
            style={{ fontSize: 8, padding: '1px 5px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--muted)', cursor: 'pointer' }}>all</button>
          <button onClick={() => onChange({ dep, indep: buildIndep(Object.fromEntries(allNames.map(f=>[f,false]))) })}
            style={{ fontSize: 8, padding: '1px 5px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--muted)', cursor: 'pointer' }}>none</button>
        </span>
      </div>
      <div style={S.list}>
        {allNames.length === 0
          ? <div style={S.empty}>Connect passthru port to see fields</div>
          : allNames.map(f => {
              const on = enabledMap[f] !== false;
              return (
                <label key={f} style={S.row}>
                  <input style={S.cb} type="checkbox" checked={on} onChange={() => toggleIndep(f)} />
                  <span style={{ ...S.field, opacity: on ? 1 : 0.35 }}>{f}</span>
                </label>
              );
            })
        }
      </div>
    </div>
  );
}
