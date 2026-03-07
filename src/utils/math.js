// ══════════════════════════════════════════════════════════════
// MATH UTILITIES — OLS, Pearson R², stats, PRNG, moving averages
// ══════════════════════════════════════════════════════════════

export const p4 = v => Math.round(v * 1e4) / 1e4;
export const p6 = v => Math.round(v * 1e6) / 1e6;

// ── Descriptive stats ─────────────────────────────────────────────────────────
export function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

export function variance(arr) {
  if (!arr.length) return 0;
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
}

export function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function stddev(arr) {
  return Math.sqrt(variance(arr));
}

// ── Pearson R² between two numeric arrays ────────────────────────────────────
export function pearsonR2(xs, ys) {
  const pairs = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => x !== null && y !== null && !isNaN(x) && !isNaN(y));
  const n = pairs.length;
  if (n < 2) return 0;
  const mx = pairs.reduce((s, [x]) => s + x, 0) / n;
  const my = pairs.reduce((s, [, y]) => s + y, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  pairs.forEach(([x, y]) => { num += (x - mx) * (y - my); dx2 += (x - mx) ** 2; dy2 += (y - my) ** 2; });
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return 0;
  return (num / denom) ** 2;
}

// ── OLS via normal equations: β = (XᵀX)⁻¹Xᵀy ────────────────────────────────
// X rows include intercept column. Returns null if matrix is singular.
export function ols(Xmat, y) {
  const n = y.length, k = Xmat[0].length;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) XtX[a][b] += Xmat[i][a] * Xmat[i][b];
  const Xty = new Array(k).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) Xty[a] += Xmat[i][a] * y[i];
  const aug = XtX.map((row, i) => [...row, ...Array.from({ length: k }, (_, j) => i === j ? 1 : 0)]);
  for (let col = 0; col < k; col++) {
    let pivot = -1, best = 0;
    for (let row = col; row < k; row++) if (Math.abs(aug[row][col]) > best) { best = Math.abs(aug[row][col]); pivot = row; }
    if (pivot < 0 || best < 1e-12) return null;
    [aug[col], aug[pivot]] = [aug[pivot], aug[col]];
    const sc = aug[col][col];
    for (let j = 0; j < 2 * k; j++) aug[col][j] /= sc;
    for (let row = 0; row < k; row++) {
      if (row === col) continue;
      const f = aug[row][col];
      for (let j = 0; j < 2 * k; j++) aug[row][j] -= f * aug[col][j];
    }
  }
  const inv = aug.map(row => row.slice(k));
  return inv.map(row => row.reduce((s, v, i) => s + v * Xty[i], 0));
}

