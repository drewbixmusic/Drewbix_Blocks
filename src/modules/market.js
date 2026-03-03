// ══════════════════════════════════════════════════════════════
// MARKET DATA MODULES — clock, calendar, assets, movers, actives, bars, snapshots
// ══════════════════════════════════════════════════════════════
import {
  fetchClock, fetchCalendar, fetchAssets, fetchMovers,
  fetchActives, fetchBars, fetchSnapshots, fetchCorporateActions,
} from '../utils/api.js';
import { extractRows, postProcessRows } from '../utils/data.js';

export async function runClock(node, { cfg, inputs, acct, setHeaders }) {
  const clockJson = await fetchClock(acct);
  const unitToDays = { minutes: 1 / 1440, hours: 1 / 24, days: 1, weeks: 7, years: 365 };
  const offsetSrc  = cfg.offset_src || 'input';
  const hasInput   = inputs.offset !== undefined && inputs.offset !== null;
  let offsetDays   = 0;

  if (offsetSrc === 'input' && hasInput) {
    let rawVal = inputs.offset;
    if (Array.isArray(rawVal) && rawVal.length) rawVal = rawVal[0];
    if (typeof rawVal === 'object' && rawVal !== null)
      rawVal = Object.values(rawVal).find(v => !isNaN(Number(v))) ?? 0;
    offsetDays = isNaN(Number(rawVal)) ? 0 : Number(rawVal);
  } else {
    offsetDays = Number(cfg.offset_val ?? 0) * (unitToDays[cfg.offset_unit || 'days'] ?? 1);
  }

  const clockTs  = clockJson.timestamp ? new Date(clockJson.timestamp) : new Date();
  const offsetMs = offsetDays * 24 * 60 * 60 * 1000;
  const offsetTs = new Date(clockTs.getTime() - offsetMs);
  const origSuffix = typeof clockJson.timestamp === 'string'
    ? (clockJson.timestamp.match(/([+-]\d{2}:\d{2}|Z)$/) || ['Z'])[0] : 'Z';

  const pad   = n => String(n).padStart(2, '0');
  const fmtTs = ts => origSuffix === 'Z' ? ts.toISOString()
    : `${ts.getFullYear()}-${pad(ts.getMonth()+1)}-${pad(ts.getDate())}T${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}${origSuffix}`;
  const shiftTs = ts => {
    if (!ts) return ts;
    const d = new Date(ts); if (isNaN(d.getTime())) return ts;
    return fmtTs(new Date(d.getTime() - offsetMs));
  };

  const outRow = {
    ...clockJson,
    timestamp:           fmtTs(offsetTs),
    timestamp_original:  clockJson.timestamp,
    next_open:           shiftTs(clockJson.next_open),
    next_open_original:  clockJson.next_open,
    next_close:          shiftTs(clockJson.next_close),
    next_close_original: clockJson.next_close,
    offset_days:         Math.round(offsetDays * 1e6) / 1e6,
  };
  const rows = [outRow];
  setHeaders(Object.keys(outRow).filter(k => !k.startsWith('_')));
  return { data: rows, _rows: rows };
}

