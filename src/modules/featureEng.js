// ══════════════════════════════════════════════════════════════════════════════
// Feature Engineering Transforms
// Two-pass approach:
//   Pass 1: Find best individual transform per (feature × target) pair.
//   Pass 2: Find best co-transform (interaction) per (feature pair × target).
// Only keeps transforms that strictly improve Pearson R² over the baseline.
// ══════════════════════════════════════════════════════════════════════════════

// ── Math helpers ──────────────────────────────────────────────────────────────

const EPS = 1e-9;

/**
 * Round to 5 significant figures.
 * Works for any magnitude: 0.000004343 → 0.0000043430, 12345.6789 → 12346.
 */
function sig5(v) {
  if (!isFinite(v) || v === 0) return v;
  const mag    = Math.floor(Math.log10(Math.abs(v)));
  const factor = Math.pow(10, 4 - mag);          // 4 = 5 sig figs - 1
  return Math.round(v * factor) / factor;
}

function pearsonR2(xs, ys) {
  const n = xs.length;
  if (n < 3) return 0;
  let sx=0, sy=0;
  for (let i=0;i<n;i++){sx+=xs[i];sy+=ys[i];}
  const mx=sx/n, my=sy/n;
  let num=0, dx2=0, dy2=0;
  for (let i=0;i<n;i++){
    const dx=xs[i]-mx, dy=ys[i]-my;
    num+=dx*dy; dx2+=dx*dx; dy2+=dy*dy;
  }
  const d=Math.sqrt(dx2*dy2);
  if (d===0) return 0;
  return (num/d)**2;
}

/** Asymptotic soft-clamp: preserves sign, maps large values to ±1.
 *  f(x) = x / (scale + |x|)  where scale = std of the array (or 1).
 *  For small |x|: f(x) ≈ x/scale (proportional); for large |x|: f(x) → ±1.
 */
function asympScale(vals) {
  const finite = vals.filter(v => isFinite(v));
  if (!finite.length) return vals.map(() => 0);
  const mean = finite.reduce((s,v)=>s+v,0)/finite.length;
  const std  = Math.sqrt(finite.reduce((s,v)=>s+(v-mean)**2,0)/finite.length) || 1;
  return vals.map(v => isFinite(v) ? v / (std + Math.abs(v)) : 0);
}

/** Replace non-finite (NaN/Inf/-Inf) with the column median. */
function sanitize(vals) {
  const finite = vals.filter(v => isFinite(v));
  if (!finite.length) return vals.map(() => 0);
  const sorted = [...finite].sort((a,b)=>a-b);
  const med = sorted[Math.floor(sorted.length/2)];
  return vals.map(v => isFinite(v) ? v : med);
}

// ── Sign-aware single transforms ──────────────────────────────────────────────
//
// For each transform we return { values: number[], needsScale: boolean }
// "needsScale" = the output can be arbitrarily large, apply asympScale.
//
// Sign handling policy:
//  - sqrt, log: use abs(x) then restore sign  →  √|x|·sgn(x), ln(|x|+ε)·sgn(x)
//  - box-cox:   shift to all-positive (x + |min| + 1), transform, then mean-center
//  - yeo-johnson: natively handles positives and negatives
//  - reciprocal: 1/x with sign, always scaled (near-zero → huge)
//  - square/cube: keep sign to preserve relative ordering (|x|²·sgn(x) for cube)

function applyTransform(vals, type, params = {}) {
  let out;
  switch (type) {
    case 'identity':
      return { values: vals, needsScale: false };

    case 'abs':
      return { values: vals.map(v => Math.abs(v)), needsScale: false };

    case 'square': {
      // |x|² preserves ordering and sign information is gone, but we keep actual x² for regression utility
      out = vals.map(v => v * v);
      return { values: asympScale(out), needsScale: false };
    }

    case 'cube': {
      // x³ preserves sign naturally
      out = vals.map(v => v**3);
      return { values: asympScale(out), needsScale: false };
    }

    case 'sqrt_signed': {
      out = vals.map(v => Math.sqrt(Math.abs(v)) * Math.sign(v));
      return { values: sanitize(out), needsScale: false };
    }

    case 'log_signed': {
      out = vals.map(v => Math.log(Math.abs(v) + EPS) * Math.sign(v));
      return { values: sanitize(out), needsScale: false };
    }

    case 'reciprocal': {
      // 1/x — extreme near zero; always asymptotically scaled
      out = vals.map(v => Math.abs(v) < EPS ? 0 : 1 / v);
      return { values: asympScale(sanitize(out)), needsScale: false };
    }

    case 'exp_signed': {
      // exp(|x|)·sgn(x) — cap to prevent overflow, then scale
      const scale = params.scale || (Math.sqrt(vals.filter(isFinite).map(v=>v*v).reduce((s,v)=>s+v,0)/Math.max(1,vals.length)) || 1);
      out = vals.map(v => {
        const u = Math.abs(v) / scale;
        return Math.min(Math.exp(u), 1e9) * Math.sign(v);
      });
      return { values: asympScale(sanitize(out)), needsScale: false };
    }

    case 'tanh': {
      const std = Math.sqrt(vals.filter(isFinite).map(v=>v*v).reduce((s,v)=>s+v,0)/Math.max(1,vals.length)) || 1;
      out = vals.map(v => Math.tanh(v / std));
      return { values: sanitize(out), needsScale: false };
    }

    case 'yeo_johnson': {
      // Yeo-Johnson λ: estimated or provided in params
      const lambda = params.lambda ?? estimateYeoJohnsonLambda(vals);
      out = vals.map(v => yeoJohnson(v, lambda));
      return { values: sanitize(out), needsScale: false, lambda };
    }

    case 'box_cox': {
      // Shift all values to positive, then apply Box-Cox
      const finite = vals.filter(isFinite);
      const minV   = Math.min(...finite);
      const offset = params.offset ?? (minV <= 0 ? Math.abs(minV) + 1 : 0);
      const shifted = vals.map(v => v + offset);
      const lambda  = params.lambda ?? estimateBoxCoxLambda(shifted.filter(v=>isFinite(v)&&v>0));
      out = shifted.map(v => (isFinite(v)&&v>0) ? boxCox(v, lambda) : 0);
      // Mean-center so the offset effect is removed
      const outFinite = out.filter(isFinite);
      const mean = outFinite.reduce((s,v)=>s+v,0)/(outFinite.length||1);
      out = out.map(v => v - mean);
      return { values: sanitize(out), needsScale: false, lambda, offset };
    }

    case 'normalize': {
      const finite = vals.filter(isFinite);
      const minV = params.min ?? Math.min(...finite);
      const maxV = params.max ?? Math.max(...finite);
      const rng  = maxV - minV || 1;
      out = vals.map(v => (v - minV) / rng);
      return { values: sanitize(out), needsScale: false, min: minV, max: maxV };
    }

    case 'zscore': {
      const finite = vals.filter(isFinite);
      const mean = params.mean ?? (finite.reduce((s,v)=>s+v,0) / finite.length);
      const std  = params.std  ?? (Math.sqrt(finite.reduce((s,v)=>s+(v-mean)**2,0)/finite.length) || 1);
      out = vals.map(v => (v - mean) / std);
      return { values: sanitize(out), needsScale: false, mean, std };
    }

    default:
      return { values: vals, needsScale: false };
  }
}

