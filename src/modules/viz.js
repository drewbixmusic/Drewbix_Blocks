// ══════════════════════════════════════════════════════════════
// VISUALIZATION MODULES — chart, chart_grid, table, rf_dash
// ══════════════════════════════════════════════════════════════

function normalize(inp) {
  if (!inp) return [];
  if (!Array.isArray(inp)) return [inp];
  return inp;
}

function toNum(v) { const n = Number(v); return isNaN(n) ? null : n; }

// ── chart ─────────────────────────────────────────────────────────────────────
export function runChart(node, { cfg, inputs, openChart }) {
  const datasets = [];
  // Accept multi-port inputs: data, data2, data3, data4 (and legacy a-h)
  ['data', 'data2', 'data3', 'data4', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].forEach(k => {
    const rows = normalize(inputs[k] || []);
    if (rows.length) datasets.push(rows);
  });
  if (!datasets.length) return { data: [], _rows: [], _viz: true };

  const title = cfg.title || node.label || 'Chart';
  // Pass the full cfg (which has series, x_pad, y_pad, etc.) plus datasets
  openChart?.({ datasets, cfg, title });
  return { data: datasets[0] || [], _rows: datasets[0] || [], _viz: true };
}

// ── chart_grid ────────────────────────────────────────────────────────────────
export function runChartGrid(node, { cfg, inputs, openChartGrid }) {
  // Merge all input ports into a single flat row array (same as original mergeVizInputs)
  const seen = new Set(), merged = [];
  ['data', 'data2', 'data3', 'data4', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].forEach(k => {
    normalize(inputs[k] || []).forEach(row => {
      if (!seen.has(row)) { seen.add(row); merged.push(row); }
    });
  });
  if (!merged.length) return { data: [], _rows: [], _viz: true };

  const title = cfg.title || node.label || 'Chart Grid';
  // Pass merged rows + full cfg (key_field, cols, series, x_pad, y_pad, etc.)
  openChartGrid?.({ rows: merged, cfg, title });
  return { data: merged, _rows: merged, _viz: true };
}

// ── table ─────────────────────────────────────────────────────────────────────
export function runTable(node, { cfg, inputs, openTable }) {
  const rows = normalize(inputs.data || inputs.filtered_data || inputs.joined_data || []);
  const title = cfg.title || node.label || 'Table';
  // Pass a proper payload object { rows, title }
  openTable?.({ nodeId: node.id, rows, title });
  return { data: rows, _rows: rows, _viz: true };
}

// ── rf_dash ───────────────────────────────────────────────────────────────────
export function runRFDash(node, { cfg, inputs, openRFDashboard }) {
  const rfData = inputs._rfData || null;
  if (rfData) {
    openRFDashboard?.(rfData);
  }
  return { data: [], _rows: [], _viz: true };
}

// ── sparkline ─────────────────────────────────────────────────────────────────
export function runSparkline(node, { cfg, inputs }) {
  const rows = normalize(inputs.data || []);
  return { data: rows, _rows: rows, _viz: true };
}

// ── heatmap ───────────────────────────────────────────────────────────────────
export function runHeatmap(node, { cfg, inputs, openChart }) {
  const rows = normalize(inputs.data || []);
  openChart?.(node.id, { rows, type: 'heatmap', title: cfg.title || node.label || 'Heatmap' });
  return { data: rows, _rows: rows, _viz: true };
}