export async function runCalendar(node, { cfg, inputs, acct, setHeaders }) {
  let refDate;
  const refInput = inputs.ref;
  if (refInput) {
    if (typeof refInput === 'string') {
      refDate = new Date(refInput);
    } else if (Array.isArray(refInput) && refInput.length) {
      const r = refInput[0];
      const tsVal = typeof r === 'string' ? r
        : r.timestamp || r.next_open || r.next_close
        || Object.values(r).find(v => typeof v === 'string' && /\d{4}-\d{2}-\d{2}/.test(v));
      refDate = new Date(tsVal);
    } else if (typeof refInput === 'object' && refInput !== null) {
      const tsVal = refInput.timestamp || Object.values(refInput).find(v => typeof v === 'string' && /\d{4}-\d{2}-\d{2}/.test(v));
      refDate = new Date(tsVal);
    }
  }
  if (!refDate || isNaN(refDate.getTime())) refDate = new Date();

  const daysBack = Number(cfg.days_back ?? -365);
  const daysFwd  = Number(cfg.days_forward ?? 365);
  const calStart = new Date(refDate); calStart.setDate(calStart.getDate() + Math.min(daysBack, 0));
  const calEnd   = new Date(refDate); calEnd.setDate(calEnd.getDate() + Math.max(daysFwd, 0));

  const json = await fetchCalendar(acct, calStart.toISOString().slice(0, 10), calEnd.toISOString().slice(0, 10));
  const rows = extractRows(json);
  if (rows.length) setHeaders(Object.keys(rows[0]).filter(k => !k.startsWith('_')));
  return { data: rows, _rows: rows };
}

export async function runAssets(node, { cfg, acct, setHeaders }) {
  const json = await fetchAssets(acct, cfg.asset_class || 'us_equity', cfg.status || 'active');
  const rows = postProcessRows(extractRows(json));
  if (rows.length) setHeaders(Object.keys(rows[0]).filter(k => !k.startsWith('_')));
  return { data: rows, _rows: rows };
}

export async function runMovers(node, { cfg, acct, setHeaders }) {
  const json = await fetchMovers(acct, cfg.market_type || 'stocks', cfg.top || 20);
  const rows = postProcessRows(extractRows(json));
  if (rows.length) setHeaders(Object.keys(rows[0]).filter(k => !k.startsWith('_')));
  return { data: rows, _rows: rows };
}

export async function runActives(node, { cfg, acct, setHeaders }) {
  const json = await fetchActives(acct, cfg.market_type || 'stocks', cfg.top || 20);
  const rows = postProcessRows(extractRows(json));
  if (rows.length) setHeaders(Object.keys(rows[0]).filter(k => !k.startsWith('_')));
  return { data: rows, _rows: rows };
}

export async function runCorporateActions(node, { cfg, acct, setHeaders }) {
  const json = await fetchCorporateActions(acct, cfg.types || ['dividend', 'split']);
  const rows = postProcessRows(extractRows(json));
  if (rows.length) setHeaders(Object.keys(rows[0]).filter(k => !k.startsWith('_')));
  return { data: rows, _rows: rows };
}

function normalizeSymbolInput(rawSyms) {
  if (typeof rawSyms === 'string' && rawSyms.includes(',')) return rawSyms;
  const symArr = Array.isArray(rawSyms) ? rawSyms : [rawSyms];
  return symArr.map(s => {
    if (typeof s === 'string') return s;
    if (s && typeof s === 'object') return s.symbol || s.value || Object.values(s)[0] || '';
    return String(s);
  }).filter(Boolean).join(',');
}

export async function runBars(node, { cfg, inputs, acct, setHeaders }) {
  const rows = await fetchBars(acct, {
    symbols:     normalizeSymbolInput(inputs.symbols || []),
    timeframe:   cfg.timeframe   || '1D',
    feed:        cfg.feed        || 'sip',
    adjustment:  cfg.adjustment  || 'all',
    limit:       cfg.limit       || '10000',
    start:       inputs.start,
    end:         inputs.end,
    asset_class: cfg.asset_class || 'us_equity',
  });
  if (rows.length) setHeaders(Object.keys(rows[0]).filter(k => !k.startsWith('_')));
  return { data: rows, _rows: rows };
}

export async function runSnapshots(node, { cfg, inputs, acct, setHeaders }) {
  const rows = await fetchSnapshots(acct, {
    symbols:     normalizeSymbolInput(inputs.symbols || []),
    feed:        cfg.feed        || 'sip',
    asset_class: cfg.asset_class || 'us_equity',
  });
  if (rows.length) setHeaders(Object.keys(rows[0]).filter(k => !k.startsWith('_')));
  return { data: rows, _rows: rows };
}
