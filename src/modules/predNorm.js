// ══════════════════════════════════════════════════════════════
// PREDICTION NORMALIZER  (pred_normalize)
//
// Two-input block:
//   inputs.model  — actual model-space time series (one set per symbol)
//   inputs.data   — prediction-space rows (RF/MV output, one set per symbol)
//
// Config fields:
//   key_field       — shared key column (e.g. 'symbol')
//   model_t_field   — time column in model rows (for t0 reference)
//   pred_t_field    — time column in prediction rows (for t0 reference)
//   model_targets   — model-side value columns (volatility reference), e.g. ['val_raw','val_avg']
//   pred_targets    — prediction-side columns to normalize, paired by order with model_targets
//                     e.g. ['forest_A_val_raw','forest_A_val_avg']
//   env_pos_field   — positive envelope column in prediction rows
//   env_neg_field   — negative envelope column in prediction rows
//
// Per-symbol pipeline:
//   1. Pair model_targets[i] ↔ pred_targets[i] (by position)
//   2. Compute model std dev per pair from model rows
//   3. Compute pred std dev per pair from pred rows
//   4. Scale pred column: model_std / pred_std (compress always; expand only if enabled)
//   5. Offset: subtract the prediction value at the row closest to pred_t_field≈0
//   6. Transient clean against env+/env- using blend/clamp/kill
//
// If model is not connected, skip steps 1-4 (only offset + transient clean).
// If only data is connected (no model), model_targets can fall back to pred_targets
// for the volatility reference (no-op since same column).
// ══════════════════════════════════════════════════════════════

function stddev(vals) {
  const finite = vals.filter(v => isFinite(v));
  if (finite.length < 2) return 0;
  const mean = finite.reduce((s, v) => s + v, 0) / finite.length;
  const variance = finite.reduce((s, v) => s + (v - mean) ** 2, 0) / finite.length;
  return Math.sqrt(variance);
}

// Asymptotic weight: maps overage ratio (0 = no overage) to blend weight 0→1.
// k is tuned so that at overage = maxMultMinus1 the weight is ~0.9.
function asympWeight(overage, maxMultMinus1) {
  if (maxMultMinus1 <= 0) return 1;
  const k = 9 / maxMultMinus1;
  return 1 - 1 / (1 + k * overage);
}

