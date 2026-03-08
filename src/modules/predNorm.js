// ══════════════════════════════════════════════════════════════
// PREDICTION NORMALIZER  (pred_normalize)
//
// Two-input block:
//   inputs.model  — actual model-space time series (one set per symbol)
//   inputs.data   — prediction-space rows (RF/MV output, one set per symbol)
//
// Config fields:
//   key_field        — shared key column (e.g. 'symbol')
//   model_t_field    — time column in model rows (for t0 reference)
//   pred_t_field     — time column in prediction rows (for t0 reference)
//   model_targets    — ONE or more model-side columns that drive volatility reference.
//                      If fewer model targets than pred targets, the last model target
//                      is reused — so selecting ONE model target applies that single
//                      volatility reference to ALL prediction fields.
//   pred_targets     — prediction-side columns to normalize (all are processed).
//                      Output columns are named <predCol>_pn.
//   env_pos_field    — positive envelope column in prediction rows
//   env_neg_field    — negative envelope column in prediction rows
//
// Per-symbol pipeline:
//   1. Compute model std dev per pred field (using abs() of model values)
//   2. Compute pred std dev per pred field
//   3. Scale _pn columns: model_std / pred_std
//   4. Offset: subtract value at row closest to pred_t_field≈0
//   5. Transient clean against env+/env- using blend/clamp/kill
// ══════════════════════════════════════════════════════════════

function stddev(vals) {
  const finite = vals.filter(v => isFinite(v));
  if (finite.length < 2) return 0;
  const mean = finite.reduce((s, v) => s + v, 0) / finite.length;
  const variance = finite.reduce((s, v) => s + (v - mean) ** 2, 0) / finite.length;
  return Math.sqrt(variance);
}

