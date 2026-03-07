// ══════════════════════════════════════════════════════════════════════════════
// balanceRows — reusable per-key row balancing (compress / expand)
//
// Used by: ohlc_to_ts (bars), convergences (intersection points), and any
// future module that needs balanced symbol/key group sizes.
//
// String field handling during compression:
//   - Numeric-parseable values → mean
//   - Otherwise → majority vote; random winner on tie
// ══════════════════════════════════════════════════════════════════════════════

const p4 = v => Math.round(v * 1e4) / 1e4;

// ── Check if a value should be treated as numeric ─────────────────────────────
function isNumericVal(v) {
  if (v === null || v === undefined || v === '') return false;
  return !isNaN(Number(v));
}

// ── Merge N rows into one (mean for numerics, majority-vote for strings) ───────
function mergeChunk(chunk) {
  if (chunk.length === 1) return { ...chunk[0] };
  const out = {};
  const keys = Object.keys(chunk[0]);

  keys.forEach(k => {
    if (k.startsWith('_')) { out[k] = chunk[0][k]; return; }

    const vals = chunk.map(r => r[k]).filter(v => v !== null && v !== undefined);
    if (!vals.length) { out[k] = null; return; }

    const numVals = vals.filter(v => isNumericVal(v)).map(Number);
    if (numVals.length === vals.length) {
      // All values are numeric → average
      out[k] = p4(numVals.reduce((s, v) => s + v, 0) / numVals.length);
    } else {
      // String field → majority vote with random tie-break
      const counts = {};
      vals.forEach(v => { const s = String(v); counts[s] = (counts[s] || 0) + 1; });
      const maxCount = Math.max(...Object.values(counts));
      const candidates = Object.keys(counts).filter(key => counts[key] === maxCount);
      out[k] = candidates[Math.floor(Math.random() * candidates.length)];
    }
  });

  return out;
}

// ── Compress an array to ~targetCount by merging consecutive groups ────────────
// sortFn: optional comparator to sort rows before compressing
export function compressRows(rows, targetCount, sortFn) {
  if (!rows.length || targetCount >= rows.length) return rows;
  const sorted = sortFn ? [...rows].sort(sortFn) : rows;
  const n = Math.max(1, Math.round(sorted.length / targetCount));
  if (n <= 1) return sorted;
  const out = [];
  for (let i = 0; i < sorted.length; i += n) {
    out.push(mergeChunk(sorted.slice(i, i + n)));
  }
  return out;
}

// ── Expand an array to targetCount by bisecting the largest gap ────────────────
// gapFn(a, b): returns numeric gap size between two adjacent rows.
// interpFn(a, b): returns a single synthetic row at the midpoint.
export function expandRows(rows, targetCount, gapFn, interpFn) {
  if (!rows.length || rows.length >= targetCount) return rows;
  const result = [...rows];

  while (result.length < targetCount) {
    let maxGap = -1, maxIdx = 0;
    for (let i = 0; i < result.length - 1; i++) {
      const g = gapFn(result[i], result[i + 1]);
      if (g > maxGap) { maxGap = g; maxIdx = i; }
    }
    if (maxGap <= 0) break;
    result.splice(maxIdx + 1, 0, interpFn(result[maxIdx], result[maxIdx + 1]));
  }

  return result;
}

// ── Compute effective sample target from group counts (Auto-Auto) ──────────────
// Returns (mean + median) / 2 across all group sizes.
export function autoTarget(groupCounts) {
  const counts = groupCounts.filter(n => n > 0);
  if (!counts.length) return 32;
  const mu  = counts.reduce((s, v) => s + v, 0) / counts.length;
  const sc  = [...counts].sort((a, b) => a - b);
  const med = sc.length % 2 === 0
    ? (sc[sc.length / 2 - 1] + sc[sc.length / 2]) / 2
    : sc[Math.floor(sc.length / 2)];
  return Math.max(1, Math.round((mu + med) / 2));
}

// ── Resolve compression ratio from a count ────────────────────────────────────
const COMP_STEPS = [1, 2, 4, 8, 12, 16, 32];
export function resolveRatio(count, target) {
  return COMP_STEPS.reduce((best, s) =>
    Math.abs(count / s - target) < Math.abs(count / best - target) ? s : best, 1);
}

// ── Main entry: balance all groups to the effective target ────────────────────
// rows:        array of objects
// keyField:    grouping key (e.g. 'symbol')
// compression: '1:1'|'2:1'|…|'Auto'
// sampleTarget: number | 'Auto'
// oversample:  boolean — if true, expand short groups; if false, global ratio only
// sortFn:      optional comparator for rows within a group before compressing
// gapFn / interpFn: required only when oversample=true (for expansion)
export function balanceRows({
  rows, keyField,
  compression = 'Auto',
  sampleTarget = 'Auto',
  oversample   = true,
  sortFn       = null,
  gapFn        = null,
  interpFn     = null,
}) {
  if (!rows.length) return rows;
  // 'Off' on either means no manipulation
  if (compression === 'Off' || sampleTarget === 'Off') return rows;

  // Group by key
  const groups = {};
  rows.forEach(r => {
    const k = String(r[keyField] ?? '');
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });

  // Resolve effective target
  const counts = Object.values(groups).map(g => g.length);
  let effectiveTarget;
  if (sampleTarget === 'Auto' && compression === 'Auto') {
    effectiveTarget = autoTarget(counts);
  } else {
    const parsed = parseInt(sampleTarget);
    effectiveTarget = isNaN(parsed) ? autoTarget(counts) : Math.max(1, parsed);
  }

  // Fixed compression ratio (used when oversample=false)
  const fixedRatio = compression === 'Auto'
    ? resolveRatio(Math.round(counts.reduce((s,v)=>s+v,0)/(counts.length||1)), effectiveTarget)
    : Math.max(1, parseInt((compression||'1:1').replace(':1',''))||1);

  const out = [];
  Object.entries(groups).forEach(([, grpRows]) => {
    const sorted = sortFn ? [...grpRows].sort(sortFn) : grpRows;

    let balanced;
    if (oversample) {
      if (sorted.length < effectiveTarget && gapFn && interpFn) {
        balanced = expandRows(sorted, effectiveTarget, gapFn, interpFn);
      } else {
        const ratio = resolveRatio(sorted.length, effectiveTarget);
        balanced = compressRows(sorted, Math.ceil(sorted.length / ratio), sortFn);
      }
    } else {
      balanced = compressRows(sorted, Math.ceil(sorted.length / fixedRatio), sortFn);
    }

    balanced.forEach(r => out.push(r));
  });

  return out;
}