function parseList(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

function groupByKey(rows, keyField) {
  const groups = {};
  for (const row of rows) {
    const k = row[keyField] ?? '__all__';
    if (!groups[k]) groups[k] = [];
    groups[k].push(row);
  }
  return groups;
}

export function runPredNorm(node, { cfg, inputs, setHeaders }) {
  const predRows  = (inputs.data  || []).filter(r => r && typeof r === 'object');
  const modelRows = (inputs.model || []).filter(r => r && typeof r === 'object');

  if (!predRows.length) return { data: [], _rows: [] };

  const keyField     = (cfg.key_field       || 'symbol').trim();
  const modelTField  = (cfg.model_t_field   || 't_rel').trim();
  const predTField   = (cfg.pred_t_field    || 't_rel').trim();
  const modelTargets = parseList(cfg.model_targets);
  const predTargets  = parseList(cfg.pred_targets);

  // If pred_targets empty, fall back to model_targets (same-name assumption)
  const effectivePredTargets = predTargets.length ? predTargets : modelTargets;
  // If model_targets empty but pred_targets set, use pred for vol reference too
  const effectiveModelTargets = modelTargets.length ? modelTargets : effectivePredTargets;

  const envPos       = (cfg.env_pos_field   || '').trim();
  const envNeg       = (cfg.env_neg_field   || '').trim();
  const mode         = cfg.transient_mode   || 'blend';
  const maxMultRaw   = cfg.max_overage_mult || '1.5';
  const maxMult      = maxMultRaw === 'Off' ? Infinity : parseFloat(maxMultRaw);
  const doExpand     = !!cfg.expand;

  // Number of pairs = length of the shorter list
  const numPairs = Math.min(effectiveModelTargets.length, effectivePredTargets.length);

  if (numPairs === 0) {
    // Nothing configured — pass through unchanged
    if (predRows.length) setHeaders(Object.keys(predRows[0]).filter(k => !k.startsWith('_')));
    return { data: predRows, _rows: predRows };
  }

  const hasModelInput = modelRows.length > 0;

  // ── Group by key ──────────────────────────────────────────────────────────
  const modelGroups = hasModelInput ? groupByKey(modelRows, keyField) : {};
  const predGroups  = groupByKey(predRows, keyField);

  const out = [];

  for (const [sym, pRows] of Object.entries(predGroups)) {
    // Model rows for this symbol (may be from model input or fall back to pred rows)
    const mRows = hasModelInput
      ? (modelGroups[sym] || [])
      : pRows; // no model input → use pred rows for self-referential vol (scale=1)

    // ── Step 1: per-pair scale factors ────────────────────────────────────
    const scaleFactor = {}; // keyed by predCol
    for (let i = 0; i < numPairs; i++) {
      const modelCol = effectiveModelTargets[i];
      const predCol  = effectivePredTargets[i];

      const ms = mRows.length >= 3
        ? stddev(mRows.map(r => Number(r[modelCol])))
        : null;

      const ps = stddev(pRows.map(r => Number(r[predCol])));

      if (ms === null || ps === 0 || !isFinite(ps)) {
        scaleFactor[predCol] = 1;
      } else if (ps > ms) {
        scaleFactor[predCol] = ms / ps;
      } else if (doExpand && ps < ms) {
        scaleFactor[predCol] = ms / ps;
      } else {
        scaleFactor[predCol] = 1;
      }
    }

    // ── Step 2: apply scale ───────────────────────────────────────────────
    const scaled = pRows.map(r => {
      const copy = { ...r };
      for (let i = 0; i < numPairs; i++) {
        const predCol = effectivePredTargets[i];
        const v = Number(copy[predCol]);
        if (isFinite(v)) copy[predCol] = v * scaleFactor[predCol];
      }
      return copy;
    });

    // ── Step 3: offset — find t0 row (pred t-field closest to 0) ─────────
    let t0Idx = 0;
    let minAbsT = Infinity;
    for (let i = 0; i < scaled.length; i++) {
      const tv = Math.abs(Number(scaled[i][predTField]));
      if (isFinite(tv) && tv < minAbsT) { minAbsT = tv; t0Idx = i; }
    }

    const t0Offsets = {};
    for (let i = 0; i < numPairs; i++) {
      const predCol = effectivePredTargets[i];
      const v = Number(scaled[t0Idx]?.[predCol]);
      t0Offsets[predCol] = isFinite(v) ? v : 0;
    }

    for (const row of scaled) {
      for (let i = 0; i < numPairs; i++) {
        const predCol = effectivePredTargets[i];
        const v = Number(row[predCol]);
        if (isFinite(v)) row[predCol] = v - t0Offsets[predCol];
      }
    }

    // ── Step 4: transient cleaning ────────────────────────────────────────
    const maxMultMinus1 = isFinite(maxMult) ? maxMult - 1 : null;

    for (const row of scaled) {
      let kill = false;

      for (let i = 0; i < numPairs; i++) {
        const predCol = effectivePredTargets[i];
        const v = Number(row[predCol]);
        if (!isFinite(v)) continue;

        const envField = v >= 0 ? envPos : envNeg;
        if (!envField) continue;

        const envVal = Number(row[envField]);
        if (!isFinite(envVal) || envVal === 0) continue;

        const absV   = Math.abs(v);
        const absEnv = Math.abs(envVal);

        if (absV <= absEnv) continue; // within envelope

        const ratio   = absV / absEnv;
        const overage = ratio - 1;

        if (mode === 'kill') {
          if (!isFinite(maxMult) || ratio > maxMult) { kill = true; break; }
        } else if (mode === 'clamp') {
          const sign    = v >= 0 ? 1 : -1;
          const ceiling = isFinite(maxMult) ? absEnv * maxMult : absEnv;
          row[predCol] = sign * Math.min(absV, ceiling);
        } else {
          // blend
          if (isFinite(maxMult) && ratio > maxMult) {
            const sign = v >= 0 ? 1 : -1;
            row[predCol] = sign * absEnv * maxMult;
          } else {
            const w = maxMultMinus1 !== null
              ? asympWeight(overage, maxMultMinus1)
              : 1 - 1 / (1 + 9 * overage);
            const sign     = v >= 0 ? 1 : -1;
            const blendEnv = sign * absEnv;
            row[predCol] = v * (1 - w) + blendEnv * w;
          }
        }
      }

      if (!kill) out.push(row);
    }
  }

  if (out.length) setHeaders(Object.keys(out[0]).filter(k => !k.startsWith('_')));
  return { data: out, _rows: out };
}
