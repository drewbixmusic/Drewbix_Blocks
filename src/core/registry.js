// ══════════════════════════════════════════════════════════════
// MODULE REGISTRY  —  single source of truth for every block type
// ══════════════════════════════════════════════════════════════

/** Injected automatically at render time so every block has a user-visible label. */
export const LABEL_CFG = { _label: { t: 'text', d: '', l: 'Block Label' } };

/** Returns the merged cfg for a module (label + its own fields). */
export function modCfg(m) {
  return { ...LABEL_CFG, ...m.cfg };
}

export const MOD = {
  // ── Market Data ──────────────────────────────────────────────────────────
  clock: {
    label: 'Clock', cat: 'tsFunc', color: '#f59e0b', icon: '⏱',
    out: ['data'], in: ['offset'],
    cfg: {
      offset_src:  { t: 'sel',    opts: ['input', 'manual'],                                d: 'input',   l: 'Offset Source' },
      offset_val:  { t: 'number',                                                            d: 0,         l: 'Offset Value' },
      offset_unit: { t: 'sel',    opts: ['minutes', 'hours', 'days', 'weeks', 'years'],     d: 'days',    l: 'Unit' },
    },
  },
  calendar: {
    label: 'Calendar', cat: 'tsFunc', color: '#f59e0b', icon: '📅',
    out: ['data'], in: ['ref'],
    cfg: {
      days_back:    { t: 'number', d: -365, l: 'Days Back (negative)' },
      days_forward: { t: 'number', d: 365,  l: 'Days Forward (positive)' },
    },
  },
  corporate_actions: {
    label: 'Corp. Actions', cat: 'market', color: '#00d4ff', icon: '🏢',
    out: ['data'], in: [],
    cfg: {
      types: { t: 'multi', opts: ['dividend', 'split', 'spinoff'], d: ['dividend', 'split'], l: 'Action Types' },
    },
  },
  assets: {
    label: 'Assets', cat: 'market', color: '#00d4ff', icon: '📦',
    out: ['data'], in: [],
    cfg: {
      asset_class: { t: 'sel', opts: ['us_equity', 'crypto'], d: 'us_equity', l: 'Asset Class' },
      status:      { t: 'sel', opts: ['active', 'inactive', 'all'], d: 'active', l: 'Status' },
    },
  },
  movers: {
    label: 'Movers', cat: 'market', color: '#ff6b35', icon: '📈',
    out: ['data'], in: [],
    cfg: {
      market_type: { t: 'sel', opts: ['stocks', 'crypto'], d: 'stocks', l: 'Market Type' },
      top:         { t: 'number', d: 20, l: 'Top N' },
    },
  },
  actives: {
    label: 'Actives', cat: 'market', color: '#ff6b35', icon: '🔥',
    out: ['data'], in: [],
    cfg: {
      market_type: { t: 'sel', opts: ['stocks', 'crypto'], d: 'stocks', l: 'Market Type' },
      top:         { t: 'number', d: 20, l: 'Top N' },
    },
  },
  bars: {
    label: 'Bars', cat: 'market', color: '#a855f7', icon: '🕯',
    out: ['data'], in: ['symbols', 'start', 'end'],
    cfg: {
      asset_class: { t: 'sel', opts: ['us_equity', 'crypto'],              d: 'us_equity', l: 'Asset Class' },
      timeframe:   { t: 'sel', opts: ['1T', '5T', '15T', '30T', '1H', '1D', '7D', '1M'], d: '1D', l: 'Timeframe' },
      feed:        { t: 'sel', opts: ['sip', 'iex', 'otc'],                d: 'sip',       l: 'Feed' },
      adjustment:  { t: 'sel', opts: ['raw', 'split', 'dividend', 'all'], d: 'all',       l: 'Adjustment' },
      limit:       { t: 'sel', opts: ['1000', '5000', '10000'],            d: '10000',     l: 'Max Rows' },
    },
  },
  snapshots: {
    label: 'Snapshots', cat: 'market', color: '#a855f7', icon: '📸',
    out: ['data'], in: ['symbols'],
    cfg: {
      asset_class: { t: 'sel', opts: ['us_equity', 'crypto'], d: 'us_equity', l: 'Asset Class' },
      feed:        { t: 'sel', opts: ['sip', 'iex'],          d: 'sip',       l: 'Feed' },
    },
  },

  // ── Account ───────────────────────────────────────────────────────────────
  watchlists:        { label: 'Watchlists',        cat: 'account', color: '#10b981', icon: '👁',  out: ['data'], in: [], cfg: {} },
  balances:          { label: 'Balances',           cat: 'account', color: '#10b981', icon: '💰',  out: ['data'], in: [], cfg: {} },
  positions:         { label: 'Positions',          cat: 'account', color: '#10b981', icon: '📊',  out: ['data'], in: [], cfg: {} },
  open_orders: {
    label: 'Open Orders', cat: 'account', color: '#f59e0b', icon: '📋',
    out: ['data'], in: [],
    cfg: {
      status: { t: 'sel', opts: ['open', 'closed', 'all'], d: 'open', l: 'Status' },
    },
  },
  activities: {
    label: 'Activities', cat: 'account', color: '#10b981', icon: '📜',
    out: ['data'], in: [],
    cfg: {
      activity_types: { t: 'multi', opts: ['FILL', 'TRANS', 'MISC'], d: ['FILL'], l: 'Activity Types' },
      days_back:       { t: 'number', d: 30, l: 'Days Back' },
    },
  },
  portfolio_history: {
    label: 'Portfolio History', cat: 'account', color: '#10b981', icon: '📉',
    out: ['data'], in: [],
    cfg: {
      period:    { t: 'sel', opts: ['1D', '1W', '1M', '3M', '1A', 'all'], d: '1M', l: 'Period' },
      timeframe: { t: 'sel', opts: ['1T', '5T', '15T', '1H', '1D'],       d: '1D', l: 'Timeframe' },
    },
  },

  // ── Write ─────────────────────────────────────────────────────────────────
  write_watchlist: {
    label: 'Write Watchlist', cat: 'write', color: '#ef4444', icon: '✍️',
    out: ['data'], in: ['data', 'name'],
    cfg: {
      mode: { t: 'sel', opts: ['create', 'replace', 'append'], d: 'append', l: 'Mode' },
    },
  },
  write_order: {
    label: 'Write Order', cat: 'write', color: '#ef4444', icon: '📤',
    out: ['data'], in: ['data'],
    cfg: {
      symbol:         { t: 'text',   d: '',            l: 'Symbol (or from data)' },
      qty:            { t: 'number', d: 1,             l: 'Qty' },
      side:           { t: 'sel',    opts: ['buy', 'sell'],                              d: 'buy',    l: 'Side' },
      type:           { t: 'sel',    opts: ['market', 'limit', 'stop', 'stop_limit'],   d: 'market', l: 'Order Type' },
      limit_price:    { t: 'text',   d: '',            l: 'Limit Price' },
      time_in_force:  { t: 'sel',    opts: ['day', 'gtc', 'ioc', 'fok'],               d: 'day',    l: 'Time in Force' },
      extended_hours: { t: 'bool',   d: false,         l: 'Extended Hours' },
    },
  },

  // ── Transform ─────────────────────────────────────────────────────────────
  filter: {
    label: 'Filter', cat: 'transform', color: '#6366f1', icon: '🔍',
    out: ['data'], in: ['data', 'sc'],
    cfg: {
      field:     { t: 'dynfield',  d: '',     l: 'Field' },
      operator:  { t: 'sel', opts: ['==', '!=', '>', '<', '>=', '<=', 'in', 'not_in', 'starts_with', 'not_starts_with', 'ends_with', 'not_ends_with', 'contains', 'not_contains', 'is_true', 'is_false'], d: '==', l: 'Operator' },
      value:     { t: 'text',      d: '',     l: 'Value' },
      value_src: { t: 'sidechain', d: 'manual', l: 'Value Source' },
    },
  },
  multi_filter: {
    label: 'Multi-Filter', cat: 'transform', color: '#6366f1', icon: '⧉',
    out: ['data'], in: ['data', 'sc'],
    cfg: {
      conditions: { t: 'condrows', d: [], l: 'Conditions' },
      logic:      { t: 'sel', opts: ['AND', 'OR'], d: 'AND', l: 'Logic' },
    },
  },
  join: {
    label: 'Join', cat: 'transform', color: '#6366f1', icon: '🔗',
    out: ['data'], in: ['left', 'right'],
    cfg: {
      on:  { t: 'dynfield', d: 'symbol',                                  l: 'Join Key' },
      how: { t: 'sel', opts: ['inner', 'left', 'right', 'outer'], d: 'inner', l: 'Join Type' },
    },
  },
  select_fields: {
    label: 'Select Fields', cat: 'transform', color: '#6366f1', icon: '✂️',
    out: ['data'], in: ['data'],
    cfg: {
      fields: { t: 'fieldpick', d: [], l: 'Fields' },
    },
  },
  symbol_intersect: {
    label: 'Symbol Intersect', cat: 'transform', color: '#6366f1', icon: '⋂',
    out: ['data'], in: ['left', 'right'],
    cfg: {
      field: { t: 'dynfield', d: 'symbol', l: 'Symbol Field' },
    },
  },
  transpose: { label: 'Transpose', cat: 'transform', color: '#6366f1', icon: '⟂', out: ['data'], in: ['data'], cfg: {} },
  time_offset: {
    label: 'Time Offset', cat: 'tsFunc', color: '#f59e0b', icon: '⏪',
    out: ['data'], in: ['data', 'sc'],
    cfg: {
      field:      { t: 'dynfield',  d: '',         l: 'Timestamp Field' },
      amount:     { t: 'number',    d: -15,        l: 'Offset Amount' },
      unit:       { t: 'sel', opts: ['minutes', 'hours', 'days', 'weeks'], d: 'minutes', l: 'Unit' },
      round:      { t: 'sel', opts: ['no_change', 'round_down', 'round_up'], d: 'no_change', l: 'Round' },
      round_unit: { t: 'sel', opts: ['1T', '5T', '10T', '20T', '30T', '1H', '2H', '4H', '8H', '12H', '1D'], d: '1D', l: 'Round To' },
      tz_field:   { t: 'sidechain', d: 'manual',   l: 'TZ Suffix Source' },
    },
  },
  ts_to_ms: {
    label: 'TS → ms', cat: 'tsFunc', color: '#f59e0b', icon: '⧗',
    out: ['data'], in: ['data'],
    cfg: { field: { t: 'dynfield', d: '', l: 'Timestamp Field' } },
  },
  date_max: {
    label: 'Date Max', cat: 'tsFunc', color: '#f59e0b', icon: '⊤',
    out: ['data'], in: ['data'],
    cfg: { field: { t: 'dynfield', d: '', l: 'Date Field' } },
  },
  date_min: {
    label: 'Date Min', cat: 'tsFunc', color: '#f59e0b', icon: '⊥',
    out: ['data'], in: ['data'],
    cfg: { field: { t: 'dynfield', d: '', l: 'Date Field' } },
  },

  // ── Logic Gates ───────────────────────────────────────────────────────────
  gate_and:      { label: 'AND Gate',  cat: 'gate', color: '#f472b6', icon: '⊓', out: ['data'], in: ['a', 'b'], cfg: {} },
  gate_or:       { label: 'OR Gate',   cat: 'gate', color: '#f472b6', icon: '⊔', out: ['data'], in: ['a', 'b'], cfg: {} },
  gate_nand:     { label: 'NAND Gate', cat: 'gate', color: '#f472b6', icon: '⊼', out: ['data'], in: ['a', 'b'], cfg: {} },
  gate_nor:      { label: 'NOR Gate',  cat: 'gate', color: '#f472b6', icon: '⊽', out: ['data'], in: ['a', 'b'], cfg: {} },
  gate_xor:      { label: 'XOR Gate',  cat: 'gate', color: '#f472b6', icon: '⊕', out: ['data'], in: ['a', 'b'], cfg: {} },
  gate_inverter: { label: 'Inverter',  cat: 'gate', color: '#f472b6', icon: '¬', out: ['data'], in: ['a'],      cfg: {} },

  // ── Visualization ─────────────────────────────────────────────────────────
  viz_table: {
    label: 'Table', cat: 'viz', color: '#06b6d4', icon: '📋',
    out: [], in: ['data'], _isViz: true,
    cfg: {
      title:   { t: 'text',     d: '',  l: 'Title (optional)' },
      columns: { t: 'colorder', d: [],  l: 'Columns' },
    },
  },
  viz_chart: {
    label: 'Chart', cat: 'viz', color: '#06b6d4', icon: '📈',
    out: [], in: ['data', 'data2', 'data3', 'data4'], _isViz: true,
    cfg: {
      title:          { t: 'text', d: '',    l: 'Title (optional)' },
      series:         { t: 'seriesrows', d: [], l: 'Series' },
      x_pad:          { t: 'sel', opts: ['0%','5%','10%','15%','20%','25%','33%','50%'], d: '10%', l: 'X Pad' },
      y_pad:          { t: 'sel', opts: ['0%','5%','10%','15%','20%','25%','33%','50%'], d: '10%', l: 'Y Pad' },
      overlap:        { t: 'bool', d: true, l: 'Pri/Sec Overlap' },
      x_fmt:          { t: 'sel', opts: ['none','date','$','%'], d: 'none', l: 'X Axis Format' },
      y_pri_fmt:      { t: 'sel', opts: ['none','date','$','%'], d: 'none', l: 'Y Pri Format' },
      y_sec_fmt:      { t: 'sel', opts: ['none','date','$','%'], d: 'none', l: 'Y Sec Format' },
      centroid_field: { t: 'dynfield', d: '', l: 'Centroid Field' },
      centroid_pos:   { t: 'sel', opts: ['off','first','mid','last'], d: 'off', l: 'Centroid Position' },
    },
  },
  viz_chart_grid: {
    label: 'Chart Grid', cat: 'viz', color: '#06b6d4', icon: '⊞',
    out: [], in: ['data', 'data2', 'data3', 'data4'], _isViz: true,
    cfg: {
      key_field:  { t: 'dynfield', d: 'symbol', l: 'Key Field (one chart per value)' },
      cols:       { t: 'sel', opts: ['auto','1','2','3','4','5','6'], d: 'auto', l: 'Columns' },
      series:     { t: 'seriesrows', d: [], l: 'Series' },
      x_pad:      { t: 'sel', opts: ['0%','5%','10%','15%','20%','25%','33%','50%'], d: '10%', l: 'X Pad' },
      y_pad:      { t: 'sel', opts: ['0%','5%','10%','15%','20%','25%','33%','50%'], d: '10%', l: 'Y Pad' },
      overlap:    { t: 'bool', d: true,  l: 'Pri/Sec Overlap' },
      x_fmt:      { t: 'sel', opts: ['none','date','$','%'], d: 'none', l: 'X Axis Format' },
      y_pri_fmt:  { t: 'sel', opts: ['none','date','$','%'], d: 'none', l: 'Y Pri Format' },
      y_sec_fmt:  { t: 'sel', opts: ['none','date','$','%'], d: 'none', l: 'Y Sec Format' },
    },
  },

  // ── Data Processing ───────────────────────────────────────────────────────
  pearson_rsq: {
    label: 'Pearson R²', cat: 'dataproc', color: '#84cc16', icon: 'ρ²',
    out: ['data'], in: ['data'],
    cfg: { rsq: { t: 'rsqcfg', d: { dep: [], indep: [] }, l: 'Variable Selection' } },
  },
  mv_regression: {
    label: 'MV Regression', cat: 'dataproc', color: '#84cc16', icon: '∑β',
    out: ['data'], in: ['data', 'rsq'],
    cfg: {
      mv:          { t: 'mvcfg', d: { dep: [], indep: [] }, l: 'Variable Selection' },
      model_name:  { t: 'text',  d: '',     l: 'Model Name' },
      model_mode:  { t: 'sel',   opts: ['New', 'Merge', 'Stored', 'Replace'], d: 'New', l: 'Model Mode' },
      top_feats:   { t: 'sel',   opts: ['3', '5', '8', '10', '15', '20', 'All'], d: '10', l: 'Top N Features (by RSQ rank)' },
      test_pct:    { t: 'sel',   opts: ['10%', '15%', '20%', '25%', '30%'],  d: '20%', l: 'Test Split' },
      seed:        { t: 'number', d: 42, l: 'Random Seed' },
    },
  },
  rand_forest: {
    label: 'Random Forest', cat: 'dataproc', color: '#84cc16', icon: '🌲',
    out: ['data'], in: ['data', 'rsq'],
    cfg: {
      rf:              { t: 'mvcfg', d: { dep: [], indep: [] }, l: 'Variable Selection' },
      model_name:      { t: 'text',  d: '',     l: 'Model Name' },
      model_mode:      { t: 'sel',   opts: ['New', 'Merge', 'Stored', 'Replace'], d: 'New', l: 'Model Mode' },
      max_stored_trees:{ t: 'sel',   opts: ['50', '100', '150', '200'],           d: '100', l: 'Max Stored Trees' },
      imp_prune_thr:   { t: 'sel',   opts: ['0.5%', '1%', '2%', '5%', 'Off'],    d: '1%',  l: 'Prune Threshold' },
      top_feats:       { t: 'sel',   opts: ['5', '8', '10', '15', '20', 'All'],   d: '10',  l: 'Top N Features (by RSQ rank)' },
      n_trees:         { t: 'sel',   opts: ['10', '25', '50', '100', '200'],      d: '50',  l: 'Trees' },
      max_depth:       { t: 'sel',   opts: ['3', '4', '5', '6', '8', '10', 'unlimited'], d: '5', l: 'Max Depth' },
      min_samples:     { t: 'sel',   opts: ['2', '3', '5', '10', '20'],           d: '5',   l: 'Min Samples/Leaf' },
      max_thresholds:  { t: 'sel',   opts: ['10', '20', '50', '100', 'All'],      d: '20',  l: 'Max Split Thresholds' },
      test_pct:        { t: 'sel',   opts: ['10%', '15%', '20%', '25%', '30%'],  d: '20%', l: 'Test Split' },
      feat_eng:        { t: 'bool',  d: true,   l: 'Feature Engineering (interactions)' },
      seed:            { t: 'number',d: 42,     l: 'Random Seed' },
    },
  },
  dp_precision: { label: 'Dyn. Precision', cat: 'dataproc', color: '#84cc16', icon: '⌗', out: ['data'], in: ['data'], cfg: {} },
  dataset: {
    label: 'Data Set', cat: 'dataproc', color: '#84cc16', icon: '🗄',
    out: ['data'], in: ['data'], _isDataset: true,
    cfg: {
      name:        { t: 'text', d: '', l: 'Dataset Name' },
      compression: { t: 'sel', opts: ['1:1','2:1','3:1','4:1','5:1','6:1','8:1','10:1'], d: '1:1', l: 'Compression' },
    },
  },
  manual_entry: {
    label: 'Manual Entry', cat: 'dataproc', color: '#84cc16', icon: '⌨',
    out: ['data'], in: [],
    cfg: {
      field:  { t: 'text',     d: 'symbol', l: 'Field Name' },
      values: { t: 'textarea', d: '',       l: 'Values (one per line)' },
    },
  },
  collect: {
    label: 'Collect', cat: 'dataproc', color: '#84cc16', icon: '⛟',
    out: ['data'], in: ['data'],
    cfg: {
      field:     { t: 'dynfield', d: '',  l: 'Field to Collect' },
      separator: { t: 'text',     d: ',', l: 'Separator' },
    },
  },
  stat_mean:   { label: 'Mean',    cat: 'dataproc', color: '#84cc16', icon: 'μ',  out: ['data'], in: ['data'], cfg: {} },
  stat_median: { label: 'Median',  cat: 'dataproc', color: '#84cc16', icon: 'M̃',  out: ['data'], in: ['data'], cfg: {} },
  stat_min:    { label: 'Min',     cat: 'dataproc', color: '#84cc16', icon: '↓',  out: ['data'], in: ['data'], cfg: {} },
  stat_max:    { label: 'Max',     cat: 'dataproc', color: '#84cc16', icon: '↑',  out: ['data'], in: ['data'], cfg: {} },
  stat_stdev:  { label: 'Std Dev', cat: 'dataproc', color: '#84cc16', icon: 'σ',  out: ['data'], in: ['data'], cfg: {} },

  ts_to_trel: {
    label: 'TS → tREL', cat: 'tsFunc', color: '#f59e0b', icon: 'Δt',
    out: ['data'], in: ['data'],
    cfg: {
      field:  { t: 'dynfield', d: '',     l: 'Timestamp Field' },
      offset: { t: 'sel', opts: ['min', 'med', 'max'], d: 'max', l: 'Offset (zero point)' },
      unit:   { t: 'sel', opts: ['days', 'ms'],         d: 'days', l: 'Time Unit' },
    },
  },
  for_each: {
    label: 'For Each', cat: 'dataproc', color: '#84cc16', icon: '↻',
    out: ['data'], in: ['data'],
    cfg: {
      key_field: { t: 'dynfield', d: 'symbol', l: 'Key Field' },
      fn_name:   { t: 'fnpick',   d: '',       l: 'Apply Function' },
    },
  },
  ohlc_to_ts: {
    label: 'OHLC → TS', cat: 'tsFunc', color: '#f59e0b', icon: '🕯→',
    out: ['data'], in: ['data'],
    cfg: {
      t_field:       { t: 'dynfield', d: 't',      l: 'Timestamp Field' },
      o_field:       { t: 'dynfield', d: 'o',      l: 'Open Field' },
      h_field:       { t: 'dynfield', d: 'h',      l: 'High Field' },
      l_field:       { t: 'dynfield', d: 'l',      l: 'Low Field' },
      c_field:       { t: 'dynfield', d: 'c',      l: 'Close Field' },
      v_field:       { t: 'dynfield', d: 'v',      l: 'Volume Field' },
      sym_field:     { t: 'dynfield', d: 'symbol', l: 'Symbol Field' },
      x_ref:         { t: 'sel', opts: ['first', 'mid', 'last'],                d: 'first',  l: 'X Reference' },
      y_fmt:         { t: 'sel', opts: ['price', 'percent'],                    d: 'price',  l: 'Y Format' },
      v_ref:         { t: 'sel', opts: ['raw', 'norm', 'min', 'med', 'max'],    d: 'raw',    l: 'Volume Scale' },
      mode:          { t: 'sel', opts: ['All', 'OC', 'O', 'H', 'L', 'C'],                              d: 'All',  l: 'OHLC Mode' },
      compression:   { t: 'sel', opts: ['Off','Auto','1:1','2:1','4:1','8:1','12:1','16:1','32:1'],  d: 'Off',  l: 'Compression Ratio' },
      sample_target: { t: 'sel', opts: ['Off','Auto','1','2','4','8','16','32','64','128'],           d: 'Off',  l: 'Sample Target (Auto = avg across symbols)' },
      oversample:    { t: 'sel', opts: ['Off', 'On'],                                               d: 'Off',  l: 'Oversample short sets (interpolate gaps)' },
      datasets:      { t: 'sel', opts: ['1','2','3','4','5','6','7','8','9','10'],              d: '1',     l: 'Data Sets (splits)' },
      overlap:       { t: 'sel', opts: ['0%','25%','33%','50%','67%','75%'],                   d: '50%',   l: 'Dataset Overlap' },
      key:           { t: 'text', d: 'symbol', l: 'Symbol Key Field' },
    },
  },
  raw_to_prel: {
    label: 'Raw → pREL', cat: 'dataproc', color: '#84cc16', icon: 'Δ%',
    out: ['data'], in: ['data'],
    cfg: {
      field:     { t: 'dynfield', d: '',      l: 'Value Field' },
      p0:        { t: 'sel', opts: ['min', 'med', 'max', 'first', 'mid', 'last'], d: 'min', l: 'Reference p0' },
      key_field: { t: 'dynfield', d: '',      l: 'Key Field (for first/mid/last)' },
    },
  },
  math_add: {
    label: 'Add', cat: 'dataproc', color: '#84cc16', icon: '+',
    out: ['data'], in: ['a', 'b'],
    cfg: {
      a_field:   { t: 'dynfield', d: '',         l: 'A Field' },
      b_mode:    { t: 'sel', opts: ['field', 'constant'], d: 'constant', l: 'B Source' },
      b_field:   { t: 'dynfield', d: '',         l: 'B Field' },
      b_const:   { t: 'number',   d: 0,          l: 'B Constant' },
      out_field: { t: 'text',     d: 'result',   l: 'Output Field' },
    },
  },
  math_sub: {
    label: 'Subtract', cat: 'dataproc', color: '#84cc16', icon: '−',
    out: ['data'], in: ['a', 'b'],
    cfg: {
      a_field:   { t: 'dynfield', d: '',         l: 'A Field' },
      b_mode:    { t: 'sel', opts: ['field', 'constant'], d: 'constant', l: 'B Source' },
      b_field:   { t: 'dynfield', d: '',         l: 'B Field' },
      b_const:   { t: 'number',   d: 0,          l: 'B Constant' },
      out_field: { t: 'text',     d: 'result',   l: 'Output Field' },
    },
  },
  math_mul: {
    label: 'Multiply', cat: 'dataproc', color: '#84cc16', icon: '×',
    out: ['data'], in: ['a', 'b'],
    cfg: {
      a_field:   { t: 'dynfield', d: '',         l: 'A Field' },
      b_mode:    { t: 'sel', opts: ['field', 'constant'], d: 'constant', l: 'B Source' },
      b_field:   { t: 'dynfield', d: '',         l: 'B Field' },
      b_const:   { t: 'number',   d: 1,          l: 'B Constant' },
      out_field: { t: 'text',     d: 'result',   l: 'Output Field' },
    },
  },
  math_div: {
    label: 'Divide', cat: 'dataproc', color: '#84cc16', icon: '÷',
    out: ['data'], in: ['a', 'b'],
    cfg: {
      a_field:   { t: 'dynfield', d: '',         l: 'A Field' },
      b_mode:    { t: 'sel', opts: ['field', 'constant'], d: 'constant', l: 'B Source' },
      b_field:   { t: 'dynfield', d: '',         l: 'B Field' },
      b_const:   { t: 'number',   d: 1,          l: 'B Constant' },
      out_field: { t: 'text',     d: 'result',   l: 'Output Field' },
    },
  },
  moving_avg: {
    label: 'Moving Average', cat: 'dataproc', color: '#84cc16', icon: '〜',
    out: ['data'], in: ['data'],
    cfg: {
      x_field:      { t: 'dynfield', d: 't_rel',  l: 'X Field' },
      y_field:      { t: 'dynfield', d: 'p_rel',  l: 'Y Field' },
      sym_field:    { t: 'dynfield', d: 'symbol', l: 'Symbol Field' },
      bucket_pct:   { t: 'sel', opts: ['1.25%','2.5%','5%','10%','15%','20%','25%','33%','50%'], d: '20%', l: 'Rolling Window Size' },
      direction:    { t: 'sel', opts: ['look_back','look_ahead','closest'], d: 'closest', l: 'Direction' },
      x_treatment:  { t: 'sel', opts: ['first','mean','med','last'],        d: 'mean',    l: 'X Treatment' },
      bands:        { t: 'sel', opts: ['1','2','3','4','5'],                 d: '1',       l: 'Bands' },
      composite:    { t: 'bool', d: false, l: 'Include Composite MA' },
      bkt_mode:     { t: 'sel', opts: ['bypass','raw','MA','blend'],         d: 'blend',   l: 'Bucket Data' },
      bkt_count:    { t: 'sel', opts: ['1','2','3','4','5','6','7','8','9','10','15','20','25','40','50','100'], d: '5', l: 'Bucket Count' },
      bkt_compound: { t: 'sel', opts: ['1.00','1.05','1.10','1.15','1.20','1.25','1.33','1.50','1.75','2.00'], d: '2.00', l: 'Compound Factor' },
    },
  },
  convergences: {
    label: 'Convergences', cat: 'dataproc', color: '#84cc16', icon: '⋈',
    out: ['features', 'actuals'], in: ['data', 'perf'],
    cfg: {
      x_field:          { t: 'dynfield', d: 't_rel',  l: 'X Field' },
      y_field:          { t: 'dynfield', d: 'p_rel',  l: 'Y Field' },
      sym_field:        { t: 'dynfield', d: 'symbol', l: 'Symbol Field' },
      v_field:          { t: 'dynfield', d: '',       l: 'Volume Field (optional)' },
      slice:            { t: 'sel', opts: ['10%','20%','25%','33%','50%','67%','75%','80%','90%','100%'], d: '50%', l: 'Model Slice' },
      traj_mode:        { t: 'sel', opts: ['Fwd','Bkwd','Both'],        d: 'Fwd',       l: 'Trajectory Mode' },
      pv_detect:        { t: 'sel', opts: ['Enabled','Disabled'],       d: 'Enabled',   l: 'PV Detection' },
      traj_env_filter:  { t: 'sel', opts: ['Off','On'],                 d: 'Off',       l: 'Trajectory Envelope Filter' },
      cy_filter:        { t: 'sel', opts: ['Off','0.50','0.67','0.75','1.00','1.50','1.75','2.00','3.00','4.00'], d: 'Off', l: 'CY Range Filter' },
      compression:      { t: 'sel', opts: ['Off','Auto','1:1','2:1','4:1','8:1','12:1','16:1','32:1'], d: 'Off', l: 'Compression Ratio' },
      sample_target:    { t: 'sel', opts: ['Off','Auto','1','2','4','8','16','32','64','128'],          d: 'Off', l: 'Sample Target' },
      oversample:       { t: 'sel', opts: ['Off','On'],                                               d: 'Off', l: 'Oversample (Expand)' },
      perf_fields:      { t: 'multidynfield', port: 'perf', d: [], l: 'Performance Indicator Fields (connect OHLC → "perf" input)' },
    },
  },
  asym_damp: {
    label: 'Asym Dampen', cat: 'dataproc', color: '#84cc16', icon: '~',
    out: ['data'], in: ['data'],
    cfg: {
      field:     { t: 'dynfield', d: 'cy',   l: 'Field to Dampen' },
      out_field: { t: 'text',     d: 'cy_d', l: 'Output Field' },
    },
  },
  dyn_envelope: {
    label: 'Dynamic Envelope', cat: 'dataproc', color: '#84cc16', icon: '⌇',
    out: ['data'], in: ['data', 'apply'],
    cfg: {
      y_field:   { t: 'dynfield', d: 'p_rel', l: 'Y Field (source — builds coefficients)' },
      x_field:   { t: 'dynfield', d: '',       l: 'X Field (source, optional — else row index)' },
      apply_x:   { t: 'dynfield', d: '',       l: 'Apply X Field (on apply dataset)' },
      sym_field: { t: 'dynfield', d: 'symbol', l: 'Symbol Field' },
      env_slice: { t: 'sel', opts: ['Edge','1%','3%','5%','10%','15%','20%','25%','33%','50%','67%','75%','80%','85%','90%','95%','97%','99%','All'], d: '10%', l: 'Envelope Slice' },
      filt_x:    { t: 'dynfield', d: '',       l: 'Filter X Field (optional)' },
      filt_y:    { t: 'dynfield', d: '',       l: 'Filter Y Field (optional)' },
      filt_pad:  { t: 'sel', opts: ['0.50','0.75','1.00','1.25','1.50','1.75','2.00','3.00','4.00','Off'], d: '2.00', l: 'Filter Pad' },
      filt_damp: { t: 'bool', d: false, l: 'Dampen Exceedences' },
    },
  },
  outlier_clean: {
    label: 'Outlier Clean', cat: 'dataproc', color: '#84cc16', icon: '✂',
    out: ['data'], in: ['data'],
    cfg: {
      y_field:   { t: 'dynfield', d: '',       l: 'Y Field' },
      x_field:   { t: 'dynfield', d: '',       l: 'X Field (optional)' },
      sym_field: { t: 'dynfield', d: 'symbol', l: 'Symbol Field' },
      method:    { t: 'sel', opts: ['iqr','zscore','mad','pct_change'], d: 'iqr',   l: 'Method' },
      threshold: { t: 'sel', opts: ['1.5','2.0','2.5','3.0','3.5','4.0','5.0'],    d: '2.5',  l: 'Threshold' },
      win_pct:   { t: 'sel', opts: ['5%','10%','20%','25%','33%','50%','100%'],    d: '100%', l: 'Window (% of set)' },
    },
  },

  // ── Feature Engineering ───────────────────────────────────────────────────
  feat_engineering: {
    label: 'Feature Eng.', cat: 'dataproc', color: '#ec4899', icon: 'φ',
    out: ['data', 'rsq'], in: ['data', 'rsq'],
    cfg: {
      fe:          { t: 'mvcfg', d: { dep: [], indep: [] }, l: 'Variable Selection' },
      model_name:  { t: 'text',  d: '', l: 'Model Name' },
      model_mode:  { t: 'sel', opts: ['New', 'Merge', 'Stored', 'Replace'], d: 'New', l: 'Model Mode' },
      top_feats:   { t: 'sel', opts: ['3', '5', '8', '10', '15', '20', 'All'], d: '10', l: 'Top N Features (by RSQ rank)' },
      corr_drop:   { t: 'sel', opts: ['Off', '0.75', '0.80', '0.85', '0.90', '0.95', '0.99'], d: 'Off', l: 'Corr Drop |r|≥ (remove redundant transforms)' },
    },
  },

  // ── I/O ───────────────────────────────────────────────────────────────────
  data_import: {
    label: 'Data Import', cat: 'io', color: '#06b6d4', icon: '📂',
    out: ['data'], in: [],
    cfg: {
      // _importedData and _importedName are managed by DataImportPanel, not shown as normal fields
    },
  },
  data_export: {
    label: 'Data Export', cat: 'io', color: '#f59e0b', icon: '📤',
    out: [], in: ['data'],
    cfg: {
      format:   { t: 'sel', opts: ['CSV', 'Excel', 'JSON', 'PDF', 'PNG'], d: 'CSV', l: 'Export Format' },
      filename: { t: 'text', d: 'export', l: 'Filename (no extension)' },
    },
  },
};

