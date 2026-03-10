/**
 * VarCfgField — UI for rsqcfg / mvcfg config types.
 *
 * When RSQ is connected (rsqConnected=true):
 *   - Shows a read-only auto-config panel derived from RSQ run results
 *   - Manual dep/indep config is hidden (RSQ linkage takes precedence)
 *
 * When RSQ is not connected (rsqConnected=false):
 *   - Shows editable dep and indep checkbox lists
 *   - Only shows fields from edges where toPort === 'data' (avoids RSQ output
 *     columns polluting the list on RF blocks)
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

const SKIP_RSQ = new Set(['rank', 'independent_variable', 'Net_RSQ']);

export default function VarCfgField({ label, value, nodeId, rsqConnected, rsqNodeId, featNodeId, targNodeId, onChange }) {
  const { nodes, edges, configs, runResults } = useStore();

  // Normalise value
  const val   = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  const dep   = Array.isArray(val.dep)   ? val.dep   : [];
  const indep = Array.isArray(val.indep) ? val.indep : [];

  // ── AUTO MODE (RSQ port, features port, or targets port connected) ───────────
  if (rsqConnected) {
    // features/targets port wiring: runResults[nodeId] IS the module output directly
    const featData = featNodeId ? runResults[featNodeId] : null;
    const targData = targNodeId ? runResults[targNodeId] : null;

    // Pull from features port bundle
    let autoFeats = [];
    const featPort = featData?.features;
    if (featPort?.feRsqRows?.length) {
      autoFeats = [...featPort.feRsqRows]
        .sort((a, b) => (a.rank || 999) - (b.rank || 999))
        .map(r => r.independent_variable).filter(Boolean);
    } else if (Array.isArray(featPort?._headers) && featPort._headers.length) {
      autoFeats = featPort._headers;
    } else if (Array.isArray(featData?._headers_features) && featData._headers_features.length) {
      autoFeats = featData._headers_features;
    }

    // Pull from targets port bundle
    let autoDep = [];
    const targPort = targData?.targets;
    if (Array.isArray(targPort?._headers) && targPort._headers.length) {
      autoDep = targPort._headers;
    } else if (Array.isArray(targData?._headers_targets) && targData._headers_targets.length) {
      autoDep = targData._headers_targets;
    }

    // Fall back to rsq port if features/targets ports gave nothing
    if (!autoFeats.length && !autoDep.length) {
      const rsqRows = rsqNodeId ? (runResults[rsqNodeId]?._rows || []) : [];
      if (rsqRows.length) {
        autoDep   = Object.keys(rsqRows[0]).filter(k => !SKIP_RSQ.has(k) && !k.startsWith('_'));
        autoFeats = [...rsqRows]
          .sort((a, b) => (a.rank || 999) - (b.rank || 999))
          .map(r => r.independent_variable).filter(Boolean);
      }
    }

    const hasPortWiring = !!(featNodeId || targNodeId);
    return (
      <div style={S.wrap}>
        <div style={S.lbl}>{label}</div>
        <div style={S.autoBox}>
          <div style={S.autoHdr}>
            {hasPortWiring ? '🔗 Auto-configured from Features / Targets ports' : '🔗 Auto-configured from Pearson R² input'}
          </div>
          {(!autoFeats.length && !autoDep.length) ? (
            <div style={{ fontSize: 9, color: 'var(--dim)' }}>
              Run the upstream Feature Eng. block to populate targets and features automatically.
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 8, color: 'var(--muted)', marginBottom: 3 }}>
                  TARGET / DEP ({autoDep.length})
                </div>
                <div>{autoDep.map(f => <span key={f} style={S.chip}>{f}</span>)}</div>
              </div>
              <div>
                <div style={{ fontSize: 8, color: 'var(--muted)', marginBottom: 3 }}>
                  FEATURES / INDEP ({autoFeats.length})
                </div>
                <div>{autoFeats.map(f => <span key={f} style={S.chipDim}>{f}</span>)}</div>
              </div>
            </>
          )}
          <div style={S.note}>Disconnect the RSQ port to configure manually.</div>
        </div>
      </div>
    );
  }

  // ── MANUAL MODE (RSQ not connected) ─────────────────────────────────────────
  // Only pull fields from edges where toPort === 'data' to avoid RSQ output columns
  const dataEdges = edges.filter(e => e.to === nodeId && e.toPort === 'data');
  const upstreamFields = getUpstreamFields(nodeId, dataEdges, nodes, configs);

  const hasLiveFields = upstreamFields.length > 0;

  // When live headers are available, prune saved names that are no longer present.
  // When no headers yet (upstream not run), keep saved names so the config isn't
  // wiped on first open. Dep names are always included in indep so they stay visible.
  const savedNames = indep.map(iv => iv.name);
  const allNames = hasLiveFields
    ? [...new Set([...upstreamFields])]          // live only — stale saved names dropped
    : [...new Set([...savedNames])];             // no headers yet — keep saved

  // Classify stale names for visual markers (saved but not in live headers)
  const staleIndepSet = hasLiveFields
    ? new Set(savedNames.filter(n => !upstreamFields.includes(n)))
    : new Set();
  const staleDepSet = hasLiveFields
    ? new Set(dep.filter(d => !upstreamFields.includes(d)))
    : new Set();

  const enabledMap = {};
  indep
    .filter(iv => !hasLiveFields || upstreamFields.includes(iv.name))
    .forEach(iv => { enabledMap[iv.name] = iv.enabled !== false; });
  allNames.forEach(f => { if (!(f in enabledMap)) enabledMap[f] = true; });

  function buildIndep(newEnabledMap) {
    return allNames.map(f => ({ name: f, enabled: newEnabledMap[f] !== false }));
  }

  const toggleDep = f => {
    // When toggling dep, also write back a pruned indep (drops stale names from cfg)
    const newDep = dep.includes(f) ? dep.filter(d => d !== f) : [...dep, f];
    onChange({ dep: newDep, indep: buildIndep(enabledMap) });
  };

  const toggleIndep = f => {
    const newMap = { ...enabledMap, [f]: !enabledMap[f] };
    onChange({ dep, indep: buildIndep(newMap) });
  };

  const allEnabled = allNames.filter(f => enabledMap[f] !== false);

  const selectAllIndep = () => {
    const newMap = Object.fromEntries(allNames.map(f => [f, true]));
    onChange({ dep, indep: buildIndep(newMap) });
  };
  const clearAllIndep = () => {
    const newMap = Object.fromEntries(allNames.map(f => [f, false]));
    onChange({ dep, indep: buildIndep(newMap) });
  };

  // Dep list: show live fields + any stale saved dep selections (dimmed with warning)
  const depListNames = hasLiveFields
    ? [...new Set([...upstreamFields, ...dep.filter(d => staleDepSet.has(d))])]
    : allNames;

  return (
    <div style={S.wrap}>
      <div style={S.lbl}>{label}</div>

      {/* Dependent (Y) */}
      <div style={S.secHdr}>
        Target / Dependent (Y) — {dep.filter(d => !staleDepSet.has(d)).length} selected
        {staleDepSet.size > 0 && (
          <span style={{ color: '#f97316', marginLeft: 6 }}>({staleDepSet.size} stale)</span>
        )}
      </div>
      <div style={S.list}>
        {depListNames.length === 0
          ? <div style={S.empty}>Run upstream nodes first to see fields</div>
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

      {/* Independent (X) */}
      <div style={{ ...S.secHdr, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>
          Features / Independent (X) — {allEnabled.length}/{allNames.length} enabled
          {staleIndepSet.size > 0 && (
            <span style={{ color: '#f97316', marginLeft: 6 }}>({staleIndepSet.size} stale hidden)</span>
          )}
        </span>
        <span style={{ display: 'flex', gap: 6 }}>
          <button onClick={selectAllIndep} style={{ fontSize: 8, padding: '1px 5px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--muted)', cursor: 'pointer' }}>all</button>
          <button onClick={clearAllIndep}  style={{ fontSize: 8, padding: '1px 5px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--muted)', cursor: 'pointer' }}>none</button>
        </span>
      </div>
      <div style={S.list}>
        {allNames.length === 0
          ? <div style={S.empty}>Run upstream nodes first to see fields</div>
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
