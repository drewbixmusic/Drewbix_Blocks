// ══════════════════════════════════════════════════════════════
// MODULE DISPATCHER — routes moduleId → run* function
// ══════════════════════════════════════════════════════════════
import { runClock, runCalendar, runAssets, runMovers, runActives, runCorporateActions, runBars, runSnapshots } from './market.js';
import { runWatchlists, runBalances, runPositions, runOpenOrders, runActivities, runPortfolioHistory } from './account.js';
import { runWriteWatchlist, runWriteOrder } from './write.js';
import { runFilter, runMultiFilter, runJoin, runSelectFields, runSymbolIntersect, runTranspose } from './transform.js';
import { runGateAnd, runGateOr, runGateNand, runGateNor, runGateXor, runGateInverter } from './gates.js';
import { runTimeOffset, runTsToMs, runDateExtreme, runTsToTrel, runOhlcToTs } from './tsFunc.js';
import {
  runPearsonRsq, runMvRegression, runRandForest,
  runDpPrecision, runDataset, runManualEntry, runCollect,
  runStat, runRawToPrel, runMathOp, runMovingAvg,
  runConvergences, runAsymDamp, runDynEnvelope, runOutlierClean, runForEach,
} from './dataproc.js';
import { runChart, runChartGrid, runTable, runRFDash, runSparkline, runHeatmap } from './viz.js';
import { runSubflow } from './subflow.js';
import { runDataImport } from './import.js';
import { runDataExport } from './export.js';
import { runFeatureEngineering } from './featureEng.js';

/**
 * Dispatches execution to the correct run* function for a given moduleId.
 *
 * @param {string} moduleId  - the MOD key (e.g. 'bars', 'filter', 'viz_table')
 * @param {object} node      - the node object from the store
 * @param {object} ctx       - execution context object:
 *   {
 *     cfg,          // merged node config
 *     inputs,       // resolved inputs from upstream nodes
 *     acct,         // active Alpaca account credentials
 *     setHeaders,   // (headers: string[]) => void — updates _headers on the result
 *     rfRegistry,   // rf model registry from store
 *     setRfRegistry,// store action to update rf registry
 *     openChart,    // opens the chart modal
 *     openChartGrid,// opens the chart-grid modal
 *     openTable,    // opens the table modal
 *     openRFDashboard, // opens the RF dashboard modal
 *     functions,    // saved functions map
 *     runSubgraph,  // engine.runSubgraph — for subflow execution
 *     callModuleCtx,// for_each context: { MOD, functions, callModuleInContext }
 *   }
 * @returns {Promise<{data: any[], _rows: any[], [key: string]: any}>}
 */
