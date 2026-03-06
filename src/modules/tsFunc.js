// ══════════════════════════════════════════════════════════════
// TIMESTAMP FUNCTION MODULES — time_offset, ts_to_ms, date_max/min, ts_to_trel, ohlc_to_ts
// ══════════════════════════════════════════════════════════════

function normalize(inp) {
  if (!inp) return [];
  if (!Array.isArray(inp)) return [inp];
  return inp;
}

export function runTimeOffset(node, { cfg, inputs, setHeaders }) {
  const dataRows = normalize(inputs.data || []);
  const field     = cfg.field || '';
  const amt       = Number(cfg.amount || 0);
  const mult      = { minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000 }[cfg.unit || 'minutes'] || 60000;
  const roundMode = cfg.round || 'no_change';
  const roundUnit = cfg.round_unit || '1D';
  const ROUND_MS  = { '1T':60000,'5T':300000,'10T':600000,'20T':1200000,'30T':1800000,'1H':3600000,'2H':7200000,'4H':14400000,'8H':28800000,'12H':43200000,'1D':86400000 };
  const rms       = ROUND_MS[roundUnit] || 86400000;
  const FALLBACK_TZ = '-04:00';

  let scTzSuffix = null;
  if (inputs.sc !== undefined) {
    const tzSrc  = cfg.tz_field || 'manual';
    const scRows = inputs.sc;
    let scTsStr  = null;
    if (tzSrc.startsWith('sc::')) {
      const scField = tzSrc.slice(4);
      if (Array.isArray(scRows) && scRows.length) scTsStr = String(scRows[0][scField] ?? '');
      else if (scRows && typeof scRows === 'object') scTsStr = String(scRows[scField] ?? '');
    } else if (typeof scRows === 'string') {
      scTsStr = scRows;
    } else if (Array.isArray(scRows) && scRows.length) {
      const firstRow = scRows[0];
      const tsKey = Object.keys(firstRow).find(k => typeof firstRow[k] === 'string' && /[+-]\d{2}:\d{2}$/.test(firstRow[k]));
      if (tsKey) scTsStr = firstRow[tsKey];
    }
    if (scTsStr) { const m = scTsStr.match(/([+-]\d{2}:\d{2}|Z)$/); if (m) scTzSuffix = m[1]; }
    if (!scTzSuffix) scTzSuffix = FALLBACK_TZ;
  }

  function processTs(tsRaw) {
    if (!tsRaw) return null;
    const tsStr   = String(tsRaw);
    const tzMatch = tsStr.match(/([+-]\d{2}:\d{2}|Z)$/);
    const tzSuffix = scTzSuffix || (tzMatch ? tzMatch[1] : '');
    const d = new Date(tsStr);
    if (isNaN(d.getTime())) return tsRaw;
    let ms = d.getTime() + amt * mult;
    if (roundMode === 'round_down') ms = Math.floor(ms / rms) * rms;
    else if (roundMode === 'round_up')  ms = Math.ceil(ms / rms) * rms;
    const result = new Date(ms);
    if (tzSuffix && tzSuffix !== 'Z') {
      const pad = n => String(n).padStart(2, '0');
      return `${result.getUTCFullYear()}-${pad(result.getUTCMonth()+1)}-${pad(result.getUTCDate())}T${pad(result.getUTCHours())}:${pad(result.getUTCMinutes())}:${pad(result.getUTCSeconds())}${tzSuffix}`;
    }
    return result.toISOString();
  }

  if (field && dataRows.length) {
    const out = dataRows.map(row => ({ ...row, [field]: processTs(row[field]) }));
    if (out.length) setHeaders(Object.keys(out[0]).filter(k => !k.startsWith('_')));
    return { data: out, _rows: out };
  }
  if (dataRows.length) {
    const firstRow = dataRows[0];
    const tsField  = field || Object.keys(firstRow).find(k => /\d{4}-\d{2}-\d{2}T/.test(String(firstRow[k]))) || 'timestamp';
    const out = dataRows.map(row => ({ ...row, [tsField]: processTs(row[tsField]) }));
    if (out.length) setHeaders(Object.keys(out[0]).filter(k => !k.startsWith('_')));
    return { data: out, _rows: out };
  }
  const fallback = [{ offset_timestamp: processTs(new Date().toISOString()) }];
  setHeaders(['offset_timestamp']);
  return { data: fallback, _rows: fallback };
}

