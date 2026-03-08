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
//      c) COMPRESS (predStd > modelStd*gainFactor*(1+deadBand)):
//           v_t = sign(v_c) * C * tanh(|v_c| / C)
//           C found by binary search so stddev(output) = threshold edge.
//           Near centroid → linear passthrough. Far from centroid → asymptotically crushed.
//      d) EXPAND (predStd < modelStd*gainFactor*(1-deadBand), expand toggle on):
//           v_boosted = v_c * linearScale  (linear pass: scale = thresholdEdge / rawStd)
//           v_t = tanhCompress(v_boosted, capC)  where capC = thresholdEdge * 2.5
//           Near centroid → scales up linearly. Far from centroid → soft ceiling prevents blowup.
//           No singularity risk (avoids atanh approach which spiked at absMax boundary).
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
// We want: small deviations from centroid amplified MORE, large deviations LESS.
//
// The atanh approach (previous) was fragile: atanh(|v|/absMax) diverges as
// |v| → absMax and produced large spikes for values near the extremes of the set.
//
// Better approach: linear scale up to match targetStd, then re-compress the
// upper tail with tanhCompress using a large C (so the shape near centroid is
// linear and untouched, and only values that were pushed beyond a soft ceiling
// by the linear scale get gently reined back in).
//
// In practice this means:
//   1. Apply linear scale k = targetStd / rawStd  (boosts everything uniformly)
//   2. Apply tanhCompress with C = targetStd * capMult  (soft-clips the boosted extremes)
//      capMult chosen so that values already within ±targetStd barely move,
//      only values that the linear scale pushed well beyond targetStd get softened
//
// Result: near-centroid values (small deviations) scale up most proportionally
//         far-from-centroid values that the linear scale pushed to extremes are
//         gently pulled back in — exactly the asymmetry we want, no singularity.
//
function linearThenCompressExpand(v, linearScale, capC) {
  if (!isFinite(v)) return v;
  const boosted = v * linearScale;
  return tanhCompress(boosted, capC);
}

// Expansion solver: find linearScale and capC.
// linearScale = effectiveTarget / rawStd  (solve for target std with linear pass)
// capC        = effectiveTarget * capMult  (soft cap at a multiple of target std)
// The combined transform consistently achieves stddev ≈ effectiveTarget because
// tanhCompress only materially bends values well beyond capC.
// capMult = 2.5 means only values > 2.5× targetStd get meaningfully compressed.
function findExpandTransform(finite, rawStd, effectiveTarget) {
  if (rawStd === 0 || effectiveTarget === 0) return { mode: 'identity' };
  const linearScale = effectiveTarget / rawStd;
  // capC: soft ceiling = 2.5× effectiveTarget so that typical expanded values
  // (within ±effectiveTarget) pass through essentially linearly, and only
  // extreme outliers that the linear boost sends very high get softened.
  const capC = effectiveTarget * 2.5;
  return { mode: 'expand', linearScale, capC };
}

// ── Unified solver ─────────────────────────────────────────────────────────
// deadBand: fraction (0–1+) of tolerance around targetStd before triggering.
//   0    → must match exactly (current behaviour)
//   0.25 → only act if predStd is more than 25% away from targetStd
//          compress threshold = targetStd * (1 + deadBand)  [only compress if over this]
//          expand  threshold  = targetStd * (1 - deadBand)  [only expand  if under this]
//          when triggered, transform to the threshold edge (not all the way to targetStd)
//          so the dead band is preserved and dynamics within it are untouched
//
// Returns { mode, C, absMax, scale } describing how to transform each value.
// mode 'compress' → use tanhCompress(v, C)
// mode 'expand'   → use atanhExpand(v, absMax, scale)
// mode 'identity' → pass through unchanged
//
function findTransform(vals, targetStd, doExpand, deadBand) {
  const db = (typeof deadBand === 'number' && isFinite(deadBand)) ? deadBand : 0;
  const finite = vals.filter(v => isFinite(v));
  if (finite.length < 2 || targetStd <= 0) return { mode: 'identity' };

  const rawStd = stddev(finite);
  if (rawStd === 0) return { mode: 'identity' };

  // ── Compression path ──
  // Only compress if predStd exceeds targetStd*(1+deadBand).
  // Target for compression is the threshold edge, not the bare targetStd,
  // so we preserve the dead band and don't over-squeeze.
  const compressThreshold = targetStd * (1 + db);
  if (rawStd > compressThreshold) {
    const effectiveTarget = compressThreshold; // compress to the threshold edge
    const absMax = Math.max(...finite.map(Math.abs));
    let lo = 1e-10;
    let hi = absMax * 100;
    for (let iter = 0; iter < 64; iter++) {
      const mid = (lo + hi) / 2;
      const s = stddev(compressArray(finite, mid));
      if (s < effectiveTarget) lo = mid;
      else hi = mid;
      if ((hi - lo) / (Math.abs(mid) + 1e-15) < 1e-9) break;
    }
    return { mode: 'compress', C: (lo + hi) / 2 };
  }

  // ── Expansion path ──
  // Only expand if predStd is below targetStd*(1-deadBand).
  // Target for expansion is the threshold edge for the same reason.
  const expandThreshold = targetStd * Math.max(0, 1 - db);
  if (doExpand && rawStd < expandThreshold) {
    return findExpandTransform(finite, rawStd, expandThreshold);
  }

  return { mode: 'identity' };
}

// Apply the transform descriptor returned by findTransform to a single value.
function applyTransform(v, t) {
  if (!isFinite(v)) return v;
  if (t.mode === 'compress') return tanhCompress(v, t.C);
  if (t.mode === 'expand')   return linearThenCompressExpand(v, t.linearScale, t.capC);
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
  // dead_band: fraction tolerance around modelStd before compressing/expanding.
  // 0.25 → only act if predStd deviates >25% from modelStd; transform to threshold edge.
  const deadBandRaw = cfg.dead_band ?? '0.25';
  const deadBand    = parseFloat(deadBandRaw) || 0;
  // gain_factor: multiplier on model volatility target.
  // 0.33 → target is ⅓ of model vol (appropriate when pred fields are offset slices
  //         of a range rather than the same-scale signal as model actuals).
  // 1.00 → match model vol exactly (original behaviour).
  const gainFactorRaw = cfg.gain_factor ?? '0.33';
  const gainFactor    = parseFloat(gainFactorRaw) || 1;

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
        ? stddev(mRows.map(r => Math.abs(Number(r[mCol])))) * gainFactor
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
        transforms[pCol] = findTransform(centredVals, modelStd, doExpand, deadBand);
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