export async function callModule(moduleId, node, ctx) {
  // Subflow nodes have moduleId like `subflow::<name>`
  if (moduleId.startsWith('subflow::')) {
    return runSubflow(node, ctx);
  }

  switch (moduleId) {
    // ── Market Data ──────────────────────────────────────────────────────────
    case 'clock':             return runClock(node, ctx);
    case 'calendar':          return runCalendar(node, ctx);
    case 'assets':            return runAssets(node, ctx);
    case 'movers':            return runMovers(node, ctx);
    case 'actives':           return runActives(node, ctx);
    case 'corporate_actions': return runCorporateActions(node, ctx);
    case 'bars':              return runBars(node, ctx);
    case 'snapshots':         return runSnapshots(node, ctx);

    // ── Account ───────────────────────────────────────────────────────────────
    case 'watchlists':        return runWatchlists(node, ctx);
    case 'balances':          return runBalances(node, ctx);
    case 'positions':         return runPositions(node, ctx);
    case 'open_orders':       return runOpenOrders(node, ctx);
    case 'activities':        return runActivities(node, ctx);
    case 'portfolio_history': return runPortfolioHistory(node, ctx);

    // ── Write ─────────────────────────────────────────────────────────────────
    case 'write_watchlist':   return runWriteWatchlist(node, ctx);
    case 'write_order':       return runWriteOrder(node, ctx);

    // ── Transform ─────────────────────────────────────────────────────────────
    case 'filter':            return runFilter(node, ctx);
    case 'multi_filter':      return runMultiFilter(node, ctx);
    case 'join':              return runJoin(node, ctx);
    case 'select_fields':     return runSelectFields(node, ctx);
    case 'symbol_intersect':  return runSymbolIntersect(node, ctx);
    case 'transpose':         return runTranspose(node, ctx);

    // ── Logic Gates ───────────────────────────────────────────────────────────
    case 'gate_and':          return runGateAnd(node, ctx);
    case 'gate_or':           return runGateOr(node, ctx);
    case 'gate_nand':         return runGateNand(node, ctx);
    case 'gate_nor':          return runGateNor(node, ctx);
    case 'gate_xor':          return runGateXor(node, ctx);
    case 'gate_inverter':     return runGateInverter(node, ctx);

    // ── Timestamp Functions ───────────────────────────────────────────────────
    case 'time_offset':       return runTimeOffset(node, ctx);
    case 'ts_to_ms':          return runTsToMs(node, ctx);
    case 'date_max':          return runDateExtreme(node, ctx, 'max');
    case 'date_min':          return runDateExtreme(node, ctx, 'min');
    case 'ts_to_trel':        return runTsToTrel(node, ctx);
    case 'ohlc_to_ts':        return runOhlcToTs(node, ctx);

    // ── Data Processing ───────────────────────────────────────────────────────
    case 'pearson_rsq':       return runPearsonRsq(node, ctx);
    case 'mv_regression':     return runMvRegression(node, ctx);
    case 'rand_forest':       return runRandForest(node, ctx);
    case 'dp_precision':      return runDpPrecision(node, ctx);
    case 'dataset':           return runDataset(node, ctx);
    case 'manual_entry':      return runManualEntry(node, ctx);
    case 'collect':           return runCollect(node, ctx);
    case 'stat_mean':         return runStat(node, ctx, 'mean');
    case 'stat_median':       return runStat(node, ctx, 'median');
    case 'stat_min':          return runStat(node, ctx, 'min');
    case 'stat_max':          return runStat(node, ctx, 'max');
    case 'stat_stdev':        return runStat(node, ctx, 'stdev');
    case 'raw_to_prel':       return runRawToPrel(node, ctx);
    case 'math_add':          return runMathOp(node, ctx, 'add');
    case 'math_sub':          return runMathOp(node, ctx, 'sub');
    case 'math_mul':          return runMathOp(node, ctx, 'mul');
    case 'math_div':          return runMathOp(node, ctx, 'div');
    case 'moving_avg':        return runMovingAvg(node, ctx);
    case 'convergences':      return runConvergences(node, ctx);
    case 'asym_damp':         return runAsymDamp(node, ctx);
    case 'dyn_envelope':      return runDynEnvelope(node, ctx);
    case 'outlier_clean':     return runOutlierClean(node, ctx);
    case 'for_each':          return runForEach(node, ctx);
    case 'feat_engineering':  return runFeatureEngineering(node, ctx);

    // ── Visualization ─────────────────────────────────────────────────────────
    case 'viz_chart':         return runChart(node, ctx);
    case 'viz_chart_grid':    return runChartGrid(node, ctx);
    case 'viz_table':         return runTable(node, ctx);
    case 'viz_rf_dash':       return runRFDash(node, ctx);
    case 'viz_sparkline':     return runSparkline(node, ctx);
    case 'viz_heatmap':       return runHeatmap(node, ctx);

    // ── I/O ───────────────────────────────────────────────────────────────────
    case 'data_import':       return runDataImport(node, ctx);
    case 'data_export':       return runDataExport(node, ctx);

    default:
      throw new Error(`Unknown module: "${moduleId}"`);
  }
}
