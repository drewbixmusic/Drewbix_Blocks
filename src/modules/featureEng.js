// ── Feature Mux / Feature Engineering ────────────────────────────────────────
// Pass-Thru mode: pure multiplexer — splits data into passthru/features/targets.
// Feature Engineering mode:
//   1. Score all transforms per feature across sets (Pearson R²), pick winner.
//   2. Forward-selection OOS loop per target: starting from top-3 features, add
//      each remaining feature one at a time (OLS train on each set, check R² on
//      all OTHER sets), keep if OOS R² improves by at least the relative threshold.
//   3. Output featureTargetMap { feat: [dvs] } so RF/MV can filter per target.
// Stored mode: replays saved transforms + featureTargetMap without re-scoring.

import { pearsonR2, ols } from '../utils/math.js';

// ── Safe transforms ───────────────────────────────────────────────────────────
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

// ── Per-set avg(mean,median) scoring ─────────────────────────────────────────
function avgMedMean(vals) {
  if (!vals.length) return 0;
  const mn = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return (mn + med) / 2;
}

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
        const xs = idxs.map(i => txCol[i]);
        const ys = idxs.map(i => yCol[i]);
        setR2s.push(pearsonR2(xs, ys));
      }
      result[txKey][dv] = avgMedMean(setR2s);
    }
  }
  return result;
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

// ── OOS regression scoring ────────────────────────────────────────────────────
// For each set: train OLS on that set's rows, predict on ALL OTHER sets,
// compute Pearson R² of predictions vs actuals on those other rows.
// Returns avg(mean, median) across sets.
function scoreOosByOls(featCols, yCols_dv, setIdxArrays) {
  const nSets = setIdxArrays.length;
  if (nSets < 2) {
    // Only one set — can't do true OOS, fall back to in-sample Pearson on all data
    const allIdxs = setIdxArrays[0] || [];
    const xs = allIdxs.map(i => featCols.map(c => c[i] ?? 0));
    const ys = allIdxs.map(i => yCols_dv[i] ?? 0);
    const validPairs = xs.map((x, j) => [x, ys[j]]).filter(([, y]) => y != null);
    if (validPairs.length < featCols.length + 2) return 0;
    const Xmat = validPairs.map(([x]) => x);
    const yVec = validPairs.map(([, y]) => y);
    const coeffs = ols(Xmat, yVec);
    if (!coeffs) return 0;
    const preds = Xmat.map(x => x.reduce((s, v, k) => s + v * coeffs[k], 0));
    const actuals = yVec;
    return pearsonR2(preds, actuals);
  }

  const oosR2s = [];
  for (let si = 0; si < nSets; si++) {
    const trainIdxs = setIdxArrays[si];
    const testIdxs  = setIdxArrays.filter((_, j) => j !== si).flat();
    if (trainIdxs.length < featCols.length + 2) continue;
    if (testIdxs.length < 3) continue;

    // Build train matrix — filter rows where y is valid
    const trainValid = trainIdxs.filter(i => yCols_dv[i] != null);
    if (trainValid.length < featCols.length + 2) continue;
    const Xmat = trainValid.map(i => featCols.map(c => c[i] ?? 0));
    const yVec = trainValid.map(i => yCols_dv[i]);

    const coeffs = ols(Xmat, yVec);
    if (!coeffs) continue;

    // Predict on test set
    const testValid = testIdxs.filter(i => yCols_dv[i] != null);
    if (testValid.length < 3) continue;
    const preds   = testValid.map(i => featCols.reduce((s, c, k) => s + (c[i] ?? 0) * coeffs[k], 0));
    const actuals = testValid.map(i => yCols_dv[i]);
    oosR2s.push(pearsonR2(preds, actuals));
  }
  return avgMedMean(oosR2s);
}

