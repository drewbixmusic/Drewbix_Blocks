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
  const mode         = cfg.mode         || 'All';   // All | OC | O | H | L | C
  const compression  = cfg.compression  || '1:1';   // 1:1 | 2:1 | 4:1 | … | Auto
  const sampleTarget = parseInt(cfg.sample_target) || 32;
  const nDatasets    = Math.max(1, Math.min(10, parseInt(cfg.datasets) || 1));
  const keyField     = cfg.key           || 'symbol'; // field used as the base "symbol" key

  // ── Group bars by symbol ───────────────────────────────────────────────────
  const bySymbol = {};
  data.forEach(row => {
    const sym = String(row[symF] ?? '');
    if (!bySymbol[sym]) bySymbol[sym] = [];
    bySymbol[sym].push(row);
  });

  // ── Compression helper ─────────────────────────────────────────────────────
  // Merges every `n` consecutive bars into one (OHLCV semantics).
  function compressBars(bars, n) {
    if (n <= 1) return bars;
    const out = [];
    for (let i = 0; i < bars.length; i += n) {
      const chunk = bars.slice(i, i + n);
      const o = Number(chunk[0][oF]);
      const h = Math.max(...chunk.map(r => Number(r[hF])));
      const l = Math.min(...chunk.map(r => Number(r[lF])));
      const c = Number(chunk[chunk.length - 1][cF]);
      const v = chunk.reduce((s, r) => s + (Number(r[vF]) || 0), 0);
      const t = chunk[0][tF]; // use first bar's timestamp
      out.push({ ...chunk[0], [tF]: t, [oF]: o, [hF]: h, [lF]: l, [cF]: c, [vF]: v });
    }
    return out;
  }

  // ── Resolve compression ratio ──────────────────────────────────────────────
  function resolveCompression(bars, compCfg) {
    if (compCfg === 'Auto') {
      if (!bars.length) return 1;
      const ratio = Math.max(1, Math.ceil(bars.length / sampleTarget));
      // Round up to nearest power-of-2-ish for cleanliness
      const steps = [1, 2, 4, 8, 12, 16, 32];
      return steps.reduce((best, s) => (Math.abs(bars.length / s - sampleTarget) < Math.abs(bars.length / best - sampleTarget) ? s : best), 1);
    }
    const n = parseInt(compCfg.replace(':1', '')) || 1;
    return Math.max(1, n);
  }

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

    // Detect intraday
    let minGapMs = Infinity;
    for (let i = 1; i < sortedBars.length; i++) {
      const g = new Date(sortedBars[i][tF]).getTime() - new Date(sortedBars[i-1][tF]).getTime();
      if (g > 0) minGapMs = Math.min(minGapMs, g);
    }
    if (!isFinite(minGapMs)) minGapMs = 86400000;
    const isIntraday = minGapMs / 86400000 < 1;

    // ── Step 1: Compression (before mode, before splitting) ──────────────────
    const compN = resolveCompression(sortedBars, compression);
    const compBars = compressBars(sortedBars, compN);

    // ── Step 2: Mode filter → explode bars to points ─────────────────────────
    const rawPoints = []; // { barIdx, off, price, v }
    compBars.forEach((bar, barIdx) => {
      barToPoints(bar, isIntraday, mode).forEach(pt => {
        rawPoints.push({ barIdx, off: pt.off, price: pt.price, v: pt.v });
      });
    });
    if (!rawPoints.length) return;

    const n = compBars.length;
    const refBarIdx = xRef === 'last' ? n - 1 : xRef === 'mid' ? Math.floor((n - 1) / 2) : 0;
    const offsets   = isIntraday ? [0, 0.2, 0.4, 0.6, 0.8] : [0.1, 0.3, 0.5, 0.7, 0.9];
    const refOff    = xRef === 'last' ? offsets[3] : offsets[0];
    const tRelBase  = refBarIdx + refOff;

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
      t_rel:  pt.barIdx + pt.off - tRelBase,
      p_rel:  yFmt === 'percent' && p0 !== null && p0 !== 0 && !isNaN(pt.price)
                ? (pt.price - p0) / p0
                : isNaN(pt.price) ? null : pt.price,
      v: scaleV(pt.v),
    }));

    // ── Step 4: Dataset splitting ─────────────────────────────────────────────
    // Add N copies of each symbol with _1, _2, … _N suffix
    if (nDatasets <= 1) {
      symRows2.forEach(r => allOutRows.push(r));
    } else {
      for (let ds = 1; ds <= nDatasets; ds++) {
        symRows2.forEach(r => allOutRows.push({ ...r, symbol: `${sym}_${ds}` }));
      }
    }
  });

  setHeaders(['symbol', 't_rel', 'p_rel', 'v']);
  return { data: allOutRows, _rows: allOutRows };
}
