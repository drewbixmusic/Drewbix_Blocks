// ══════════════════════════════════════════════════════════════════════════════
// Feature Engineering Transforms
// Pass 1: individual transforms. Pass 2: co-transforms. Co-corr (Pearson between
// feature vectors >= thresh) + second co-corr on selected. Final cap: nBase × mult.
// All R² uses Pearson correlation squared. RSQ drop: <= threshold; co-corr: >= threshold.
// No per-feature limits; co-correlation handles redundancy.
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

// ── Set / band partitioning (mirrors MV/RF) ───────────────────────────────────
function parseModGroups(data, keyField, modSep) {
  const groups = new Map();
  data.forEach((row, i) => {
    const key = String(row[keyField] ?? '');
    const sepIdx = key.lastIndexOf(modSep);
    const mod = (sepIdx >= 0 && sepIdx < key.length - 1)
      ? key.slice(sepIdx + modSep.length)
      : '__none__';
    if (!groups.has(mod)) groups.set(mod, []);
    groups.get(mod).push(i);
  });
  return groups;
}

function buildSetRowIndices(modGroups) {
  const realMods = [...modGroups.keys()].filter(m => m !== '__none__');
  return realMods.map(mod => modGroups.get(mod));
}

function buildBandRowIndices(data, xField, nBands) {
  const sorted = Array.from({ length: data.length }, (_, i) => i)
    .sort((a, b) => Number(data[a][xField] || 0) - Number(data[b][xField] || 0));
  const bandSize = Math.max(1, Math.ceil(sorted.length / nBands));
  const bands = [];
  for (let bi = 0; bi < nBands; bi++) {
    const chunk = sorted.slice(bi * bandSize, (bi + 1) * bandSize);
    if (chunk.length > 0) bands.push(chunk);
  }
  return bands;
}