/** Category metadata for the palette. */
export const CATS = {
  market:   { l: 'Market Data',          c: '#00d4ff' },
  account:  { l: 'Account',              c: '#10b981' },
  write:    { l: 'Write/Patch',           c: '#ef4444' },
  transform:{ l: 'Transform',            c: '#6366f1' },
  gate:     { l: 'Logic Gates',          c: '#f472b6' },
  tsFunc:   { l: 'Timestamp Functions',  c: '#f59e0b' },
  dataproc: { l: 'Data Processing',      c: '#84cc16' },
  viz:      { l: 'Visualization',        c: '#06b6d4' },
  io:       { l: 'Import / Export',      c: '#0ea5e9' },
  subflows: { l: 'Sub-Flows',            c: '#a855f7' },
};

/**
 * Returns a fake MOD-like definition for a subflow node.
 * The moduleId for subflow nodes is `subflow::<name>`.
 */
export function getSubflowDef(moduleId, functions) {
  const name = moduleId.slice(9);
  const fn   = functions?.[name];
  return {
    label:      name,
    color:      '#a855f7',
    icon:       'ƒ',
    in:         ['enable', 'data'],
    out:        ['data', 'status'],
    cfg:        {},
    _isSubflow: true,
    _fn:        fn,
  };
}

/**
 * Resolve the def (MOD entry or subflow) for any node.
 */
export function nodeDef(node, functions) {
  if (node.moduleId.startsWith('subflow::')) {
    return getSubflowDef(node.moduleId, functions);
  }
  return MOD[node.moduleId];
}
