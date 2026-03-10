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

function parseComboLabelForCol(lab) {
  if (!lab) return ['base', 'base'];
  if (lab === 'base_base') return ['base', 'base'];
  if (lab.startsWith('base_')) return ['base', lab.slice(6)];
  if (lab.endsWith('_base')) return [lab.slice(0, -5), 'base'];
  for (const t of SINGLE_TRANSFORMS) {
    if (lab.startsWith(t + '_')) return [t, lab.slice(t.length + 1)];
  }
  return lab.split('_');
}

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

  // Resolve dep/indep/modifiers from cfg.fe.
  const parseVarList = (arr) => (arr || [])
    .filter(item => item && (typeof item === 'string' ? true : item.enabled !== false))
    .map(item => (typeof item === 'string' ? item : item.name))
    .filter(Boolean);
  const parseModifierList = (arr) => (arr || [])
    .filter(Boolean)
    .map(m => (typeof m === 'string' ? m : m?.name))
    .filter(Boolean);

  const depVars   = parseVarList(cfg.fe?.dep);
  const modifiers = parseModifierList(cfg.fe?.modifiers);
  let indepSrc   = parseVarList(cfg.fe?.indep);
  indepSrc = indepSrc.filter(f => !depVars.includes(f) && !modifiers.includes(f));

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
  const pilotFeatSampleCfg = cfg.pilot_feat_sample || '6';
  const pilotFeatSample = pilotFeatSampleCfg === 'All' ? Infinity : parseInt(pilotFeatSampleCfg);
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

  // No early drop: check ALL features and modifiers. RSQ threshold applies only
  // AFTER all transforms are generated (at selection time).
  const indepFiltered = indepSrc;

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

  // ── Pre-pilot pruning: drop low-value features and non-improving transforms ──
  // Done here, after all R² is scored, before any pilot or pool work.
  //
  // Rule 1 — Base feature threshold:
  //   If dropBelowThresh is enabled AND a feature's avg base R² < rsqThreshold,
  //   drop it entirely (no standalone indiv, no co-transform partner).
  //   Protected features always survive regardless.
  //   Features that fail this check are still usable as co-transform *partners*
  //   by features that DO pass — they just can't anchor a standalone column.
  //   → pilotDropFeats: features too weak to be anchors or standalone candidates.
  //
  // Rule 2 — Transform improvement gate:
  //   For each surviving feature, keep only transforms whose avg R² > base avg R².
  //   Transforms that don't beat base are pruned from currentIndivR2/currentTxParams
  //   so they never enter the pilot matrix or the full rolling loop as transforms.
  //   (They've already been scored — this just removes them from future consideration.)

  const pilotDropFeats = new Set(); // features dropped from standalone + anchor roles
  const avgR2 = (r2ByDv) => {
    const vals = Object.values(r2ByDv || {}).filter(v => v != null && isFinite(v));
    return vals.length ? vals.reduce((s,v)=>s+v,0)/vals.length : 0;
  };

  for (const feat of indepSrc) {
    const baseR2 = avgR2(allBaseR2ByFeat[feat] || currentIndivR2[feat]?.['_base'] || {});

    // Rule 1: drop base features below threshold (unless protected)
    if (dropBelowThresh && rsqThreshold > 0 && baseR2 < rsqThreshold && !protectedFeats.has(feat)) {
      pilotDropFeats.add(feat);
      continue; // no point pruning transforms for a dropped feature
    }

    // Rule 2: prune transforms that don't improve on base R²
    if (currentIndivR2[feat]) {
      for (const tType of SINGLE_TRANSFORMS) {
        if (!currentIndivR2[feat][tType]) continue;
        const txR2 = avgR2(currentIndivR2[feat][tType]);
        if (txR2 <= baseR2) {
          delete currentIndivR2[feat][tType];
          delete currentTxParams[feat][tType];
        }
      }
    }
  }

  // ── Pilot Phase: screen which transforms are useful in co-transforms ─────────
  // Goal: reduce the co-transform search space before the full rolling loop.
  // Only features that survived pre-pilot pruning act as anchors or standalone
  // indiv candidates. Dropped features can still appear as co-transform partners
  // (b-side) since they may have interaction value even without individual signal.
  // Transforms that don't improve base are already pruned from currentIndivR2,
  // so they won't appear on either side of the pilot matrix.
  //
  // Method:
  //  1. Select up to pilotFeatSample anchor features (surviving, top R² descending).
  //  2. For each anchor × every other surviving feature × anchor labels × other labels:
  //     compute pilotGainTStat (per-set weighted mean gain / weighted SE).
  //     t > 0 means consistently beats base×base more often than not across sets.
  //  3. A transform label is "useful in co" if its t > 0 in at least one pilot pairing.
  //     Otherwise block it from co slots in the full rolling loop.

  // Track which tx labels were ever useful in a co-transform in the pilot
  // coTxUseful[feat][label] = true if that label (for feat's side) ever helped
  const coTxUseful = {};
  const modCoTxUseful = {}; // modCoTxUseful[mod][label] = true

  // Select anchor features: surviving (not pilotDropFeats), non-static, top R², up to pilotFeatSample
  const sortedByBaseR2 = indepSrc
    .filter(f => !staticFeats.has(f) && allBaseR2ByFeat[f] && !pilotDropFeats.has(f))
    .sort((a, b) => avgR2(allBaseR2ByFeat[b]) - avgR2(allBaseR2ByFeat[a]));
  const anchorFeats = sortedByBaseR2.slice(0, Math.min(sortedByBaseR2.length, pilotFeatSample));

  // ── Pilot scoring helpers ─────────────────────────────────────────────────
  // Score a raw co-transform column (product of colA × colB, already multiplied)
  // against all depVars, returning mean R² across depVars for a given row index set.
  const scoreCoSegment = (rawCol, idxs) => {
    const subX = idxs.map(i => rawCol[i]);
    const nonNull = subX.filter(v => v != null);
    if (nonNull.length < 3) return null;
    const scaled = asympScale(nonNull); let si = 0;
    const subXScaled = subX.map(v => v == null ? null : scaled[si++]);
    let sum = 0, cnt = 0;
    for (const dv of depVars) {
      const subY = idxs.map(i => dvYCols[dv][i]);
      const { xv, yv } = jointPair(subXScaled, subY);
      if (xv.length >= 3) { sum += pearsonR2(xv, yv); cnt++; }
    }
    return cnt ? sum / cnt : null;
  };

  // Build the raw co-column (multiply) from two pre-computed feature columns.
  const buildCoRaw = (colA, colB) =>
    colA.map((v1, i) => {
      const v2 = colB[i];
      return (v1 == null || v2 == null) ? null : v1 * v2;
    });

  // Compute a consistency-weighted gain t-statistic for colA×colB vs baseACol×baseBCol.
  // Returns a signed value: positive = combo consistently beats base×base across sets.
  // When sets are available: weighted-mean gain / weighted-SE (inverse-variance by set size).
  // When no sets: simple aggregate gain (coR2 - baseR2), treated as a single "set".
  const pilotGainTStat = (colA, colB, baseACol, baseBCol) => {
    const rawCo   = buildCoRaw(colA, colB);
    const rawBase = buildCoRaw(baseACol, baseBCol);

    if (!setRows || setRows.length < 2) {
      // Aggregate fallback: single sample, no set consistency
      const allIdxs = Array.from({ length: trainData.length }, (_, i) => i);
      const coR2   = scoreCoSegment(rawCo,   allIdxs) ?? 0;
      const baseR2 = scoreCoSegment(rawBase, allIdxs) ?? 0;
      return coR2 - baseR2; // positive = better than base
    }

    // Per-set gains, weighted by set size (inverse-variance weighting proxy)
    const gains = [];
    const weights = [];
    for (const idxs of setRows) {
      if (idxs.length < 3) continue;
      const coR2   = scoreCoSegment(rawCo,   idxs);
      const baseR2 = scoreCoSegment(rawBase, idxs);
      if (coR2 == null || baseR2 == null) continue;
      gains.push(coR2 - baseR2);
      weights.push(idxs.length); // weight = set size
    }
    if (gains.length < 1) return 0;
    if (gains.length === 1) return gains[0]; // single set: no consistency info, use raw gain

    const wSum = weights.reduce((s, w) => s + w, 0);
    const wMean = gains.reduce((s, g, i) => s + g * weights[i], 0) / wSum;

    // Weighted variance of gains
    const wVar = gains.reduce((s, g, i) => s + weights[i] * (g - wMean) ** 2, 0) / wSum;
    const wStd = Math.sqrt(wVar);
    if (wStd < 1e-9) return wMean > 0 ? Infinity : (wMean < 0 ? -Infinity : 0);

    // t = weighted_mean / (weighted_std / sqrt(n_sets))
    // Positive t > 0: consistently beats base×base more often than not across sets
    return wMean / (wStd / Math.sqrt(gains.length));
  };

  if (anchorFeats.length > 0) {
    const getRawTxCol = (feat, label) => {
      if (label === 'base') return getNumCol(trainData, feat);
      const xCol = getNumCol(trainData, feat);
      const params = currentTxParams[feat]?.[label] || {};
      const xFill = xCol.map(v => v ?? 0);
      const res = applyTransform(xFill, label, params);
      if (!res.values || res.values.length !== xCol.length) return null;
      return res.values.map((v, i) => (xCol[i] == null ? null : (isFinite(v) ? v : null)));
    };
    const getModRawTxCol = (mod, label) => {
      const xCol = getNumCol(trainData, mod);
      if (label === 'base') return xCol;
      const xFill = xCol.map(v => v ?? 0);
      const res = applyTransform(xFill, label, {});
      if (!res.values || res.values.length !== xCol.length) return null;
      return res.values.map((v, i) => (xCol[i] == null ? null : (isFinite(v) ? v : null)));
    };

    // For each anchor × all other surviving features
    for (const anchor of anchorFeats) {
      const anchorBaseCol = getNumCol(trainData, anchor);

      // Anchor label side: base + transforms that survived pre-pilot pruning (improve on base)
      const anchorTxLabels = Object.keys(currentIndivR2[anchor] || {}).filter(k => k !== '_base');
      const anchorLabels = ['base', ...anchorTxLabels];

      for (const aLab of anchorLabels) {
        const aCol = getRawTxCol(anchor, aLab);
        if (!aCol) continue;

        for (const other of indepSrc) {
          if (other === anchor || staticFeats.has(other) || pilotDropFeats.has(other)) continue;
          if (!coTxUseful[other]) coTxUseful[other] = {};
          const otherBaseCol = getNumCol(trainData, other);

          // Other side: base + transforms that survived pre-pilot pruning for this feature
          const otherTxLabels = Object.keys(currentIndivR2[other] || {}).filter(k => k !== '_base');
          const otherLabels = ['base', ...otherTxLabels];
          for (const bLab of otherLabels) {
            const bCol = bLab === 'base' ? otherBaseCol : getRawTxCol(other, bLab);
            if (!bCol) continue;
            // t > 0: this combo consistently beats anchor_base × other_base across sets
            const t = pilotGainTStat(aCol, bCol, anchorBaseCol, otherBaseCol);
            if (t > 0) {
              if (aLab !== 'base') {
                if (!coTxUseful[anchor]) coTxUseful[anchor] = {};
                coTxUseful[anchor][aLab] = true;
              }
              if (bLab !== 'base') coTxUseful[other][bLab] = true;
            }
          }
        }

        // Anchor × modifiers (modifiers aren't pre-pruned; pilot handles them)
        for (const mod of modifiers) {
          if (!modCoTxUseful[mod]) modCoTxUseful[mod] = {};
          const modBaseCol = getNumCol(trainData, mod);
          const modLabels = ['base', ...SINGLE_TRANSFORMS];
          for (const bLab of modLabels) {
            const bCol = getModRawTxCol(mod, bLab);
            if (!bCol) continue;
            const t = pilotGainTStat(aCol, bCol, anchorBaseCol, modBaseCol);
            if (t > 0) {
              if (aLab !== 'base') {
                if (!coTxUseful[anchor]) coTxUseful[anchor] = {};
                coTxUseful[anchor][aLab] = true;
              }
              if (bLab !== 'base') modCoTxUseful[mod][bLab] = true;
              else modCoTxUseful[mod]['_base_useful'] = true;
            }
          }
        }
      }
    }
  }

  // Derive blocked sets:
  // blockedTxForCo[feat] = Set of transform types to skip on the co-transform (b-side) of feat.
  // A transform is blocked from co if: it didn't survive pre-pilot pruning (i.e., doesn't improve
  // base individually) OR it survived pruning but showed no co-transform gain in the pilot (t ≤ 0).
  // Transforms that survive pruning AND show co gain remain eligible on both sides.
  const blockedTxForCo = {};
  for (const feat of indepSrc) {
    blockedTxForCo[feat] = new Set();
    if (anchorFeats.length > 0 && pilotFeatSample !== Infinity) {
      for (const tType of SINGLE_TRANSFORMS) {
        const survivedPruning = !!(currentIndivR2[feat]?.[tType]);
        const coUseful = coTxUseful[feat]?.[tType] === true;
        // Block if: didn't improve base (pruned) OR survived but never helped co-transforms
        if (!survivedPruning || !coUseful) blockedTxForCo[feat].add(tType);
      }
    }
  }

  // blockedModifiers: modifiers with no useful co-transform signal in pilot
  const blockedModifiers = new Set();
  if (anchorFeats.length > 0 && pilotFeatSample !== Infinity) {
    for (const mod of modifiers) {
      const hasAnyUse = modCoTxUseful[mod]?.['_base_useful'] ||
        Object.keys(modCoTxUseful[mod] || {}).some(k => modCoTxUseful[mod][k] && k !== '_base_useful');
      if (!hasAnyUse) blockedModifiers.add(mod);
    }
  }

  // ── Build column pools: base + surviving transforms for features and modifiers ─
  // For features: only builds columns for transforms that survived pre-pilot pruning
  // (i.e., exist in currentTxParams after non-improving transforms were deleted).
  // Dropped features (pilotDropFeats) still get a pool entry so they can serve as
  // b-side co-transform partners for stronger features.
  const featureCols = {};
  for (const feat of indepFiltered) {
    const xCol = getNumCol(trainData, feat);
    if (xCol.filter(v => v != null).length < 3) continue;
    const transforms = {};
    // Only build columns for transforms that survived pre-pilot pruning
    for (const tType of Object.keys(currentTxParams[feat] || {})) {
      const params = currentTxParams[feat][tType];
      const xFill = xCol.map(v => v ?? 0);
      const result = applyTransform(xFill, tType, params);
      if (!result.values || result.values.length !== xCol.length) continue;
      const txCol = result.values.map((v, i) => (xCol[i] == null ? null : (isFinite(v) ? v : null)));
      transforms[tType] = { col: txCol, params };
    }
    featureCols[feat] = { base: xCol, transforms };
  }
  const modifierCols = {};
  for (const mod of modifiers) {
    const xCol = getNumCol(trainData, mod);
    if (xCol.filter(v => v != null).length < 3) continue;
    const transforms = {};
    for (const tType of SINGLE_TRANSFORMS) {
      const xFill = xCol.map(v => v ?? 0);
      const result = applyTransform(xFill, tType, {});
      if (!result.values || result.values.length !== xCol.length) continue;
      const txCol = result.values.map((v, i) => (xCol[i] == null ? null : (isFinite(v) ? v : null)));
      transforms[tType] = { col: txCol, params: {} };
    }
    modifierCols[mod] = { base: xCol, transforms };
  }

  const getCol = (cols, label) => {
    if (!cols) return null;
    if (label === 'base') return cols.base;
    return cols.transforms?.[label]?.col || null;
  };
  const getCols = (name) => featureCols[name] || modifierCols[name];

  const allFeatList = Object.keys(featureCols);
  const allModList = Object.keys(modifierCols);
  const aLabels = (cols) => ['base', ...Object.keys(cols?.transforms || {})];

  const getBaseBias = (c) => {
    if (c.kind === 'base') return 2;
    if (c.kind === 'indiv') return 1;
    const lab = c.comboLabel || '';
    if (lab === 'base_base') return 2;
    if (lab.startsWith('base_') || lab.endsWith('_base')) return 1;
    return 0;
  };

  // Rolling kept list: never exceed maxFeatures. Prefer no correlation conflicts over higher RSQ.
  const isCorrelated = (colA, colB) => {
    if (!colA || !colB || corrDropThresh == null) return false;
    const pairs = colA.map((v, i) => [v, colB[i]]).filter(([a, b]) => a != null && b != null);
    if (pairs.length < 3) return false;
    const absR = Math.sqrt(pearsonR2(pairs.map(([a])=>a), pairs.map(([,b])=>b)));
    return absR >= corrDropThresh;
  };

  const considerCandidate = (candidate, kept) => {
    const rsq = candidate.avgR2 ?? 0;
    const col = candidate.col;
    if (!col) return;

    if (dropBelowThresh && rsqThreshold >= 0 && rsq < rsqThreshold) return;

    const conflicts = [];
    for (let i = 0; i < kept.length; i++) {
      if (isCorrelated(col, kept[i].col)) conflicts.push(i);
    }

    if (kept.length >= maxFeatures) {
      const worstIdx = kept.reduce((worst, cur, i) =>
        (cur.avgR2 ?? 0) < (kept[worst].avgR2 ?? 0) ? i : worst, 0);
      const worstRsq = kept[worstIdx].avgR2 ?? 0;
      if (rsq <= worstRsq) return;
      if (conflicts.length === 0) {
        kept[worstIdx] = candidate;
        return;
      }
      const worstConflictIdx = conflicts.reduce((w, i) =>
        (kept[i].avgR2 ?? 0) < (kept[w].avgR2 ?? 0) ? i : w);
      const worstConflictRsq = kept[worstConflictIdx].avgR2 ?? 0;
      if (rsq > worstConflictRsq) kept[worstConflictIdx] = candidate;
      return;
    }

    if (conflicts.length > 0) {
      const worstConflictIdx = conflicts.reduce((w, i) =>
        (kept[i].avgR2 ?? 0) < (kept[w].avgR2 ?? 0) ? i : w);
      const worstConflictRsq = kept[worstConflictIdx].avgR2 ?? 0;
      if (rsq > worstConflictRsq) kept[worstConflictIdx] = candidate;
      return;
    }
    kept.push(candidate);
  };

  const scoreCoCol = (a, b, coType) => {
    const coCol = a.map((v1, i) => {
      const v2 = b[i];
      if (v1 == null || v2 == null) return null;
      const r = coType === 'multiply' ? v1 * v2 : v1 / (Math.abs(v2) + EPS);
      return isFinite(r) ? r : null;
    });
    const nonNull = coCol.filter(v => v != null);
    if (nonNull.length < 3) return null;
    const scaled = asympScale(nonNull);
    let si = 0;
    const coColScaled = coCol.map(v => v == null ? null : scaled[si++]);
    const r2ByDv = {};
    for (const dv of depVars) {
      const { xv, yv } = jointPair(coColScaled, dvYCols[dv]);
      if (xv.length < 3) continue;
      r2ByDv[dv] = pearsonR2(xv, yv);
    }
    if (!Object.keys(r2ByDv).length) return null;
    return { r2ByDv, col: coColScaled };
  };

  const kept = [];
  const bestCoSpec = {};

  for (let fi = 0; fi < allFeatList.length; fi++) {
    const feat = allFeatList[fi];
    if (staticFeats.has(feat)) continue;
    const cols = featureCols[feat];

    // This feature's indiv: base + surviving transforms
    // Dropped features (pilotDropFeats) are skipped entirely as standalone candidates.
    if (!pilotDropFeats.has(feat)) {
      const baseAvg = allBaseR2ByFeat[feat]
        ? Object.values(allBaseR2ByFeat[feat]).reduce((s,v)=>s+v,0)/Object.values(allBaseR2ByFeat[feat]).length
        : 0;
      considerCandidate({ kind: 'base', feat, avgR2: baseAvg, col: cols?.base }, kept);
      for (const [txType, { col }] of Object.entries(cols?.transforms || {})) {
        const r2ByDv = currentIndivR2[feat]?.[txType];
        if (!r2ByDv) continue;
        const avgR2 = Object.values(r2ByDv).reduce((s,v)=>s+v,0)/Object.keys(r2ByDv).length;
        considerCandidate({ kind: 'indiv', feat, txType, avgR2, col }, kept);
      }
    }

    for (let fj = fi + 1; fj < allFeatList.length; fj++) {
      // Dropped features don't anchor co-transform pairs; they can still appear as fj (b-side)
      if (pilotDropFeats.has(feat)) break;
      const f2 = allFeatList[fj];
      if (staticFeats.has(feat) && staticFeats.has(f2)) continue;
      const cols2 = featureCols[f2];
      for (const aLab of aLabels(cols)) {
        // Skip aLab transforms blocked from co-transform slots (can still appear as standalone indiv)
        if (aLab !== 'base' && blockedTxForCo[feat]?.has(aLab)) continue;
        const a = getCol(cols, aLab);
        if (!a) continue;
        for (const bLab of aLabels(cols2)) {
          // Skip bLab transforms blocked from co-transform slots
          if (bLab !== 'base' && blockedTxForCo[f2]?.has(bLab)) continue;
          const b = getCol(cols2, bLab);
          if (!b) continue;
          for (const coType of ['multiply', 'divide']) {
            const res = scoreCoCol(a, b, coType);
            if (!res) continue;
            const avgR2 = Object.values(res.r2ByDv).reduce((s, v) => s + v, 0) / Object.keys(res.r2ByDv).length;
            const pairKey = `${feat}__${f2}__${aLab}_${bLab}__${coType}`;
            bestCoSpec[pairKey] = { f1: feat, f2, type: coType, r2ByDv: res.r2ByDv, comboLabel: `${aLab}_${bLab}` };
            considerCandidate({ kind: 'co', pairKey, avgR2, f1: feat, f2, comboLabel: `${aLab}_${bLab}`, col: res.col }, kept);
          }
        }
      }
    }
    for (const mod of allModList) {
      // Dropped features don't anchor modifier co-transforms either
      if (pilotDropFeats.has(feat)) break;
      // Skip modifiers that showed no co-transform value in the pilot
      if (blockedModifiers.has(mod)) continue;
      const cols2 = modifierCols[mod];
      for (const aLab of aLabels(cols)) {
        // Skip aLab transforms blocked from co-transform slots
        if (aLab !== 'base' && blockedTxForCo[feat]?.has(aLab)) continue;
        const a = getCol(cols, aLab);
        if (!a) continue;
        for (const bLab of aLabels(cols2)) {
          // Skip bLab transforms blocked for this modifier in co-transform slots
          if (bLab !== 'base' && modCoTxUseful[mod] && !modCoTxUseful[mod][bLab]) continue;
          const b = getCol(cols2, bLab);
          if (!b) continue;
          for (const coType of ['multiply', 'divide']) {
            const res = scoreCoCol(a, b, coType);
            if (!res) continue;
            const avgR2 = Object.values(res.r2ByDv).reduce((s, v) => s + v, 0) / Object.keys(res.r2ByDv).length;
            const pairKey = `${feat}__${mod}__${aLab}_${bLab}__${coType}`;
            bestCoSpec[pairKey] = { f1: feat, f2: mod, type: coType, r2ByDv: res.r2ByDv, comboLabel: `${aLab}_${bLab}` };
            considerCandidate({ kind: 'co', pairKey, avgR2, f1: feat, f2: mod, comboLabel: `${aLab}_${bLab}`, col: res.col }, kept);
          }
        }
      }
    }
  }

  const selected = kept;

  const emittedIndivCols = new Set(); // entries: "feat" or "feat__txType" for multiple indiv per feat
  const emittedBaseCols = new Set();
  const emittedCoPairKeys = new Set();
  const bestIndivSpec = {}; // feat or feat__txType -> { type, params, r2ByDv } for buildOutputFinal
  for (const c of selected) {
    if (c.kind === 'base') emittedBaseCols.add(c.feat);
    else if (c.kind === 'indiv') {
      const key = c.txType ? `${c.feat}__${c.txType}` : c.feat;
      emittedIndivCols.add(key);
      bestIndivSpec[key] = {
        type: c.txType,
        params: currentTxParams[c.feat]?.[c.txType] || {},
        r2ByDv: currentIndivR2[c.feat]?.[c.txType] || {},
      };
    } else if (c.kind === 'co') emittedCoPairKeys.add(c.pairKey);
  }

  const out = buildOutputFinal(
    data, indepFiltered, bestIndivSpec, bestCoSpec,
    staticFeats, emittedIndivCols, emittedBaseCols, emittedCoPairKeys, keyField
  );
  const finalOut = out;

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
    if (emittedBaseCols.has(feat)) {
      const baseHist = updatedIndivHist[feat]?.['_base'];
      if (baseHist) {
        const r2Map = {};
        for (const [dv, h] of Object.entries(baseHist)) { r2Map[dv] = h.count ? h.sum / h.count : null; }
        feRsqRows.push(makeRsqRow(feat, r2Map));
      }
    }
  }
  for (const key of emittedIndivCols) {
    const spec = bestIndivSpec[key];
    if (!spec) continue;
    const feat = key.includes('__') ? key.split('__')[0] : key;
    const colName = `${feat}${TRANSFORM_SUFFIX[spec.type] || '_xf'}`;
    if (spec.r2ByDv) feRsqRows.push(makeRsqRow(colName, spec.r2ByDv));
  }
  for (const pairKey of emittedCoPairKeys) {
    const spec = bestCoSpec[pairKey];
    if (!spec) continue;
    const { f1, f2, type, comboLabel } = spec;
    const [aLab, bLab] = parseComboLabelForCol(comboLabel);
    const sfx = CO_SUFFIX[type] || '_co_';
    const f1s = (aLab && aLab !== 'base') ? (TRANSFORM_SUFFIX[aLab] || '') : '';
    const f2s = (bLab && bLab !== 'base') ? (TRANSFORM_SUFFIX[bLab] || '') : '';
    const colName = `${f1}${f1s}${sfx}${f2}${f2s}`;
    feRsqRows.push(makeRsqRow(colName, spec.r2ByDv));
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
        name: saveName, depVars, features: indepFiltered, modifiers,
        mergeCount: newCount,
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

  // Re-derive emission sets. indivSpecs keys can be "feat" or "feat__txType".
  const emittedIndivCols = new Set(
    Object.keys(indivSpecs).filter(k => {
      const f = k.includes('__') ? k.split('__')[0] : k;
      return indepSrc.includes(f) && !staticFeats.has(f);
    })
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

  const parseIndivKey = (k) => {
    const idx = k.indexOf('__');
    return idx >= 0 ? { feat: k.slice(0, idx), txType: k.slice(idx + 2) } : { feat: k, txType: indivSpecs[k]?.type };
  };
  const parseComboLabel = (lab) => {
    if (!lab) return ['base', 'base'];
    if (lab === 'base_base') return ['base', 'base'];
    if (lab.startsWith('base_')) return ['base', lab.slice(6)];
    if (lab.endsWith('_base')) return [lab.slice(0, -5), 'base'];
    for (const t of SINGLE_TRANSFORMS) {
      if (lab.startsWith(t + '_')) return [t, lab.slice(t.length + 1)];
    }
    return lab.split('_');
  };

  const indivColVecs = {};
  for (const key of emittedIndivCols) {
    const spec = indivSpecs[key];
    if (!spec) continue;
    const { feat, txType } = parseIndivKey(key);
    const tx = txType || spec.type;
    const xAll = data.map(r => { const v = Number(r[feat]); return isNaN(v) ? null : v; });
    const xFill = xAll.map(v => v ?? 0);
    indivColVecs[key] = sanitize(applyTransform(xFill, tx, spec.params || {}).values).map(sig5);
  }

  const getColForCo = (feat, label) => {
    if (label === 'base') return data.map(r => { const v = Number(r[feat]); return isNaN(v) ? null : sig5(v); });
    const key = `${feat}__${label}`;
    if (indivColVecs[key]) return indivColVecs[key];
    const spec = indivSpecs[key] || indivSpecs[feat];
    const params = spec?.params || {};
    const xAll = data.map(r => { const v = Number(r[feat]); return isNaN(v) ? null : v; });
    const xFill = xAll.map(v => v ?? 0);
    return sanitize(applyTransform(xFill, label, params).values).map(sig5);
  };

  const coColVecs = {};
  for (const pairKey of emittedCoPairKeys) {
    const coSpec = coSpecs[pairKey];
    if (!coSpec) continue;
    const { f1, f2, type, comboLabel } = coSpec;
    const [aLab, bLab] = parseComboLabel(comboLabel);
    const a = getColForCo(f1, aLab);
    const b = getColForCo(f2, bLab);
    coColVecs[pairKey] = coTransform(a, b, type).map(sig5);
  }

  return data.map((r, i) => {
    const row = { ...r };

    for (const key of emittedIndivCols) {
      const spec = indivSpecs[key];
      if (!spec || !indivColVecs[key]) continue;
      const { feat, txType } = parseIndivKey(key);
      const suffix = TRANSFORM_SUFFIX[txType || spec.type] || '_xf';
      row[`${feat}${suffix}`] = indivColVecs[key][i] ?? null;
    }

    for (const feat of staticFeats) {
      delete row[feat];
      for (const tType of Object.keys(TRANSFORM_SUFFIX)) {
        if (tType === 'identity') continue;
        const suffix = TRANSFORM_SUFFIX[tType];
        if (suffix) delete row[`${feat}${suffix}`];
      }
      delete row[`${feat}_xf`];
    }

    const emittedFeats = new Set([...emittedIndivCols].map(k => parseIndivKey(k).feat));
    for (const feat of emittedFeats) {
      if (!emittedBaseCols.has(feat)) delete row[feat];
    }

    for (const pairKey of emittedCoPairKeys) {
      const coSpec = coSpecs[pairKey];
      if (!coSpec || !coColVecs[pairKey]) continue;
      const { f1, f2, type, comboLabel } = coSpec;
      const [aLab, bLab] = parseComboLabel(comboLabel);
      const sfx = CO_SUFFIX[type] || '_co_';
      const f1s = (aLab && aLab !== 'base') ? (TRANSFORM_SUFFIX[aLab] || '_xf') : '';
      const f2s = (bLab && bLab !== 'base') ? (TRANSFORM_SUFFIX[bLab] || '_xf') : '';
      const colName = `${f1}${f1s}${sfx}${f2}${f2s}`;
      row[colName] = coColVecs[pairKey][i] ?? null;
    }

    return row;
  });
}
