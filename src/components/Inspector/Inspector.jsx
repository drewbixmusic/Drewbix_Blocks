import React from 'react';
import { useStore } from '../../core/state.js';
import { nodeDef, modCfg, LABEL_CFG } from '../../core/registry.js';
import TextField           from './fields/TextField.jsx';
import NumberField         from './fields/NumberField.jsx';
import SelectField         from './fields/SelectField.jsx';
import BoolField           from './fields/BoolField.jsx';
import MultiField          from './fields/MultiField.jsx';
import TextareaField       from './fields/TextareaField.jsx';
import DynFieldSelect      from './fields/DynFieldSelect.jsx';
import MultiDynFieldSelect from './fields/MultiDynFieldSelect.jsx';
import FieldPickField      from './fields/FieldPickField.jsx';
import CondRowsField       from './fields/CondRowsField.jsx';
import FnPickField         from './fields/FnPickField.jsx';
import VarCfgField         from './fields/VarCfgField.jsx';
import FeVarCfgField       from './fields/FeVarCfgField.jsx';
import SeriesRowsField     from './fields/SeriesRowsField.jsx';
import RfModelNameField from './fields/RfModelNameField.jsx';
import RFModelPanel    from './RFModelPanel.jsx';
import MvModelNameField from './fields/MvModelNameField.jsx';
import MvModelPanel    from './MvModelPanel.jsx';
import FeModelPanel    from './FeModelPanel.jsx';
import DataImportPanel from './DataImportPanel.jsx';
import '../../styles/inspector.css';

