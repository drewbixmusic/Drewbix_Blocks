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
//   1. Centroid-relative vol-matching transform:
//      a) centroid = mean(predVals)  — establishes the "centre line" of the prediction set
//      b) v_c = v - centroid         — shift so deviations are measured from centre, not from 0
//      c) COMPRESS (predStd > modelStd):
//           v_t = sign(v_c) * C * tanh(|v_c| / C)
//           C found by binary search so stddev(output) = modelStd.
//           Near centroid → linear passthrough. Far from centroid → asymptotically crushed.
//      d) EXPAND (predStd < modelStd, expand toggle on):
//           v_t = sign(v_c) * atanh(|v_c| / absMax) * scale
//           Near centroid → biggest relative boost. Far from centroid → barely grows.
//      e) v_out = v_t + centroid     — unshift back to original y-space
//   2. Offset: subtract value at row closest to pred_t_field≈0  (pins t0 to y=0)
//   3. Transient clean against env+/env- using blend/clamp/kill
// ══════════════════════════════════════════════════════════════

function stddev(vals) {
  const finite = vals.filter(v => isFinite(v));
  if (finite.length < 2) return 0;
  const mean = finite.reduce((s, v) => s + v, 0) / finite.length;
  const variance = finite.reduce((s, v) => s + (v - mean) ** 2, 0) / finite.length;
  return Math.sqrt(variance);
}

// ── Compression transform ──────────────────────────────────────────────────
// Soft asymptotic compressor: identity near 0, asymptotes to ±C at extremes.
// C controls the "elbow" — small C compresses earlier, large C compresses later.
//
//   near  |v| = 0 : tanh(x) ≈ x  →  output ≈ v  (linear, shape intact)
//   large |v|     : tanh → 1      →  output caps at ±C  (extreme transients crushed)
//
function tanhCompress(v, C) {
  if (!isFinite(v) || C <= 0) return v;
  return Math.sign(v) * C * Math.tanh(Math.abs(v) / C);
}

function compressArray(vals, C) {
  return vals.map(v => tanhCompress(v, C));
}

// ── Expansion transform ────────────────────────────────────────────────────
// Inverse of tanhCompress: atanh-based expander.
// For expansion the desired behaviour is the *mirror* of compression:
//   - small deviations from centre get amplified MORE (relatively)
//   - large deviations get amplified LESS (the already-extreme values
//     should not blow up further)
//
// This is exactly what atanh delivers when C is set correctly:
//   v_expanded = sign(v) * C * atanh(|v| / C)
//   near |v| = 0 : atanh(x) ≈ x              →  output ≈ v  (linear)
//   as |v| → C   : atanh → ∞                 →  large values grow fast
//
// BUT we want small values expanded more, not large. The trick:
//   - Normalise all values to the range (0, 1) using |v| / absMax
//   - Apply atanh to that normalised signal  → boosts near-zero values most
//   - Rescale back so stddev = targetStd
//
// This gives the correct asymmetric expansion shape:
//   values already near ±absMax barely move (they're already "out there")
//   values near 0 get the biggest relative boost
//
function atanhExpand(v, absMax, scale) {
  if (!isFinite(v) || absMax <= 0) return v;
  const x = Math.abs(v) / absMax;
  // atanh diverges at x=1; clamp safely below 1
  const xc = Math.min(x, 1 - 1e-9);
  return Math.sign(v) * Math.atanh(xc) * scale;
}

function expandArray(vals, absMax, scale) {
  return vals.map(v => atanhExpand(v, absMax, scale));
}

