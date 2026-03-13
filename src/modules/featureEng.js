// ── Feature Mux / Feature Engineering ────────────────────────────────────────
// Pass-Thru mode: pure multiplexer — splits data into passthru/features/targets.
// Feature Engineering mode:
//   1. Score all transforms per feature across sets (Pearson R²), pick winner.
//   2. Forward-selection OOS loop per target (individual features).
//   3. Co-transform step: for each pair of value-add features, score mult/div
//      combinations and keep any that improve the base Pearson score per target.
//   4. Co-transform forward-selection: add 1 co-transform at a time per target,
//      keep if OOS R² improves by the relative threshold.
//   5. Output featureTargetMap (indiv + co), fwdSelScores, coTxMap.
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
// Multiply: straightforward, sign-preserving.
// Divide: asymptotic safe — when denominator is near zero the result softly
//   saturates rather than blowing up to ±Inf.  The asymptote is chosen
//   proportionally to the denominator's IQR so it adapts to each column's
//   scale and never hard-clips.
function coMult(aCol, bCol) {
  return aCol.map((a, i) => {
    const b = bCol[i];
    if (a == null || b == null) return null;
    const v = a * b;
    return isFinite(v) ? v : null;
  });
}

function coDiv(numCol, denCol) {
  // compute a scale-adaptive asymptote from the denominator's typical magnitude
  const finDen = denCol.filter(v => v != null && isFinite(v));
  if (!finDen.length) return denCol.map(() => null);
  const absVals = finDen.map(Math.abs).sort((a, b) => a - b);
  const q25 = absVals[Math.floor(absVals.length * 0.25)];
  const q75 = absVals[Math.floor(absVals.length * 0.75)];
  const iqr = Math.max(q75 - q25, EPS);
  // soft-safe denominator: sign(d) * max(|d|, iqr * 0.1)
  // keeps direction, prevents extreme values when |d| → 0
  return numCol.map((n, i) => {
    const d = denCol[i];
    if (n == null || d == null) return null;
    const safeDen = Math.sign(d || 1) * Math.max(Math.abs(d), iqr * 0.1);
    const v = n / safeDen;
    return isFinite(v) ? v : null;
  });
}

// co-transform key: "a×b" or "a÷b"
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

