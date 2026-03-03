// ══════════════════════════════════════════════════════════════
// WRITE MODULES — write_watchlist, write_order
// ══════════════════════════════════════════════════════════════
import { postWatchlist, postOrder } from '../utils/api.js';

export async function runWriteWatchlist(node, { cfg, inputs, acct }) {
  const body = {
    name:    inputs.name || 'Flow Watchlist',
    symbols: inputs.symbols || [],
  };
  const result = await postWatchlist(acct, body);
  return { data: [result], _rows: [result] };
}

export async function runWriteOrder(node, { cfg, inputs, acct }) {
  const body = {
    symbol:         inputs.symbol || cfg.symbol,
    qty:            inputs.qty    || cfg.qty || 1,
    side:           inputs.side   || cfg.side || 'buy',
    type:           inputs.type   || cfg.type || 'market',
    time_in_force:  cfg.time_in_force || 'day',
  };
  if (inputs.limit_price || cfg.limit_price) body.limit_price = String(inputs.limit_price || cfg.limit_price);
  if (cfg.extended_hours) body.extended_hours = true;
  const result = await postOrder(acct, body);
  return { data: [result], _rows: [result] };
}
