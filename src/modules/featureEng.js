// ══════════════════════════════════════════════════════════════════════════════
// Feature Engineering Transforms
// Two-pass approach:
//   Pass 1: Find best individual transform per (feature × target) pair.
//   Pass 2: Find best co-transform (interaction) per (feature pair × target).
// Only keeps transforms that strictly improve Pearson R² over the baseline.
// ══════════════════════════════════════════════════════════════════════════════

// ── Math helpers ──────────────────────────────────────────────────────────────

const EPS = 1e-9;

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
export async function runFeatureEngineering(node, { cfg, inputs, setHeaders, feRegistry, setFeRegistry }) {
  const data   = (inputs.data || []).filter(r => r && typeof r === 'object');
  const rsqIn  = inputs.rsq;

  if (!data.length) return { data: [], _rows: [] };

  // Resolve dep/indep from cfg.fe or upstream RSQ
  let depVars  = (cfg.fe?.dep  || []).filter(Boolean);
  let indepSrc = (cfg.fe?.indep || []).filter(Boolean);
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
    return applyStoredFE(data, stored, setHeaders);
  }

  // ── For Merge: combine with stored trainRows ───────────────────────────────
  let trainData = data;
  if (modelMode === 'Merge' && modelName && registry[modelName]) {
    trainData = [...(registry[modelName].trainRows || []), ...data];
  }

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

  // ── Pass 1: Best individual transform per feature ─────────────────────────
  // For each feature we try every single-variable transform and keep the one
  // that produces the highest AVERAGE R² gain across all targets.
  // A transform is only accepted if it strictly beats the baseline for at
  // least one target.  Joint filtering ensures missing rows never block R².
  const bestIndivSpec = {};  // feature → { type, params, r2ByDv, baseR2ByDv }

  for (const feat of indepSrc) {
    const xCol = getNumCol(trainData, feat);
    if (xCol.filter(v => v != null).length < 3) continue;

    // ── Baseline R² (identity transform) per DV ──────────────────────────
    const baseR2ByDv = {};
    const dvYCols    = {};
    for (const dv of depVars) {
      const yCol = getNumCol(trainData, dv);
      dvYCols[dv] = yCol;
      const { xv, yv } = jointPair(xCol, yCol);
      if (xv.length < 3) continue;
      baseR2ByDv[dv] = pearsonR2(xv, yv);
    }
    if (!Object.keys(baseR2ByDv).length) continue;

    let bestType = null, bestParams = {}, bestAvgGain = 0;

    for (const tType of SINGLE_TRANSFORMS) {
      // Apply transform to all rows (use 0 as placeholder for nulls; joint filter below)
      const xFill  = xCol.map(v => v ?? 0);
      const result = applyTransform(xFill, tType, {});
      if (!result.values || result.values.length !== xCol.length) continue;
      const txCol  = result.values.map((v, i) => (xCol[i] == null ? null : (isFinite(v) ? v : null)));

      let gainSum = 0, gainCount = 0;
      for (const dv of depVars) {
        const { xv, yv } = jointPair(txCol, dvYCols[dv]);
        if (xv.length < 3) continue;
        const r2   = pearsonR2(xv, yv);
        const gain = r2 - (baseR2ByDv[dv] ?? 0);
        if (gain > 0) gainSum += gain;
        gainCount++;
      }
      const avgGain = gainCount ? gainSum / gainCount : 0;
      if (avgGain > bestAvgGain) {
        bestAvgGain = avgGain;
        bestType    = tType;
        bestParams  = { ...result };
        delete bestParams.values;
      }
    }

    if (bestType && bestAvgGain > 0) {
      const xFill  = xCol.map(v => v ?? 0);
      const result = applyTransform(xFill, bestType, bestParams);
      const txCol  = result.values.map((v, i) => (xCol[i] == null ? null : (isFinite(v) ? v : null)));
      const r2ByDv = {};
      let   anyBetter = false;
      for (const dv of depVars) {
        const { xv, yv } = jointPair(txCol, dvYCols[dv]);
        if (xv.length < 3) continue;
        r2ByDv[dv] = pearsonR2(xv, yv);
        if (r2ByDv[dv] > (baseR2ByDv[dv] ?? 0)) anyBetter = true;
      }
      if (anyBetter) {
        bestIndivSpec[feat] = { type: bestType, params: bestParams, r2ByDv, baseR2ByDv };
      }
    }
  }

  // ── Pass 2: Co-transforms (pairwise interactions) ─────────────────────────
  // Pre-compute full-length transformed columns for qualified features so
  // we can do row-aligned joint filtering with y columns.
  const indivTxCols = {}; // feat → transformed numeric column (length = trainData.length)
  for (const feat of Object.keys(bestIndivSpec)) {
    const xCol  = getNumCol(trainData, feat);
    const xFill = xCol.map(v => v ?? 0);
    const txRaw = applyTransform(xFill, bestIndivSpec[feat].type, bestIndivSpec[feat].params).values;
    indivTxCols[feat] = txRaw.map((v, i) => (xCol[i] == null ? null : (isFinite(v) ? v : null)));
  }

  const bestCoSpec   = {}; // `feat1__feat2` → { type, r2ByDv }
  const qualFeatList = Object.keys(bestIndivSpec);

  for (let fi = 0; fi < qualFeatList.length; fi++) {
    for (let fj = fi + 1; fj < qualFeatList.length; fj++) {
      const f1 = qualFeatList[fi];
      const f2 = qualFeatList[fj];
      const tx1 = indivTxCols[f1];
      const tx2 = indivTxCols[f2];

      // Baseline per DV = max of the two features' individual R² for that DV
      const baselineByDv = {};
      for (const dv of depVars) {
        baselineByDv[dv] = Math.max(
          bestIndivSpec[f1].r2ByDv[dv] || 0,
          bestIndivSpec[f2].r2ByDv[dv] || 0,
        );
      }

      let bestCoType = null, bestCoAvgGain = 0;
      for (const coType of ['multiply', 'divide']) {
        // Build co-transformed column (null wherever either input is null)
        const coCol = tx1.map((v1, i) => {
          const v2 = tx2[i];
          if (v1 == null || v2 == null) return null;
          const r = coType === 'multiply' ? v1 * v2 : v1 / (Math.abs(v2) + EPS);
          return isFinite(r) ? r : null;
        });
        // Apply asympScale to the non-null values, then put them back
        const nonNull = coCol.filter(v => v != null);
        if (nonNull.length < 3) continue;
        const scaled  = asympScale(nonNull);
        let si = 0;
        const coColScaled = coCol.map(v => v == null ? null : scaled[si++]);

        let gainSum = 0, gainCount = 0;
        for (const dv of depVars) {
          const yCol  = getNumCol(trainData, dv);
          const { xv, yv } = jointPair(coColScaled, yCol);
          if (xv.length < 3) continue;
          const r2   = pearsonR2(xv, yv);
          const gain = r2 - (baselineByDv[dv] || 0);
          if (gain > 0) gainSum += gain;
          gainCount++;
        }
        const avg = gainCount ? gainSum / gainCount : 0;
        if (avg > bestCoAvgGain) { bestCoAvgGain = avg; bestCoType = coType; }
      }

      if (bestCoType && bestCoAvgGain > 0) {
        const coCol = tx1.map((v1, i) => {
          const v2 = tx2[i];
          if (v1 == null || v2 == null) return null;
          const r = bestCoType === 'multiply' ? v1 * v2 : v1 / (Math.abs(v2) + EPS);
          return isFinite(r) ? r : null;
        });
        const nonNull = coCol.filter(v => v != null);
        const scaled  = asympScale(nonNull);
        let si = 0;
        const coColScaled = coCol.map(v => v == null ? null : scaled[si++]);

        const r2ByDv  = {};
        let   anyBetter = false;
        for (const dv of depVars) {
          const yCol = getNumCol(trainData, dv);
          const { xv, yv } = jointPair(coColScaled, yCol);
          if (xv.length < 3) continue;
          r2ByDv[dv] = pearsonR2(xv, yv);
          if (r2ByDv[dv] > (baselineByDv[dv] || 0)) anyBetter = true;
        }
        if (anyBetter) {
          bestCoSpec[`${f1}__${f2}`] = { f1, f2, type: bestCoType, r2ByDv };
        }
      }
    }
  }

  // ── Build output rows ─────────────────────────────────────────────────────
  const out = buildOutput(data, indepSrc, bestIndivSpec, bestCoSpec);
  if (out.length) setHeaders(Object.keys(out[0]).filter(k => !k.startsWith('_')));

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
        name:       saveName,
        depVars,
        features:   indepSrc,
        indivSpecs: bestIndivSpec,
        coSpecs:    bestCoSpec,
        updated:    new Date().toISOString(),
        trainRows:  trainData,
      },
    };
    setFeRegistry?.(updatedReg);
  }

  return {
    data: out, _rows: out,
    _feIndivSpecs: bestIndivSpec,
    _feCoSpecs:    bestCoSpec,
  };
}