// ── Unified solver ─────────────────────────────────────────────────────────
// Returns { mode, C, absMax, scale } describing how to transform each value.
// mode 'compress' → use tanhCompress(v, C)
// mode 'expand'   → use atanhExpand(v, absMax, scale)
// mode 'identity' → pass through unchanged
//
function findTransform(vals, targetStd, doExpand) {
  const finite = vals.filter(v => isFinite(v));
  if (finite.length < 2 || targetStd <= 0) return { mode: 'identity' };

  const rawStd = stddev(finite);
  if (rawStd === 0) return { mode: 'identity' };

  // ── Compression path ──
  if (rawStd > targetStd) {
    // Binary search on C: stddev(tanhCompress(vals, C)) increases monotonically with C.
    // C → 0   : std → 0
    // C → Inf : std → rawStd
    const absMax = Math.max(...finite.map(Math.abs));
    let lo = 1e-10;
    let hi = absMax * 100;
    for (let iter = 0; iter < 64; iter++) {
      const mid = (lo + hi) / 2;
      const s = stddev(compressArray(finite, mid));
      if (s < targetStd) lo = mid;
      else hi = mid;
      if ((hi - lo) / (Math.abs(mid) + 1e-15) < 1e-9) break;
    }
    return { mode: 'compress', C: (lo + hi) / 2 };
  }

  // ── Expansion path ──
  if (doExpand && rawStd < targetStd) {
    // Binary search on 'scale': stddev(expandArray(vals, absMax, scale)) ∝ scale.
    // atanh(|v|/absMax) gives a fixed shape; scale is just a linear multiplier,
    // so stddev is linear in scale → direct solve is fine, but binary search
    // is used for safety and symmetry with the compress path.
    const absMax = Math.max(...finite.map(Math.abs));
    if (absMax === 0) return { mode: 'identity' };

    // Compute the shape stddev at scale=1 so we can solve directly
    const shapedVals = finite.map(v => {
      const x = Math.min(Math.abs(v) / absMax, 1 - 1e-9);
      return Math.sign(v) * Math.atanh(x);
    });
    const shapeStd = stddev(shapedVals);
    if (shapeStd === 0) return { mode: 'identity' };
    const scale = targetStd / shapeStd;
    return { mode: 'expand', absMax, scale };
  }

  return { mode: 'identity' };
}

// Apply the transform descriptor returned by findTransform to a single value.
function applyTransform(v, t) {
  if (!isFinite(v)) return v;
  if (t.mode === 'compress') return tanhCompress(v, t.C);
  if (t.mode === 'expand')   return atanhExpand(v, t.absMax, t.scale);
  return v;
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

    // ── Step 1: find vol-matching transform per pred column ──────────────
    // All transforms operate on centroid-shifted values so that "near zero"
    // in the math means "near the centre of THIS prediction set", not literal 0.
    // Pipeline per column:
    //   a) compute centroid (mean of finite values)
    //   b) shift: v_c = v - centroid
    //   c) findTransform on centroid-shifted values → C or scale
    //   d) applyTransform on centroid-shifted value → v_t
    //   e) unshift: v_out = v_t + centroid
    // Compression (predStd > modelStd): tanhCompress on v_c
    //   near centroid → linear passthrough; far from centroid → asymptotically crushed
    // Expansion (predStd < modelStd, expand=true): atanhExpand on v_c
    //   near centroid → biggest relative boost; far from centroid → barely grows
    const transforms   = {};
    const centroids    = {};
    for (let i = 0; i < predCols.length; i++) {
      const mCol = getModelCol(i);
      const pCol = predCols[i];

      const modelStd = mRows.length >= 3
        ? stddev(mRows.map(r => Math.abs(Number(r[mCol]))))
        : null;

      const predVals = pRows.map(r => Number(r[pCol])).filter(isFinite);
      const centroid = predVals.length
        ? predVals.reduce((s, v) => s + v, 0) / predVals.length
        : 0;
      centroids[pCol] = centroid;

      if (modelStd === null || !isFinite(modelStd)) {
        transforms[pCol] = { mode: 'identity' };
      } else {
        // Shift values to centroid-space before solving
        const centredVals = predVals.map(v => v - centroid);
        transforms[pCol] = findTransform(centredVals, modelStd, doExpand);
      }
    }

    // ── Step 2: apply transform → write to <predCol>_pn columns ─────────
    // Shift to centroid, transform, unshift back.
    const scaled = pRows.map(r => {
      const copy = { ...r };
      for (const pCol of predCols) {
        const v = Number(copy[pCol]);
        if (!isFinite(v)) { copy[pCol + '_pn'] = null; continue; }
        const vc = v - centroids[pCol];                  // shift to centroid
        const vt = applyTransform(vc, transforms[pCol]); // compress/expand deviation
        copy[pCol + '_pn'] = vt + centroids[pCol];       // unshift back
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