export function runTsToMs(node, { cfg, inputs, setHeaders }) {
  const data  = normalize(inputs.data || []);
  const field = cfg.field || '';
  if (!data.length) return { data: [], _rows: [] };
  const detect = (row) => field && row[field] !== undefined ? field
    : Object.keys(row).find(k => typeof row[k] === 'string' && /\d{4}-\d{2}-\d{2}/.test(row[k]));
  const out = data.map(row => {
    const f = detect(row);
    if (!f) return row;
    const ms = new Date(row[f]).getTime();
    return { ...row, [`${f}_ms`]: isNaN(ms) ? null : ms };
  });
  if (out.length) setHeaders(Object.keys(out[0]).filter(k => !k.startsWith('_')));
  return { data: out, _rows: out };
}

export function runDateExtreme(node, { cfg, inputs, setHeaders }, extreme) {
  const data  = normalize(inputs.data || []);
  const field = cfg.field || '';
  const vals  = [];
  data.forEach(row => {
    const candidates = field ? [row[field]] : Object.values(row);
    candidates.forEach(v => {
      if (!v) return;
      const s  = String(v);
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const ms = new Date(s).getTime(); if (!isNaN(ms)) vals.push({ ms, str: s }); }
    });
  });
  if (!vals.length) return { data: [], _rows: [] };
  vals.sort((a, b) => a.ms - b.ms);
  const picked = extreme === 'max' ? vals[vals.length - 1] : vals[0];
  const label  = extreme === 'max' ? 'date_max' : 'date_min';
  const rows   = [{ [label]: picked.str, ms: picked.ms }];
  setHeaders([label, 'ms']);
  return { data: rows, _rows: rows, [label]: picked.str, _scalar: picked.str };
}

export function runTsToTrel(node, { cfg, inputs, setHeaders }) {
  const data = normalize(inputs.data || []);
  if (!data.length) return { data: [], _rows: [] };
  const trelField = cfg.field || (() => {
    const first = data[0];
    return Object.keys(first).find(k => k.endsWith('_ms') && typeof first[k] === 'number')
      || Object.keys(first).find(k => typeof first[k] === 'string' && /\d{4}-\d{2}-\d{2}/.test(first[k]))
      || '';
  })();
  if (!trelField) return { data, _rows: data };
  const msVals = data.map(row => {
    const v = row[trelField];
    if (typeof v === 'number') return v;
    const p = new Date(v).getTime();
    return isNaN(p) ? null : p;
  });
  const validPairs = data.map((row, i) => ({ row, ms: msVals[i] }))
    .filter(x => x.ms !== null).sort((a, b) => a.ms - b.ms);
  if (!validPairs.length) return { data, _rows: data };
  const n     = validPairs.length;
  const tMin  = validPairs[0].ms, tMax = validPairs[n - 1].ms;
  const msPerUnit  = cfg.unit === 'ms' ? 1 : 86400000;
  const totalRange = (tMax - tMin) / msPerUnit;
  const offsetIdx  = cfg.offset === 'min' ? 0 : cfg.offset === 'med' ? (n - 1) / 2 : n - 1;
  const offsetTrel = n > 1 ? (offsetIdx / (n - 1)) * totalRange : 0;
  const out = validPairs.map(({ row }, i) => ({
    ...row,
    [`${trelField}_trel`]: n > 1 ? (i / (n - 1)) * totalRange - offsetTrel : 0,
  }));
  if (out.length) setHeaders(Object.keys(out[0]).filter(k => !k.startsWith('_')));
  return { data: out, _rows: out };
}

// ── Technical indicator helpers ────────────────────────────────────────────
// All functions operate on full price arrays and return the last-bar value.
// Short arrays (fewer bars than the period) gracefully use all available data.

