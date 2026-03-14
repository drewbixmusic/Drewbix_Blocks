// ── Feature Engineering ───────────────────────────────────────────────────────
// Pass-Thru mode: pure multiplexer — splits data into passthru/features/targets.
// Feature Engineering mode:
//   1. Score all transforms per feature across sets (Pearson R²), pick winner.
//   2. Per-target greedy forward selection: each target independently finds its
//      best feature set via OOS OLS regression (train 1 set, eval on rest).
//      Every feature is a candidate for every target — no global pre-filter.
//   3. Co-transform step: for each value-add anchor × all features (b-side),
//      generate mult/div; screen by Pearson gain over both constituents.
//   4. Per-target greedy co-transform forward selection on top of each target's
//      individual feature baseline.
//   5. Compute per-target OLS prediction columns (FE_<tgt>) and append to both
//      the passthru output and the features port so downstream models can use
//      the FE predicted values as additional inputs.
// Stored mode: replays saved transforms + featureTargetMap without re-scoring.

import { pearsonR2, ols } from '../utils/math.js';

// ── Safe individual transforms ─────────────────────────────────────────────────
const EPS = 1e-9;

const TRANSFORMS = {
  base:  x => x,
  inv:   x => { const d = Math.abs(x) + EPS; return (x >= 0 ? 1 : -1) / d; },
  log:   x => Math.sign(x || 0) * Math.log(Math.abs(x) + 1),
  sqrt:  x => Math.sign(x || 0) * Math.sqrt(Math.abs(x)),
  sq:    x => Math.sign(x || 0) * x * x,
  abs:   x => Math.abs(x),
};

const TRANSFORM_KEYS = Object.keys(TRANSFORMS);

function applyTx(col, txKey) {
  const fn = TRANSFORMS[txKey];
  return col.map(v => {
    if (v == null || !isFinite(v)) return null;
    const r = fn(v);
    return isFinite(r) ? r : null;
  });
}

// ── Co-transform operations ───────────────────────────────────────────────────
function coMult(aCol, bCol) {
  return aCol.map((a, i) => {
    const b = bCol[i];
    if (a == null || b == null) return null;
    const v = a * b;
    return isFinite(v) ? v : null;
  });
}

// Asymptotic-safe division: denominator saturates at IQR×0.1 to prevent ±Inf
function coDiv(numCol, denCol) {
  const finDen = denCol.filter(v => v != null && isFinite(v));
  if (!finDen.length) return denCol.map(() => null);
  const absVals = finDen.map(Math.abs).sort((a, b) => a - b);
  const q25 = absVals[Math.floor(absVals.length * 0.25)];
  const q75 = absVals[Math.floor(absVals.length * 0.75)];
  const iqr = Math.max(q75 - q25, EPS);
  return numCol.map((n, i) => {
    const d = denCol[i];
    if (n == null || d == null) return null;
    const safeDen = Math.sign(d || 1) * Math.max(Math.abs(d), iqr * 0.1);
    const v = n / safeDen;
    return isFinite(v) ? v : null;
  });
}

function coKey(a, b, op) { return `${a}${op}${b}`; }

// ── Set detection ─────────────────────────────────────────────────────────────
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

// ── Per-set avg(mean,median) ───────────────────────────────────────────────────
function avgMedMean(vals) {
  if (!vals.length) return 0;
  const mn = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return (mn + med) / 2;
}

// ── Per-feature Pearson across sets ──────────────────────────────────────────
function scoreTxAcrossSets(col, depCols, setIdxArrays) {
  const dvKeys = Object.keys(depCols);
  const result = {};
  for (const txKey of TRANSFORM_KEYS) {
    const txCol = applyTx(col, txKey);
    result[txKey] = {};
    for (const dv of dvKeys) {
      const yCol = depCols[dv];
      const setR2s = [];
      for (const idxs of setIdxArrays) {
        if (idxs.length < 3) continue;
        setR2s.push(pearsonR2(idxs.map(i => txCol[i]), idxs.map(i => yCol[i])));
      }
      result[txKey][dv] = avgMedMean(setR2s);
    }
  }
  return result;
}

