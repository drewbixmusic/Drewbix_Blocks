// ══════════════════════════════════════════════════════════════
// ALPACA API LAYER — thin fetch wrappers for every endpoint
// ══════════════════════════════════════════════════════════════
import { extractRows, postProcessRows, flattenRow } from './data.js';

/**
 * Build base URLs and auth headers for the active account.
 * @param {{ env: string, key: string, secret: string }} acct
 */
export function alpacaContext(acct) {
  const BASE = acct.env === 'live'
    ? 'https://api.alpaca.markets'
    : 'https://paper-api.alpaca.markets';
  const DATA = 'https://data.alpaca.markets';
  const headers = {
    'APCA-API-KEY-ID':     acct.key,
    'APCA-API-SECRET-KEY': acct.secret,
  };
  return { BASE, DATA, headers };
}

async function request(url, headers) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

// ── Market clock ─────────────────────────────────────────────────────────────
export async function fetchClock(acct) {
  const { BASE, headers } = alpacaContext(acct);
  return request(`${BASE}/v2/clock`, headers);
}

// ── Calendar ─────────────────────────────────────────────────────────────────
export async function fetchCalendar(acct, start, end) {
  const { BASE, headers } = alpacaContext(acct);
  const p = new URLSearchParams({ start, end });
  return request(`${BASE}/v2/calendar?${p}`, headers);
}

// ── Assets ───────────────────────────────────────────────────────────────────
export async function fetchAssets(acct, asset_class = 'us_equity', status = 'active') {
  const { BASE, headers } = alpacaContext(acct);
  const p = new URLSearchParams({ asset_class, status });
  return request(`${BASE}/v2/assets?${p}`, headers);
}

// ── Movers ───────────────────────────────────────────────────────────────────
export async function fetchMovers(acct, market_type = 'stocks', top = 20) {
  const { DATA, headers } = alpacaContext(acct);
  const p = new URLSearchParams({ top });
  return request(`${DATA}/v1beta1/screener/${market_type}/movers?${p}`, headers);
}

// ── Actives ──────────────────────────────────────────────────────────────────
export async function fetchActives(acct, market_type = 'stocks', top = 20) {
  const { DATA, headers } = alpacaContext(acct);
  const p = new URLSearchParams({ top });
  return request(`${DATA}/v1beta1/screener/${market_type}/most-actives?${p}`, headers);
}

// ── Corporate actions ─────────────────────────────────────────────────────────
export async function fetchCorporateActions(acct, types = ['dividend', 'split']) {
  const { DATA, headers } = alpacaContext(acct);
  const p = new URLSearchParams({ types: types.join(',') });
  return request(`${DATA}/v1beta1/corporate-actions?${p}`, headers);
}

// ── OHLCV Bars (with pagination) ──────────────────────────────────────────────
export async function fetchBars(acct, { symbols, timeframe, feed, adjustment, limit, start, end, asset_class }) {
  const { DATA, headers } = alpacaContext(acct);
  const isCrypto = asset_class === 'crypto';
  const baseUrl = isCrypto ? `${DATA}/v1beta3/crypto/us/bars` : `${DATA}/v2/stocks/bars`;
  const maxRows = Number(limit || 10000);

  const p = new URLSearchParams();
  p.set('symbols', symbols);
  p.set('timeframe', timeframe || '1D');
  p.set('limit', Math.min(maxRows, 10000));
  if (!isCrypto) {
    p.set('feed', feed || 'sip');
    p.set('adjustment', adjustment || 'all');
  }
  if (start) p.set('start', start);
  if (end)   p.set('end', end);

  let allRows = [], nextPageToken = null;
  do {
    if (nextPageToken) p.set('page_token', nextPageToken);
    const j = await request(`${baseUrl}?${p}`, headers);
    const pageRows = extractRows(j).filter(r => r && typeof r === 'object' && !Array.isArray(r));
    allRows = allRows.concat(pageRows);
    nextPageToken = j.next_page_token || null;
  } while (nextPageToken && allRows.length < maxRows);

  return postProcessRows(allRows);
}

// ── Snapshots ─────────────────────────────────────────────────────────────────
export async function fetchSnapshots(acct, { symbols, feed, asset_class }) {
  const { DATA, headers } = alpacaContext(acct);
  const isCrypto = asset_class === 'crypto';
  const url = isCrypto ? `${DATA}/v1beta3/crypto/us/snapshots` : `${DATA}/v2/stocks/snapshots`;
  const p = new URLSearchParams({ symbols });
  if (!isCrypto) p.set('feed', feed || 'sip');
  const j = await request(`${url}?${p}`, headers);
  return postProcessRows(extractRows(j).filter(r => r && typeof r === 'object' && !Array.isArray(r)));
}

// ── Account endpoints ─────────────────────────────────────────────────────────
export async function fetchWatchlists(acct) {
  const { BASE, headers } = alpacaContext(acct);
  return request(`${BASE}/v2/watchlists`, headers);
}

export async function fetchBalances(acct) {
  const { BASE, headers } = alpacaContext(acct);
  return request(`${BASE}/v2/account`, headers);
}

export async function fetchPositions(acct) {
  const { BASE, headers } = alpacaContext(acct);
  return request(`${BASE}/v2/positions`, headers);
}

export async function fetchOrders(acct, { status = 'open' } = {}) {
  const { BASE, headers } = alpacaContext(acct);
  let allOrders = [], afterId = null;
  do {
    const p = new URLSearchParams({ status, limit: '500' });
    if (afterId) p.set('after', afterId);
    const page = await request(`${BASE}/v2/orders?${p}`, headers);
    if (!Array.isArray(page) || !page.length) break;
    allOrders = allOrders.concat(page);
    afterId = page.length === 500 ? page[page.length - 1].id : null;
  } while (afterId);
  return allOrders.map(r => flattenRow(r)).filter(r => r && typeof r === 'object');
}

export async function fetchActivities(acct, { activity_types = ['FILL'], days_back = 30 } = {}) {
  const { BASE, headers } = alpacaContext(acct);
  const actTypes = activity_types.join(',');
  let allActs = [], pageToken = null;
  do {
    const p = new URLSearchParams({ activity_types: actTypes, page_size: '100' });
    if (pageToken) p.set('page_token', pageToken);
    const page = await request(`${BASE}/v2/account/activities?${p}`, headers);
    if (!Array.isArray(page) || !page.length) break;
    allActs = allActs.concat(page);
    pageToken = page.length === 100 ? page[page.length - 1].id : null;
  } while (pageToken);
  return allActs.map(r => flattenRow(r)).filter(r => r && typeof r === 'object');
}

export async function fetchPortfolioHistory(acct, { period = '1M', timeframe = '1D' } = {}) {
  const { BASE, headers } = alpacaContext(acct);
  const p = new URLSearchParams({ period, timeframe });
  return request(`${BASE}/v2/account/portfolio/history?${p}`, headers);
}

// ── Write endpoints ───────────────────────────────────────────────────────────
export async function postWatchlist(acct, body) {
  const { BASE, headers } = alpacaContext(acct);
  const r = await fetch(`${BASE}/v2/watchlists`, {
    method:  'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

export async function postOrder(acct, body) {
  const { BASE, headers } = alpacaContext(acct);
  const r = await fetch(`${BASE}/v2/orders`, {
    method:  'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