function _sma(arr, period) {
  if (!arr.length) return null;
  const slice = arr.length >= period ? arr.slice(-period) : arr;
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

function _emaFull(arr, period) {
  // Returns the EMA value at the LAST bar using Wilder-style EMA initialisation.
  if (!arr.length) return null;
  const k = 2 / (period + 1);
  let ema = arr[0];
  for (let i = 1; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
  return ema;
}

function _bollinger(closes, period = 20, mult = 2) {
  if (!closes.length) return { upper: null, mid: null, lower: null };
  const slice = closes.length >= period ? closes.slice(-period) : closes;
  const mid = slice.reduce((s, v) => s + v, 0) / slice.length;
  const std = Math.sqrt(slice.reduce((s, v) => s + (v - mid) ** 2, 0) / slice.length);
  return { upper: mid + mult * std, mid, lower: mid - mult * std };
}

function _macd(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < 2) return { line: null, sig: null, hist: null };
  const kf = 2 / (fast + 1), ks = 2 / (slow + 1), ksg = 2 / (signal + 1);
  let ef = closes[0], es = closes[0];
  const macdLine = [];
  for (const c of closes) {
    ef = c * kf + ef * (1 - kf);
    es = c * ks + es * (1 - ks);
    macdLine.push(ef - es);
  }
  let sg = macdLine[0];
  for (const m of macdLine) sg = m * ksg + sg * (1 - ksg);
  const last = macdLine[macdLine.length - 1];
  return { line: last, sig: sg, hist: last - sg };
}

function _stochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  const kVals = closes.map((c, i) => {
    const start = Math.max(0, i - kPeriod + 1);
    const hi = Math.max(...highs.slice(start, i + 1));
    const lo = Math.min(...lows.slice(start, i + 1));
    return hi === lo ? 50 : ((c - lo) / (hi - lo)) * 100;
  });
  // %D = SMA of %K
  const dVals = kVals.map((_, i) => {
    const s = kVals.length >= dPeriod ? kVals.slice(i - dPeriod + 1, i + 1) : kVals.slice(0, i + 1);
    return s.reduce((a, b) => a + b, 0) / s.length;
  });
  return { k: kVals[kVals.length - 1] ?? null, d: dVals[dVals.length - 1] ?? null };
}

function _atr(highs, lows, closes, period = 14) {
  if (closes.length < 2) return null;
  const tr = [];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1]),
    ));
  }
  // Wilder's smoothed ATR
  const initN = Math.min(period, tr.length);
  let atr = tr.slice(0, initN).reduce((s, v) => s + v, 0) / initN;
  for (let i = initN; i < tr.length; i++) atr = (atr * (period - 1) + tr[i]) / period;
  return atr;
}

// Compute all snapshot indicators from raw sorted bars.
// Returns an object of constant feature values (at the last bar).
// Price-level indicators are expressed as ratio to lastClose so they are
// comparable to p_rel regardless of whether y_fmt is 'price' or 'percent'.
function computeSnapshotIndicators(sortedBars, oF, hF, lF, cF) {
  const closes = sortedBars.map(b => Number(b[cF])).filter(isFinite);
  const highs  = sortedBars.map(b => Number(b[hF])).filter(isFinite);
  const lows   = sortedBars.map(b => Number(b[lF])).filter(isFinite);
  if (!closes.length) return {};

  const lastC  = closes[closes.length - 1];
  const refP   = lastC !== 0 ? lastC : 1;

  const bb     = _bollinger(closes, 20, 2);
  const macd   = _macd(closes, 12, 26, 9);
  const stoch  = _stochastic(highs, lows, closes, 14, 3);
  const sma20  = _sma(closes, 20);
  const ema20  = _emaFull(closes, 20);
  const atr14  = _atr(highs, lows, closes, 14);

  // Express price-level indicators as ratio to lastClose (scale-neutral).
  // MACD / histogram are price differences → also divide by refP.
  // ATR is a price range → divide by refP.
  // Stochastic is 0-100 → divide by 100 to give 0-1.
  const pct = v => (v != null && isFinite(v)) ? v / refP : null;
  const osc = v => (v != null && isFinite(v)) ? v / 100  : null;

  return {
    sma:      pct(sma20),
    ema:      pct(ema20),
    bb_up:    pct(bb.upper),
    bb_mid:   pct(bb.mid),
    bb_lo:    pct(bb.lower),
    macd:     pct(macd.line),
    macd_s:   pct(macd.sig),
    macd_h:   pct(macd.hist),
    stoch_k:  osc(stoch.k),
    stoch_d:  osc(stoch.d),
    atr:      pct(atr14),
  };
}