// ── Score a pre-built column vs all DVs across sets ───────────────────────────
function scoreColAcrossSets(col, depCols, setIdxArrays) {
  const dvMap = {};
  for (const dv of Object.keys(depCols)) {
    const yCol = depCols[dv];
    const setR2s = [];
    for (const idxs of setIdxArrays) {
      if (idxs.length < 3) continue;
      setR2s.push(pearsonR2(idxs.map(i => col[i]), idxs.map(i => yCol[i])));
    }
    dvMap[dv] = avgMedMean(setR2s);
  }
  return dvMap;
}

// ── Winner selection ──────────────────────────────────────────────────────────
function pickWinner(txScores, featName) {
  const dvKeys = Object.keys(txScores[TRANSFORM_KEYS[0]] || {});
  if (!dvKeys.length) return 'base';
  let bestKey = null, bestScore = -Infinity;
  for (const txKey of TRANSFORM_KEYS) {
    const dvMap = txScores[txKey] || {};
    const score = dvKeys.reduce((s, dv) => s + (dvMap[dv] ?? 0), 0) / dvKeys.length;
    if (score > bestScore + 1e-12) { bestScore = score; bestKey = txKey; }
    else if (Math.abs(score - bestScore) <= 1e-12) {
      if (txKey === 'base') bestKey = 'base';
      else if (bestKey !== 'base') {
        if (simpleHash(featName + txKey) < simpleHash(featName + bestKey)) bestKey = txKey;
      }
    }
  }
  return bestKey || 'base';
}

function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

function netRsq(dvMap) {
  const vals = Object.values(dvMap).filter(v => v != null && isFinite(v));
  if (!vals.length) return null;
  return avgMedMean(vals);
}

function r3(v) { return v == null ? null : Math.round(v * 1000) / 1000; }

// ── OOS regression scoring ─────────────────────────────────────────────────────
// Train on each set individually, evaluate on all OTHER sets.
// Returns avg(mean, median) across folds, or null if no valid folds.
// useIntercept: if true, prepend a column of 1s to the feature matrix.
function scoreOosByOls(featCols, yCol, setIdxArrays, useIntercept = false) {
  const prepX = (idxs) => {
    const base = idxs.map(i => featCols.map(c => c[i] ?? 0));
    return useIntercept ? base.map(row => [1, ...row]) : base;
  };
  const nCols = featCols.length + (useIntercept ? 1 : 0);
  const nSets = setIdxArrays.length;

  if (nSets < 2) {
    const validIdx = (setIdxArrays[0] || []).filter(i => yCol[i] != null);
    if (validIdx.length < nCols + 2) return null;
    const Xmat   = prepX(validIdx);
    const yVec   = validIdx.map(i => yCol[i]);
    const coeffs = ols(Xmat, yVec);
    if (!coeffs) return null;
    return pearsonR2(Xmat.map(x => x.reduce((s, v, k) => s + v * coeffs[k], 0)), yVec);
  }

  const oosR2s = [];
  for (let si = 0; si < nSets; si++) {
    const trainIdx = setIdxArrays[si].filter(i => yCol[i] != null);
    const testIdx  = setIdxArrays.filter((_, j) => j !== si).flat().filter(i => yCol[i] != null);
    if (trainIdx.length < nCols + 2) continue;
    if (testIdx.length  < 3) continue;
    const Xmat   = prepX(trainIdx);
    const yVec   = trainIdx.map(i => yCol[i]);
    const coeffs = ols(Xmat, yVec);
    if (!coeffs) continue;
    const preds   = testIdx.map(i => {
      const row = useIntercept
        ? [1, ...featCols.map(c => c[i] ?? 0)]
        : featCols.map(c => c[i] ?? 0);
      return row.reduce((s, v, k) => s + v * coeffs[k], 0);
    });
    oosR2s.push(pearsonR2(preds, testIdx.map(i => yCol[i])));
  }
  return oosR2s.length ? avgMedMean(oosR2s) : null;
}

