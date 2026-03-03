/**
 * SeriesRowsField — chart series config UI (viz_chart, viz_chart_grid).
 * Replaces JSON textarea with dropdowns for X/Y fields, line/marker styles,
 * axis, segment/ray extras, add/remove series.
 */
import React from 'react';
import { useStore } from '../../../core/state.js';
import { getUpstreamFields } from '../../../utils/data.js';

const COLORS = ['#00d4ff','#f59e0b','#10b981','#a855f7','#ef4444','#f472b6','#6366f1','#84cc16','#ff6b35','#06b6d4'];
const LINE_STYLES = ['off','straight','dashed','dotted','bar','segment','ray'];
const MARKER_STYLES = ['off','o','x','+','*','-'];
const AXES = ['pri','sec'];

const DEFAULT_SERIES = {
  x_field: '', y_field: '', axis: 'pri', line_style: 'straight',
  line_weight: 1.5, line_alpha: 80, marker_style: 'off', marker_size: 4,
  marker_alpha: 80, zoom_include: true, color: undefined,
};

const S = {
  wrap:   { marginBottom: 12 },
  lbl:    { fontSize: 9, color: '#475569', marginBottom: 2 },
  row2:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 5 },
  row3:   { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5, marginBottom: 5 },
  inp:    { width: '100%', boxSizing: 'border-box', background: '#080810', border: '1px solid #1e1e3a', borderRadius: 3, color: '#e2e8f0', padding: '4px 6px', fontFamily: 'var(--font)', fontSize: 10 },
  card:   { background: '#111122', border: '1px solid #1e1e3a', borderRadius: 5, padding: 8, marginBottom: 8 },
  hdr:    { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 },
  addBtn: { width: '100%', padding: 6, background: 'transparent', border: '1px dashed #1e1e3a', borderRadius: 4, color: '#475569', fontFamily: 'var(--font)', fontSize: 10, cursor: 'pointer', marginTop: 2 },
  rmBtn:  { background: '#1a0a0a', border: '1px solid #3a1a1a', borderRadius: 3, color: '#ef4444', cursor: 'pointer', fontSize: 12, padding: '2px 7px', lineHeight: 1 },
  hint:   { fontSize: 9, color: 'var(--dim)', marginTop: 3 },
  segHdr: { fontSize: 9, color: '#6366f1', marginBottom: 4 },
  rayHdr: { fontSize: 9, color: '#f59e0b', marginBottom: 4 },
  extra:  { borderTop: '1px solid #1e1e3a', paddingTop: 5, marginTop: 2 },
};