// ── Power transform helpers ────────────────────────────────────────────────────

function yeoJohnson(x, lambda) {
  if (x >= 0) {
    return lambda === 0
      ? Math.log(x + 1)
      : ((x + 1)**lambda - 1) / lambda;
  } else {
    return lambda === 2
      ? -Math.log(1 - x)
      : -((-x + 1)**(2 - lambda) - 1) / (2 - lambda);
  }
}

function boxCox(x, lambda) {
  return lambda === 0 ? Math.log(x) : (x**lambda - 1) / lambda;
}

function estimateYeoJohnsonLambda(vals) {
  const candidates = [-1, -0.5, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
  let best = 0, bestVar = Infinity;
  for (const lam of candidates) {
    const tr = vals.map(v => yeoJohnson(isFinite(v) ? v : 0, lam));
    const m  = tr.reduce((s,v)=>s+v,0)/tr.length;
    const va = tr.reduce((s,v)=>s+(v-m)**2,0)/tr.length;
    if (va < bestVar) { bestVar = va; best = lam; }
  }
  return best;
}

function estimateBoxCoxLambda(posVals) {
  if (!posVals.length) return 1;
  const candidates = [-1, -0.5, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
  let best = 1, bestVar = Infinity;
  for (const lam of candidates) {
    const tr = posVals.map(v => boxCox(v, lam));
    const m  = tr.reduce((s,v)=>s+v,0)/tr.length;
    const va = tr.reduce((s,v)=>s+(v-m)**2,0)/tr.length;
    if (va < bestVar) { bestVar = va; best = lam; }
  }
  return best;
}

// ── Transform types to try (single-variable) ──────────────────────────────────
const SINGLE_TRANSFORMS = [
  'sqrt_signed', 'log_signed', 'reciprocal', 'square', 'cube',
  'tanh', 'exp_signed', 'yeo_johnson', 'box_cox', 'normalize', 'zscore', 'abs',
];

// ── Column naming ─────────────────────────────────────────────────────────────
const TRANSFORM_SUFFIX = {
  identity:     '',
  abs:          '_abs',
  square:       '_sq',
  cube:         '_cu',
  sqrt_signed:  '_sqrt',
  log_signed:   '_log',
  reciprocal:   '_recip',
  exp_signed:   '_exp',
  tanh:         '_tanh',
  yeo_johnson:  '_yjohn',
  box_cox:      '_boxcox',
  normalize:    '_norm',
  zscore:       '_z',
};

const CO_SUFFIX = { multiply: '_x_', divide: '_d_' };

// ── Run extracted transform spec on new data ───────────────────────────────────
function applySpec(vals, spec) {
  return applyTransform(vals, spec.type, spec.params || {}).values;
}

// ── Co-transform helper ────────────────────────────────────────────────────────
function coTransform(a, b, type) {
  switch (type) {
    case 'multiply': return asympScale(a.map((v,i) => v * b[i]));
    case 'divide':   return asympScale(a.map((v,i) => v / (Math.abs(b[i]) + EPS)));
    default: return a;
  }
}

// ── Main run function ─────────────────────────────────────────────────────────
export async function runFeatureEngineering(node, { cfg, inputs, setHeaders, feRegistry, setFeRegistry, openTable }) {
  const data   = (inputs.data || []).filter(r => r && typeof r === 'object');

  if (!data.length) return { data: [], _rows: [] };

  // Resolve dep/indep from cfg.fe.
  // VarCfgField stores indep as [{name, enabled}] objects; dep as plain strings.
  const parseVarList = (arr) => (arr || [])
    .filter(item => item && (typeof item === 'string' ? true : item.enabled !== false))
    .map(item => (typeof item === 'string' ? item : item.name))
    .filter(Boolean);

  const depVars  = parseVarList(cfg.fe?.dep);
  const indepSrc = parseVarList(cfg.fe?.indep);

  if (!depVars.length || !indepSrc.length) {
    return { data, _rows: data, _feError: 'No target or feature variables configured. Select targets and features in the Variable Selection field.' };
  }

  const modelName     = (cfg.model_name || '').trim();
  const modelMode     = cfg.model_mode || 'New';
  const keyField      = (cfg.key_field || 'symbol').trim();
  const maxTransforms = parseInt(cfg.max_transforms || '2');
  const registry      = feRegistry || {};

  // ── Stored mode: replay exact transforms from saved spec ─────────────────
  if (modelMode === 'Stored') {
    const stored = modelName ? registry[modelName] : null;
    if (!stored) return { data, _rows: data, error: `No stored FE model named "${modelName}".` };
    try {
      return applyStoredFE(data, stored, setHeaders, openTable);
    } catch (err) {
      console.error('[FE Stored] applyStoredFE error:', err);
      return { data: [], _rows: [], error: `FE Stored mode error: ${err?.message || err}` };
    }
  }

  // ── Merge: load prior history but always train on current data only ────────
  const isMerge   = modelMode === 'Merge' && modelName && !!registry[modelName];
  const prevModel = isMerge ? registry[modelName] : null;
  const prevIndivHist = prevModel?.indivHistory || {};
  const prevCoHist    = prevModel?.coHistory    || {};
  const prevCount     = prevModel?.mergeCount   || 0;
  const newCount      = isMerge ? prevCount + 1 : 1;
  const trainData     = data;

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getNumCol = (rows, field) =>
    rows.map(r => { const v = Number(r[field]); return isFinite(v) ? v : null; });

  const jointPair = (xCol, yCol) => {
    const xv = [], yv = [];
    for (let i = 0; i < xCol.length; i++) {
      if (xCol[i] != null && yCol[i] != null) { xv.push(xCol[i]); yv.push(yCol[i]); }
    }
    return { xv, yv };
  };

  // ── Detect static features (constant within each full key group) ──────────
  // Uses FULL key — no modifier stripping. _1/_2/..._n imply different time
  // windows and must be treated as different symbols for detection purposes.
  const staticFeats = new Set();
  for (const feat of indepSrc) {
    const groups = {};
    for (const row of trainData) {
      const key = String(row[keyField] ?? '_no_key_');
      const val = row[feat];
      if (!groups[key]) groups[key] = new Set();
      groups[key].add(val);
    }
    if (Object.values(groups).every(s => s.size <= 1)) staticFeats.add(feat);
  }

  // ── Pre-compute DV y-columns once ────────────────────────────────────────
  const dvYCols = {};
  for (const dv of depVars) dvYCols[dv] = getNumCol(trainData, dv);

  // ── Pass 1: score all individual transforms for ALL features ─────────────
  // Static features: transforms scored but individual transform columns NOT
  //   emitted to output — they feed Pass 2 co-transform candidate pool only.
  // Dynamic features: best transform selected for output (solo slot).
  const allBaseR2ByFeat  = {};
  const currentIndivR2   = {};
  const currentTxParams  = {};

  for (const feat of indepSrc) {
    const xCol = getNumCol(trainData, feat);
    if (xCol.filter(v => v != null).length < 3) continue;

    const baseR2ByDv = {};
    for (const dv of depVars) {
      const { xv, yv } = jointPair(xCol, dvYCols[dv]);
      if (xv.length < 3) continue;
      baseR2ByDv[dv] = pearsonR2(xv, yv);
    }
    if (!Object.keys(baseR2ByDv).length) continue;
    allBaseR2ByFeat[feat]     = baseR2ByDv;
    currentIndivR2[feat]      = { _base: baseR2ByDv };
    currentTxParams[feat]     = {};

    for (const tType of SINGLE_TRANSFORMS) {
      const xFill  = xCol.map(v => v ?? 0);
      const result = applyTransform(xFill, tType, {});
      if (!result.values || result.values.length !== xCol.length) continue;
      const txCol  = result.values.map((v, i) => (xCol[i] == null ? null : (isFinite(v) ? v : null)));
      const r2ByDv = {};
      for (const dv of depVars) {
        const { xv, yv } = jointPair(txCol, dvYCols[dv]);
        if (xv.length < 3) continue;
        r2ByDv[dv] = pearsonR2(xv, yv);
      }
      if (Object.keys(r2ByDv).length) {
        currentIndivR2[feat][tType] = r2ByDv;
        const p = { ...result }; delete p.values;
        currentTxParams[feat][tType] = p;
      }
    }
  }

  // ── Update rolling history ────────────────────────────────────────────────
  const updatedIndivHist = {};
  for (const [feat, tMap] of Object.entries(currentIndivR2)) {
    updatedIndivHist[feat] = {};
    const prevFeat = prevIndivHist[feat] || {};
    for (const [tType, r2Map] of Object.entries(tMap)) {
      updatedIndivHist[feat][tType] = {};
      const prevT = prevFeat[tType] || {};
      for (const [dv, r2] of Object.entries(r2Map)) {
        const prev = prevT[dv] || { sum: 0, count: 0 };
        updatedIndivHist[feat][tType][dv] = { sum: prev.sum + r2, count: prev.count + 1 };
      }
    }
    for (const [tType, prevT] of Object.entries(prevFeat)) {
      if (!updatedIndivHist[feat][tType]) updatedIndivHist[feat][tType] = {};
      for (const [dv, prev] of Object.entries(prevT)) {
        if (!updatedIndivHist[feat][tType][dv]) updatedIndivHist[feat][tType][dv] = prev;
      }
    }
  }

  // ── Select best individual transform per feature from cumulative history ──
  // Applied to ALL features (both static and dynamic).
  // For static: winning transform used only as a co-transform candidate, never emitted.
  // For dynamic: winning transform is the "solo" output column (if better than base).
  const bestIndivSpec = {};
  for (const [feat, tHistMap] of Object.entries(updatedIndivHist)) {
    const baseHist = tHistMap['_base'] || {};
    const cumBaseByDv = {};
    for (const [dv, hist] of Object.entries(baseHist)) {
      cumBaseByDv[dv] = hist.count ? hist.sum / hist.count : 0;
    }
    let bestType = null, bestAvgGain = 0;
    for (const tType of SINGLE_TRANSFORMS) {
      const tHist = tHistMap[tType] || {};
      let gainSum = 0, gainCount = 0;
      for (const dv of depVars) {
        const hist = tHist[dv];
        if (!hist || !hist.count) continue;
        const gain = (hist.sum / hist.count) - (cumBaseByDv[dv] || 0);
        if (gain > 0) gainSum += gain;
        gainCount++;
      }
      const avgGain = gainCount ? gainSum / gainCount : 0;
      if (avgGain > bestAvgGain) { bestAvgGain = avgGain; bestType = tType; }
    }
    if (bestType && bestAvgGain > 0) {
      const tHist  = updatedIndivHist[feat][bestType] || {};
      const r2ByDv = {};
      let anyBetter = false;
      for (const dv of depVars) {
        const hist = tHist[dv];
        if (!hist || !hist.count) continue;
        r2ByDv[dv] = hist.sum / hist.count;
        if (r2ByDv[dv] > (cumBaseByDv[dv] || 0)) anyBetter = true;
      }
      if (anyBetter) {
        const params = currentTxParams[feat]?.[bestType] || {};
        bestIndivSpec[feat] = { type: bestType, params, r2ByDv, baseR2ByDv: cumBaseByDv };
      }
    }
  }

  const corrDropThresh = (!cfg.corr_drop || cfg.corr_drop === 'Off')
    ? null : parseFloat(cfg.corr_drop);

  // ── Build candidate column pool for Pass 2 ───────────────────────────────
  // Each feature contributes up to 2 candidates: base col + best transform col.
  // featureCols[feat] = { base: number[]|null, tx: number[]|null, txR2: {dv→r2} }
  const featureCols = {};
  for (const feat of indepSrc) {
    const xCol = getNumCol(trainData, feat);
    if (xCol.filter(v => v != null).length < 3) continue;
    const baseCol = xCol; // raw nullable column
    let txCol = null;
    if (bestIndivSpec[feat]) {
      const xFill = xCol.map(v => v ?? 0);
      const txRaw = applyTransform(xFill, bestIndivSpec[feat].type, bestIndivSpec[feat].params).values;
      txCol = txRaw.map((v, i) => (xCol[i] == null ? null : (isFinite(v) ? v : null)));
    }
    featureCols[feat] = { base: baseCol, tx: txCol, txR2: bestIndivSpec[feat]?.r2ByDv || null };
  }

  // ── Pass 2: co-transforms — expanded 4-combo pairings ────────────────────
  // static × static: always blocked.
  // static × dynamic and dynamic × dynamic: all 4 combos (base×base, base×tx,
  //   tx×base, tx×tx) tried; best R² wins per pair direction.
  const currentCoR2 = {};

  const allFeatList = Object.keys(featureCols);
  for (let fi = 0; fi < allFeatList.length; fi++) {
    for (let fj = fi + 1; fj < allFeatList.length; fj++) {
      const f1 = allFeatList[fi];
      const f2 = allFeatList[fj];
      // block static×static
      if (staticFeats.has(f1) && staticFeats.has(f2)) continue;

      const cols1 = featureCols[f1];
      const cols2 = featureCols[f2];
      const pairKey = `${f1}__${f2}`;

      // Try all 4 combos × 2 co-types = up to 8 candidates per pair
      const combos = [
        { a: cols1.base, b: cols2.base, aLabel: 'base', bLabel: 'base' },
        { a: cols1.base, b: cols2.tx,   aLabel: 'base', bLabel: 'tx'   },
        { a: cols1.tx,   b: cols2.base, aLabel: 'tx',   bLabel: 'base' },
        { a: cols1.tx,   b: cols2.tx,   aLabel: 'tx',   bLabel: 'tx'   },
      ].filter(c => c.a != null && c.b != null);

      for (const coType of ['multiply', 'divide']) {
        let bestR2ByDv = null, bestAvgR2 = 0, bestComboLabel = null;
        for (const { a, b, aLabel, bLabel } of combos) {
          const coCol = a.map((v1, i) => {
            const v2 = b[i];
            if (v1 == null || v2 == null) return null;
            const r = coType === 'multiply' ? v1 * v2 : v1 / (Math.abs(v2) + EPS);
            return isFinite(r) ? r : null;
          });
          const nonNull = coCol.filter(v => v != null);
          if (nonNull.length < 3) continue;
          const scaled = asympScale(nonNull); let si = 0;
          const coColScaled = coCol.map(v => v == null ? null : scaled[si++]);
          const r2ByDv = {};
          for (const dv of depVars) {
            const { xv, yv } = jointPair(coColScaled, dvYCols[dv]);
            if (xv.length < 3) continue;
            r2ByDv[dv] = pearsonR2(xv, yv);
          }
          if (!Object.keys(r2ByDv).length) continue;
          const avg = Object.values(r2ByDv).reduce((s,v)=>s+v,0)/Object.values(r2ByDv).length;
          if (avg > bestAvgR2) { bestAvgR2 = avg; bestR2ByDv = r2ByDv; bestComboLabel = `${aLabel}_${bLabel}`; }
        }
        if (bestR2ByDv) {
          if (!currentCoR2[pairKey]) currentCoR2[pairKey] = {};
          currentCoR2[pairKey][coType] = { f1, f2, r2ByDv: bestR2ByDv, comboLabel: bestComboLabel };
        }
      }
    }
  }

  // ── Update co-transform rolling history ───────────────────────────────────
  const updatedCoHist = {};
  for (const [pairKey, coTypeMap] of Object.entries(currentCoR2)) {
    updatedCoHist[pairKey] = {};
    const prevPair = prevCoHist[pairKey] || {};
    for (const [coType, { f1, f2, r2ByDv, comboLabel }] of Object.entries(coTypeMap)) {
      updatedCoHist[pairKey][coType] = { f1, f2, comboLabel };
      const prevT = prevPair[coType] || {};
      for (const [dv, r2] of Object.entries(r2ByDv)) {
        const prev = prevT[dv] || { sum: 0, count: 0 };
        updatedCoHist[pairKey][coType][dv] = { sum: prev.sum + r2, count: prev.count + 1 };
      }
    }
    for (const [coType, prevT] of Object.entries(prevPair)) {
      if (!updatedCoHist[pairKey][coType]) updatedCoHist[pairKey][coType] = prevT;
      else {
        for (const [dv, prev] of Object.entries(prevT)) {
          if (!updatedCoHist[pairKey][coType][dv]) updatedCoHist[pairKey][coType][dv] = prev;
        }
      }
    }
  }
  for (const [pairKey, prevPair] of Object.entries(prevCoHist)) {
    if (!updatedCoHist[pairKey]) updatedCoHist[pairKey] = prevPair;
  }

  // ── Select best co-transform per pair from cumulative history ─────────────
  // Greedy per-feature slot counter: each feature gets up to (maxTransforms-1)
  // co-transform slots.
  const allCoCandidates = [];
  for (const [pairKey, coTypeMap] of Object.entries(updatedCoHist)) {
    const { f1, f2 } = coTypeMap.multiply || coTypeMap.divide || {};
    if (!f1 || !f2) continue;
    if (staticFeats.has(f1) && staticFeats.has(f2)) continue; // safety guard

    let bestCoType = null, bestCoAvgR2 = 0;
    for (const coType of ['multiply', 'divide']) {
      const tHist = coTypeMap[coType];
      if (!tHist) continue;
      let sum = 0, cnt = 0;
      for (const dv of depVars) {
        const h = tHist[dv];
        if (!h || !h.count) continue;
        sum += h.sum / h.count; cnt++;
      }
      const avgR2 = cnt ? sum / cnt : 0;
      if (avgR2 > bestCoAvgR2) { bestCoAvgR2 = avgR2; bestCoType = coType; }
    }
    if (bestCoType) {
      const tHist  = coTypeMap[bestCoType];
      const r2ByDv = {};
      for (const dv of depVars) {
        const h = tHist[dv];
        if (h?.count) r2ByDv[dv] = h.sum / h.count;
      }
      if (Object.keys(r2ByDv).length) {
        allCoCandidates.push({ f1, f2, type: bestCoType, r2ByDv, avgR2: bestCoAvgR2 });
      }
    }
  }

  // Greedy assignment — per-feature slot counter, (maxTransforms-1) co slots each
  const maxCoSlots = Math.max(1, maxTransforms - 1);
  allCoCandidates.sort((a, b) => b.avgR2 - a.avgR2);
  const coSlotsUsed = {};
  const bestCoSpec  = {};
  for (const cand of allCoCandidates) {
    const c1 = coSlotsUsed[cand.f1] || 0;
    const c2 = coSlotsUsed[cand.f2] || 0;
    if (c1 >= maxCoSlots || c2 >= maxCoSlots) continue;
    bestCoSpec[`${cand.f1}__${cand.f2}`] = { f1: cand.f1, f2: cand.f2, type: cand.type, r2ByDv: cand.r2ByDv };
    coSlotsUsed[cand.f1] = c1 + 1;
    coSlotsUsed[cand.f2] = c2 + 1;
  }

  // ── Co-correlation drop (individual + co-transforms, one pass after Pass 2) ─
  // Build indivTxCols for corr-drop use (dynamic features only)
  const indivTxCols = {};
  for (const feat of Object.keys(bestIndivSpec)) {
    if (staticFeats.has(feat)) continue; // static indiv transforms never emitted
    const fc = featureCols[feat];
    if (fc?.tx) indivTxCols[feat] = fc.tx;
  }

  if (corrDropThresh !== null) {
    const txEntries = [];
    for (const [feat, spec] of Object.entries(bestIndivSpec)) {
      if (staticFeats.has(feat)) continue;
      const col = indivTxCols[feat];
      if (!col) continue;
      const vals = Object.values(spec.r2ByDv).filter(v => v != null && isFinite(v));
      txEntries.push({ kind: 'indiv', feat, avgRsq: vals.length ? vals.reduce((s,v)=>s+v,0)/vals.length : 0, col });
    }
    for (const [pairKey, spec] of Object.entries(bestCoSpec)) {
      const { f1, f2, type } = spec;
      const fc1 = featureCols[f1], fc2 = featureCols[f2];
      if (!fc1 || !fc2) continue;
      const a = fc1.tx || fc1.base, b = fc2.tx || fc2.base;
      if (!a || !b) continue;
      const raw = a.map((v1, i) => {
        const v2 = b[i];
        if (v1 == null || v2 == null) return null;
        const r = type === 'multiply' ? v1 * v2 : v1 / (Math.abs(v2) + EPS);
        return isFinite(r) ? r : null;
      });
      const nonNull = raw.filter(v => v != null);
      if (!nonNull.length) continue;
      const sc = asympScale(nonNull); let si2 = 0;
      const col = raw.map(v => v == null ? null : sc[si2++]);
      const vals = Object.values(spec.r2ByDv).filter(v => v != null && isFinite(v));
      txEntries.push({ kind: 'co', pairKey, avgRsq: vals.length ? vals.reduce((s,v)=>s+v,0)/vals.length : 0, col });
    }
    txEntries.sort((a, b) => b.avgRsq - a.avgRsq);
    const toDrop = new Set();
    for (let i = 0; i < txEntries.length; i++) {
      if (toDrop.has(i)) continue;
      for (let j = i + 1; j < txEntries.length; j++) {
        if (toDrop.has(j)) continue;
        const ei = txEntries[i].col.filter(v => v != null);
        const ej = txEntries[j].col.filter(v => v != null);
        if (ei.length < 3 || ej.length < 3) continue;
        // Only compare non-null pairs at same indices
        const pairs = txEntries[i].col.map((v, idx) => [v, txEntries[j].col[idx]])
          .filter(([a, b]) => a != null && b != null);
        if (pairs.length < 3) continue;
        const absR = Math.sqrt(pearsonR2(pairs.map(([a])=>a), pairs.map(([,b])=>b)));
        if (absR >= corrDropThresh) toDrop.add(j);
      }
    }
    for (const idx of toDrop) {
      const entry = txEntries[idx];
      if (entry.kind === 'indiv') delete bestIndivSpec[entry.feat];
      else                        delete bestCoSpec[entry.pairKey];
    }
  }

  // ── Final per-feature column selection ───────────────────────────────────
  // N = maxTransforms (total columns per feature)
  // Dynamic: 1 solo slot (best of base vs indiv-transform) + (N-1) co slots = N total
  //   Special N=1: pick single best across base, solo-transform, co-transforms
  // Static:  0 solo slot + (N-1) co slots = N-1 total (min 1 if any co-transform exists)
  //
  // Collect per-feature co-transforms (sorted best R² first)
  const featCoMap = {}; // feat → [{ pairKey, spec, avgR2 }] sorted desc
  for (const [pairKey, spec] of Object.entries(bestCoSpec)) {
    const avgR2 = Object.values(spec.r2ByDv).filter(v => v != null).reduce((s,v,_,a)=>s+v/a.length,0);
    for (const feat of [spec.f1, spec.f2]) {
      if (!featCoMap[feat]) featCoMap[feat] = [];
      featCoMap[feat].push({ pairKey, spec, avgR2 });
    }
  }
  for (const v of Object.values(featCoMap)) v.sort((a,b) => b.avgR2 - a.avgR2);

  // Determine which indiv-transform columns are actually emitted (dynamic only)
  const emittedIndivCols  = new Set(); // feat names that emit their transform col
  const emittedBaseCols   = new Set(); // feat names that emit their base col
  const emittedCoPairKeys = new Set(); // pairKeys that are emitted

  for (const feat of indepSrc) {
    if (staticFeats.has(feat)) {
      // Static: emit (N-1) best co-transforms, min 1
      const slots = Math.max(1, maxTransforms - 1);
      const pairs = featCoMap[feat] || [];
      let added = 0;
      for (const { pairKey } of pairs) {
        if (added >= slots) break;
        if (!emittedCoPairKeys.has(pairKey)) {
          emittedCoPairKeys.add(pairKey);
          added++;
        }
      }
    } else {
      // Dynamic
      const hasIndiv   = !!bestIndivSpec[feat];
      const baseAvgR2  = allBaseR2ByFeat[feat]
        ? Object.values(allBaseR2ByFeat[feat]).reduce((s,v)=>s+v,0)/Object.values(allBaseR2ByFeat[feat]).length
        : 0;
      const indivAvgR2 = hasIndiv
        ? Object.values(bestIndivSpec[feat].r2ByDv).reduce((s,v)=>s+v,0)/Object.values(bestIndivSpec[feat].r2ByDv).length
        : 0;
      const coPairs    = featCoMap[feat] || [];

      if (maxTransforms === 1) {
        // N=1: pick single best overall
        const coAvgR2 = coPairs[0]?.avgR2 || 0;
        if (coAvgR2 >= indivAvgR2 && coAvgR2 >= baseAvgR2 && coPairs[0]) {
          emittedCoPairKeys.add(coPairs[0].pairKey);
        } else if (indivAvgR2 >= baseAvgR2 && hasIndiv) {
          emittedIndivCols.add(feat);
        } else {
          emittedBaseCols.add(feat);
        }
      } else {
        // N>=2: solo slot + (N-1) co slots
        if (indivAvgR2 >= baseAvgR2 && hasIndiv) {
          emittedIndivCols.add(feat);
        } else {
          emittedBaseCols.add(feat);
        }
        const coSlots = maxTransforms - 1;
        let added = 0;
        for (const { pairKey } of coPairs) {
          if (added >= coSlots) break;
          if (!emittedCoPairKeys.has(pairKey)) {
            emittedCoPairKeys.add(pairKey);
            added++;
          }
        }
      }
    }
  }

  // ── Build output rows ──────────────────────────────────────────────────────
  const out = buildOutputFinal(
    data, indepSrc, bestIndivSpec, bestCoSpec,
    staticFeats, emittedIndivCols, emittedBaseCols, emittedCoPairKeys, keyField
  );

  // ── Duplicate column detection and drop ───────────────────────────────────
  // If two output columns are effectively identical (pearsonR2 >= 0.9999),
  // drop the one with the lower avgR2. Keys and _-prefixed fields are kept.
  const colNames = out.length ? Object.keys(out[0]).filter(k => !k.startsWith('_') && k !== keyField) : [];
  const colsToDropFinal = new Set();
  if (colNames.length > 1) {
    // Build per-column avgR2 lookup from bestIndivSpec / bestCoSpec
    const colAvgR2 = {};
    for (const cn of colNames) {
      // Check indiv transforms
      for (const [feat, spec] of Object.entries(bestIndivSpec)) {
        const suffix = TRANSFORM_SUFFIX[spec.type] || '_xf';
        if (`${feat}${suffix}` === cn) {
          colAvgR2[cn] = Object.values(spec.r2ByDv).reduce((s,v)=>s+v,0)/Object.values(spec.r2ByDv).length;
        }
      }
      // Check co-transforms
      for (const spec of Object.values(bestCoSpec)) {
        const { f1, f2, type } = spec;
        const sfx = CO_SUFFIX[type] || '_co_';
        const f1s = TRANSFORM_SUFFIX[bestIndivSpec[f1]?.type] || '';
        const f2s = TRANSFORM_SUFFIX[bestIndivSpec[f2]?.type] || '';
        if (`${f1}${f1s}${sfx}${f2}${f2s}` === cn) {
          colAvgR2[cn] = Object.values(spec.r2ByDv).reduce((s,v)=>s+v,0)/Object.values(spec.r2ByDv).length;
        }
      }
      if (colAvgR2[cn] == null) colAvgR2[cn] = 0;
    }
    // Pairwise check
    const colVecs = {};
    for (const cn of colNames) colVecs[cn] = out.map(r => { const v = Number(r[cn]); return isFinite(v) ? v : null; });
    for (let i = 0; i < colNames.length; i++) {
      if (colsToDropFinal.has(colNames[i])) continue;
      for (let j = i + 1; j < colNames.length; j++) {
        if (colsToDropFinal.has(colNames[j])) continue;
        const pairs = colVecs[colNames[i]].map((v,k)=>[v,colVecs[colNames[j]][k]])
          .filter(([a,b])=>a!=null&&b!=null);
        if (pairs.length < 3) continue;
        const r2 = pearsonR2(pairs.map(([a])=>a), pairs.map(([,b])=>b));
        if (r2 >= 0.9999) {
          // Drop the lower-R² one
          const drop = (colAvgR2[colNames[i]] >= colAvgR2[colNames[j]]) ? colNames[j] : colNames[i];
          colsToDropFinal.add(drop);
        }
      }
    }
  }

  const finalOut = colsToDropFinal.size
    ? out.map(r => {
        const row = {};
        for (const [k, v] of Object.entries(r)) { if (!colsToDropFinal.has(k)) row[k] = v; }
        return row;
      })
    : out;

  if (finalOut.length) setHeaders(Object.keys(finalOut[0]).filter(k => !k.startsWith('_')));

  // ── Build RSQ tables ───────────────────────────────────────────────────────
  const r3 = v => (v != null && isFinite(v)) ? Math.round(v * 1000) / 1000 : null;
  const makeRsqRow = (name, r2Map) => {
    const row = { independent_variable: name };
    let sum = 0, cnt = 0;
    for (const dv of depVars) {
      const v = r3(r2Map[dv]);
      row[dv] = v;
      if (v != null) { sum += v; cnt++; }
    }
    row.Net_RSQ = r3(cnt ? sum / cnt : null);
    return row;
  };

  const fullRsqRows = [];
  for (const feat of indepSrc) {
    const baseHist = updatedIndivHist[feat]?.['_base'];
    if (!baseHist) continue;
    const r2Map = {};
    for (const [dv, h] of Object.entries(baseHist)) { r2Map[dv] = h.count ? h.sum / h.count : null; }
    fullRsqRows.push(makeRsqRow(feat, r2Map));
  }
  for (const feat of indepSrc) {
    const featHist = updatedIndivHist[feat] || {};
    for (const tType of SINGLE_TRANSFORMS) {
      const tHist = featHist[tType];
      if (!tHist) continue;
      const r2Map = {};
      for (const [dv, h] of Object.entries(tHist)) { r2Map[dv] = h.count ? h.sum / h.count : null; }
      fullRsqRows.push(makeRsqRow(`${feat}${TRANSFORM_SUFFIX[tType] || '_xf'}`, r2Map));
    }
  }
  for (const [, coTypeMap] of Object.entries(updatedCoHist)) {
    for (const [coType, tHist] of Object.entries(coTypeMap)) {
      const { f1, f2 } = tHist;
      if (!f1 || !f2) continue;
      const r2Map = {};
      for (const dv of depVars) {
        const h = tHist[dv];
        if (h?.count) r2Map[dv] = h.sum / h.count;
      }
      if (!Object.keys(r2Map).length) continue;
      const sfx = CO_SUFFIX[coType] || '_co_';
      const f1s = TRANSFORM_SUFFIX[bestIndivSpec[f1]?.type] || '';
      const f2s = TRANSFORM_SUFFIX[bestIndivSpec[f2]?.type] || '';
      fullRsqRows.push(makeRsqRow(`${f1}${f1s}${sfx}${f2}${f2s}`, r2Map));
    }
  }
  fullRsqRows.sort((a, b) => (b.Net_RSQ ?? -1) - (a.Net_RSQ ?? -1));
  fullRsqRows.forEach((r, i) => { r.rank = i + 1; });

  if (fullRsqRows.length) {
    const runsLabel = newCount > 1 ? ` (${newCount} runs)` : '';
    const rsqTitle  = modelName ? `FE RSQ: ${modelName}${runsLabel}` : 'Feature Eng. RSQ';
    openTable?.({ nodeId: node.id + '_rsq', rows: fullRsqRows, title: rsqTitle });
  }

  // ── Winner-only RSQ for downstream RF/MV ──────────────────────────────────
  const outputCols = finalOut.length ? new Set(Object.keys(finalOut[0]).filter(k=>!k.startsWith('_'))) : new Set();
  const feRsqRows = [];
  for (const feat of indepSrc) {
    // Base col emitted (dynamic, no better transform)
    if (emittedBaseCols.has(feat) && !colsToDropFinal.has(feat)) {
      const baseHist = updatedIndivHist[feat]?.['_base'];
      if (baseHist) {
        const r2Map = {};
        for (const [dv, h] of Object.entries(baseHist)) { r2Map[dv] = h.count ? h.sum / h.count : null; }
        feRsqRows.push(makeRsqRow(feat, r2Map));
      }
    }
    // Indiv transform col emitted (dynamic)
    if (emittedIndivCols.has(feat) && bestIndivSpec[feat]) {
      const spec    = bestIndivSpec[feat];
      const colName = `${feat}${TRANSFORM_SUFFIX[spec.type] || '_xf'}`;
      if (!colsToDropFinal.has(colName)) feRsqRows.push(makeRsqRow(colName, spec.r2ByDv));
    }
  }
  // Co-transforms emitted
  for (const pairKey of emittedCoPairKeys) {
    const spec = bestCoSpec[pairKey];
    if (!spec) continue;
    const { f1, f2, type } = spec;
    const sfx  = CO_SUFFIX[type] || '_co_';
    const f1s  = TRANSFORM_SUFFIX[bestIndivSpec[f1]?.type] || '';
    const f2s  = TRANSFORM_SUFFIX[bestIndivSpec[f2]?.type] || '';
    const colName = `${f1}${f1s}${sfx}${f2}${f2s}`;
    if (!colsToDropFinal.has(colName)) feRsqRows.push(makeRsqRow(colName, spec.r2ByDv));
  }
  feRsqRows.sort((a, b) => (b.Net_RSQ ?? -1) - (a.Net_RSQ ?? -1));
  feRsqRows.forEach((r, i) => { r.rank = i + 1; });

  // ── Store model ───────────────────────────────────────────────────────────
  if (modelName && modelMode !== 'Stored') {
    let saveName = modelName;
    if (modelMode === 'New' && registry[saveName]) {
      let n = 1;
      while (registry[saveName + '_' + n]) n++;
      saveName = modelName + '_' + n;
    }
    const updatedReg = {
      ...registry,
      [saveName]: {
        name: saveName, depVars, features: indepSrc, mergeCount: newCount,
        indivHistory: updatedIndivHist, coHistory: updatedCoHist,
        indivSpecs: bestIndivSpec, coSpecs: bestCoSpec,
        staticFeats: [...staticFeats], keyField,
        updated: new Date().toISOString(),
      },
    };
    setFeRegistry?.(updatedReg);
  }

  return {
    data: finalOut, _rows: finalOut,
    rsq:    feRsqRows,
    fe_rsq: feRsqRows,
    _feIndivSpecs: bestIndivSpec,
    _feCoSpecs:    bestCoSpec,
  };
}

// ── Apply stored FE specs to new data ─────────────────────────────────────────
function applyStoredFE(data, stored, setHeaders, openTable) {
  const out = buildOutput(data, stored.features || [], stored.indivSpecs || {}, stored.coSpecs || {});
  if (out.length) setHeaders(Object.keys(out[0]).filter(k => !k.startsWith('_')));
  // Show stored model's cumulative RSQ table if history is available
  if (openTable && stored.indivHistory) {
    const r3    = v => (v != null && isFinite(v)) ? Math.round(v * 1000) / 1000 : null;
    const dvs   = stored.depVars || [];
    const rows  = [];
    const addRow = (name, r2Map) => {
      const row = { independent_variable: name };
      let sum = 0, cnt = 0;
      for (const dv of dvs) { const v = r3(r2Map[dv]); row[dv] = v; if (v != null) { sum += v; cnt++; } }
      row.Net_RSQ = r3(cnt ? sum / cnt : null);
      rows.push(row);
    };
    for (const [feat, tHistMap] of Object.entries(stored.indivHistory)) {
      for (const [tType, tHist] of Object.entries(tHistMap)) {
        const r2Map = {};
        for (const [dv, h] of Object.entries(tHist)) { if (h?.count) r2Map[dv] = h.sum / h.count; }
        const label = tType === '_base' ? feat : `${feat}${TRANSFORM_SUFFIX[tType] || '_xf'}`;
        addRow(label, r2Map);
      }
    }
    rows.sort((a, b) => (b.Net_RSQ ?? -1) - (a.Net_RSQ ?? -1));
    rows.forEach((r, i) => { r.rank = i + 1; });
    if (rows.length) {
      const n = stored.mergeCount || 1;
      openTable?.({ nodeId: `stored_fe_rsq_${stored.name}`, rows, title: `FE RSQ: ${stored.name} (${n} run${n > 1 ? 's' : ''})` });
    }
    // Build winner-only RSQ for downstream RF/MV — same logic as live run
    const winnerRows = rows.filter(r => {
      const name = r.independent_variable || '';
      // Include if it's a transform column (suffixed) or a base feature with no transform
      const isBase = (stored.features || []).includes(name);
      const isTransform = !isBase;
      if (isTransform) return true;
      // Base feature: only include if no transform exists for it
      const hasTransform = Object.keys(stored.indivSpecs || {}).includes(name);
      return !hasTransform;
    });
    return { data: out, _rows: out, rsq: winnerRows, fe_rsq: winnerRows };
  }
  return { data: out, _rows: out, rsq: [], fe_rsq: [] };
}

// ── Build output rows from final selection sets ───────────────────────────────
// staticFeats: Set of feature names detected as constant within each key group.
// emittedIndivCols: dynamic features that emit their individual transform column.
// emittedBaseCols:  dynamic features that emit their base column.
// emittedCoPairKeys: set of pairKeys whose co-transform column is emitted.
// Static base and static individual transform columns are NEVER added to output.
// Keys (keyField) and _-prefixed columns are always preserved from input rows.
function buildOutputFinal(data, indepSrc, indivSpecs, coSpecs,
    staticFeats, emittedIndivCols, emittedBaseCols, emittedCoPairKeys, keyField) {

  // Pre-compute emitted individual transform vectors
  const indivColVecs = {};
  for (const feat of emittedIndivCols) {
    const spec  = indivSpecs[feat];
    if (!spec) continue;
    const xAll  = data.map(r => { const v = Number(r[feat]); return isNaN(v) ? null : v; });
    const xFill = xAll.map(v => v ?? 0);
    indivColVecs[feat] = sanitize(applyTransform(xFill, spec.type, spec.params || {}).values).map(sig5);
  }

  // Pre-compute co-transform vectors (use best available column for each participant)
  const coColVecs = {};
  for (const pairKey of emittedCoPairKeys) {
    const coSpec = coSpecs[pairKey];
    if (!coSpec) continue;
    const { f1, f2, type } = coSpec;
    // Prefer the individual transform col if available; otherwise base col
    const getCol = (feat) => {
      if (indivColVecs[feat]) return indivColVecs[feat];
      return data.map(r => { const v = Number(r[feat]); return isNaN(v) ? null : sig5(v); });
    };
    const a = getCol(f1);
    const b = getCol(f2);
    coColVecs[pairKey] = coTransform(a, b, type).map(sig5);
  }

  return data.map((r, i) => {
    const row = { ...r };

    // Add emitted individual transform columns for dynamic features
    for (const feat of emittedIndivCols) {
      const spec = indivSpecs[feat];
      if (!spec || !indivColVecs[feat]) continue;
      const suffix  = TRANSFORM_SUFFIX[spec.type] || '_xf';
      row[`${feat}${suffix}`] = indivColVecs[feat][i] ?? null;
    }

    // Remove static base columns and static individual transform columns from output
    // (they were passed through in r = {...row} above; strip them now)
    for (const feat of staticFeats) {
      delete row[feat]; // remove static base column
      // Remove any individual transform columns for this static feature
      for (const tType of Object.keys(TRANSFORM_SUFFIX)) {
        if (tType === 'identity') continue;
        const suffix = TRANSFORM_SUFFIX[tType];
        if (suffix) delete row[`${feat}${suffix}`];
      }
      delete row[`${feat}_xf`]; // fallback suffix
    }

    // Remove dynamic base columns that have a better individual transform
    for (const feat of emittedIndivCols) {
      delete row[feat]; // base col replaced by transform col
    }

    // Add co-transform columns
    for (const pairKey of emittedCoPairKeys) {
      const coSpec = coSpecs[pairKey];
      if (!coSpec || !coColVecs[pairKey]) continue;
      const { f1, f2, type } = coSpec;
      const sfx  = CO_SUFFIX[type] || '_co_';
      const f1s  = TRANSFORM_SUFFIX[indivSpecs[f1]?.type] || '';
      const f2s  = TRANSFORM_SUFFIX[indivSpecs[f2]?.type] || '';
      const colName = `${f1}${f1s}${sfx}${f2}${f2s}`;
      row[colName] = coColVecs[pairKey][i] ?? null;
    }

    return row;
  });
}