// ── Sequential per-target forward selection ───────────────────────────────────
// Sort once by per-target Pearson R² descending. Sweep through in that fixed
// order — score current kept set + candidate, keep if it clears the improvement
// threshold, skip if not, continue to the end of the list regardless.
// O(N) OLS calls per target instead of O(N²) — much faster.
//
// Returns { featureTargetMap, fwdSelScores }
function runForwardSelection(allCandidates, candidateCols, depVars, winnerMap, depCols, setIdxArrays, improvePct, useIntercept) {
  const featureTargetMap = {};
  const fwdSelScores     = {};

  for (const dv of depVars) {
    fwdSelScores[dv] = {};
    const yCol = depCols[dv];

    if (!allCandidates.length) continue;

    // Sort once by individual Pearson for this target — highest first
    const ordered = [...allCandidates].sort((a, b) =>
      (winnerMap[b]?.scores?.[dv] ?? 0) - (winnerMap[a]?.scores?.[dv] ?? 0)
    );

    // Seed with the single best feature
    const seed = ordered[0];
    const kept = [seed];
    let currentOos = scoreOosByOls([candidateCols[seed]], yCol, setIdxArrays, useIntercept);
    if (currentOos == null) currentOos = winnerMap[seed]?.scores?.[dv] ?? 0;
    fwdSelScores[dv][seed] = r3(currentOos);

    // Single sequential sweep — no re-sorting, no inner loop over all remaining
    for (let i = 1; i < ordered.length; i++) {
      const feat = ordered[i];
      const cols = [...kept, feat].map(f => candidateCols[f]);
      let candOos = scoreOosByOls(cols, yCol, setIdxArrays, useIntercept);
      if (candOos == null) candOos = winnerMap[feat]?.scores?.[dv] ?? 0;

      if (candOos > currentOos * (1 + improvePct)) {
        kept.push(feat);
        fwdSelScores[dv][feat] = r3(candOos);
        currentOos = candOos;
      }
      // Skip non-improvers — continue to next in sorted order
    }

    for (const f of kept) {
      if (!featureTargetMap[f]) featureTargetMap[f] = [];
      if (!featureTargetMap[f].includes(dv)) featureTargetMap[f].push(dv);
    }
  }

  return { featureTargetMap, fwdSelScores };
}

// ── Co-transform screening ────────────────────────────────────────────────────
// Anchors (value-add features) × all features. Unused features are b-side only.
// Gate: co-tx must beat both constituent Pearson scores for at least one target.
function buildCoTransforms(valueAddFeats, allFeats, txCols, depCols, setIdxArrays, winnerMap) {
  const coTxMap  = {};
  const coTxByDv = {};
  const unusedSet = new Set(allFeats.filter(f => !valueAddFeats.includes(f)));

  for (const dv of Object.keys(depCols)) coTxByDv[dv] = [];

  for (const a of valueAddFeats) {
    for (const b of allFeats) {
      if (a === b) continue;

      const colMult = coMult(txCols[a], txCols[b]);
      const colDiv  = coDiv(txCols[a], txCols[b]);

      for (const [col, op] of [[colMult, '×'], [colDiv, '÷']]) {
        const key = coKey(a, b, op);
        if (op === '×' && !unusedSet.has(b) && coTxMap[coKey(b, a, '×')]) continue;

        const scoresDv = scoreColAcrossSets(col, depCols, setIdxArrays);
        const aScores  = winnerMap[a]?.scores || {};
        const bScores  = winnerMap[b]?.scores || {};

        const anyGain = Object.keys(depCols).some(dv =>
          (scoresDv[dv] ?? 0) > Math.max(aScores[dv] ?? 0, bScores[dv] ?? 0) + 1e-6
        );
        if (!anyGain) continue;

        coTxMap[key] = { op, a, b, col, scores: scoresDv };
        for (const dv of Object.keys(depCols)) {
          if ((scoresDv[dv] ?? 0) > 0) coTxByDv[dv].push(key);
        }
      }
    }
  }

  for (const dv of Object.keys(depCols)) {
    coTxByDv[dv].sort((x, y) => (coTxMap[y]?.scores[dv] ?? 0) - (coTxMap[x]?.scores[dv] ?? 0));
  }

  return { coTxMap, coTxByDv };
}

