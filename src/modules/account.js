// ══════════════════════════════════════════════════════════════
// ACCOUNT MODULES — watchlists, balances, positions, orders, activities, portfolio
// ══════════════════════════════════════════════════════════════
import {
  fetchWatchlists, fetchBalances, fetchPositions,
  fetchOrders, fetchActivities, fetchPortfolioHistory,
} from '../utils/api.js';
import { extractRows, postProcessRows } from '../utils/data.js';

export async function runWatchlists(node, { acct, setHeaders }) {
  const json = await fetchWatchlists(acct);
  const rows = postProcessRows(extractRows(json));
  if (rows.length) setHeaders(Object.keys(rows[0]).filter(k => !k.startsWith('_')));
  return { data: rows, _rows: rows };
}

export async function runBalances(node, { acct, setHeaders }) {
  const json = await fetchBalances(acct);
  const rows = postProcessRows(extractRows(json));
  if (rows.length) setHeaders(Object.keys(rows[0]).filter(k => !k.startsWith('_')));
  return { data: rows, _rows: rows };
}

export async function runPositions(node, { acct, setHeaders }) {
  const json = await fetchPositions(acct);
  const rows = postProcessRows(extractRows(json));
  if (rows.length) setHeaders(Object.keys(rows[0]).filter(k => !k.startsWith('_')));
  return { data: rows, _rows: rows };
}

export async function runOpenOrders(node, { cfg, acct, setHeaders }) {
  const rows = await fetchOrders(acct, { status: cfg.status || 'open' });
  if (rows.length) setHeaders(Object.keys(rows[0]).filter(k => !k.startsWith('_')));
  return { data: rows, _rows: rows };
}

export async function runActivities(node, { cfg, acct, setHeaders }) {
  const rows = await fetchActivities(acct, {
    activity_types: cfg.activity_types || ['FILL'],
    days_back:      cfg.days_back || 30,
  });
  if (rows.length) setHeaders(Object.keys(rows[0]).filter(k => !k.startsWith('_')));
  return { data: rows, _rows: rows };
}

export async function runPortfolioHistory(node, { cfg, acct, setHeaders }) {
  const json = await fetchPortfolioHistory(acct, {
    period:    cfg.period    || '1M',
    timeframe: cfg.timeframe || '1D',
  });
  const rows = postProcessRows(extractRows(json));
  if (rows.length) setHeaders(Object.keys(rows[0]).filter(k => !k.startsWith('_')));
  return { data: rows, _rows: rows };
}