// Asymptotic weight: maps overage ratio to blend weight 0→1.
// k tuned so weight ≈ 0.9 at overage = maxMultMinus1.
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

  const keyField    = (cfg.key_field      || 'symbol').trim();
  const modelTField = (cfg.model_t_field  || 't_rel').trim();
  const predTField  = (cfg.pred_t_field   || 't_rel').trim();
  const modelTargets = parseList(cfg.model_targets);
  const predTargets  = parseList(cfg.pred_targets);

  // Fall back: if pred_targets empty use model_targets (same-name assumption)
  const predCols  = predTargets.length  ? predTargets  : modelTargets;
  // Fall back: if model_targets empty use pred_targets (self-referential, scale≈1)
  const modelCols = modelTargets.length ? modelTargets : predCols;

  // getModelCol(i): if user picked ONE model reference, reuse it for all pred fields.
  // If they picked the same number, use positional matching.
  function getModelCol(i) {
    return modelCols[Math.min(i, modelCols.length - 1)];
  }

  const envPos     = (cfg.env_pos_field   || '').trim();
  const envNeg     = (cfg.env_neg_field   || '').trim();
  const mode       = cfg.transient_mode   || 'blend';
  const maxMultRaw = cfg.max_overage_mult || '1.5';
  const maxMult    = maxMultRaw === 'Off' ? Infinity : parseFloat(maxMultRaw);
  const doExpand   = !!cfg.expand;

  if (!predCols.length) {
    if (predRows.length) setHeaders(Object.keys(predRows[0]).filter(k => !k.startsWith('_')));
    return { data: predRows, _rows: predRows };
  }

  const hasModelInput = modelRows.length > 0;
  const modelGroups   = hasModelInput ? groupByKey(modelRows, keyField) : {};
  const predGroups    = groupByKey(predRows, keyField);
  const maxMultMinus1 = isFinite(maxMult) ? maxMult - 1 : null;

  const out = [];

  for (const [sym, pRows] of Object.entries(predGroups)) {
    const mRows = hasModelInput ? (modelGroups[sym] || []) : pRows;

    // ── Step 1: scale factors (one per pred column) ────────────────────
    const scaleFactor = {};
    for (let i = 0; i < predCols.length; i++) {
      const mCol = getModelCol(i);
      const pCol = predCols[i];

      // abs() on model values: model-space actuals are often on a negative-relative
      // scale centred around 0, so abs gives the correct volatility magnitude.
      const ms = mRows.length >= 3
        ? stddev(mRows.map(r => Math.abs(Number(r[mCol]))))
        : null;
      const ps = stddev(pRows.map(r => Number(r[pCol])));

      if (ms === null || ps === 0 || !isFinite(ps)) {
        scaleFactor[pCol] = 1;
      } else if (ps > ms) {
        scaleFactor[pCol] = ms / ps;       // always compress over-volatile predictions
      } else if (doExpand && ps < ms) {
        scaleFactor[pCol] = ms / ps;       // expand only if enabled
      } else {
        scaleFactor[pCol] = 1;
      }
    }

    // ── Step 2: apply scale → write to <predCol>_pn columns ───────────
    const scaled = pRows.map(r => {
      const copy = { ...r };
      for (const pCol of predCols) {
        const v = Number(copy[pCol]);
        copy[pCol + '_pn'] = isFinite(v) ? v * scaleFactor[pCol] : null;
      }
      return copy;
    });

    // ── Step 3: offset — find row closest to t=0 in prediction rows ───
    let t0Idx = 0, minAbsT = Infinity;
    for (let i = 0; i < scaled.length; i++) {
      const tv = Math.abs(Number(scaled[i][predTField]));
      if (isFinite(tv) && tv < minAbsT) { minAbsT = tv; t0Idx = i; }
    }

    const t0Off = {};
    for (const pCol of predCols) {
      const v = Number(scaled[t0Idx]?.[pCol + '_pn']);
      t0Off[pCol] = isFinite(v) ? v : 0;
    }

    for (const row of scaled) {
      for (const pCol of predCols) {
        const outCol = pCol + '_pn';
        const v = Number(row[outCol]);
        if (isFinite(v)) row[outCol] = v - t0Off[pCol];
      }
    }

    // ── Step 4: transient cleaning against envelope ────────────────────
    // Envelope fields are read from the same prediction row —
    // positive _pn values use env_pos_field, negative use env_neg_field.
    for (const row of scaled) {
      let kill = false;

      for (const pCol of predCols) {
        const outCol = pCol + '_pn';
        const v = Number(row[outCol]);
        if (!isFinite(v)) continue;

        const envField = v >= 0 ? envPos : envNeg;
        if (!envField) continue;

        const envVal = Number(row[envField]);
        if (!isFinite(envVal) || envVal === 0) continue;

        const absV   = Math.abs(v);
        const absEnv = Math.abs(envVal);
        if (absV <= absEnv) continue; // within envelope — no action

        const ratio   = absV / absEnv;
        const overage = ratio - 1;

        if (mode === 'kill') {
          if (!isFinite(maxMult) || ratio > maxMult) { kill = true; break; }
        } else if (mode === 'clamp') {
          const sign    = v >= 0 ? 1 : -1;
          const ceiling = isFinite(maxMult) ? absEnv * maxMult : absEnv;
          row[outCol] = sign * Math.min(absV, ceiling);
        } else {
          // blend: asymptotic soft pull toward envelope
          if (isFinite(maxMult) && ratio > maxMult) {
            row[outCol] = (v >= 0 ? 1 : -1) * absEnv * maxMult;
          } else {
            const w        = maxMultMinus1 !== null
              ? asympWeight(overage, maxMultMinus1)
              : 1 - 1 / (1 + 9 * overage);
            const blendEnv = (v >= 0 ? 1 : -1) * absEnv;
            row[outCol] = v * (1 - w) + blendEnv * w;
          }
        }
      }

      if (!kill) out.push(row);
    }
  }

  if (out.length) setHeaders(Object.keys(out[0]).filter(k => !k.startsWith('_')));
  return { data: out, _rows: out };
}
