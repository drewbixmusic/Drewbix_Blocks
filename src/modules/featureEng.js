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
function scoreOosByOls(featCols, yCol, setIdxArrays) {
  const nSets = setIdxArrays.length;
  if (nSets < 2) {
    const validIdx = (setIdxArrays[0] || []).filter(i => yCol[i] != null);
    if (validIdx.length < featCols.length + 2) return null;
    const Xmat   = validIdx.map(i => featCols.map(c => c[i] ?? 0));
    const yVec   = validIdx.map(i => yCol[i]);
    const coeffs = ols(Xmat, yVec);
    if (!coeffs) return null;
    return pearsonR2(Xmat.map(x => x.reduce((s, v, k) => s + v * coeffs[k], 0)), yVec);
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
    oosR2s.push(pearsonR2(preds, testIdx.map(i => yCol[i])));
  }
  return oosR2s.length ? avgMedMean(oosR2s) : null;
}

// ── Greedy per-target forward selection ───────────────────────────────────────
// Each target runs its own independent greedy search over ALL features.
// No global pre-filter — a feature that is individually weak overall can still
// be excellent for a specific target.
//
// Returns { featureTargetMap, fwdSelScores, txCols }
function runForwardSelection(allCandidates, candidateCols, depVars, winnerMap, depCols, setIdxArrays, improvePct) {
  const featureTargetMap = {};
  const fwdSelScores     = {};

  // Sort candidates by per-target individual Pearson score for each dv
  for (const dv of depVars) {
    fwdSelScores[dv] = {};
    const yCol = depCols[dv];

    if (!allCandidates.length) continue;

    // Per-target sort: best individual Pearson for this specific dv first
    const sortedForDv = [...allCandidates].sort((a, b) => {
      const sa = winnerMap[a]?.scores?.[dv] ?? 0;
      const sb = winnerMap[b]?.scores?.[dv] ?? 0;
      return sb - sa;
    });

    // Seed: single best feature for this specific dv
    const seed = sortedForDv[0];
    const kept = [seed];
    let currentOos = scoreOosByOls([candidateCols[seed]], yCol, setIdxArrays);
    if (currentOos == null) currentOos = winnerMap[seed]?.scores?.[dv] ?? 0;
    fwdSelScores[dv][seed] = r3(currentOos);

    const remaining = new Set(sortedForDv.slice(1));

    while (remaining.size > 0) {
      let bestFeat = null;
      let bestOos  = -Infinity;

      for (const feat of remaining) {
        let candOos = scoreOosByOls([...kept, feat].map(f => candidateCols[f]), yCol, setIdxArrays);
        if (candOos == null) candOos = winnerMap[feat]?.scores?.[dv] ?? 0;
        if (candOos > bestOos) { bestOos = candOos; bestFeat = feat; }
      }

      if (!bestFeat) break;
      remaining.delete(bestFeat);

      if (bestOos > currentOos * (1 + improvePct)) {
        kept.push(bestFeat);
        fwdSelScores[dv][bestFeat] = r3(bestOos);
        currentOos = bestOos;
      } else {
        break;
      }
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

// ── Greedy co-transform forward selection per target ──────────────────────────
// Each target starts from its individual feature OOS baseline and greedily adds
// co-transforms that provide the highest marginal OOS gain.
function runCoFwdSelection(
  depVars, depCols, setIdxArrays,
  keptIndivColsByDv, coTxMap, coTxByDv,
  featureTargetMap, improvePct
) {
  const coTargetMap = {};
  const coSelScores = {};

  for (const dv of depVars) {
    coSelScores[dv] = {};
    const yCol      = depCols[dv];
    const indivCols = keptIndivColsByDv[dv] || [];

    let currentOos = indivCols.length ? (scoreOosByOls(indivCols, yCol, setIdxArrays) ?? 0) : 0;
    const keptCoKeys = [];
    const remaining  = new Set((coTxByDv[dv] || []).filter(k => coTxMap[k]));

    while (remaining.size > 0) {
      let bestKey  = null;
      let bestOos  = -Infinity;

      for (const key of remaining) {
        const entry   = coTxMap[key];
        const colSet  = [...indivCols, ...keptCoKeys.map(k => coTxMap[k].col), entry.col];
        const candOos = scoreOosByOls(colSet, yCol, setIdxArrays) ?? (entry.scores?.[dv] ?? 0);
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
        break;
      }
    }
  }

  return { coTargetMap, coSelScores };
}

// ── Build per-target OLS prediction column (FE_<dv>) ─────────────────────────
// Train on all data (combined sets) for final in-sample prediction.
// Uses the kept individual + co-transform columns for each target.
function buildFePredCols(depVars, depCols, setIdxArrays, keptColsByDv) {
  const nRows = depCols[depVars[0]]?.length ?? 0;
  const fePreds = {};  // dv → Float64Array-like number[]

  for (const dv of depVars) {
    const yCol     = depCols[dv];
    const featCols = keptColsByDv[dv] || [];
    if (!featCols.length) { fePreds[dv] = new Array(nRows).fill(null); continue; }

    // Combine all sets for a full-data OLS fit
    const validIdx = Array.from({ length: nRows }, (_, i) => i).filter(i => yCol[i] != null);
    if (validIdx.length < featCols.length + 2) { fePreds[dv] = new Array(nRows).fill(null); continue; }

    const Xmat   = validIdx.map(i => featCols.map(c => c[i] ?? 0));
    const yVec   = validIdx.map(i => yCol[i]);
    const coeffs = ols(Xmat, yVec);
    if (!coeffs) { fePreds[dv] = new Array(nRows).fill(null); continue; }

    const predCol = new Array(nRows).fill(null);
    for (let i = 0; i < nRows; i++) {
      const x = featCols.map(c => c[i] ?? 0);
      const p = x.reduce((s, v, k) => s + v * coeffs[k], 0);
      predCol[i] = isFinite(p) ? p : null;
    }
    fePreds[dv] = predCol;
  }

  return fePreds;
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
      console.warn(`[FE] No stored model "${modelName}" — falling back to pass-thru`);
      return runPassThru(data, featNames, depVars, setHeaders);
    }
    return runApply(data, featNames, stored.depVars || depVars, stored.winnerMap,
      stored.featureTargetMap || {}, stored.fwdSelScores || {},
      stored.coTxMap || {}, stored.coTargetMap || {}, stored.coSelScores || {},
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
    featNames, txCols, depVars, winnerMap, depCols, setIdxArrays, improvePct
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
        keptIndivColsByDv, coTxMap, coTxByDv, featureTargetMap, improvePct)
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
    depVars, depCols, realMods, setHeaders, openFEDashboard, modelName);
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
    storedDepVars, depCols, setNames, setHeaders, openFEDashboard, modelName) {

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
    if (!entry.col) {
      // Stored mode: recompute col
      const aCol = txCols[entry.a] || new Array(nRows).fill(null);
      const bCol = txCols[entry.b] || new Array(nRows).fill(null);
      entry.col  = entry.op === '×' ? coMult(aCol, bCol) : coDiv(aCol, bCol);
    }
    entry.col.forEach((v, i) => { featuresRows[i][key] = v; });
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

  // Step 5: build FE_<dv> prediction columns
  const fePredCols = depCols
    ? buildFePredCols(storedDepVars, depCols, null, keptAllColsByDv)
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
    coTxMap, coTargetMap, coSelScores, storedDepVars);

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

// ── RSQ rows (individual + co-transforms) ─────────────────────────────────────
function buildRsqRows(featNames, winnerMap, fwdSelScores, coTxMap, coTargetMap, coSelScores, depVars) {
  const rows = [];

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

// ── buildFePredCols: full-data OLS fit per target using kept feature columns ──
function buildFePredCols(depVars, depCols, _setIdxArrays, keptColsByDv) {
  const nRows   = depCols[depVars[0]]?.length ?? 0;
  const fePreds = {};

  for (const dv of depVars) {
    const yCol     = depCols[dv];
    const featCols = keptColsByDv[dv] || [];
    if (!featCols.length || !yCol) { fePreds[dv] = new Array(nRows).fill(null); continue; }

    const validIdx = Array.from({ length: nRows }, (_, i) => i).filter(i => yCol[i] != null);
    if (validIdx.length < featCols.length + 2) { fePreds[dv] = new Array(nRows).fill(null); continue; }

    const Xmat   = validIdx.map(i => featCols.map(c => c[i] ?? 0));
    const yVec   = validIdx.map(i => yCol[i]);
    const coeffs = ols(Xmat, yVec);
    if (!coeffs) { fePreds[dv] = new Array(nRows).fill(null); continue; }

    const predCol = new Array(nRows).fill(null);
    for (let i = 0; i < nRows; i++) {
      const p = featCols.reduce((s, c, k) => s + (c[i] ?? 0) * coeffs[k], 0);
      predCol[i] = isFinite(p) ? p : null;
    }
    fePreds[dv] = predCol;
  }

  return fePreds;
}
