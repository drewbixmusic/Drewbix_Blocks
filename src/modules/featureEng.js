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
  const rsqIn  = inputs.rsq;

  if (!data.length) return { data: [], _rows: [] };

  // Resolve dep/indep from cfg.fe or upstream RSQ.
  // VarCfgField stores indep as [{name, enabled}] objects; dep as plain strings.
  // Handle both formats so either works.
  const parseVarList = (arr) => (arr || [])
    .filter(item => item && (typeof item === 'string' ? true : item.enabled !== false))
    .map(item => (typeof item === 'string' ? item : item.name))
    .filter(Boolean);

  let depVars  = parseVarList(cfg.fe?.dep);
  let indepSrc = parseVarList(cfg.fe?.indep);
  if (rsqIn?.rsqScores) {
    const topNRaw = cfg.top_feats;
    const topN    = (topNRaw === 'All' || !topNRaw) ? Infinity : (parseInt(topNRaw) || 10);
    const scores  = rsqIn.rsqScores;
    const byDv    = {};
    Object.keys(scores).forEach(dv => {
      const sorted = Object.entries(scores[dv]).sort(([,a],[,b]) => b - a);
      byDv[dv] = (topN === Infinity ? sorted : sorted.slice(0, topN)).map(([f]) => f);
    });
    if (!depVars.length)  depVars  = Object.keys(byDv);
    if (!indepSrc.length) indepSrc = [...new Set(Object.values(byDv).flat())];
  }
  if (!depVars.length || !indepSrc.length) {
    return { data, _rows: data, _feError: 'No target or feature variables configured. Select targets and features in the Variable Selection field, or connect a Pearson RSQ block.' };
  }

  const modelName = (cfg.model_name || '').trim();
  const modelMode = cfg.model_mode || 'New';
  const registry  = feRegistry || {};

  // ── Stored mode: replay exact transforms from saved spec ─────────────────
  if (modelMode === 'Stored') {
    const stored = modelName ? registry[modelName] : null;
    if (!stored) return { data, _rows: data, _feError: `No stored FE model named "${modelName}".` };
    return applyStoredFE(data, stored, setHeaders, openTable);
  }

  // ── Merge: load prior history but always train on current data only ────────
  // (no raw data stored — only rolling-average RSQ history accumulates)
  const isMerge   = modelMode === 'Merge' && modelName && !!registry[modelName];
  const prevModel = isMerge ? registry[modelName] : null;
  const prevIndivHist = prevModel?.indivHistory || {};
  const prevCoHist    = prevModel?.coHistory    || {};
  const prevCount     = prevModel?.mergeCount   || 0;
  const newCount      = isMerge ? prevCount + 1 : 1;
  const trainData     = data; // always current data; RSQ accumulates in history

  // ── Helpers: numeric column extraction with joint x,y filtering ─────────────
  const getNumCol = (rows, field) =>
    rows.map(r => { const v = Number(r[field]); return isFinite(v) ? v : null; });

  // Returns { xVals, yVals } keeping only rows where BOTH x and y are non-null.
  const jointPair = (xCol, yCol) => {
    const xv = [], yv = [];
    for (let i = 0; i < xCol.length; i++) {
      if (xCol[i] != null && yCol[i] != null) { xv.push(xCol[i]); yv.push(yCol[i]); }
    }
    return { xv, yv };
  };

  // ── Pass 1: Compute ALL transform R² for every feature; update history ────
  // History accumulates rolling averages so Merge mode ranks transforms across
  // multiple runs.  The best transform is selected from CUMULATIVE history.
  const allBaseR2ByFeat  = {};   // feat → { dv → r2 } (current-run baseline, for RSQ table)
  const currentIndivR2   = {};   // feat → { tType/_base → { dv → r2 } }
  const currentTxParams  = {};   // feat → { tType → params } (for buildOutput)

  for (const feat of indepSrc) {
    const xCol = getNumCol(trainData, feat);
    if (xCol.filter(v => v != null).length < 3) continue;

    const dvYCols    = {};
    const baseR2ByDv = {};
    for (const dv of depVars) {
      const yCol = getNumCol(trainData, dv);
      dvYCols[dv] = yCol;
      const { xv, yv } = jointPair(xCol, yCol);
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

  // ── Update rolling history (sum + count per feat/tType/dv) ────────────────
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
    // Preserve prior history for DVs/types not present in current run
    for (const [tType, prevT] of Object.entries(prevFeat)) {
      if (!updatedIndivHist[feat][tType]) updatedIndivHist[feat][tType] = {};
      for (const [dv, prev] of Object.entries(prevT)) {
        if (!updatedIndivHist[feat][tType][dv]) updatedIndivHist[feat][tType][dv] = prev;
      }
    }
  }

  // ── Select best transform per feature from cumulative history ─────────────
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
      // Cumulative avg R² per DV for the winning transform
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
        // Use current-run params (most recently learned; needed for buildOutput)
        const params = currentTxParams[feat]?.[bestType] || {};
        bestIndivSpec[feat] = { type: bestType, params, r2ByDv, baseR2ByDv: cumBaseByDv };
      }
    }
  }

  // (Co-correlation drop runs AFTER Pass 2 so co-transforms are included in the check)
  const corrDropThresh = (!cfg.corr_drop || cfg.corr_drop === 'Off')
    ? null : parseFloat(cfg.corr_drop);

  // ── Pass 2: Co-transforms (pairwise interactions) — with history tracking ──
  const indivTxCols = {};
  for (const feat of Object.keys(bestIndivSpec)) {
    const xCol  = getNumCol(trainData, feat);
    const xFill = xCol.map(v => v ?? 0);
    const txRaw = applyTransform(xFill, bestIndivSpec[feat].type, bestIndivSpec[feat].params).values;
    indivTxCols[feat] = txRaw.map((v, i) => (xCol[i] == null ? null : (isFinite(v) ? v : null)));
  }

  const currentCoR2  = {}; // pairKey → coType → { dv → r2 }
  const qualFeatList = Object.keys(bestIndivSpec);

  for (let fi = 0; fi < qualFeatList.length; fi++) {
    for (let fj = fi + 1; fj < qualFeatList.length; fj++) {
      const f1 = qualFeatList[fi];
      const f2 = qualFeatList[fj];
      const tx1 = indivTxCols[f1];
      const tx2 = indivTxCols[f2];
      const pairKey = `${f1}__${f2}`;

      for (const coType of ['multiply', 'divide']) {
        const coCol = tx1.map((v1, i) => {
          const v2 = tx2[i];
          if (v1 == null || v2 == null) return null;
          const r = coType === 'multiply' ? v1 * v2 : v1 / (Math.abs(v2) + EPS);
          return isFinite(r) ? r : null;
        });
        const nonNull = coCol.filter(v => v != null);
        if (nonNull.length < 3) continue;
        const scaled = asympScale(nonNull);
        let si = 0;
        const coColScaled = coCol.map(v => v == null ? null : scaled[si++]);

        const r2ByDv = {};
        for (const dv of depVars) {
          const yCol = getNumCol(trainData, dv);
          const { xv, yv } = jointPair(coColScaled, yCol);
          if (xv.length < 3) continue;
          r2ByDv[dv] = pearsonR2(xv, yv);
        }
        if (Object.keys(r2ByDv).length) {
          if (!currentCoR2[pairKey]) currentCoR2[pairKey] = {};
          currentCoR2[pairKey][coType] = { f1, f2, r2ByDv };
        }
      }
    }
  }

  // ── Update co-transform rolling history ───────────────────────────────────
  const updatedCoHist = {};
  for (const [pairKey, coTypeMap] of Object.entries(currentCoR2)) {
    updatedCoHist[pairKey] = {};
    const prevPair = prevCoHist[pairKey] || {};
    for (const [coType, { f1, f2, r2ByDv }] of Object.entries(coTypeMap)) {
      updatedCoHist[pairKey][coType] = { f1, f2 };
      const prevT = prevPair[coType] || {};
      for (const [dv, r2] of Object.entries(r2ByDv)) {
        const prev = prevT[dv] || { sum: 0, count: 0 };
        updatedCoHist[pairKey][coType][dv] = { sum: prev.sum + r2, count: prev.count + 1 };
      }
    }
    // Preserve prior history for types/DVs not in current run
    for (const [coType, prevT] of Object.entries(prevPair)) {
      if (!updatedCoHist[pairKey][coType]) updatedCoHist[pairKey][coType] = prevT;
      else {
        for (const [dv, prev] of Object.entries(prevT)) {
          if (!updatedCoHist[pairKey][coType][dv]) updatedCoHist[pairKey][coType][dv] = prev;
        }
      }
    }
  }
  // Also carry over pairs from prior history not evaluated this run
  for (const [pairKey, prevPair] of Object.entries(prevCoHist)) {
    if (!updatedCoHist[pairKey]) updatedCoHist[pairKey] = prevPair;
  }

  // ── Select best co-transform per pair from cumulative history ─────────────
  // Build candidates scored by cumulative avg R² improvement over individual R²
  const allCoCandidates = [];
  for (const [pairKey, coTypeMap] of Object.entries(updatedCoHist)) {
    const { f1, f2 } = coTypeMap.multiply || coTypeMap.divide || {};
    if (!f1 || !f2 || !bestIndivSpec[f1] || !bestIndivSpec[f2]) continue;

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
      const baseline = depVars.reduce((mx, dv) =>
        Math.max(mx, bestIndivSpec[f1].r2ByDv[dv] || 0, bestIndivSpec[f2].r2ByDv[dv] || 0), 0);
      if (avgR2 > baseline && avgR2 > bestCoAvgR2) { bestCoAvgR2 = avgR2; bestCoType = coType; }
    }

    if (bestCoType) {
      const tHist = coTypeMap[bestCoType];
      const r2ByDv = {};
      let anyBetter = false;
      for (const dv of depVars) {
        const h = tHist[dv];
        if (!h || !h.count) continue;
        r2ByDv[dv] = h.sum / h.count;
        const base = Math.max(bestIndivSpec[f1].r2ByDv[dv] || 0, bestIndivSpec[f2].r2ByDv[dv] || 0);
        if (r2ByDv[dv] > base) anyBetter = true;
      }
      if (anyBetter) allCoCandidates.push({ f1, f2, type: bestCoType, r2ByDv, avgR2: bestCoAvgR2 });
    }
  }

  // Greedy assignment: 1 co-transform per feature, best avgR² first
  allCoCandidates.sort((a, b) => b.avgR2 - a.avgR2);
  const usedInCo   = new Set();
  const bestCoSpec = {};
  for (const cand of allCoCandidates) {
    if (usedInCo.has(cand.f1) || usedInCo.has(cand.f2)) continue;
    bestCoSpec[`${cand.f1}__${cand.f2}`] = { f1: cand.f1, f2: cand.f2, type: cand.type, r2ByDv: cand.r2ByDv };
    usedInCo.add(cand.f1);
    usedInCo.add(cand.f2);
  }

  // ── Combined co-correlation drop (individual + co-transforms, one pass) ───
  // Runs AFTER Pass 2 so co-transforms are checked for redundancy alongside
  // individual transforms.  Dropped entries revert to base-column fallback in
  // the rsq output.  Base features are never dropped here — only transforms.
  if (corrDropThresh !== null) {
    // Collect all surviving transform columns with avg RSQ for ranking
    const txEntries = [];

    for (const [feat, spec] of Object.entries(bestIndivSpec)) {
      const col  = indivTxCols[feat];
      if (!col) continue;
      const vals = Object.values(spec.r2ByDv).filter(v => v != null && isFinite(v));
      txEntries.push({ kind: 'indiv', feat, avgRsq: vals.length ? vals.reduce((s,v)=>s+v,0)/vals.length : 0, col });
    }

    for (const [pairKey, spec] of Object.entries(bestCoSpec)) {
      const { f1, f2, type } = spec;
      const tx1 = indivTxCols[f1], tx2 = indivTxCols[f2];
      if (!tx1 || !tx2) continue;
      const raw = tx1.map((v1, i) => {
        const v2 = tx2[i];
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

    // Sort best first; greedily drop anything correlated with a better entry
    txEntries.sort((a, b) => b.avgRsq - a.avgRsq);
    const toDrop = new Set();
    for (let i = 0; i < txEntries.length; i++) {
      const ei = txEntries[i];
      if (toDrop.has(i)) continue;
      for (let j = i + 1; j < txEntries.length; j++) {
        if (toDrop.has(j)) continue;
        const absR = Math.sqrt(pearsonR2(ei.col, txEntries[j].col));
        if (absR >= corrDropThresh) toDrop.add(j);
      }
    }
    for (const idx of toDrop) {
      const entry = txEntries[idx];
      if (entry.kind === 'indiv') delete bestIndivSpec[entry.feat];
      else                        delete bestCoSpec[entry.pairKey];
    }
  }

  // ── Build output rows ─────────────────────────────────────────────────────
  const out = buildOutput(data, indepSrc, bestIndivSpec, bestCoSpec);
  if (out.length) setHeaders(Object.keys(out[0]).filter(k => !k.startsWith('_')));

  // ── Build RSQ tables ───────────────────────────────────────────────────────
  // Uses Pearson-compatible field names (independent_variable, Net_RSQ, rank)
  // so the fe_rsq pin is a drop-in replacement for pearson_rsq → RF/MV.
  //
  // Two views are produced:
  //  fullRsqRows — ALL tested transforms (for VizHub display analysis)
  //  fe_rsq      — Only winning transforms (columns that actually exist in
  //                the output data) for use as RF/MV rsq input.
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

  // ── Full table for VizHub (all transforms, for analysis) ──────────────────
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

  // Open full table in VizHub
  if (fullRsqRows.length) {
    const runsLabel = newCount > 1 ? ` (${newCount} runs)` : '';
    const rsqTitle  = modelName ? `FE RSQ: ${modelName}${runsLabel}` : 'Feature Eng. RSQ';
    openTable?.({ nodeId: node.id + '_rsq', rows: fullRsqRows, title: rsqTitle });
  }

  // ── Pearson-compatible output pin (winners only) ───────────────────────────
  // Contains only the columns that actually appear in the FE output dataset so
  // RF / MV blocks can consume this pin exactly like a Pearson RSQ output.
  const feRsqRows = [];
  // Features with no winning transform → original column name, baseline R²
  for (const feat of indepSrc) {
    if (bestIndivSpec[feat]) continue;   // has a winner, handled below
    const baseHist = updatedIndivHist[feat]?.['_base'];
    if (!baseHist) continue;
    const r2Map = {};
    for (const [dv, h] of Object.entries(baseHist)) { r2Map[dv] = h.count ? h.sum / h.count : null; }
    feRsqRows.push(makeRsqRow(feat, r2Map));
  }
  // Winning individual transforms → transform column name, cumulative R²
  for (const [feat, spec] of Object.entries(bestIndivSpec)) {
    const colName = `${feat}${TRANSFORM_SUFFIX[spec.type] || '_xf'}`;
    feRsqRows.push(makeRsqRow(colName, spec.r2ByDv));
  }
  // Winning co-transforms → co-transform column name, cumulative R²
  for (const spec of Object.values(bestCoSpec)) {
    const { f1, f2, type } = spec;
    const sfx = CO_SUFFIX[type] || '_co_';
    const f1s = TRANSFORM_SUFFIX[bestIndivSpec[f1]?.type] || '';
    const f2s = TRANSFORM_SUFFIX[bestIndivSpec[f2]?.type] || '';
    feRsqRows.push(makeRsqRow(`${f1}${f1s}${sfx}${f2}${f2s}`, spec.r2ByDv));
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
        name:         saveName,
        depVars,
        features:     indepSrc,
        mergeCount:   newCount,
        indivHistory: updatedIndivHist,
        coHistory:    updatedCoHist,
        indivSpecs:   bestIndivSpec,
        coSpecs:      bestCoSpec,
        updated:      new Date().toISOString(),
      },
    };
    setFeRegistry?.(updatedReg);
  }

  // Emit under both 'rsq' (new registry pin name) and 'fe_rsq' (backward compat).
  // The engine resolves inputs by fromPort name, so wires from either label work.
  return {
    data: out, _rows: out,
    rsq:    feRsqRows,   // primary — matches registry out:['data','rsq']
    fe_rsq: feRsqRows,   // backward compat for saved flows that used old pin name
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

// ── Build output rows from specs ──────────────────────────────────────────────
// All new transform values are rounded to 5 significant figures.
function buildOutput(data, indepSrc, indivSpecs, coSpecs) {
  const tColsMap = {};
  for (const feat of indepSrc) {
    if (!indivSpecs[feat]) continue;
    const xAll  = data.map(r => { const v = Number(r[feat]); return isNaN(v) ? null : v; });
    const xFill = xAll.map(v => v ?? 0);
    const spec  = indivSpecs[feat];
    tColsMap[feat] = sanitize(applyTransform(xFill, spec.type, spec.params || {}).values)
      .map(sig5);
  }

  const coColsMap = {};
  for (const [key, coSpec] of Object.entries(coSpecs)) {
    const { f1, f2, type } = coSpec;
    const a = tColsMap[f1];
    const b = tColsMap[f2];
    if (!a || !b) continue;
    coColsMap[key] = coTransform(a, b, type).map(sig5);
  }

  return data.map((r, i) => {
    const row = { ...r };
    for (const feat of indepSrc) {
      if (tColsMap[feat]) {
        const suffix = TRANSFORM_SUFFIX[indivSpecs[feat]?.type] || '_xf';
        row[`${feat}${suffix}`] = tColsMap[feat][i] ?? null;
      }
    }
    for (const [key, coSpec] of Object.entries(coSpecs)) {
      const { f1, f2, type } = coSpec;
      const sfx = CO_SUFFIX[type] || '_co_';
      const f1s = TRANSFORM_SUFFIX[indivSpecs[f1]?.type] || '';
      const f2s = TRANSFORM_SUFFIX[indivSpecs[f2]?.type] || '';
      const colName = `${f1}${f1s}${sfx}${f2}${f2s}`;
      row[colName] = coColsMap[key]?.[i] ?? null;
    }
    return row;
  });
}