export function runOhlcToTs(node, { cfg, inputs, setHeaders }) {
  const data = normalize(inputs.data || []);
  if (!data.length) return { data: [], _rows: [] };

  const tF    = cfg.t_field   || 't';
  const oF    = cfg.o_field   || 'o';
  const hF    = cfg.h_field   || 'h';
  const lF    = cfg.l_field   || 'l';
  const cF    = cfg.c_field   || 'c';
  const vF    = cfg.v_field   || 'v';
  const symF  = cfg.sym_field || 'symbol';
  const xRef  = cfg.x_ref    || 'first';
  const yFmt  = cfg.y_fmt    || 'price';
  const vRef  = cfg.v_ref    || 'raw';

  // New config fields
  const mode            = cfg.mode         || 'All';   // All | OC | O | H | L | C
  const compression     = cfg.compression  || 'Auto';  // 1:1 | 2:1 | … | Auto
  const sampleTargetCfg = cfg.sample_target || 'Auto'; // number or 'Auto'
  const oversample      = (cfg.oversample   || 'On') === 'On';
  const nDatasets       = Math.max(1, Math.min(10, parseInt(cfg.datasets) || 1));
  const keyField        = cfg.key || 'symbol';

  // ── Group bars by symbol ───────────────────────────────────────────────────
  const bySymbol = {};
  data.forEach(row => {
    const sym = String(row[symF] ?? '');
    if (!bySymbol[sym]) bySymbol[sym] = [];
    bySymbol[sym].push(row);
  });

  // ── Determine effective sample target ─────────────────────────────────────
  // Auto-Auto: derive target from mean/median sample count across all symbols.
  let effectiveSampleTarget;
  if (sampleTargetCfg === 'Auto' && compression === 'Auto') {
    const counts = Object.values(bySymbol).map(arr => arr.length).filter(n => n > 0);
    if (counts.length) {
      const mu  = counts.reduce((s,v) => s + v, 0) / counts.length;
      const sc  = [...counts].sort((a,b) => a-b);
      const med = sc.length % 2 === 0
        ? (sc[sc.length/2-1] + sc[sc.length/2]) / 2
        : sc[Math.floor(sc.length/2)];
      effectiveSampleTarget = Math.max(1, Math.round((mu + med) / 2));
    } else {
      effectiveSampleTarget = 32;
    }
  } else {
    const parsed = parseInt(sampleTargetCfg);
    effectiveSampleTarget = isNaN(parsed) ? 32 : Math.max(1, parsed);
  }

  // ── Compression helper ─────────────────────────────────────────────────────
  // Each compressed bar stores _xMid = the midpoint of its constituent bars'
  // original sequential indices.  Merging bars 0+1 → _xMid 0.5, bars 2+3 → 2.5.
  // This is the x-value that gets used for t_rel so compression averages x
  // the same way it averages every other numeric column.
  // Timestamp is also averaged so the stored tF reflects the true midpoint.
  function compressBars(bars, n) {
    if (n <= 1) return bars.map((b, i) => ({ ...b, _xMid: b._xMid ?? i }));
    const out = [];
    for (let i = 0; i < bars.length; i += n) {
      const chunk = bars.slice(i, i + n);
      const o = Number(chunk[0][oF]);
      const h = Math.max(...chunk.map(r => Number(r[hF])));
      const l = Math.min(...chunk.map(r => Number(r[lF])));
      const c = Number(chunk[chunk.length - 1][cF]);
      const v = chunk.reduce((s, r) => s + (Number(r[vF]) || 0), 0);
      const msList = chunk.map(r => new Date(r[tF]).getTime()).filter(ms => !isNaN(ms));
      const avgMs  = msList.length
        ? Math.round(msList.reduce((s, ms) => s + ms, 0) / msList.length)
        : new Date(chunk[0][tF]).getTime();
      // _xMid: average of the constituent bars' original positions
      const xMids = chunk.map((b, ci) => b._xMid ?? (i + ci));
      const xMid  = xMids.reduce((s, v) => s + v, 0) / xMids.length;
      out.push({ ...chunk[0], [tF]: new Date(avgMs).toISOString(), [oF]: o, [hF]: h, [lF]: l, [cF]: c, [vF]: v, _xMid: xMid });
    }
    return out;
  }

  // ── Oversample helper (gap-filling interpolation) ─────────────────────────
  // Repeatedly bisects the largest time gap until target count is reached.
  // _xMid tracks each bar's averaged original-index position so t_rel stays
  // correct: a bar inserted between _xMid=0 and _xMid=1 gets _xMid=0.5.
  function expandBars(bars, target) {
    if (bars.length >= target) return bars;
    const result = bars.map((b, i) => ({ ...b, _xMid: b._xMid ?? i, _synth: false }));
    while (result.length < target) {
      let maxGap = -1, maxIdx = 0;
      for (let i = 0; i < result.length - 1; i++) {
        const gap = new Date(result[i+1][tF]).getTime() - new Date(result[i][tF]).getTime();
        if (gap > maxGap) { maxGap = gap; maxIdx = i; }
      }
      if (maxGap <= 0) break;
      const a = result[maxIdx], b = result[maxIdx + 1];
      const midMs    = Math.floor((new Date(a[tF]).getTime() + new Date(b[tF]).getTime()) / 2);
      const midPriceO = (Number(a[cF]) + Number(b[oF])) / 2;
      result.splice(maxIdx + 1, 0, {
        ...a,
        [tF]:  new Date(midMs).toISOString(),
        [oF]:  midPriceO,
        [hF]:  midPriceO,
        [lF]:  midPriceO,
        [cF]:  midPriceO,
        [vF]:  ((Number(a[vF]) || 0) + (Number(b[vF]) || 0)) / 2,
        _xMid: (a._xMid + b._xMid) / 2,  // midpoint in original-index space
        _synth: true,
      });
    }
    return result;
  }

  // ── Resolve compression ratio for a bar count ─────────────────────────────
  // Returns the integer ratio that brings `count` closest to `effectiveSampleTarget`.
  function resolveCompRatio(count) {
    if (compression !== 'Auto') {
      return Math.max(1, parseInt((compression || '1:1').replace(':1', '')) || 1);
    }
    if (!count) return 1;
    const steps = [1, 2, 4, 8, 12, 16, 32];
    return steps.reduce((best, s) =>
      Math.abs(count / s - effectiveSampleTarget) <
      Math.abs(count / best - effectiveSampleTarget) ? s : best, 1);
  }

  // ── Global compression ratio (oversample=Off: same ratio for ALL symbols) ─
  // Derived from the mean bar count across symbols so one ratio fits all.
  const allCounts  = Object.values(bySymbol).map(a => a.length);
  const meanCount  = allCounts.length
    ? allCounts.reduce((s,v) => s+v, 0) / allCounts.length
    : effectiveSampleTarget;
  const globalCompRatio = resolveCompRatio(Math.round(meanCount));

  // ── Points from a single bar per mode ──────────────────────────────────────
  // Returns array of {price, subOffset} — sub-offsets within [0,1)
  function barToPoints(row, isIntraday, modeStr) {
    const o = Number(row[oF]), h = Number(row[hF]), l = Number(row[lF]), c = Number(row[cF]);
    const v = Number(row[vF]) || 0;
    const bull = o < c;
    const offsets = isIntraday ? [0, 0.2, 0.4, 0.6, 0.8] : [0.1, 0.3, 0.5, 0.7, 0.9];
    switch (modeStr) {
      case 'OC': return [{ price: o, off: offsets[0], v }, { price: c, off: offsets[3], v }];
      case 'O':  return [{ price: o, off: offsets[0], v }];
      case 'H':  return [{ price: h, off: offsets[2], v }];
      case 'L':  return [{ price: l, off: offsets[1], v }];
      case 'C':  return [{ price: c, off: offsets[3], v }];
      default: { // All
        const prices = [o, bull ? l : h, bull ? h : l, c];
        return prices.map((price, si) => ({ price, off: offsets[si], v: v / 4 }));
      }
    }
  }

  // ── Process each symbol ────────────────────────────────────────────────────
  const allOutRows = [];

  Object.entries(bySymbol).forEach(([sym, symRows]) => {
    // Sort by time
    const sortedBars = [...symRows]
      .map(r => ({ r, ms: new Date(r[tF]).getTime() }))
      .filter(x => !isNaN(x.ms))
      .sort((a, b) => a.ms - b.ms)
      .map(x => x.r);
    if (!sortedBars.length) return;

    // Compute technical indicator snapshots from FULL raw bars (before compression)
    // so we always use the maximum available history for best indicator accuracy.
    const snap = computeSnapshotIndicators(sortedBars, oF, hF, lF, cF);

    // Detect intraday
    let minGapMs = Infinity;
    for (let i = 1; i < sortedBars.length; i++) {
      const g = new Date(sortedBars[i][tF]).getTime() - new Date(sortedBars[i-1][tF]).getTime();
      if (g > 0) minGapMs = Math.min(minGapMs, g);
    }
    if (!isFinite(minGapMs)) minGapMs = 86400000;
    const isIntraday = minGapMs / 86400000 < 1;

    // ── Step 1: Balance bar count to target ──────────────────────────────────
    // oversample=On : each symbol independently reaches target
    //   - below target → expand via gap-fill interpolation
    //   - above target → compress per-symbol to target
    // oversample=Off: same global compression ratio for every symbol (no expansion)
    let compBars;
    if (oversample) {
      if (sortedBars.length < effectiveSampleTarget) {
        compBars = expandBars(sortedBars, effectiveSampleTarget);
      } else {
        const compN = resolveCompRatio(sortedBars.length);
        compBars = compressBars(sortedBars, compN);
      }
    } else {
      compBars = compressBars(sortedBars, globalCompRatio);
    }

    // ── Step 2: Mode filter → explode bars to points ─────────────────────────
    // _xMid carries the averaged original-index position through compression
    // and expansion so t_rel reflects the true midpoint of merged bars.
    // Gap-elimination (no weekend holes) is preserved because _xMid is still
    // an index in the sorted-bars sequence, not a wall-clock timestamp.
    const rawPoints = []; // { xMid, off, price, v }
    compBars.forEach((bar, barIdx) => {
      const xMid = bar._xMid ?? barIdx;
      barToPoints(bar, isIntraday, mode).forEach(pt => {
        rawPoints.push({ xMid, off: pt.off, price: pt.price, v: pt.v });
      });
    });
    if (!rawPoints.length) return;

    const n = compBars.length;
    const refBarIdx = xRef === 'last' ? n - 1 : xRef === 'mid' ? Math.floor((n - 1) / 2) : 0;
    const offsets   = isIntraday ? [0, 0.2, 0.4, 0.6, 0.8] : [0.1, 0.3, 0.5, 0.7, 0.9];
    const refOff    = xRef === 'last' ? offsets[3] : offsets[0];
    const tRelBase  = (compBars[refBarIdx]?._xMid ?? refBarIdx) + refOff;

    // ── Step 3: Relative scaling per symbol ──────────────────────────────────
    let p0 = null;
    if (yFmt === 'percent') {
      p0 = xRef === 'last'
        ? Number(compBars[refBarIdx]?.[cF])
        : Number(compBars[refBarIdx]?.[oF]);
    }
    const allV  = rawPoints.map(p => p.v).filter(v => !isNaN(v));
    const vMin  = allV.length ? Math.min(...allV) : 0;
    const vMax  = allV.length ? Math.max(...allV) : 1;
    const sv    = [...allV].sort((a,b) => a-b);
    const vMed  = sv.length % 2 === 0
      ? (sv[sv.length/2-1]+sv[sv.length/2])/2
      : sv[Math.floor(sv.length/2)] || 1;
    const scaleV = v => {
      if (v === null || isNaN(v)) return null;
      if (vRef === 'norm') return vMax === vMin ? 0 : (v - vMin) / (vMax - vMin);
      if (vRef === 'min')  return vMin === 0 ? null : v / vMin;
      if (vRef === 'max')  return vMax === 0 ? null : v / vMax;
      if (vRef === 'med')  return vMed === 0 ? null : v / vMed;
      return v;
    };

    const symRows2 = rawPoints.map(pt => ({
      symbol: sym,
      t_rel:  pt.xMid + pt.off - tRelBase,
      p_rel:  yFmt === 'percent' && p0 !== null && p0 !== 0 && !isNaN(pt.price)
                ? (pt.price - p0) / p0
                : isNaN(pt.price) ? null : pt.price,
      v: scaleV(pt.v),
      // Technical indicator snapshots — constant per symbol (last bar of full dataset)
      ...snap,
    }));

    // ── Step 4: Dataset splitting with overlap ────────────────────────────────
    // overlap=0% → non-overlapping equal slices (original behaviour).
    // overlap=50%, N=2, 270pts → window=180, step=90: [0..179], [90..269].
    // Formula: w = total / [(1-ov)*(N-1) + 1],  step = w*(1-ov)
    if (nDatasets <= 1) {
      symRows2.forEach(r => allOutRows.push(r));
    } else {
      const overlapFrac = parseFloat((cfg.overlap || '50%').replace('%', '')) / 100;
      const total       = symRows2.length;
      const w    = Math.max(1, Math.round(total / ((1 - overlapFrac) * (nDatasets - 1) + 1)));
      const step = Math.max(1, Math.round(w * (1 - overlapFrac)));
      for (let ds = 1; ds <= nDatasets; ds++) {
        const start = (ds - 1) * step;
        const end   = Math.min(start + w, total);
        symRows2.slice(start, end).forEach(r =>
          allOutRows.push({ ...r, symbol: `${sym}_${ds}` })
        );
      }
    }
  });

  setHeaders(['symbol', 't_rel', 'p_rel', 'v',
    'sma', 'ema', 'bb_up', 'bb_mid', 'bb_lo',
    'macd', 'macd_s', 'macd_h', 'stoch_k', 'stoch_d', 'atr']);
  return { data: allOutRows, _rows: allOutRows };
}