// ── Forward selection per target ──────────────────────────────────────────────
// Returns { featureTargetMap, fwdSelScores, setNames }
function runForwardSelection(featNames, depVars, winnerMap, depCols, data, setIdxArrays, improvePct) {
  // Pre-build transformed columns for each feature
  const txCols = {};
  for (const feat of featNames) {
    const raw = data.map(r => { const v = Number(r[feat]); return isNaN(v) ? null : v; });
    txCols[feat] = applyTx(raw, winnerMap[feat]?.type || 'base');
  }

  // Individual net scores for seeding (already in winnerMap.scores)
  const indivScore = feat => {
    const scores = winnerMap[feat]?.scores || {};
    return netRsq(scores) ?? 0;
  };

  // Sort all features by individual score desc
  const sortedFeats = [...featNames].sort((a, b) => indivScore(b) - indivScore(a));

  const featureTargetMap = {};  // feat → [dvs it was kept for]
  const fwdSelScores     = {};  // dv → { feat: finalOosR2 }

  for (const dv of depVars) {
    fwdSelScores[dv] = {};
    const yCol = depCols[dv];

    // Seed: top 3 features by individual score
    const seed = sortedFeats.slice(0, Math.min(3, sortedFeats.length));
    const keptFeats = [...seed];

    // Baseline OOS R² with seed
    let currentOos = scoreOosByOls(keptFeats.map(f => txCols[f]), yCol, setIdxArrays);

    // Store seed scores
    for (const f of keptFeats) fwdSelScores[dv][f] = r3(currentOos);

    // Try adding each remaining feature
    for (const feat of sortedFeats) {
      if (keptFeats.includes(feat)) continue;
      const candidateFeats = [...keptFeats, feat];
      const candidateOos = scoreOosByOls(candidateFeats.map(f => txCols[f]), yCol, setIdxArrays);

      // Keep if improvement meets relative threshold
      const minRequired = currentOos * (1 + improvePct);
      if (candidateOos > minRequired) {
        keptFeats.push(feat);
        fwdSelScores[dv][feat] = r3(candidateOos);
        currentOos = candidateOos;
      }
    }

    // Populate featureTargetMap
    for (const f of keptFeats) {
      if (!featureTargetMap[f]) featureTargetMap[f] = [];
      if (!featureTargetMap[f].includes(dv)) featureTargetMap[f].push(dv);
    }
  }

  return { featureTargetMap, fwdSelScores };
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

  // ── Pass-Thru mode ──────────────────────────────────────────────────────────
  const feMode = cfg.fe_mode || 'Pass-Thru';
  if (feMode === 'Pass-Thru') {
    return runPassThru(data, featNames, depVars, setHeaders);
  }

  // ── Feature Engineering mode ────────────────────────────────────────────────
  const modelName  = (cfg.model_name || '').trim();
  const modelMode  = cfg.model_mode || 'New';
  const keyField   = (cfg.key_field  || 'symbol').trim();
  const modSep     = (cfg.key_modifier ?? '_').trim() || '_';
  const improvePct = parseFloat((cfg.fwd_improve_thresh || '1%').replace('%', '')) / 100;

  // Stored mode: replay saved transforms + featureTargetMap
  if (modelMode === 'Stored' && modelName) {
    const stored = (feRegistry || {})[modelName];
    if (!stored?.winnerMap) {
      console.warn(`[FeatureMux] No stored model "${modelName}" — falling back to pass-thru`);
      return runPassThru(data, featNames, depVars, setHeaders);
    }
    return runApply(data, featNames, stored.depVars || depVars, stored.winnerMap,
      stored.featureTargetMap || null, stored.fwdSelScores || null,
      stored.depVars || depVars, null, [], setHeaders, openFEDashboard, modelName);
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

  // Step 1: score transforms, pick winner per feature
  const winnerMap = {};
  for (const feat of featNames) {
    const col    = data.map(r => { const v = Number(r[feat]); return isNaN(v) ? null : v; });
    const txScores = scoreTxAcrossSets(col, depCols, setIdxArrays);
    const winner   = pickWinner(txScores, feat);
    winnerMap[feat] = { type: winner, scores: txScores[winner] };
  }

  // Step 2: forward selection — identifies per-target value-add features
  const { featureTargetMap, fwdSelScores } = runForwardSelection(
    featNames, depVars, winnerMap, depCols, data, setIdxArrays, improvePct
  );

  // Save to registry
  if (modelName && setFeRegistry) {
    const newEntry = {
      name: modelName, depVars, features: featNames,
      winnerMap, featureTargetMap, fwdSelScores,
      updated: new Date().toISOString(),
    };
    setFeRegistry({ ...(feRegistry || {}), [modelName]: newEntry });
  }

  return runApply(data, featNames, depVars, winnerMap, featureTargetMap, fwdSelScores,
    depVars, depCols, realMods, setHeaders, openFEDashboard, modelName);
}

// ── Pass-Thru helper ──────────────────────────────────────────────────────────
function runPassThru(data, featNames, depVars, setHeaders) {
  const featuresRows = data.map(r => {
    const row = {};
    featNames.forEach(f => { if (f in r) row[f] = r[f]; });
    return row;
  });
  const targetsRows = data.map(r => {
    const row = {};
    depVars.forEach(f => { if (f in r) row[f] = r[f]; });
    return row;
  });
  if (featNames.length) setHeaders(featNames);
  return {
    _rows: data, passthru: data,
    features: { _headers: featNames, _rows: featuresRows },
    targets:  { _headers: depVars,   _rows: targetsRows  },
    _headers_features: featNames,
    _headers_targets:  depVars,
  };
}

// ── Apply winners, build output, open dashboard ───────────────────────────────
function runApply(data, featNames, depVars, winnerMap, featureTargetMap, fwdSelScores,
    storedDepVars, depColsForRsq, setNames, setHeaders, openFEDashboard, modelName) {

  // Apply winning transforms to feature rows
  const featuresRows = data.map(r => {
    const row = {};
    for (const feat of featNames) {
      const txKey = winnerMap[feat]?.type || 'base';
      const raw   = r[feat];
      if (raw == null || !isFinite(Number(raw))) { row[feat] = raw ?? null; continue; }
      const fn  = TRANSFORMS[txKey] || TRANSFORMS.base;
      const out = fn(Number(raw));
      row[feat] = isFinite(out) ? out : null;
    }
    return row;
  });

  const targetsRows = data.map(r => {
    const row = {};
    storedDepVars.forEach(f => { if (f in r) row[f] = r[f]; });
    return row;
  });

  // Build RSQ rows — use fwdSelScores per dv when available, else winnerMap scores
  const feRsqRows = buildRsqRows(featNames, winnerMap, fwdSelScores, storedDepVars);

  if (featNames.length) setHeaders(featNames);

  // Open FE Dashboard
  if (openFEDashboard) {
    openFEDashboard({
      title:            `FE: ${modelName || 'results'}`,
      depVars:          storedDepVars,
      featNames,
      winnerMap,
      featureTargetMap: featureTargetMap || {},
      fwdSelScores:     fwdSelScores     || {},
      feRsqRows,
      setNames,
    });
  }

  return {
    _rows: data, passthru: data,
    features: {
      _headers: featNames, _rows: featuresRows, feRsqRows,
      featureTargetMap: featureTargetMap || {},
    },
    targets:  { _headers: storedDepVars, _rows: targetsRows },
    _headers_features: featNames,
    _headers_targets:  storedDepVars,
  };
}

// ── RSQ rows ─────────────────────────────────────────────────────────────────
// Per-dv score uses fwdSelScores[dv][feat] when available (OOS regression score),
// otherwise falls back to individual transform Pearson score from winnerMap.
function buildRsqRows(featNames, winnerMap, fwdSelScores, depVars) {
  const rows = [];
  featNames.forEach(feat => {
    const winner = winnerMap[feat];
    if (!winner) return;
    const row = { independent_variable: feat, xform: winner.type };
    const dvMap = {};
    for (const dv of depVars) {
      const score = fwdSelScores?.[dv]?.[feat] ?? r3(winner.scores?.[dv] ?? null);
      row[dv]    = score;
      if (score != null) dvMap[dv] = score;
    }
    row.Net_RSQ = r3(netRsq(dvMap));
    rows.push(row);
  });
  rows.sort((a, b) => (b.Net_RSQ ?? -1) - (a.Net_RSQ ?? -1));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}