// ── Seeded PRNG (Mulberry32) ──────────────────────────────────────────────────
export function makePRNG(seed) {
  let s = (seed >>> 0) || 1;
  return function rng() {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function bootstrapSample(arr, n, rng) {
  return Array.from({ length: n }, () => arr[Math.floor(rng() * arr.length)]);
}

/**
 * Stratified train/test split by segments (e.g. merged datasets).
 * segmentLengths: [len1, len2, ...] so indices 0..len1-1 are source 0, len1..len1+len2-1 are source 1, etc.
 * Returns { trainIdx, testIdx } with balanced train/test from each segment.
 */
export function stratifiedTrainTestBySource(segmentLengths, testPct, rng) {
  const trainIdx = [];
  const testIdx = [];
  let start = 0;
  for (const len of segmentLengths) {
    if (len <= 0) continue;
    const segmentIndices = Array.from({ length: len }, (_, i) => start + i);
    const shuffled = shuffle(segmentIndices, rng);
    const nTest = Math.max(1, Math.round(len * testPct));
    const nTrain = len - nTest;
    trainIdx.push(...shuffled.slice(0, nTrain));
    testIdx.push(...shuffled.slice(nTrain));
    start += len;
  }
  return { trainIdx, testIdx };
}

// ── CART tree (regression) ───────────────────────────────────────────────────

export function bestSplit(rows, ys, featSubset, X, maxThresh = 20) {
  let bestGain = 0, bestFeat = -1, bestThresh = 0;
  const parentVar = variance(ys) * ys.length;
  for (const fi of featSubset) {
    const vals = rows.map(r => X[r][fi]);
    let candidates = [...new Set(vals)].sort((a, b) => a - b);
    if (maxThresh < Infinity && candidates.length > maxThresh) {
      const step = (candidates.length - 1) / (maxThresh - 1);
      candidates = Array.from({ length: maxThresh }, (_, i) => candidates[Math.round(i * step)]);
    }
    for (let t = 0; t < candidates.length - 1; t++) {
      const thresh = (candidates[t] + candidates[t + 1]) / 2;
      const leftY = [], rightY = [];
      vals.forEach((v, i) => (v <= thresh ? leftY : rightY).push(ys[i]));
      if (!leftY.length || !rightY.length) continue;
      const gain = parentVar - (variance(leftY) * leftY.length + variance(rightY) * rightY.length);
      if (gain > bestGain) { bestGain = gain; bestFeat = fi; bestThresh = thresh; }
    }
  }
  return { feat: bestFeat, thresh: bestThresh, gain: bestGain };
}

export function buildTree(rows, ys, depth, impurityAccum, X, nF, { minSamp, minSampSplit, maxDepth, maxThresh, rng }) {
  const splitMin = minSampSplit ?? minSamp; // fall back to minSamp for backward compat
  if (rows.length < minSamp || depth >= maxDepth || new Set(ys).size === 1) {
    return { val: mean(ys) ?? 0, n: rows.length };
  }
  if (rows.length < splitMin) {
    return { val: mean(ys) ?? 0, n: rows.length };
  }
  const k = Math.max(1, Math.round(Math.sqrt(nF)));
  const featSubset = shuffle(Array.from({ length: nF }, (_, i) => i), rng).slice(0, k);
  const { feat, thresh, gain } = bestSplit(rows, ys, featSubset, X, maxThresh);
  if (feat < 0 || gain <= 0) return { val: mean(ys) ?? 0, n: rows.length };
  if (impurityAccum) impurityAccum[feat] = (impurityAccum[feat] || 0) + gain;
  const leftRows = [], leftY = [], rightRows = [], rightY = [];
  rows.forEach((r, i) => {
    if (X[r][feat] <= thresh) { leftRows.push(r); leftY.push(ys[i]); }
    else { rightRows.push(r); rightY.push(ys[i]); }
  });
  return {
    feat, thresh, n: rows.length,
    left:  buildTree(leftRows,  leftY,  depth + 1, impurityAccum, X, nF, { minSamp, minSampSplit, maxDepth, maxThresh, rng }),
    right: buildTree(rightRows, rightY, depth + 1, impurityAccum, X, nF, { minSamp, minSampSplit, maxDepth, maxThresh, rng }),
  };
}

export function predictTree(tree, rowIdx, X) {
  if ('val' in tree) return tree.val;
  return X[rowIdx][tree.feat] <= tree.thresh
    ? predictTree(tree.left,  rowIdx, X)
    : predictTree(tree.right, rowIdx, X);
}

// ── Feature engineering (interaction terms) ──────────────────────────────────
// engTop = 0  → no interaction terms; Xmat contains ALL baseFeats (bug fix: was
//               silently capping to 5 features which starved the RF of all others)
// engTop > 0  → generate mul/div pairs from the first engTop base features only
//               (keeps interaction explosion manageable while all base feats remain)
export function buildFeatContext(baseFeats, dataRows, engTop = 0) {
  const topForEng = (engTop > 0 && baseFeats.length >= 2)
    ? baseFeats.slice(0, Math.min(engTop, baseFeats.length))
    : [];

  const engFeatNames = [];
  for (let i = 0; i < topForEng.length; i++)
    for (let j = i + 1; j < topForEng.length; j++) {
      engFeatNames.push(`__eng_mul_${i}_${j}`);
      engFeatNames.push(`__eng_div_${i}_${j}`);
    }

  const allFeats = [...baseFeats, ...engFeatNames];

  function rowToVec(row) {
    const getNum = (r, f) => { const v = Number(r[f]); return isNaN(v) ? 0 : v; };
    // Always include ALL base features
    const base = baseFeats.map(f => getNum(row, f));
    if (topForEng.length < 2) return base;
    const eng = [];
    for (let i = 0; i < topForEng.length; i++)
      for (let j = i + 1; j < topForEng.length; j++) {
        eng.push(base[i] * base[j]);
        eng.push(base[j] !== 0 ? base[i] / base[j] : 0);
      }
    return [...base, ...eng];
  }

  const Xmat = dataRows.map(r => rowToVec(r));
  return { allFeats, engFeatNames, Xmat, nFeats: allFeats.length, rowToVec };
}

// ── Moving-average bucket bounds (geometric spacing) ─────────────────────────
export function bucketBounds(xMin, xMax, n, c) {
  const range = xMax - xMin;
  const bounds = [xMin];
  if (Math.abs(c - 1.0) < 0.001) {
    for (let i = 1; i <= n; i++) bounds.push(xMin + range * i / n);
  } else {
    const w0 = range * (c - 1) / (Math.pow(c, n) - 1);
    let cur = xMin;
    for (let i = 0; i < n; i++) { cur += w0 * Math.pow(c, i); bounds.push(Math.min(xMax, cur)); }
    bounds[n] = xMax;
  }
  return bounds;
}

// ── Interpolate bucket values (fill empty buckets) ───────────────────────────
export function interpolateBuckets(bucketCenters, bucketVals) {
  const n = bucketCenters.length;
  const src = [...bucketVals];
  const out = [...bucketVals];
  for (let i = 0; i < n; i++) {
    if (src[i] !== null) continue;
    let prevI = -1, nextI = -1;
    for (let j = i - 1; j >= 0; j--) { if (src[j] !== null) { prevI = j; break; } }
    for (let j = i + 1; j < n; j++) { if (src[j] !== null) { nextI = j; break; } }
    if (prevI === -1 && nextI === -1) {
      out[i] = 0;
    } else if (prevI === -1) {
      const t = (bucketCenters[i] - bucketCenters[0]) / (bucketCenters[nextI] - bucketCenters[0] || 1);
      out[i] = p4(t * src[nextI]);
    } else if (nextI === -1) {
      out[i] = src[prevI];
    } else {
      const span = bucketCenters[nextI] - bucketCenters[prevI];
      const t = span > 0 ? (bucketCenters[i] - bucketCenters[prevI]) / span : 0;
      out[i] = p4(src[prevI] + t * (src[nextI] - src[prevI]));
    }
  }
  return out;
}