export default function Inspector() {
  const {
    selectedId, nodes, edges, configs, functions,
    runResults, setConfig, deleteEdge, inspectorVisible,
    openVizTab, toggleInspector,
  } = useStore();

  const node = nodes.find(n => n.id === selectedId);

  // In "show" latch mode, auto-hide when no node selected to avoid blank panel.
  // When "hidden" latch is set, stay hidden regardless of selection.
  const shouldShow = inspectorVisible && !!node;
  const visibilityClass = shouldShow ? 'show' : 'hidden';

  if (!shouldShow) {
    // Collapsed bezel tab on the right edge when inspector is latched hidden
    const collapsedBezel = !inspectorVisible && (
      <div
        onClick={toggleInspector}
        title="Show inspector"
        style={{
          position: 'fixed', right: 0, top: '50%', transform: 'translateY(-50%)',
          zIndex: 200, background: '#1a1e3a', border: '1px solid #818cf8',
          borderRight: 'none', borderRadius: '8px 0 0 8px',
          padding: '12px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center',
          color: '#818cf8', fontSize: 18, userSelect: 'none', fontWeight: 700,
          boxShadow: '-3px 0 12px rgba(0,0,0,0.5)',
        }}
      >‹</div>
    );
    return <>{collapsedBezel}<div id="inspector" className={visibilityClass} aria-hidden="true" /></>;
  }

  const def  = nodeDef(node, functions);
  const cfg  = configs[node.id] || {};
  const fields = def ? { ...LABEL_CFG, ...def.cfg } : LABEL_CFG;

  const upstreamEdges  = edges.filter(e => e.to   === node.id);
  const downstreamEdges= edges.filter(e => e.from === node.id);

  const runResult  = runResults[node.id];
  const rows       = runResult?._rows || [];
  const runError   = runResult?.error;

  const change = (key, val) => setConfig(node.id, key, val);

  function renderField(key, fDef) {
    const val = cfg[key] ?? fDef.d ?? '';
    if (node.moduleId === 'rand_forest' && key === 'model_name') {
      return <RfModelNameField key={key} label={fDef.l} value={val} onChange={v => change(key, v)} />;
    }
    if (node.moduleId === 'mv_regression' && key === 'model_name') {
      return <MvModelNameField key={key} label={fDef.l} value={val} onChange={v => change(key, v)} />;
    }
    switch (fDef.t) {
      case 'text':      return <TextField     key={key} label={fDef.l} value={val} onChange={v => change(key, v)} />;
      case 'number':    return <NumberField   key={key} label={fDef.l} value={val} onChange={v => change(key, v)} />;
      case 'sel':       return <SelectField   key={key} label={fDef.l} value={val} opts={fDef.opts} onChange={v => change(key, v)} />;
      case 'bool':      return <BoolField     key={key} label={fDef.l} value={val} onChange={v => change(key, v)} />;
      case 'multi':     return <MultiField    key={key} label={fDef.l} value={val} opts={fDef.opts} onChange={v => change(key, v)} />;
      case 'textarea':  return <TextareaField key={key} label={fDef.l} value={val} onChange={v => change(key, v)} />;
      case 'dynfield':  return <DynFieldSelect key={key} label={fDef.l} value={val} nodeId={node.id} onChange={v => change(key, v)} />;
      case 'multidynfield': return (
        <MultiDynFieldSelect
          key={key}
          label={fDef.l}
          value={Array.isArray(val) ? val : []}
          nodeId={node.id}
          port={fDef.port || null}
          onChange={v => change(key, v)}
        />
      );
      case 'sidechain': return <SelectField   key={key} label={fDef.l} value={val} opts={['input', 'manual']} onChange={v => change(key, v)} />;
      case 'fnpick':
        return (
          <FnPickField
            key={key}
            label={fDef.l}
            value={val}
            nodeId={node.id}
            onChange={v => change(key, v)}
            onInnerChange={(innerKey, innerVal) => change(innerKey, innerVal)}
          />
        );
      case 'fieldpick':
      case 'colorder':
        return <FieldPickField key={key} label={fDef.l} value={val} nodeId={node.id} onChange={v => change(key, v)} />;
      case 'condrows':
        return <CondRowsField key={key} label={fDef.l} value={val} nodeId={node.id} onChange={v => change(key, v)} />;
      case 'fecfg':
        return (
          <FeVarCfgField
            key={key}
            label={fDef.l}
            value={val}
            nodeId={node.id}
            onChange={v => change(key, v)}
          />
        );
      case 'rsqcfg':
      case 'mvcfg': {
        const rsqEdge      = upstreamEdges.find(e => e.toPort === 'rsq');
        const featEdge     = upstreamEdges.find(e => e.toPort === 'features');
        const targEdge     = upstreamEdges.find(e => e.toPort === 'targets');
        const portsConnected = !!(featEdge || targEdge);
        const rsqConnected = !!(rsqEdge || portsConnected);
        // For port-based wiring, derive rsqNodeId from features edge (it holds the ranked list)
        const rsqNodeId    = rsqEdge ? rsqEdge.from : (featEdge ? featEdge.from : null);
        return (
          <VarCfgField
            key={key}
            label={fDef.l}
            value={val}
            nodeId={node.id}
            rsqConnected={rsqConnected}
            rsqNodeId={rsqNodeId}
            featNodeId={featEdge ? featEdge.from : null}
            targNodeId={targEdge ? targEdge.from : null}
            onChange={v => change(key, v)}
          />
        );
      }
      case 'seriesrows':
        return (
          <SeriesRowsField
            key={key}
            label={fDef.l}
            value={val}
            nodeId={node.id}
            onChange={v => change(key, v)}
          />
        );
      default:
        return <TextField key={key} label={fDef.l} value={String(val)} onChange={v => change(key, v)} />;
    }
  }

  return (
    <div id="inspector" className={visibilityClass}>
      {/* Hide button */}
      <div style={{ display: 'flex', justifyContent: 'flex-start', padding: '5px 8px 2px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
        <button
          onClick={toggleInspector}
          title="Hide inspector"
          style={{
            background: '#1a1e3a', border: '1px solid #818cf8',
            borderRadius: 5, color: '#818cf8', cursor: 'pointer',
            fontSize: 12, padding: '3px 10px', fontFamily: 'var(--font)', fontWeight: 600, lineHeight: 1.4,
          }}
        >hide ››</button>
      </div>
      {/* Header */}
      <div className="insp-header" style={{ borderBottom: `2px solid ${def?.color || '#888'}` }}>
        <span className="insp-icon">{def?.icon || '?'}</span>
        <div>
          <div className="insp-name" style={{ color: def?.color || '#888' }}>{def?.label || node.moduleId}</div>
          <div className="insp-id">{node.id}</div>
        </div>
      </div>

      {/* Config fields */}
      <div className="insp-section">
        <div className="insp-section-title">Configuration</div>

        {/* data_import: render custom panel instead of fields */}
        {node.moduleId === 'data_import' ? (
          <DataImportPanel
            nodeId={node.id}
            cfg={cfg}
            onConfigChange={updates => setConfig(node.id, { ...cfg, ...updates })}
          />
        ) : (
          Object.entries(fields).map(([k, fDef]) => {
            const field = renderField(k, fDef);
            if (k === 'model_mode' && node.moduleId === 'rand_forest') {
              return (
                <React.Fragment key={k}>
                  {field}
                  <RFModelPanel activeModelName={cfg.model_name || ''} />
                </React.Fragment>
              );
            }
            if (k === 'model_mode' && node.moduleId === 'mv_regression') {
              return (
                <React.Fragment key={k}>
                  {field}
                  <MvModelPanel activeModelName={cfg.model_name || ''} />
                </React.Fragment>
              );
            }
            if (k === 'model_mode' && node.moduleId === 'feat_engineering') {
              return (
                <React.Fragment key={k}>
                  {field}
                  <FeModelPanel activeModelName={cfg.model_name || ''} />
                </React.Fragment>
              );
            }
            return field;
          })
        )}
      </div>

      {/* Connections */}
      {upstreamEdges.length > 0 && (
        <div className="insp-section">
          <div className="insp-section-title">Inputs</div>
          {upstreamEdges.map(e => (
            <div key={e.id} className="conn-row">
              <span style={{ color: 'var(--muted)', fontSize: 9 }}>{e.fromPort}</span>
              <span style={{ color: 'var(--dim)', fontSize: 9 }}>→</span>
              <span style={{ color: 'var(--text)', fontSize: 10 }}>{e.toPort}</span>
              <button className="conn-del" title="Remove edge" onClick={() => deleteEdge(e.id)}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Output preview / error */}
      {runError && (
        <div className="insp-section">
          <div className="insp-section-title" style={{ color: 'var(--red)' }}>Error</div>
          <div style={{ fontSize: 10, color: 'var(--red)', wordBreak: 'break-all' }}>{runError}</div>
        </div>
      )}
      {rows.length > 0 && (
        <div className="insp-section">
          <div className="insp-section-title">
            Output — {rows.length} rows
            {rows.length > 0 && (
              <button
                onClick={() => openVizTab('table', { rows, title: cfg?._label || def?.label || node.id }, cfg?._label || def?.label || node.id)}
                style={{
                  float: 'right', background: 'transparent',
                  border: '1px solid var(--cyan)', borderRadius: 3,
                  color: 'var(--cyan)', fontSize: 9, cursor: 'pointer',
                  padding: '1px 6px', fontFamily: 'var(--font)',
                }}
              >
                ⊞ View
              </button>
            )}
          </div>
          <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 4 }}>
            {Object.keys(rows[0]).filter(k => !k.startsWith('_')).join('  ·  ')}
          </div>
          <div style={{ fontSize: 9, color: 'var(--dim)', overflowX: 'auto', maxHeight: 80 }}>
            <pre style={{ margin: 0 }}>{JSON.stringify(rows[0], null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