// ── Sequential co-transform forward selection per target ──────────────────────
// co-transforms are pre-sorted by per-target Pearson desc (done in buildCoTransforms).
// Single sweep in that order: keep if it improves OOS baseline, skip if not,
// continue to end of list. O(N) OLS calls per target — no inner re-evaluation.
function runCoFwdSelection(
  depVars, depCols, setIdxArrays,
  keptIndivColsByDv, coTxMap, coTxByDv,
  featureTargetMap, improvePct, useIntercept
) {
  const coTargetMap = {};
  const coSelScores = {};

  for (const dv of depVars) {
    coSelScores[dv] = {};
    const yCol      = depCols[dv];
    const indivCols = keptIndivColsByDv[dv] || [];

    let currentOos = indivCols.length ? (scoreOosByOls(indivCols, yCol, setIdxArrays, useIntercept) ?? 0) : 0;
    const keptCoKeys = [];
    // coTxByDv[dv] is already sorted by Pearson desc for this dv
    const candidates = (coTxByDv[dv] || []).filter(k => coTxMap[k]);

    for (const key of candidates) {
      const entry  = coTxMap[key];
      const colSet = [...indivCols, ...keptCoKeys.map(k => coTxMap[k].col), entry.col];
      const candOos = scoreOosByOls(colSet, yCol, setIdxArrays, useIntercept) ?? (entry.scores?.[dv] ?? 0);

      if (candOos > currentOos * (1 + improvePct)) {
        keptCoKeys.push(key);
        coSelScores[dv][key] = r3(candOos);
        if (!coTargetMap[key]) coTargetMap[key] = [];
        if (!coTargetMap[key].includes(dv)) coTargetMap[key].push(dv);
        for (const feat of [entry.a, entry.b]) {
          if (!featureTargetMap[feat]) featureTargetMap[feat] = [];
          if (!featureTargetMap[feat].includes(dv)) featureTargetMap[feat].push(dv);
        }
        currentOos = candOos;
      }
      // Skip non-improvers — continue in Pearson-sorted order
    }
  }

  return { coTargetMap, coSelScores };
}

