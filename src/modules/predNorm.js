// ══════════════════════════════════════════════════════════════
// PREDICTION NORMALIZER  (pred_normalize)
//
// Two-input block:
//   inputs.model  — actual model-space time series (one set per symbol)
//   inputs.data   — prediction-space rows (RF/MV output, one set per symbol)
//
// Per-symbol pipeline:
//   1. Compute model std dev from inputs.model (reference volatility)
//   2. Compute pred std dev from inputs.data
//   3. Scale predictions: model_std / pred_std
//      - only when pred_std > model_std  (compress)
//      - also when pred_std < model_std  AND  cfg.expand = true
//      - skip when fewer than 3 model rows for that symbol
//   4. Offset: subtract the prediction value at the row closest to t=0
//      (applied per-symbol per-target AFTER scaling)
//   5. Transient clean against env+/env- using blend/clamp/kill
// ══════════════════════════════════════════════════════════════

function stddev(vals) {
  const finite = vals.filter(v => isFinite(v));
  if (finite.length < 2) return 0;
  const mean = finite.reduce((s, v) => s + v, 0) / finite.length;
  const variance = finite.reduce((s, v) => s + (v - mean) ** 2, 0) / finite.length;
  return Math.sqrt(variance);
}

// Asymptotic weight: maps overage ratio (0 = no overage, maxMult-1 = near envelope limit)
// to a blend weight 0→1 using w = 1 - 1/(1 + k*x) where k is tuned so that
// at x = maxMult-1 the weight approaches ~0.9 (i.e. heavily envelope-weighted).
// This ensures small overages get barely dampened while large ones are pulled
// strongly toward the envelope, without linearly scaling everything down.
function asympWeight(overage, maxMultMinus1) {
  if (maxMultMinus1 <= 0) return 1; // maxMult=1 → always fully at envelope
  // Tune k so that at x=maxMultMinus1 the weight is ~0.9
  const k = 9 / maxMultMinus1;
  return 1 - 1 / (1 + k * overage);
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

  const keyField      = (cfg.key_field  || 'symbol').trim();
  const tField        = (cfg.t_field    || 't_rel').trim();
  const rawTargets    = cfg.targets;
  const targets       = Array.isArray(rawTargets) ? rawTargets.filter(Boolean)
                      : typeof rawTargets === 'string' ? rawTargets.split(',').map(s => s.trim()).filter(Boolean)
                      : [];
  const envPos        = (cfg.env_pos_field || '').trim();
  const envNeg        = (cfg.env_neg_field || '').trim();
  const mode          = cfg.transient_mode || 'blend';
  const maxMultRaw    = cfg.max_overage_mult || '1.5';
  const maxMult       = maxMultRaw === 'Off' ? Infinity : parseFloat(maxMultRaw);
  const doExpand      = !!cfg.expand;

  if (!targets.length) {
    // No targets configured — pass through unchanged
    if (predRows.length) setHeaders(Object.keys(predRows[0]).filter(k => !k.startsWith('_')));
    return { data: predRows, _rows: predRows };
  }

  // ── Group by key ──────────────────────────────────────────────────────────
  const modelGroups = modelRows.length ? groupByKey(modelRows, keyField) : {};
  const predGroups  = groupByKey(predRows, keyField);

  const out = [];

  for (const [sym, pRows] of Object.entries(predGroups)) {
    const mRows = modelGroups[sym] || [];

    // ── Step 1: per-target model std dev ─────────────────────────────────
    const modelStd = {};
    for (const t of targets) {
      modelStd[t] = mRows.length >= 3
        ? stddev(mRows.map(r => Number(r[t])))
        : null; // null = skip scaling for this target
    }

    // ── Step 2: per-target pred std dev ───────────────────────────────────
    const predStd = {};
    for (const t of targets) {
      predStd[t] = stddev(pRows.map(r => Number(r[t])));
    }

    // ── Step 3: compute scale factor per target ───────────────────────────
    const scaleFactor = {};
    for (const t of targets) {
      const ms = modelStd[t];
      const ps = predStd[t];
      if (ms === null || ps === 0 || !isFinite(ps)) {
        scaleFactor[t] = 1; // skip
      } else if (ps > ms) {
        // Always compress when pred is more volatile than model
        scaleFactor[t] = ms / ps;
      } else if (doExpand && ps < ms) {
        // Only expand if user enabled it
        scaleFactor[t] = ms / ps;
      } else {
        scaleFactor[t] = 1;
      }
    }

    // ── Step 3 (apply scale) + Step 4 (offset) ────────────────────────────
    // First pass: apply scale to a working copy, find t0 value per target
    const scaled = pRows.map(r => {
      const copy = { ...r };
      for (const t of targets) {
        const v = Number(copy[t]);
        copy[t] = isFinite(v) ? v * scaleFactor[t] : copy[t];
      }
      return copy;
    });

    // Find row closest to t=0 for offset reference
    let t0Idx = 0;
    let minAbsT = Infinity;
    for (let i = 0; i < scaled.length; i++) {
      const tv = Math.abs(Number(scaled[i][tField]));
      if (isFinite(tv) && tv < minAbsT) { minAbsT = tv; t0Idx = i; }
    }
    const t0Offsets = {};
    for (const t of targets) {
      const v = Number(scaled[t0Idx]?.[t]);
      t0Offsets[t] = isFinite(v) ? v : 0;
    }

    // Second pass: apply offset
    for (const row of scaled) {
      for (const t of targets) {
        const v = Number(row[t]);
        if (isFinite(v)) row[t] = v - t0Offsets[t];
      }
    }

    // ── Step 5: transient cleaning ────────────────────────────────────────
    const maxMultMinus1 = isFinite(maxMult) ? maxMult - 1 : null;

    for (const row of scaled) {
      let kill = false;

      for (const t of targets) {
        const v = Number(row[t]);
        if (!isFinite(v)) continue;

        // Determine which envelope to use based on sign of prediction
        const envField = v >= 0 ? envPos : envNeg;
        if (!envField) continue;

        const envVal = Number(row[envField]);
        if (!isFinite(envVal) || envVal === 0) continue;

        // Overage ratio: how much does |v| exceed |env|?
        const absV   = Math.abs(v);
        const absEnv = Math.abs(envVal);

        if (absV <= absEnv) continue; // within envelope, no action

        const ratio   = absV / absEnv; // > 1
        const overage = ratio - 1;     // > 0

        if (mode === 'kill') {
          if (!isFinite(maxMult) || ratio > maxMult) { kill = true; break; }
        } else if (mode === 'clamp') {
          // Clamp to max_overage * envelope magnitude, preserve sign
          const sign    = v >= 0 ? 1 : -1;
          const ceiling = isFinite(maxMult) ? absEnv * maxMult : absEnv;
          row[t] = sign * Math.min(absV, ceiling);
        } else {
          // blend: asymptotic soft dampening
          if (isFinite(maxMult) && ratio > maxMult) {
            // Beyond hard limit — clamp to maxMult * env
            const sign = v >= 0 ? 1 : -1;
            row[t] = sign * absEnv * maxMult;
          } else {
            // Soft blend
            const w = maxMultMinus1 !== null
              ? asympWeight(overage, maxMultMinus1)
              : 1 - 1 / (1 + 9 * overage); // fallback when Off
            const sign     = v >= 0 ? 1 : -1;
            const blendEnv = sign * absEnv; // envelope with matching sign
            row[t] = v * (1 - w) + blendEnv * w;
          }
        }
      }

      if (!kill) out.push(row);
    }
  }

  if (out.length) setHeaders(Object.keys(out[0]).filter(k => !k.startsWith('_')));
  return { data: out, _rows: out };
}