// ── Apply stored FE specs to new data ─────────────────────────────────────────
function applyStoredFE(data, stored, setHeaders) {
  const out = buildOutput(data, stored.features || [], stored.indivSpecs || {}, stored.coSpecs || {});
  if (out.length) setHeaders(Object.keys(out[0]).filter(k => !k.startsWith('_')));
  return { data: out, _rows: out };
}

// ── Build output rows from specs ──────────────────────────────────────────────
function buildOutput(data, indepSrc, indivSpecs, coSpecs) {
  // Pre-compute transform values for every feature in indivSpecs
  const tColsMap = {}; // feat → transformed values array (length = data.length)
  for (const feat of indepSrc) {
    if (!indivSpecs[feat]) continue;
    const xAll  = data.map(r => { const v = Number(r[feat]); return isNaN(v) ? null : v; });
    // For rows with null, use 0 for transform (will be sanitized)
    const xFill = xAll.map(v => v ?? 0);
    const spec  = indivSpecs[feat];
    tColsMap[feat] = sanitize(applyTransform(xFill, spec.type, spec.params || {}).values);
  }

  // Co-transform values
  const coColsMap = {};
  for (const [key, coSpec] of Object.entries(coSpecs)) {
    const { f1, f2, type } = coSpec;
    const a = tColsMap[f1];
    const b = tColsMap[f2];
    if (!a || !b) continue;
    coColsMap[key] = coTransform(a, b, type);
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
