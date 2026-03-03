import React, { useEffect, useRef } from 'react';
import { useStore } from '../../core/state.js';
import { renderChartToContext } from '../../utils/chartRenderer.js';

function ChartCell({ groupKey, rows, cfg, cellH }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth || 300;
    const H = cellH;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    renderChartToContext(ctx, W, H, rows, { ...cfg, title: groupKey });
  });

  return (
    <div style={{
      background: '#080810',
      border: '1px solid #1e1e3a',
      borderRadius: 5,
      overflow: 'hidden',
      height: cellH,
    }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}

export default function ChartGridModal() {
  const { chartGrid, closeChartGrid } = useStore();

  if (!chartGrid) return null;

  // chartGrid is { rows, cfg, title }
  const rows  = chartGrid.rows || [];
  const cfg   = chartGrid.cfg  || {};
  const title = chartGrid.title || cfg.title || 'Chart Grid';

  const keyField = cfg.key_field || 'symbol';
  const colsCfg  = cfg.cols || 'auto';

  // Group rows by key field (preserve insertion order)
  const seen = new Set(), keys = [];
  rows.forEach(r => {
    const k = String(r[keyField] ?? '');
    if (k && !seen.has(k)) { seen.add(k); keys.push(k); }
  });

  if (!keys.length) {
    return (
      <div id="chart-grid-overlay" className="show">
        <div id="chart-grid-inner">
          <div id="chart-grid-header">
            <span id="chart-grid-title">{title}</span>
            <button id="chart-grid-close" onClick={closeChartGrid}>×</button>
          </div>
          <div style={{ padding: 20, color: 'var(--dim)', textAlign: 'center', fontSize: 12 }}>
            No data — check key_field "{keyField}"
          </div>
        </div>
      </div>
    );
  }

  let cols;
  if (colsCfg === 'auto') {
    const n = keys.length;
    cols = n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 2 : n <= 6 ? 3 : n <= 12 ? 4 : n <= 20 ? 5 : 6;
  } else {
    cols = parseInt(colsCfg) || 2;
  }
  cols = Math.min(cols, keys.length);

  // Cell height proportional to width-based estimate
  const cellH = 240;

  return (
    <div id="chart-grid-overlay" className="show">
      <div id="chart-grid-inner">
        <div id="chart-grid-header">
          <span id="chart-grid-title">⊞ {title} — {keys.length} charts</span>
          <button id="chart-grid-close" onClick={closeChartGrid}>×</button>
        </div>
        <div
          id="chart-grid-body"
          style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
        >
          {keys.map(key => (
            <ChartCell
              key={key}
              groupKey={key}
              rows={rows.filter(r => String(r[keyField] ?? '') === key)}
              cfg={cfg}
              cellH={cellH}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
