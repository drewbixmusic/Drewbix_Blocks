// ── Feature Mux ───────────────────────────────────────────────────────────────
// Pure multiplexer: splits input data into passthru / features / targets ports
// based on user variable selections. No transforms, no scoring.

export function runFeatureEngineering(node, { cfg, inputs, setHeaders }) {
  const data = Array.isArray(inputs.data) ? inputs.data : [];
  if (!data.length) return { _rows: [], passthru: [], features: { _headers: [], _rows: [] }, targets: { _headers: [], _rows: [] } };

  const fe       = cfg.fe || {};
  const depVars  = Array.isArray(fe.dep) ? fe.dep : [];
  const featVars = Array.isArray(fe.indep)
    ? fe.indep.filter(iv => iv.enabled !== false).map(iv => iv.name).filter(Boolean)
    : [];

  // features output: only selected feature columns
  const featNames   = featVars.filter(f => !depVars.includes(f));
  const featuresRows = data.map(r => {
    const row = {};
    featNames.forEach(f => { if (f in r) row[f] = r[f]; });
    return row;
  });

  // targets output: only selected target columns
  const targetsRows = data.map(r => {
    const row = {};
    depVars.forEach(f => { if (f in r) row[f] = r[f]; });
    return row;
  });

  if (featNames.length) setHeaders(featNames);

  return {
    _rows:    data,
    passthru: data,
    features: { _headers: featNames,  _rows: featuresRows },
    targets:  { _headers: depVars,    _rows: targetsRows  },
    _headers_features: featNames,
    _headers_targets:  depVars,
  };
}