// ── Main export ───────────────────────────────────────────────────────────────
export function runFeatureEngineering(node, { cfg, inputs, setHeaders, feRegistry, setFeRegistry, openFEDashboard }) {
  const data = Array.isArray(inputs.data) ? inputs.data : [];
  const fe       = cfg.fe || {};
  const depVars  = Array.isArray(fe.dep) ? fe.dep : [];
  const featVars = Array.isArray(fe.indep)
    ? fe.indep.filter(iv => iv.enabled !== false).map(iv => iv.name).filter(Boolean)
    : [];
  const featNames = featVars.filter(f => !depVars.includes(f));

  const empty = () => ({
    _rows: data, passthru: data,
    features: { _headers: [], _rows: [] },
    targets:  { _headers: [], _rows: [] },
    _headers_features: [], _headers_targets: depVars,
  });

  if (!data.length) return empty();

  const feMode = cfg.fe_mode || 'Pass-Thru';
  if (feMode === 'Pass-Thru') return runPassThru(data, featNames, depVars, setHeaders);

  const modelName    = (cfg.model_name || '').trim();
  const modelMode    = cfg.model_mode || 'New';
  const keyField     = (cfg.key_field  || 'symbol').trim();
  const modSep       = (cfg.key_modifier ?? '_').trim() || '_';
  const improvePct   = parseFloat((cfg.fwd_improve_thresh || '1%').replace('%', '')) / 100;
  const useIntercept = cfg.use_intercept === true || cfg.use_intercept === 'true';

  // Stored mode: replay saved model
  if (modelMode === 'Stored' && modelName) {
    const stored = (feRegistry || {})[modelName];
    if (!stored?.winnerMap) {
      console.warn(`[FE] No stored model "${modelName}" — falling back to pass-thru`);
      return runPassThru(data, featNames, depVars, setHeaders);
    }
    // Use the feature list from the stored model (not current UI selection)
    const storedFeatNames = stored.features || featNames;
    const storedDepVars   = stored.depVars || depVars;
    // Build depCols and setIdxArrays from current data so FE_<dv> predictions
    // are generated fresh on the current dataset.
    const storedDepCols = {};
    for (const dv of storedDepVars) {
      storedDepCols[dv] = data.map(r => { const v = Number(r[dv]); return isNaN(v) ? null : v; });
    }
    const storedModGroups = parseModGroups(data, keyField, modSep);
    const storedRealMods  = [...storedModGroups.keys()].filter(m => m !== '__none__');
    const storedSetIdx    = storedRealMods.length >= 2
      ? storedRealMods.map(m => storedModGroups.get(m))
      : null;
    return runApply(data, storedFeatNames, storedDepVars, stored.winnerMap,
      stored.featureTargetMap || {}, stored.fwdSelScores || {},
      stored.coTxMap || {}, stored.coTargetMap || {}, stored.coSelScores || {},
      storedDepVars, storedDepCols, storedRealMods, setHeaders, openFEDashboard, modelName, useIntercept, storedSetIdx);
  }

  if (!featNames.length || !depVars.length) return runPassThru(data, featNames, depVars, setHeaders);

  // Build dep var columns
  const depCols = {};
  for (const dv of depVars) {
    depCols[dv] = data.map(r => { const v = Number(r[dv]); return isNaN(v) ? null : v; });
  }

  // Detect sets
  const modGroups    = parseModGroups(data, keyField, modSep);
  const realMods     = [...modGroups.keys()].filter(m => m !== '__none__');
  const setIdxArrays = realMods.length >= 2
    ? realMods.map(m => modGroups.get(m))
    : [data.map((_, i) => i)];

  // Step 1: score individual transforms, pick winner per feature
  const winnerMap = {};
  const txCols    = {};
  for (const feat of featNames) {
    const raw      = data.map(r => { const v = Number(r[feat]); return isNaN(v) ? null : v; });
    const txScores = scoreTxAcrossSets(raw, depCols, setIdxArrays);
    const winner   = pickWinner(txScores, feat);
    winnerMap[feat] = { type: winner, scores: txScores[winner] };
    txCols[feat]    = applyTx(raw, winner);
  }

  // Step 2: per-target greedy forward selection (each target independent)
  const { featureTargetMap, fwdSelScores } = runForwardSelection(
    featNames, txCols, depVars, winnerMap, depCols, setIdxArrays, improvePct, useIntercept
  );

  // Union of all value-add features across all targets
  const valueAddFeats = [...new Set(Object.keys(featureTargetMap))];

  // Kept individual column lists per dv
  const keptIndivColsByDv = {};
  for (const dv of depVars) {
    keptIndivColsByDv[dv] = featNames
      .filter(f => featureTargetMap[f]?.includes(dv))
      .map(f => txCols[f]);
  }

  // Step 3: co-transform screening
  const { coTxMap, coTxByDv } = valueAddFeats.length >= 1 && featNames.length >= 2
    ? buildCoTransforms(valueAddFeats, featNames, txCols, depCols, setIdxArrays, winnerMap)
    : { coTxMap: {}, coTxByDv: {} };

  // Step 4: greedy co-transform forward selection per target
  const { coTargetMap, coSelScores } = Object.keys(coTxMap).length
    ? runCoFwdSelection(depVars, depCols, setIdxArrays,
        keptIndivColsByDv, coTxMap, coTxByDv, featureTargetMap, improvePct, useIntercept)
    : { coTargetMap: {}, coSelScores: {} };

  // Save to registry
  if (modelName && setFeRegistry) {
    setFeRegistry({
      ...(feRegistry || {}),
      [modelName]: {
        name: modelName, depVars, features: featNames,
        winnerMap, featureTargetMap, fwdSelScores,
        coTxMap: sanitizeCoTxForStorage(coTxMap), coTargetMap, coSelScores,
        updated: new Date().toISOString(),
      },
    });
  }

  return runApply(data, featNames, depVars, winnerMap, featureTargetMap, fwdSelScores,
    coTxMap, coTargetMap, coSelScores,
    depVars, depCols, realMods, setHeaders, openFEDashboard, modelName, useIntercept, setIdxArrays);
}

