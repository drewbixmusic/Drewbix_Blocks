import React from 'react';
import { useStore } from '../../core/state.js';
import { nodeDef, modCfg, LABEL_CFG } from '../../core/registry.js';
import TextField       from './fields/TextField.jsx';
import NumberField     from './fields/NumberField.jsx';
import SelectField     from './fields/SelectField.jsx';
import BoolField       from './fields/BoolField.jsx';
import MultiField      from './fields/MultiField.jsx';
import TextareaField   from './fields/TextareaField.jsx';
import DynFieldSelect  from './fields/DynFieldSelect.jsx';
import FieldPickField  from './fields/FieldPickField.jsx';
import CondRowsField   from './fields/CondRowsField.jsx';
import FnPickField     from './fields/FnPickField.jsx';
import VarCfgField     from './fields/VarCfgField.jsx';
import SeriesRowsField from './fields/SeriesRowsField.jsx';
import RfModelNameField from './fields/RfModelNameField.jsx';
import RFModelPanel    from './RFModelPanel.jsx';
import '../../styles/inspector.css';

export default function Inspector() {
  const {
    selectedId, nodes, edges, configs, functions,
    runResults, setConfig, deleteEdge, inspectorVisible,
    openVizTab,
  } = useStore();

  const node = nodes.find(n => n.id === selectedId);
  const visibilityClass = inspectorVisible ? 'show' : 'hidden';

  if (!inspectorVisible) {
    return (
      <div id="inspector" className={visibilityClass} aria-hidden="true">
        <div className="no-cfg" style={{ marginTop: 20, textAlign: 'center', padding: 12 }}>
          <div style={{ color: 'var(--dim)', fontSize: 10 }}>Click ⊞ in the top bar to show inspector</div>
        </div>
      </div>
    );
  }

  if (!node) {
    return (
      <div id="inspector" className={visibilityClass}>
        <div className="no-cfg" style={{ marginTop: 20, textAlign: 'center' }}>
          <div style={{ opacity: 0.3, fontSize: 24 }}>☰</div>
          <div style={{ color: 'var(--dim)', fontSize: 11, marginTop: 6 }}>Select a node to inspect</div>
        </div>
      </div>
    );
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
    switch (fDef.t) {
      case 'text':      return <TextField     key={key} label={fDef.l} value={val} onChange={v => change(key, v)} />;
      case 'number':    return <NumberField   key={key} label={fDef.l} value={val} onChange={v => change(key, v)} />;
      case 'sel':       return <SelectField   key={key} label={fDef.l} value={val} opts={fDef.opts} onChange={v => change(key, v)} />;
      case 'bool':      return <BoolField     key={key} label={fDef.l} value={val} onChange={v => change(key, v)} />;
      case 'multi':     return <MultiField    key={key} label={fDef.l} value={val} opts={fDef.opts} onChange={v => change(key, v)} />;
      case 'textarea':  return <TextareaField key={key} label={fDef.l} value={val} onChange={v => change(key, v)} />;
      case 'dynfield':  return <DynFieldSelect key={key} label={fDef.l} value={val} nodeId={node.id} onChange={v => change(key, v)} />;
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
      case 'rsqcfg':
      case 'mvcfg': {
        const rsqEdge     = upstreamEdges.find(e => e.toPort === 'rsq');
        const rsqConnected = !!rsqEdge;
        const rsqNodeId    = rsqEdge ? rsqEdge.from : null;
        return (
          <VarCfgField
            key={key}
            label={fDef.l}
            value={val}
            nodeId={node.id}
            rsqConnected={rsqConnected}
            rsqNodeId={rsqNodeId}
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
        {Object.entries(fields).map(([k, fDef]) => {
          const field = renderField(k, fDef);
          // Inject RF stored-model sense panel immediately after model_mode
          if (k === 'model_mode' && node.moduleId === 'rand_forest') {
            return (
              <React.Fragment key={k}>
                {field}
                <RFModelPanel activeModelName={cfg.model_name || ''} />
              </React.Fragment>
            );
          }
          return field;
        })}
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
