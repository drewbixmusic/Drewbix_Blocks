// ── Feature Mux / Feature Engineering ────────────────────────────────────────
// Pass-Thru mode: pure multiplexer — splits data into passthru/features/targets.
// Feature Engineering mode: scores all transforms per feature across sets using
// Pearson R², picks the winner per feature, optionally stores the model.
// Stored mode: replays saved winner transforms on new data without re-scoring.

import { pearsonR2 } from '../utils/math.js';

// ── Safe transforms ───────────────────────────────────────────────────────────
// All handle zero-crossings, negatives, and NaN/Inf without errors.
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
// Groups row indices by modifier suffix on the key field.
// E.g. key_modifier='_', 'SPY_1' → mod='1', 'SPY_2' → mod='2'.
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

// ── Scoring ───────────────────────────────────────────────────────────────────
// Returns { [txKey]: { [dv]: r2 } } for all transforms × targets.
// Uses per-set R² averaged with avg(mean, median).
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
        const r2 = pearsonR2(xs, ys);
        setR2s.push(r2);
      }

      if (!setR2s.length) { result[txKey][dv] = 0; continue; }

      const mn = setR2s.reduce((s, v) => s + v, 0) / setR2s.length;
      const sorted = [...setR2s].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      result[txKey][dv] = (mn + med) / 2;
    }
  }
  return result;
}

// ── Winner selection ──────────────────────────────────────────────────────────
// finalScore per transform = mean across all dep vars of avg(mean,median) set R².
// Tie: base wins. Tie with no base: deterministic pick via feature name hash.
function pickWinner(txScores, featName) {
  const dvKeys = Object.keys(txScores[TRANSFORM_KEYS[0]] || {});
  if (!dvKeys.length) return 'base';

  let bestKey = null, bestScore = -Infinity;

  for (const txKey of TRANSFORM_KEYS) {
    const dvMap = txScores[txKey] || {};
    const vals = dvKeys.map(dv => dvMap[dv] ?? 0);
    const score = vals.reduce((s, v) => s + v, 0) / vals.length;

    if (score > bestScore + 1e-12) {
      bestScore = score;
      bestKey = txKey;
    } else if (Math.abs(score - bestScore) <= 1e-12) {
      // Tie: base always wins over non-base
      if (txKey === 'base') bestKey = 'base';
      else if (bestKey !== 'base') {
        // Deterministic tiebreak: use feature name hash + txKey to pick consistently
        const hashA = simpleHash(featName + bestKey);
        const hashB = simpleHash(featName + txKey);
        if (hashB < hashA) bestKey = txKey;
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

// ── Net RSQ: avg(mean, median) across dep vars ────────────────────────────────
function netRsq(dvMap) {
  const vals = Object.values(dvMap).filter(v => v != null && isFinite(v));
  if (!vals.length) return null;
  const mn = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return (mn + med) / 2;
}

function r3(v) { return v == null ? null : Math.round(v * 1000) / 1000; }

// ── Main export ───────────────────────────────────────────────────────────────
export function runFeatureEngineering(node, { cfg, inputs, setHeaders, feRegistry, setFeRegistry }) {
  const data = Array.isArray(inputs.data) ? inputs.data : [];
  const fe        = cfg.fe || {};
  const depVars   = Array.isArray(fe.dep) ? fe.dep : [];
  const featVars  = Array.isArray(fe.indep)
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

  // Stored mode: replay saved transforms
  if (modelMode === 'Stored' && modelName) {
    const stored = (feRegistry || {})[modelName];
    if (!stored?.winnerMap) {
      console.warn(`[FeatureMux] No stored model "${modelName}" — falling back to pass-thru`);
      return runPassThru(data, featNames, depVars, setHeaders);
    }
    return runApply(data, featNames, depVars, stored.winnerMap, stored.depVars || depVars, null, setHeaders);
  }

  // New / Replace: score transforms across sets and pick winners
  if (!featNames.length || !depVars.length) return runPassThru(data, featNames, depVars, setHeaders);

  // Build dep var columns
  const depCols = {};
  for (const dv of depVars) {
    depCols[dv] = data.map(r => { const v = Number(r[dv]); return isNaN(v) ? null : v; });
  }

  // Detect sets
  const modGroups = parseModGroups(data, keyField, modSep);
  const realMods  = [...modGroups.keys()].filter(m => m !== '__none__');
  const setIdxArrays = realMods.length >= 2
    ? realMods.map(m => modGroups.get(m))
    : [data.map((_, i) => i)];  // no sets: treat all as one

  // Score and pick winner per feature
  const winnerMap = {};  // { featName: { type, scores: { dv: r2 } } }
  for (const feat of featNames) {
    const col = data.map(r => { const v = Number(r[feat]); return isNaN(v) ? null : v; });
    const txScores = scoreTxAcrossSets(col, depCols, setIdxArrays);
    const winner   = pickWinner(txScores, feat);
    winnerMap[feat] = { type: winner, scores: txScores[winner] };
  }

  // Save to registry
  if (modelName && setFeRegistry) {
    const newEntry = {
      name:      modelName,
      depVars,
      features:  featNames,
      winnerMap,
      updated:   new Date().toISOString(),
    };
    const reg = feRegistry || {};
    setFeRegistry({ ...reg, [modelName]: newEntry });
  }

  return runApply(data, featNames, depVars, winnerMap, depVars, depCols, setHeaders);
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

// ── Apply winners and build output ────────────────────────────────────────────
// depColsForRsq: pre-computed dep cols (for RSQ table). null if Stored mode.
function runApply(data, featNames, depVars, winnerMap, storedDepVars, depColsForRsq, setHeaders) {
  // Transform data rows
  const featuresRows = data.map(r => {
    const row = {};
    for (const feat of featNames) {
      const winner = winnerMap[feat];
      const txKey  = winner?.type || 'base';
      const raw    = r[feat];
      if (raw == null || !isFinite(Number(raw))) { row[feat] = raw ?? null; continue; }
      const v = Number(raw);
      const fn = TRANSFORMS[txKey] || TRANSFORMS.base;
      const out = fn(v);
      row[feat] = isFinite(out) ? out : null;
    }
    return row;
  });

  const targetsRows = data.map(r => {
    const row = {};
    storedDepVars.forEach(f => { if (f in r) row[f] = r[f]; });
    return row;
  });

  // Build RSQ rows for the features port bundle
  const feRsqRows = buildRsqRows(featNames, winnerMap, depVars, depColsForRsq);

  if (featNames.length) setHeaders(featNames);

  return {
    _rows: data, passthru: data,
    features: { _headers: featNames, _rows: featuresRows, feRsqRows },
    targets:  { _headers: storedDepVars, _rows: targetsRows },
    _headers_features: featNames,
    _headers_targets:  storedDepVars,
  };
}

// ── RSQ table rows ────────────────────────────────────────────────────────────
function buildRsqRows(featNames, winnerMap, depVars, depCols) {
  const rows = [];
  featNames.forEach((feat, i) => {
    const winner = winnerMap[feat];
    if (!winner) return;
    const row = {
      independent_variable: feat,
      xform:                winner.type,
      rank:                 i + 1,
    };
    // Per-dv scores from stored winner scores
    const dvMap = winner.scores || {};
    for (const dv of depVars) {
      row[dv] = r3(dvMap[dv] ?? null);
    }
    row.Net_RSQ = r3(netRsq(dvMap));
    rows.push(row);
  });
  // Re-rank by Net_RSQ descending
  rows.sort((a, b) => (b.Net_RSQ ?? -1) - (a.Net_RSQ ?? -1));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}