// ── Score a pre-built column (array) vs all DVs across sets ──────────────────
function scoreColAcrossSets(col, depCols, setIdxArrays) {
  const dvKeys = Object.keys(depCols);
  const dvMap  = {};
  for (const dv of dvKeys) {
    const yCol = depCols[dv];
    const setR2s = [];
    for (const idxs of setIdxArrays) {
      if (idxs.length < 3) continue;
      setR2s.push(pearsonR2(idxs.map(i => col[i]), idxs.map(i => yCol[i])));
    }
    dvMap[dv] = avgMedMean(setR2s);
  }
  return dvMap;   // { dv: r2 }
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

// ── OOS regression scoring (multivariate OLS) ─────────────────────────────────
// For each set: train on that set, score R² on all other sets.
// Returns avg(mean, median) across sets.
function scoreOosByOls(featCols, yCol, setIdxArrays) {
  const nSets = setIdxArrays.length;
  if (nSets < 2) {
    const allIdxs = setIdxArrays[0] || [];
    const validIdx = allIdxs.filter(i => yCol[i] != null);
    if (validIdx.length < featCols.length + 2) return 0;
    const Xmat = validIdx.map(i => featCols.map(c => c[i] ?? 0));
    const yVec = validIdx.map(i => yCol[i]);
    const coeffs = ols(Xmat, yVec);
    if (!coeffs) return 0;
    const preds = Xmat.map(x => x.reduce((s, v, k) => s + v * coeffs[k], 0));
    return pearsonR2(preds, yVec);
  }

  const oosR2s = [];
  for (let si = 0; si < nSets; si++) {
    const trainIdx = setIdxArrays[si].filter(i => yCol[i] != null);
    const testIdx  = setIdxArrays.filter((_, j) => j !== si).flat().filter(i => yCol[i] != null);
    if (trainIdx.length < featCols.length + 2) continue;
    if (testIdx.length  < 3) continue;
    const Xmat   = trainIdx.map(i => featCols.map(c => c[i] ?? 0));
    const yVec   = trainIdx.map(i => yCol[i]);
    const coeffs = ols(Xmat, yVec);
    if (!coeffs) continue;
    const preds   = testIdx.map(i => featCols.reduce((s, c, k) => s + (c[i] ?? 0) * coeffs[k], 0));
    const actuals = testIdx.map(i => yCol[i]);
    oosR2s.push(pearsonR2(preds, actuals));
  }
  return avgMedMean(oosR2s);
}

// ── Step 2: Forward selection (individual features) ────────────────────────────
// Greedy best-first: each round scores ALL remaining candidates against the
// current kept set and picks the one with the highest marginal OOS gain.
// This prevents a lower-Pearson feature from blocking a higher-marginal-gain
// feature that happens to be less correlated with the kept set.
function runForwardSelection(featNames, depVars, winnerMap, depCols, data, setIdxArrays, improvePct) {
  const txCols = {};
  for (const feat of featNames) {
    const raw = data.map(r => { const v = Number(r[feat]); return isNaN(v) ? null : v; });
    txCols[feat] = applyTx(raw, winnerMap[feat]?.type || 'base');
  }

  const indivScore = f => netRsq(winnerMap[f]?.scores || {}) ?? 0;
  // Initial sort by Pearson desc — determines the seed (top 3) and candidate pool order
  const sortedFeats = [...featNames].sort((a, b) => indivScore(b) - indivScore(a));

  const featureTargetMap = {};
  const fwdSelScores     = {};

  for (const dv of depVars) {
    fwdSelScores[dv] = {};
    const yCol = depCols[dv];

    // Seed: top 3 by individual Pearson
    const seed = sortedFeats.slice(0, Math.min(3, sortedFeats.length));
    const kept = [...seed];
    let currentOos = scoreOosByOls(kept.map(f => txCols[f]), yCol, setIdxArrays);
    for (const f of kept) fwdSelScores[dv][f] = r3(currentOos);

    // Greedy best-first for remaining candidates
    const remaining = new Set(sortedFeats.filter(f => !kept.includes(f)));

    while (remaining.size > 0) {
      let bestFeat = null;
      let bestOos  = -Infinity;

      for (const feat of remaining) {
        const candOos = scoreOosByOls([...kept, feat].map(f => txCols[f]), yCol, setIdxArrays);
        if (candOos > bestOos) { bestOos = candOos; bestFeat = feat; }
      }

      if (!bestFeat) break;
      remaining.delete(bestFeat);

      if (bestOos > currentOos * (1 + improvePct)) {
        kept.push(bestFeat);
        fwdSelScores[dv][bestFeat] = r3(bestOos);
        currentOos = bestOos;
      } else {
        // Best available candidate didn't clear the threshold — stop
        break;
      }
    }

    for (const f of kept) {
      if (!featureTargetMap[f]) featureTargetMap[f] = [];
      if (!featureTargetMap[f].includes(dv)) featureTargetMap[f].push(dv);
    }
  }

  return { featureTargetMap, fwdSelScores, txCols };
}

// ── Step 3: Co-transform scoring ──────────────────────────────────────────────
// Anchor features (value-add) are tested on the a-side AND b-side.
// Unused features (did not make individual fwd-sel) are tested as b-side only —
// they never anchor a pair but can act as a "modifier" paired with every
// value-add anchor.  unused×unused pairs are skipped (low signal, high noise).
//
// Screening gate: co-tx must beat BOTH constituent individual Pearson scores for
// at least one target before entering forward-selection.
//
// Returns:
//   coTxMap:   { coKey: { op:'×'|'÷', a, b, col, scores:{dv:r2} } }
//   coTxByDv:  { dv: [coKey sorted by score desc] }
function buildCoTransforms(valueAddFeats, allFeats, txCols, depCols, setIdxArrays, winnerMap) {
  const coTxMap  = {};
  const coTxByDv = {};
  const unusedSet = new Set(allFeats.filter(f => !valueAddFeats.includes(f)));

  for (const dv of Object.keys(depCols)) coTxByDv[dv] = [];

  // Iterate all ordered (a, b) pairs where:
  //   a ∈ valueAddFeats   (always an anchor)
  //   b ∈ allFeats, b ≠ a (value-add or unused)
  for (const a of valueAddFeats) {
    for (const b of allFeats) {
      if (a === b) continue;

      const colMult = coMult(txCols[a], txCols[b]);
      const colDiv  = coDiv(txCols[a], txCols[b]);

      for (const [col, op] of [[colMult, '×'], [colDiv, '÷']]) {
        const key = coKey(a, b, op);
        // For multiply, skip the reverse pair a×b when b×a already exists
        // (only applies when both are value-add; unused is always b-side so no dup)
        if (op === '×' && !unusedSet.has(b) && coTxMap[coKey(b, a, '×')]) continue;

        const scoresDv = scoreColAcrossSets(col, depCols, setIdxArrays);
        const aScores  = winnerMap[a]?.scores || {};
        const bScores  = winnerMap[b]?.scores || {};

        // At least one DV where co-tx score > max of both individual scores
        const anyGain = Object.keys(depCols).some(dv => {
          return (scoresDv[dv] ?? 0) > Math.max(aScores[dv] ?? 0, bScores[dv] ?? 0) + 1e-6;
        });
        if (!anyGain) continue;

        coTxMap[key] = { op, a, b, col, scores: scoresDv };
        for (const dv of Object.keys(depCols)) {
          if ((scoresDv[dv] ?? 0) > 0) coTxByDv[dv].push(key);
        }
      }
    }
  }

  // Sort each dv list by score desc
  for (const dv of Object.keys(depCols)) {
    coTxByDv[dv].sort((x, y) => (coTxMap[y]?.scores[dv] ?? 0) - (coTxMap[x]?.scores[dv] ?? 0));
  }

  return { coTxMap, coTxByDv };
}

// ── Step 4: Co-transform forward selection ────────────────────────────────────
// For each target: start from the OOS baseline reached by individual fwd-sel,
// try co-transforms using a greedy best-first search.
//
// Each iteration: evaluate ALL remaining candidates against the current kept set,
// pick the one with the highest marginal OOS R², keep it if it clears the
// relative improvement threshold, then repeat.  This ensures a co-transform
// with a weaker standalone Pearson score but higher marginal contribution isn't
// blocked by a weaker co-transform that "took the slot" earlier due to
// Pearson-ordering alone.
function runCoFwdSelection(
  depVars, depCols, setIdxArrays,
  keptIndivColsByDv, coTxMap, coTxByDv,
  fwdSelScores, featureTargetMap, improvePct
) {
  const coTargetMap = {};
  const coSelScores = {};

  for (const dv of depVars) {
    coSelScores[dv] = {};
    const yCol      = depCols[dv];
    const indivCols = keptIndivColsByDv[dv] || [];

    let currentOos   = indivCols.length ? scoreOosByOls(indivCols, yCol, setIdxArrays) : 0;
    const keptCoKeys = [];
    const remaining  = new Set(
      // Only consider candidates that had any Pearson signal for this dv
      (coTxByDv[dv] || []).filter(k => coTxMap[k])
    );

    // Greedy best-first: each round pick the candidate with the highest marginal OOS gain
    while (remaining.size > 0) {
      let bestKey  = null;
      let bestOos  = -Infinity;

      for (const key of remaining) {
        const entry   = coTxMap[key];
        const colSet  = [...indivCols, ...keptCoKeys.map(k => coTxMap[k].col), entry.col];
        const candOos = scoreOosByOls(colSet, yCol, setIdxArrays);
        if (candOos > bestOos) { bestOos = candOos; bestKey = key; }
      }

      if (!bestKey) break;
      remaining.delete(bestKey);

      if (bestOos > currentOos * (1 + improvePct)) {
        keptCoKeys.push(bestKey);
        coSelScores[dv][bestKey] = r3(bestOos);
        if (!coTargetMap[bestKey]) coTargetMap[bestKey] = [];
        if (!coTargetMap[bestKey].includes(dv)) coTargetMap[bestKey].push(dv);
        for (const feat of [coTxMap[bestKey].a, coTxMap[bestKey].b]) {
          if (!featureTargetMap[feat]) featureTargetMap[feat] = [];
          if (!featureTargetMap[feat].includes(dv)) featureTargetMap[feat].push(dv);
        }
        currentOos = bestOos;
      } else {
        // Best available candidate didn't clear the threshold — no point continuing
        break;
      }
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

  const modelName  = (cfg.model_name || '').trim();
  const modelMode  = cfg.model_mode || 'New';
  const keyField   = (cfg.key_field  || 'symbol').trim();
  const modSep     = (cfg.key_modifier ?? '_').trim() || '_';
  const improvePct = parseFloat((cfg.fwd_improve_thresh || '1%').replace('%', '')) / 100;

  // Stored mode: replay saved model
  if (modelMode === 'Stored' && modelName) {
    const stored = (feRegistry || {})[modelName];
    if (!stored?.winnerMap) {
      console.warn(`[FeatureMux] No stored model "${modelName}" — falling back to pass-thru`);
      return runPassThru(data, featNames, depVars, setHeaders);
    }
    return runApply(data, featNames, stored.depVars || depVars, stored.winnerMap,
      stored.featureTargetMap || null, stored.fwdSelScores || null,
      stored.coTxMap || {}, stored.coTargetMap || {},
      stored.coSelScores || {}, stored.depVars || depVars, null, [], setHeaders, openFEDashboard, modelName);
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
  for (const feat of featNames) {
    const col      = data.map(r => { const v = Number(r[feat]); return isNaN(v) ? null : v; });
    const txScores = scoreTxAcrossSets(col, depCols, setIdxArrays);
    const winner   = pickWinner(txScores, feat);
    winnerMap[feat] = { type: winner, scores: txScores[winner] };
  }

  // Step 2: individual forward selection
  const { featureTargetMap, fwdSelScores, txCols } = runForwardSelection(
    featNames, depVars, winnerMap, depCols, data, setIdxArrays, improvePct
  );

  // De-duplicated union of all value-add features
  const valueAddFeats = [...new Set(Object.keys(featureTargetMap))];

  // Kept individual column lists per dv (for co-fwd-selection baseline)
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

  // Step 4: co-transform forward selection per target
  const { coTargetMap, coSelScores } = Object.keys(coTxMap).length
    ? runCoFwdSelection(depVars, depCols, setIdxArrays,
        keptIndivColsByDv, coTxMap, coTxByDv,
        fwdSelScores, featureTargetMap, improvePct)
    : { coTargetMap: {}, coSelScores: {} };

  // Save to registry
  if (modelName && setFeRegistry) {
    setFeRegistry({
      ...(feRegistry || {}),
      [modelName]: {
        name: modelName, depVars, features: featNames,
        winnerMap, featureTargetMap, fwdSelScores,
        coTxMap:     sanitizeCoTxForStorage(coTxMap),
        coTargetMap, coSelScores,
        updated: new Date().toISOString(),
      },
    });
  }

  return runApply(data, featNames, depVars, winnerMap, featureTargetMap, fwdSelScores,
    coTxMap, coTargetMap, coSelScores,
    depVars, depCols, realMods, setHeaders, openFEDashboard, modelName);
}

// Strip computed `col` arrays before persisting (they'd waste memory in registry)
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

// ── Apply winners, build output, open dashboard ───────────────────────────────
function runApply(data, featNames, depVars, winnerMap, featureTargetMap, fwdSelScores,
    coTxMap, coTargetMap, coSelScores,
    storedDepVars, depColsForRsq, setNames, setHeaders, openFEDashboard, modelName) {

  // Apply winning individual transforms
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
    // Apply co-transforms that passed forward selection (in coTargetMap)
    for (const [key, entry] of Object.entries(coTxMap)) {
      if (!coTargetMap[key]?.length) continue;
      if (!entry.col) continue;  // no pre-built col in stored mode — recompute below
      row[key] = null;  // will be populated from pre-built col; fallback row-level below
    }
    return row;
  });

  // For co-transforms with pre-built col arrays, inject values row-by-row
  for (const [key, entry] of Object.entries(coTxMap)) {
    if (!coTargetMap[key]?.length) continue;
    if (!entry.col) continue;
    entry.col.forEach((v, i) => { featuresRows[i][key] = v; });
  }

  const targetsRows = data.map(r => {
    const row = {}; storedDepVars.forEach(f => { if (f in r) row[f] = r[f]; }); return row;
  });

  // All output column names: individual features + kept co-transforms
  const coKeys    = Object.keys(coTxMap).filter(k => coTargetMap[k]?.length);
  const allCols   = [...featNames, ...coKeys];

  // Combined featureTargetMap: individual + co-transforms
  const combinedFtMap = { ...featureTargetMap };
  for (const k of coKeys) { combinedFtMap[k] = coTargetMap[k]; }

  const feRsqRows = buildRsqRows(featNames, winnerMap, fwdSelScores, coTxMap, coTargetMap, coSelScores, storedDepVars);

  if (featNames.length) setHeaders(allCols);

  if (openFEDashboard) {
    openFEDashboard({
      title:            `FE: ${modelName || 'results'}`,
      depVars:          storedDepVars,
      featNames,
      coKeys,
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
    _rows: data, passthru: data,
    features: {
      _headers: allCols, _rows: featuresRows, feRsqRows,
      featureTargetMap: combinedFtMap,
    },
    targets:  { _headers: storedDepVars, _rows: targetsRows },
    _headers_features: allCols,
    _headers_targets:  storedDepVars,
  };
}

// ── RSQ rows (individual + co-transforms) ─────────────────────────────────────
function buildRsqRows(featNames, winnerMap, fwdSelScores, coTxMap, coTargetMap, coSelScores, depVars) {
  const rows = [];

  // Individual features
  for (const feat of featNames) {
    const winner = winnerMap[feat];
    if (!winner) continue;
    const row = { independent_variable: feat, xform: winner.type, kind: 'indiv' };
    const dvMap = {};
    for (const dv of depVars) {
      const score = fwdSelScores?.[dv]?.[feat] ?? r3(winner.scores?.[dv] ?? null);
      row[dv] = score;
      if (score != null) dvMap[dv] = score;
    }
    row.Net_RSQ = r3(netRsq(dvMap));
    rows.push(row);
  }

  // Co-transforms that passed fwd-sel
  for (const [key, entry] of Object.entries(coTxMap)) {
    if (!coTargetMap[key]?.length) continue;
    const row = { independent_variable: key, xform: entry.op, kind: 'co' };
    const dvMap = {};
    for (const dv of depVars) {
      const score = coSelScores?.[dv]?.[key] ?? r3(entry.scores?.[dv] ?? null);
      row[dv] = score;
      if (score != null) dvMap[dv] = score;
    }
    row.Net_RSQ = r3(netRsq(dvMap));
    rows.push(row);
  }

  rows.sort((a, b) => (b.Net_RSQ ?? -1) - (a.Net_RSQ ?? -1));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}