export default function SeriesRowsField({ label, value, nodeId, onChange }) {
  const { nodes, edges, configs } = useStore();
  const upstreamFields = getUpstreamFields(nodeId, edges, nodes, configs);
  const seriesArr = Array.isArray(value) ? value : [];

  function updateSeries(idx, prop, val) {
    const arr = [...seriesArr];
    if (!arr[idx]) arr[idx] = { ...DEFAULT_SERIES };
    arr[idx] = { ...arr[idx], [prop]: val };
    onChange(arr);
  }

  function removeSeries(idx) {
    const arr = seriesArr.filter((_, i) => i !== idx);
    onChange(arr);
  }

  function addSeries() {
    onChange([...seriesArr, { ...DEFAULT_SERIES }]);
  }

  const fieldSel = (fld, placeholder, idx, prop) => {
    if (upstreamFields.length) {
      return (
        <select style={S.inp} value={fld || ''} onChange={e => updateSeries(idx, prop, e.target.value)}>
          <option value="">{placeholder}</option>
          {upstreamFields.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      );
    }
    return (
      <input
        type="text"
        style={S.inp}
        placeholder={placeholder}
        value={fld || ''}
        onChange={e => updateSeries(idx, prop, e.target.value)}
      />
    );
  };

  return (
    <div style={S.wrap}>
      <div style={S.lbl}>{label}</div>
      {seriesArr.map((s, i) => {
        const sc = s.color || COLORS[i % COLORS.length];
        const alpha = s.line_alpha ?? s.marker_alpha ?? 80;
        return (
          <div key={i} style={S.card}>
            <div style={S.hdr}>
              <span style={{ fontSize: 9, color: '#475569', fontWeight: 600 }}>S{i + 1}</span>
              <input
                type="color"
                value={sc}
                title="Color"
                style={{ width: 22, height: 22, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
                onChange={e => updateSeries(i, 'color', e.target.value)}
              />
              <span style={{ flex: 1 }} />
              <button style={S.rmBtn} onClick={() => removeSeries(i)} title="Remove series">✕ remove</button>
            </div>

            <div style={S.row2}>
              <div><div style={S.lbl}>X Field</div>{fieldSel(s.x_field, 'x field…', i, 'x_field')}</div>
              <div><div style={S.lbl}>Y Field</div>{fieldSel(s.y_field, 'y field…', i, 'y_field')}</div>
            </div>

            <div style={S.row3}>
              <div><div style={S.lbl}>Line Style</div>
                <select style={S.inp} value={s.line_style || 'straight'} onChange={e => updateSeries(i, 'line_style', e.target.value)}>
                  {LINE_STYLES.map(ls => <option key={ls} value={ls}>{ls}</option>)}
                </select>
              </div>
              <div><div style={S.lbl}>Weight</div>
                <input type="number" min={0.5} max={8} step={0.5} style={S.inp} value={s.line_weight ?? 1.5} onChange={e => updateSeries(i, 'line_weight', Number(e.target.value))} />
              </div>
              <div><div style={S.lbl}>Axis</div>
                <select style={S.inp} value={s.axis || 'pri'} onChange={e => updateSeries(i, 'axis', e.target.value)}>
                  {AXES.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            </div>

            <div style={S.row3}>
              <div><div style={S.lbl}>Marker</div>
                <select style={S.inp} value={s.marker_style || 'off'} onChange={e => updateSeries(i, 'marker_style', e.target.value)}>
                  {MARKER_STYLES.map(ms => <option key={ms} value={ms}>{ms}</option>)}
                </select>
              </div>
              <div><div style={S.lbl}>Marker Size</div>
                <input type="number" min={1} max={20} step={1} style={S.inp} value={s.marker_size ?? 4} onChange={e => updateSeries(i, 'marker_size', Number(e.target.value))} />
              </div>
              <div><div style={S.lbl}>Alpha %</div>
                <input type="number" min={0} max={100} step={5} style={S.inp} value={alpha} onChange={e => { const v = Number(e.target.value); updateSeries(i, 'line_alpha', v); updateSeries(i, 'marker_alpha', v); }} />
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, color: '#475569', cursor: 'pointer', marginBottom: 4 }}>
              <input type="checkbox" checked={s.zoom_include !== false} onChange={e => updateSeries(i, 'zoom_include', e.target.checked)} />
              Include in auto-zoom range
            </label>

            {s.line_style === 'segment' && (
              <div style={S.extra}>
                <div style={S.segHdr}>Segment end point</div>
                <div style={S.row2}>
                  <div><div style={S.lbl}>X2 Field</div>{fieldSel(s.x2_field, 'x2 field…', i, 'x2_field')}</div>
                  <div><div style={S.lbl}>Y2 Field</div>{fieldSel(s.y2_field, 'y2 field…', i, 'y2_field')}</div>
                </div>
              </div>
            )}

            {s.line_style === 'ray' && (
              <div style={S.extra}>
                <div style={S.rayHdr}>Ray parameters</div>
                <div style={S.row3}>
                  <div><div style={S.lbl}>Slope (m)</div>{fieldSel(s.m_field, 'm field…', i, 'm_field')}</div>
                  <div><div style={S.lbl}>Intercept (b)</div>{fieldSel(s.b_field, 'b field…', i, 'b_field')}</div>
                  <div><div style={S.lbl}>X End (opt)</div>{fieldSel(s.x_end_field, 'x end…', i, 'x_end_field')}</div>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <button style={S.addBtn} onClick={addSeries}>+ Add Series</button>
      {!upstreamFields.length && <div style={S.hint}>⚡ Connect upstream node to populate field dropdowns</div>}
    </div>
  );
}
