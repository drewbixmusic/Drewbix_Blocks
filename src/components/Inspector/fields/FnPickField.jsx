import React from 'react';
import { MOD, CATS, modCfg, LABEL_CFG } from '../../../core/registry.js';
import { useStore } from '../../../core/state.js';

// Field types too complex to inline inside for_each
const SKIP_TYPES = new Set(['seriesrows', 'condrows', 'colorder', 'fnpick', 'rsqcfg', 'mvcfg']);
const SKIP_KEYS  = new Set(['key_field', 'fn_name', '_label', '_headers']);

const CAT_ORDER = ['market', 'account', 'write', 'transform', 'gate', 'tsFunc', 'dataproc'];

/**
 * Picker for the for_each "Apply Function" field.
 * Shows:
 *   • All built-in modules grouped by category  (value: "mod::moduleId")
 *   • User saved sub-flow functions              (value: "fn::name")
 *
 * When a mod:: entry is selected it also renders the inner module's
 * config fields directly on the for_each node (stored in the same
 * configs[nodeId] object, minus key_field / fn_name).
 */
export default function FnPickField({ label, value, nodeId, onChange, onInnerChange }) {
  const { functions } = useStore();
  const fnNames = Object.keys(functions || {});

  const selectedMod = value?.startsWith('mod::') ? value.slice(5) : null;
  const innerDef    = selectedMod ? MOD[selectedMod] : null;
  const innerFields = innerDef
    ? Object.entries(modCfg(innerDef)).filter(
        ([k, fd]) => !SKIP_KEYS.has(k) && !SKIP_TYPES.has(fd.t)
      )
    : [];

  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      <select
        className="field-select"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">-- select --</option>

        {/* Built-in modules grouped by category */}
        {CAT_ORDER.map(catKey => {
          const cat  = CATS[catKey];
          const mods = Object.entries(MOD).filter(([, m]) => m.cat === catKey);
          if (!mods.length) return null;
          return (
            <optgroup key={catKey} label={cat.l}>
              {mods.map(([id, m]) => (
                <option key={id} value={`mod::${id}`}>{m.label}</option>
              ))}
            </optgroup>
          );
        })}

        {/* User-saved sub-flow functions */}
        {fnNames.length > 0 && (
          <optgroup label="── User Functions ──">
            {fnNames.map(n => (
              <option key={n} value={`fn::${n}`}>{n}</option>
            ))}
          </optgroup>
        )}
      </select>

      {/* Inner module config — only shown when a mod:: is selected */}
      {innerDef && innerFields.length > 0 && (
        <div style={{
          marginTop: 6, padding: '6px 8px',
          background: 'var(--bg0)', border: '1px solid var(--border)',
          borderRadius: 4,
        }}>
          <div style={{ fontSize: 9, color: 'var(--purple)', letterSpacing: 1, marginBottom: 5 }}>
            ↻ {innerDef.label} PARAMS
          </div>
          {innerFields.map(([k, fd]) => (
            <InnerField key={k} fieldKey={k} fd={fd} nodeId={nodeId} onInnerChange={onInnerChange} />
          ))}
        </div>
      )}

      {value?.startsWith('fn::') && (
        <div style={{ marginTop: 4, fontSize: 9, color: 'var(--dim)' }}>
          User function — configure fields inside the saved sub-flow.
        </div>
      )}
    </div>
  );
}

// ── Lightweight inline field renderer for inner module params ─────────────────
function InnerField({ fieldKey, fd, nodeId, onInnerChange }) {
  const { configs } = useStore();
  const val = configs[nodeId]?.[fieldKey] ?? fd.d ?? '';

  const change = v => onInnerChange(fieldKey, v);

  if (fd.t === 'sel') {
    return (
      <div className="field-group" style={{ marginBottom: 6 }}>
        <label className="field-label">{fd.l}</label>
        <select className="field-select" value={val} onChange={e => change(e.target.value)}>
          {(fd.opts || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }

  if (fd.t === 'bool') {
    const on = val === true || val === 'true';
    return (
      <div className="field-group" style={{ marginBottom: 6 }}>
        <label className="field-label">{fd.l}</label>
        <div className="bool-row">
          <button className={`bool-btn${on ? ' on' : ''}`}  onClick={() => change(true)}>Yes</button>
          <button className={`bool-btn${!on ? ' on' : ''}`} onClick={() => change(false)}>No</button>
        </div>
      </div>
    );
  }

  if (fd.t === 'number') {
    return (
      <div className="field-group" style={{ marginBottom: 6 }}>
        <label className="field-label">{fd.l}</label>
        <input
          className="field-input"
          type="number"
          value={val}
          onChange={e => change(e.target.value === '' ? '' : Number(e.target.value))}
        />
      </div>
    );
  }

  if (fd.t === 'dynfield') {
    // Simple text input fallback for dynfield inside for_each inner config
    return (
      <div className="field-group" style={{ marginBottom: 6 }}>
        <label className="field-label">{fd.l}</label>
        <input
          className="field-input"
          value={val}
          onChange={e => change(e.target.value)}
          placeholder="field name…"
        />
      </div>
    );
  }

  // text / textarea fallback
  return (
    <div className="field-group" style={{ marginBottom: 6 }}>
      <label className="field-label">{fd.l}</label>
      <input
        className="field-input"
        value={val}
        onChange={e => change(e.target.value)}
      />
    </div>
  );
}