function sanitizeCoTxForStorage(coTxMap) {
  const out = {};
  for (const [k, v] of Object.entries(coTxMap)) {
    out[k] = { op: v.op, a: v.a, b: v.b, scores: v.scores };
  }
  return out;
}

// ── Pass-Thru helper ──────────────────────────────────────────────────────────
function runPassThru(data, featNames, depVars, setHeaders) {
  const featuresRows = data.map(r => { const row = {}; featNames.forEach(f => { if (f in r) row[f] = r[f]; }); return row; });
  const targetsRows  = data.map(r => { const row = {}; depVars.forEach(f => { if (f in r) row[f] = r[f]; }); return row; });
  if (featNames.length) setHeaders(featNames);
  return {
    _rows: data, passthru: data,
    features: { _headers: featNames, _rows: featuresRows },
    targets:  { _headers: depVars,   _rows: targetsRows  },
    _headers_features: featNames,
    _headers_targets:  depVars,
  };
}

// ── Apply winners, build output, generate FE_<dv> predictions ─────────────────
function runApply(data, featNames, depVars, winnerMap, featureTargetMap, fwdSelScores,
    coTxMap, coTargetMap, coSelScores,
    storedDepVars, depCols, setNames, setHeaders, openFEDashboard, modelName, useIntercept = false, setIdxArrays = null) {

  const nRows = data.length;

  // Re-build txCols if not already available (stored mode)
  const txCols = {};
  for (const feat of featNames) {
    const raw = data.map(r => { const v = Number(r[feat]); return isNaN(v) ? null : v; });
    txCols[feat] = applyTx(raw, winnerMap[feat]?.type || 'base');
  }

  // Apply individual winning transforms to feature rows
  const featuresRows = data.map((r, i) => {
    const row = {};
    for (const feat of featNames) {
      row[feat] = txCols[feat][i];
    }
    return row;
  });

  // Inject co-transform values
  const coKeys = Object.keys(coTxMap).filter(k => coTargetMap[k]?.length);
  for (const key of coKeys) {
    const entry = coTxMap[key];
    // Always recompute col from current txCols — stored col may be stale (different row count)
    const aCol = txCols[entry.a] || new Array(nRows).fill(null);
    const bCol = txCols[entry.b] || new Array(nRows).fill(null);
    entry.col  = entry.op === '×' ? coMult(aCol, bCol) : coDiv(aCol, bCol);
    entry.col.forEach((v, i) => { if (featuresRows[i]) featuresRows[i][key] = v; });
  }

  const targetsRows = data.map(r => {
    const row = {}; storedDepVars.forEach(f => { if (f in r) row[f] = r[f]; }); return row;
  });

  // Build kept column lists per dv (individual + co) for FE prediction
  const keptAllColsByDv = {};
  for (const dv of storedDepVars) {
    const indiv = featNames.filter(f => featureTargetMap[f]?.includes(dv)).map(f => txCols[f]);
    const co    = coKeys.filter(k => coTargetMap[k]?.includes(dv)).map(k => coTxMap[k].col);
    keptAllColsByDv[dv] = [...indiv, ...co];
  }

  // Step 5: build FE_<dv> prediction columns — per-set OLS fits blended by R²
  const fePredCols = depCols
    ? buildFePredCols(storedDepVars, depCols, setIdxArrays, keptAllColsByDv, useIntercept)
    : {};

  // Inject FE_<dv> into featuresRows and build passthru rows with FE cols
  const feColNames = storedDepVars.map(dv => `FE_${dv}`);
  for (const dv of storedDepVars) {
    const predCol = fePredCols[dv];
    if (!predCol) continue;
    predCol.forEach((v, i) => { featuresRows[i][`FE_${dv}`] = v; });
  }

  // Passthru: full data + FE_<dv> cols added
  const passthruRows = data.map((r, i) => {
    const row = { ...r };
    for (const dv of storedDepVars) {
      const pred = fePredCols[dv]?.[i];
      if (pred != null) row[`FE_${dv}`] = pred;
    }
    return row;
  });

  const allFeatCols = [...featNames, ...coKeys, ...feColNames];

  // Combined featureTargetMap
  const combinedFtMap = { ...featureTargetMap };
  for (const k of coKeys) { combinedFtMap[k] = coTargetMap[k]; }
  // FE_<dv> cols are valid features for ALL targets
  for (const col of feColNames) {
    combinedFtMap[col] = [...storedDepVars];
  }

  const feRsqRows = buildRsqRows(featNames, winnerMap, fwdSelScores,
    coTxMap, coTargetMap, coSelScores, storedDepVars, feColNames);

  if (allFeatCols.length) setHeaders(allFeatCols);

  if (openFEDashboard) {
    openFEDashboard({
      title:            `FE: ${modelName || 'results'}`,
      depVars:          storedDepVars,
      featNames,
      coKeys,
      feColNames,
      winnerMap,
      coTxMap:          sanitizeCoTxForStorage(coTxMap),
      featureTargetMap: combinedFtMap,
      fwdSelScores,
      coSelScores,
      feRsqRows,
      setNames,
    });
  }

  return {
    _rows: passthruRows, passthru: passthruRows,
    features: {
      _headers: allFeatCols, _rows: featuresRows, feRsqRows,
      featureTargetMap: combinedFtMap,
    },
    targets:  { _headers: storedDepVars, _rows: targetsRows },
    _headers_features: allFeatCols,
    _headers_targets:  storedDepVars,
  };
}