// Compute per-set R², average across sets. setRows = [rowIdx[], ...] per set/band.
function computeBaseR2BySet(getNumCol, trainData, depVars, indepSrc, setRows, jointPair) {
  const dvYCols = {};
  for (const dv of depVars) dvYCols[dv] = getNumCol(trainData, dv);

  const allBaseR2ByFeat = {};
  for (const feat of indepSrc) {
    const xCol = getNumCol(trainData, feat);
    if (xCol.filter(v => v != null).length < 3) continue;

    const r2BySetByDv = {};
    for (const dv of depVars) r2BySetByDv[dv] = [];

    for (let si = 0; si < setRows.length; si++) {
      const idxs = setRows[si];
      const subX = idxs.map(i => xCol[i]);
      for (const dv of depVars) {
        const subY = idxs.map(i => dvYCols[dv][i]);
        const { xv, yv } = jointPair(subX, subY);
        if (xv.length < 3) continue;
        r2BySetByDv[dv].push(pearsonR2(xv, yv));
      }
    }

    const baseR2ByDv = {};
    for (const dv of depVars) {
      const vals = r2BySetByDv[dv];
      if (vals && vals.length) baseR2ByDv[dv] = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    if (Object.keys(baseR2ByDv).length) allBaseR2ByFeat[feat] = { baseR2ByDv, r2BySetByDv };
  }
  return allBaseR2ByFeat;
}

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

  const modelName       = (cfg.model_name || '').trim();
  const modelMode       = cfg.model_mode || 'New';
  const keyField        = (cfg.key_field || 'symbol').trim();
  const modSep          = (cfg.key_modifier ?? '_').trim() || '_';
  const foldSource      = cfg.fold_source || 'By Sets';
  const fallbackXField  = (cfg.fallback_x_field || 't_rel').trim();
  const fallbackBands   = parseInt(cfg.fallback_bands || '10');
  const rsqMode         = cfg.rsq_mode || 'Aggregate';
  const dropBelowThresh = cfg.drop_below_thresh === true || cfg.drop_below_thresh === 'true';
  const rsqThreshold    = parseFloat(cfg.rsq_threshold || '0');
  const maxMult         = parseFloat(cfg.max_transforms_mult || '1.00');
  // Protected features: dynamic features where the base value is ALWAYS passed through
  // in addition to any winning individual transform. The protection simply prevents the
  // base column from being suppressed when a transform wins the solo slot.
  // Co-transforms use the best available column (base or transform) as usual.
  // Supports both array (multidynfield) and legacy comma-separated string formats.
  const rawProtected = cfg.protected_feats;
  const protectedFeats = new Set(
    Array.isArray(rawProtected)
      ? rawProtected.filter(Boolean)
      : (typeof rawProtected === 'string' ? rawProtected.split(',').map(s => s.trim()).filter(Boolean) : [])
  );
  const registry      = feRegistry || {};

  // ── Stored mode: replay exact transforms from saved spec ─────────────────
  if (modelMode === 'Stored') {
    const stored = modelName ? registry[modelName] : null;
    if (!stored) return { data, _rows: data, error: `No stored FE model named "${modelName}".` };
    try {
      // Pass current cfg's protectedFeats so user can add/change protections after storing
      return applyStoredFE(data, stored, setHeaders, openTable, protectedFeats);
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

  // ── Build set/band row partition (for Set/Band RSQ mode) ──────────────────
  let setRows = null;
  if (rsqMode === 'Set/Band') {
    const modGroups = parseModGroups(trainData, keyField, modSep);
    const realMods = [...modGroups.keys()].filter(m => m !== '__none__');
    if (foldSource === 'Stratify All' || realMods.length < 2) {
      setRows = buildBandRowIndices(trainData, fallbackXField, fallbackBands);
    } else {
      setRows = buildSetRowIndices(modGroups);
    }
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
  const baseR2BySetByFeat = {}; // feat -> { dv -> [r2 per set] } for threshold check

  if (setRows && setRows.length >= 2) {
    const setResult = computeBaseR2BySet(getNumCol, trainData, depVars, indepSrc, setRows, jointPair);
    for (const [feat, rec] of Object.entries(setResult)) {
      allBaseR2ByFeat[feat] = rec.baseR2ByDv;
      baseR2BySetByFeat[feat] = rec.r2BySetByDv;
    }
  }

  // ── Threshold filter: drop features with R² <= threshold (any set or dv)
  let indepFiltered = indepSrc;
  if (dropBelowThresh && rsqThreshold >= 0) {
    indepFiltered = indepSrc.filter(feat => {
      const bySet = baseR2BySetByFeat[feat];
      const byDv = allBaseR2ByFeat[feat];
      if (!byDv) return false;
      if (bySet) {
        for (const dv of depVars) {
          const vals = bySet[dv] || [];
          if (vals.some(r => r <= rsqThreshold)) return false;
        }
      } else {
        for (const dv of depVars) {
          if ((byDv[dv] ?? -1) <= rsqThreshold) return false;
        }
      }
      return true;
    });
  }

  const corrDropThresh = (!cfg.corr_drop || cfg.corr_drop === 'Off')
    ? null : parseFloat(cfg.corr_drop);
  const nBase = indepFiltered.length;
  const maxFeatures = Math.max(1, Math.round(nBase * maxMult));

  for (const feat of indepFiltered) {
    if (allBaseR2ByFeat[feat]) continue; // already filled by set mode

    const xCol = getNumCol(trainData, feat);
    if (xCol.filter(v => v != null).length < 3) continue;

    const baseR2ByDv = {};
    for (const dv of depVars) {
      const { xv, yv } = jointPair(xCol, dvYCols[dv]);
      if (xv.length < 3) continue;
      baseR2ByDv[dv] = pearsonR2(xv, yv);
    }
    if (!Object.keys(baseR2ByDv).length) continue;
    allBaseR2ByFeat[feat] = baseR2ByDv;
    currentIndivR2[feat]  = { _base: baseR2ByDv };
    currentTxParams[feat] = {};

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

  // ── Build candidate column pool for Pass 2 ───────────────────────────────
  // Each feature contributes up to 2 candidates: base col + best transform col.
  // featureCols[feat] = { base: number[]|null, tx: number[]|null, txR2: {dv→r2} }
  const featureCols = {};
  for (const feat of indepFiltered) {
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

  // Keep all co-transforms; final cap will select top by R² (no per-feature limits)
  const bestCoSpec = {};
  for (const cand of allCoCandidates) {
    bestCoSpec[`${cand.f1}__${cand.f2}`] = { f1: cand.f1, f2: cand.f2, type: cand.type, r2ByDv: cand.r2ByDv };
  }

  // ── Co-correlation drop: Pearson R² between *feature column vectors* >= thresh → drop lower-R²
  const indivTxCols = {};
  for (const feat of Object.keys(bestIndivSpec)) {
    if (staticFeats.has(feat)) continue;
    const fc = featureCols[feat];
    if (fc?.tx) indivTxCols[feat] = fc.tx;
  }
  let droppedBaseFeats = new Set();

  if (corrDropThresh !== null) {
    const txEntries = [];
    for (const feat of indepFiltered) {
      if (staticFeats.has(feat)) continue;
      const baseCol = featureCols[feat]?.base;
      const indivCol = indivTxCols[feat];
      const baseAvg = allBaseR2ByFeat[feat] ? Object.values(allBaseR2ByFeat[feat]).reduce((s,v)=>s+v,0)/Object.values(allBaseR2ByFeat[feat]).length : 0;
      const indivAvg = bestIndivSpec[feat] ? Object.values(bestIndivSpec[feat].r2ByDv).reduce((s,v)=>s+v,0)/Object.values(bestIndivSpec[feat].r2ByDv).length : 0;
      if (indivCol && indivAvg >= baseAvg) {
        const vals = Object.values(bestIndivSpec[feat].r2ByDv).filter(v => v != null && isFinite(v));
        txEntries.push({ kind: 'indiv', feat, avgRsq: vals.length ? vals.reduce((s,v)=>s+v,0)/vals.length : 0, col: indivCol });
      } else if (baseCol) {
        txEntries.push({ kind: 'base', feat, avgRsq: baseAvg, col: baseCol });
      }
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
      else if (entry.kind === 'base') droppedBaseFeats.add(entry.feat);
      else delete bestCoSpec[entry.pairKey];
    }
  }

  // ── Final selection: global cap nBase × multiplier, no per-feature limits ─────
  // Collect ALL candidates (base, indiv xform, co-xform), sort by avg R², take top maxFeatures.
  const allCandidates = [];
  for (const feat of indepFiltered) {
    if (staticFeats.has(feat)) continue;
    const isProtected = protectedFeats.has(feat);
    const hasIndiv = !!bestIndivSpec[feat];
    const baseAvgR2 = allBaseR2ByFeat[feat]
      ? Object.values(allBaseR2ByFeat[feat]).reduce((s,v)=>s+v,0)/Object.values(allBaseR2ByFeat[feat]).length
      : 0;
    const indivAvgR2 = hasIndiv
      ? Object.values(bestIndivSpec[feat].r2ByDv).reduce((s,v)=>s+v,0)/Object.values(bestIndivSpec[feat].r2ByDv).length
      : 0;
    if (isProtected) {
      if (!droppedBaseFeats.has(feat)) allCandidates.push({ kind: 'base', feat, avgR2: baseAvgR2 });
      if (hasIndiv && indivAvgR2 > baseAvgR2)
        allCandidates.push({ kind: 'indiv', feat, avgR2: indivAvgR2 });
    } else if (hasIndiv && indivAvgR2 >= baseAvgR2) {
      allCandidates.push({ kind: 'indiv', feat, avgR2: indivAvgR2 });
    } else if (!droppedBaseFeats.has(feat)) {
      allCandidates.push({ kind: 'base', feat, avgR2: baseAvgR2 });
    }
  }
  for (const [pairKey, spec] of Object.entries(bestCoSpec)) {
    const avgR2 = Object.values(spec.r2ByDv).filter(v => v != null).reduce((s,v,_,a)=>s+v/a.length,0);
    allCandidates.push({ kind: 'co', pairKey, avgR2 });
  }
  allCandidates.sort((a, b) => (b.avgR2 ?? 0) - (a.avgR2 ?? 0));
  let selected = allCandidates.slice(0, maxFeatures);

  // Second co-correlation pass on selected (Pearson between feature vectors >= thresh → drop lower-R²)
  if (corrDropThresh !== null && selected.length > 1) {
    const getCol = (c) => {
      if (c.kind === 'base') return featureCols[c.feat]?.base;
      if (c.kind === 'indiv') return indivTxCols[c.feat];
      if (c.kind === 'co') {
        const spec = bestCoSpec[c.pairKey];
        if (!spec) return null;
        const fc1 = featureCols[spec.f1], fc2 = featureCols[spec.f2];
        const a = fc1?.tx || fc1?.base, b = fc2?.tx || fc2?.base;
        if (!a || !b) return null;
        const raw = a.map((v1, i) => {
          const v2 = b[i];
          if (v1 == null || v2 == null) return null;
          const r = spec.type === 'multiply' ? v1 * v2 : v1 / (Math.abs(v2) + EPS);
          return isFinite(r) ? r : null;
        });
        const nonNull = raw.filter(v => v != null);
        if (nonNull.length < 3) return null;
        const sc = asympScale(nonNull); let si = 0;
        return raw.map(v => v == null ? null : sc[si++]);
      }
      return null;
    };
    const selWithCols = selected.map(c => ({ c, col: getCol(c) })).filter(x => x.col != null);
    const toDrop = new Set();
    for (let i = 0; i < selWithCols.length; i++) {
      if (toDrop.has(i)) continue;
      for (let j = i + 1; j < selWithCols.length; j++) {
        if (toDrop.has(j)) continue;
        const pairs = selWithCols[i].col.map((v, idx) => [v, selWithCols[j].col[idx]])
          .filter(([a, b]) => a != null && b != null);
        if (pairs.length < 3) continue;
        const absR = Math.sqrt(pearsonR2(pairs.map(([a])=>a), pairs.map(([,b])=>b)));
        if (absR >= corrDropThresh) toDrop.add(j);
      }
    }
    const droppedCs = new Set([...toDrop].map(i => selWithCols[i].c));
    selected = selected.filter(c => !droppedCs.has(c));
  }

  const emittedIndivCols = new Set();
  const emittedBaseCols = new Set();
  const emittedCoPairKeys = new Set();
  for (const c of selected) {
    if (c.kind === 'base') emittedBaseCols.add(c.feat);
    else if (c.kind === 'indiv') emittedIndivCols.add(c.feat);
    else if (c.kind === 'co') emittedCoPairKeys.add(c.pairKey);
  }

  // ── Build output rows ──────────────────────────────────────────────────────
  const out = buildOutputFinal(
    data, indepFiltered, bestIndivSpec, bestCoSpec,
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
      if (allBaseR2ByFeat[cn]) {
        colAvgR2[cn] = Object.values(allBaseR2ByFeat[cn]).reduce((s,v)=>s+v,0)/Object.values(allBaseR2ByFeat[cn]).length;
      }
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

  // ── Winner-only RSQ (passed features only, for table + downstream RF/MV) ─────
  const outputCols = finalOut.length ? new Set(Object.keys(finalOut[0]).filter(k=>!k.startsWith('_'))) : new Set();
  const feRsqRows = [];
  for (const feat of indepFiltered) {
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
  const passedRsqRows = feRsqRows.filter(r => outputCols.has(r.independent_variable || ''));
  passedRsqRows.sort((a, b) => (b.Net_RSQ ?? -1) - (a.Net_RSQ ?? -1));
  passedRsqRows.forEach((r, i) => { r.rank = i + 1; });

  if (passedRsqRows.length) {
    const runsLabel = newCount > 1 ? ` (${newCount} runs)` : '';
    const rsqTitle  = modelName ? `FE RSQ: ${modelName}${runsLabel}` : 'Feature Eng. RSQ';
    openTable?.({ nodeId: node.id + '_rsq', rows: passedRsqRows, title: rsqTitle });
  }

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
        name: saveName, depVars, features: indepFiltered, mergeCount: newCount,
        indivHistory: updatedIndivHist, coHistory: updatedCoHist,
        indivSpecs: bestIndivSpec, coSpecs: bestCoSpec,
        staticFeats: [...staticFeats], protectedFeats: [...protectedFeats], keyField,
        updated: new Date().toISOString(),
      },
    };
    setFeRegistry?.(updatedReg);
  }

  // Build features output: feature names + values (passed columns from finalOut)
  const featNames = passedRsqRows.map(r => r.independent_variable).filter(Boolean);
  const featuresRows = finalOut.map(r => {
    const row = {};
    featNames.forEach(f => { row[f] = r[f]; });
    return row;
  });

  // Build targets output: target names + values
  const targetsRows = finalOut.map(r => {
    const row = {};
    depVars.forEach(d => { row[d] = r[d]; });
    return row;
  });

  return {
    passthru: finalOut,
    features: { _headers: featNames, _rows: featuresRows, feRsqRows: passedRsqRows },
    targets:  { _headers: depVars, _rows: targetsRows },
    data: finalOut,
    _rows: finalOut,
    rsq:    passedRsqRows,
    fe_rsq: passedRsqRows,
    _feIndivSpecs: bestIndivSpec,
    _feCoSpecs:    bestCoSpec,
  };
}

// ── Apply stored FE specs to new data ─────────────────────────────────────────
function applyStoredFE(data, stored, setHeaders, openTable, overrideProtectedFeats) {
  const indepSrc       = stored.features || [];
  const indivSpecs     = stored.indivSpecs || {};
  const coSpecs        = stored.coSpecs   || {};
  const keyField       = stored.keyField  || 'symbol';
  const staticFeatsArr = stored.staticFeats || [];
  const staticFeats    = new Set(staticFeatsArr);
  // Use current cfg's protectedFeats if provided (overrides stored) — allows user to
  // add/change protected features after the model was stored without needing to retrain.
  const protectedFeats = overrideProtectedFeats instanceof Set && overrideProtectedFeats.size > 0
    ? overrideProtectedFeats
    : new Set(stored.protectedFeats || []);

  // Re-derive emission sets from stored specs so buildOutputFinal knows what to emit.
  // Re-derive emission sets from stored specs so buildOutputFinal knows what to emit.
  // Protected dynamic features emit BOTH base and transform (if a transform exists).
  // Unprotected: only the winning transform OR base (whichever won at training time).
  const emittedIndivCols  = new Set(
    Object.keys(indivSpecs).filter(f => !staticFeats.has(f))
  );
  const emittedCoPairKeys = new Set(Object.keys(coSpecs));
  const emittedBaseCols   = new Set(
    indepSrc.filter(f => !staticFeats.has(f) && (!emittedIndivCols.has(f) || protectedFeats.has(f)))
  );

  const out = buildOutputFinal(
    data, indepSrc, indivSpecs, coSpecs,
    staticFeats, emittedIndivCols, emittedBaseCols, emittedCoPairKeys, keyField
  );
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
    // Passed features only: filter to columns actually in output
    const outputCols = out.length ? new Set(Object.keys(out[0]).filter(k => !k.startsWith('_'))) : new Set();
    const winnerRows = rows.filter(r => outputCols.has(r.independent_variable || ''));
    if (winnerRows.length) {
      const n = stored.mergeCount || 1;
      openTable?.({ nodeId: `stored_fe_rsq_${stored.name}`, rows: winnerRows, title: `FE RSQ: ${stored.name} (${n} run${n > 1 ? 's' : ''})` });
    }
    const featNames = winnerRows.map(r => r.independent_variable).filter(Boolean);
    const featuresRows = out.map(r => { const row = {}; featNames.forEach(f => { row[f] = r[f]; }); return row; });
    const targetsRows = out.map(r => { const row = {}; dvs.forEach(d => { row[d] = r[d]; }); return row; });
    return {
      data: out, _rows: out, passthru: out,
      features: { _headers: featNames, _rows: featuresRows, feRsqRows: winnerRows },
      targets:  { _headers: dvs, _rows: targetsRows },
      rsq: winnerRows, fe_rsq: winnerRows,
    };
  }
  return { data: out, _rows: out, passthru: out, features: { _rows: [] }, targets: { _rows: [] }, rsq: [], fe_rsq: [] };
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

    // Remove dynamic base columns that have a better individual transform,
    // UNLESS they are also in emittedBaseCols (protected features stay in both sets)
    for (const feat of emittedIndivCols) {
      if (!emittedBaseCols.has(feat)) delete row[feat]; // base col replaced by transform col
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