// ── RSQ rows (individual + co-transforms + FE_<dv> pred cols) ─────────────────
// IMPORTANT: dv score is set to null when the feature was NOT selected for that
// target (i.e. not in fwdSelScores[dv]). This ensures downstream RF/MV blocks
// correctly exclude features via their r[dv]!==null filter.
// FE_<dv> prediction columns are appended at the end, valid for all targets.
function buildRsqRows(featNames, winnerMap, fwdSelScores, coTxMap, coTargetMap, coSelScores, depVars, feColNames = []) {
  const rows = [];

  for (const feat of featNames) {
    const winner = winnerMap[feat];
    if (!winner) continue;
    const row = { independent_variable: feat, xform: winner.type, kind: 'indiv' };
    const dvMap = {};
    for (const dv of depVars) {
      // Only include a score if this feature was actually selected for this target
      const fwdScore = fwdSelScores?.[dv]?.[feat];
      const score = fwdScore != null ? fwdScore : null;
      row[dv] = score;
      if (score != null) dvMap[dv] = score;
    }
    // Net_RSQ from actual selected scores only (not raw Pearson of unselected features)
    row.Net_RSQ = r3(netRsq(dvMap));
    rows.push(row);
  }

  for (const [key, entry] of Object.entries(coTxMap)) {
    if (!coTargetMap[key]?.length) continue;
    const row = { independent_variable: key, xform: entry.op, kind: 'co' };
    const dvMap = {};
    for (const dv of depVars) {
      const coScore = coSelScores?.[dv]?.[key];
      const score = coScore != null ? coScore : null;
      row[dv] = score;
      if (score != null) dvMap[dv] = score;
    }
    row.Net_RSQ = r3(netRsq(dvMap));
    rows.push(row);
  }

  // FE_<dv> prediction columns — valid for all targets
  for (const col of feColNames) {
    const row = { independent_variable: col, xform: 'pred', kind: 'fepred' };
    const dvMap = {};
    for (const d of depVars) {
      // Give a non-null score for every target so RF includes these in all feature lists.
      // The actual own-target prediction is most relevant so score it highest.
      const ownDv = col.replace(/^FE_/, '');
      const score = d === ownDv ? 1.0 : 0.5;
      row[d] = score;
      dvMap[d] = score;
    }
    row.Net_RSQ = r3(netRsq(dvMap));
    rows.push(row);
  }

  rows.sort((a, b) => (b.Net_RSQ ?? -1) - (a.Net_RSQ ?? -1));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

// ── buildFePredCols: per-set OLS fits blended by R² ──────────────────────────
// For each target: train OLS on each set individually, compute R² on that set,
// blend predictions across sets weighted by R² (like RF/MV final output).
// Falls back to single full-data fit when only one set exists.
function buildFePredCols(depVars, depCols, setIdxArrays, keptColsByDv, useIntercept = false) {
  const nRows = depCols[depVars[0]]?.length ?? 0;
  const fePreds = {};

  // Resolve set index arrays — fall back to single full-data set
  const sets = (setIdxArrays && setIdxArrays.length >= 2)
    ? setIdxArrays
    : [Array.from({ length: nRows }, (_, i) => i)];

  for (const dv of depVars) {
    const yCol     = depCols[dv];
    const featCols = keptColsByDv[dv] || [];

    if (!featCols.length || !yCol) {
      fePreds[dv] = new Array(nRows).fill(null);
      continue;
    }

    const nCols = featCols.length + (useIntercept ? 1 : 0);

    // Per-set: train OLS on set rows, score R² on same set, accumulate weighted prediction
    const accumPred   = new Array(nRows).fill(0);
    const accumWeight = new Array(nRows).fill(0);
    let anyFit = false;

    for (const setIdx of sets) {
      const validIdx = setIdx.filter(i => yCol[i] != null);
      if (validIdx.length < nCols + 2) continue;

      const Xmat = useIntercept
        ? validIdx.map(i => [1, ...featCols.map(c => c[i] ?? 0)])
        : validIdx.map(i => featCols.map(c => c[i] ?? 0));
      const yVec   = validIdx.map(i => yCol[i]);
      const coeffs = ols(Xmat, yVec);
      if (!coeffs) continue;

      // Compute in-set R² as blend weight
      const setR2 = Math.max(0, pearsonR2(
        Xmat.map(x => x.reduce((s, v, k) => s + v * coeffs[k], 0)),
        yVec
      ));

      // Apply these coefficients to ALL rows and accumulate weighted
      for (let i = 0; i < nRows; i++) {
        const row = useIntercept
          ? [1, ...featCols.map(c => c[i] ?? 0)]
          : featCols.map(c => c[i] ?? 0);
        const p = row.reduce((s, v, k) => s + v * coeffs[k], 0);
        if (isFinite(p)) {
          accumPred[i]   += p * setR2;
          accumWeight[i] += setR2;
        }
      }
      anyFit = true;
    }

    if (!anyFit) {
      fePreds[dv] = new Array(nRows).fill(null);
      continue;
    }

    fePreds[dv] = accumPred.map((sum, i) =>
      accumWeight[i] > 0 ? sum / accumWeight[i] : null
    );
  }

  return fePreds;
}
