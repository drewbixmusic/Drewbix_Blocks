// ══════════════════════════════════════════════════════════════
// FLOW EXECUTION ENGINE — topological sort, input resolution, runner
// ══════════════════════════════════════════════════════════════
import { getState } from './state.js';
import { MOD }      from './registry.js';
import { callModule } from '../modules/index.js';

// ── Ports that carry no data — used only for ordering ────────────────────────
export const SCALAR_PORTS = new Set(['start', 'end', 'name', 'a', 'b', 'timestamp', 'ref']);
export const SEQ_PORTS    = new Set(['enable', 'status']);

// ── Kahn's Algorithm — returns node IDs in execution order ──────────────────
export function topoSort(nodes, edges) {
  const inDeg = {}, adj = {};
  nodes.forEach(n => { inDeg[n.id] = 0; adj[n.id] = []; });
  edges.forEach(e => { inDeg[e.to] = (inDeg[e.to] || 0) + 1; (adj[e.from] = adj[e.from] || []).push(e.to); });
  const queue = nodes.filter(n => inDeg[n.id] === 0).map(n => n.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    (adj[id] || []).forEach(nxt => { if (--inDeg[nxt] === 0) queue.push(nxt); });
  }
  return order;
}

// ── Resolve all upstream outputs into a flat { portName: rows[] } map ────────
export function resolveInputs(nodeId, { edges, runResults }) {
  const incoming = edges.filter(e => e.to === nodeId);
  const resolved = {};
  incoming.forEach(e => {
    if (SEQ_PORTS.has(e.toPort)) return;
    const upstreamData = runResults[e.from]?.data;
    if (!upstreamData) return;
    const rows = upstreamData._rows;

    // Side-chain ports (_sc_<fromNodeId>) → extract scalar
    if (e.toPort.startsWith('_sc_')) {
      const sc = upstreamData._scalar;
      if (sc !== undefined) { resolved[e.toPort] = sc; return; }
      if (Array.isArray(rows) && rows.length) {
        const firstRow  = rows[0];
        const tsField   = Object.keys(firstRow).find(k => typeof firstRow[k] === 'string' && /\d{4}-\d{2}-\d{2}/.test(firstRow[k]));
        const firstVal  = tsField ? firstRow[tsField] : firstRow[Object.keys(firstRow)[0]];
        resolved[e.toPort] = typeof firstVal === 'object' ? JSON.stringify(firstVal) : String(firstVal ?? '');
      }
      return;
    }

    if (SCALAR_PORTS.has(e.toPort)) {
      if (upstreamData._scalar !== undefined) { resolved[e.toPort] = upstreamData._scalar; return; }
      const explicit = upstreamData[e.fromPort];
      if (explicit !== undefined && explicit !== null && !Array.isArray(explicit) && typeof explicit !== 'object') {
        resolved[e.toPort] = explicit; return;
      }
      if (Array.isArray(rows) && rows.length) {
        const firstRow = rows[0];
        if (e.fromPort && firstRow[e.fromPort] !== undefined) {
          resolved[e.toPort] = String(firstRow[e.fromPort] ?? ''); return;
        }
        const tsKey = Object.keys(firstRow).find(k => typeof firstRow[k] === 'string' && /\d{4}-\d{2}-\d{2}T/.test(firstRow[k]));
        const val   = tsKey ? firstRow[tsKey] : Object.values(firstRow).find(v => typeof v === 'string' || typeof v === 'number');
        resolved[e.toPort] = String(val ?? '');
      }
      return;
    }

    // Data ports: named port takes priority, else fall back to _rows
    const portData = upstreamData[e.fromPort];
    if (Array.isArray(portData) && portData.length) {
      resolved[e.toPort] = portData;
    } else if (Array.isArray(rows)) {
      resolved[e.toPort] = rows;
    } else if (rows !== undefined) {
      resolved[e.toPort] = rows;
    }
  });
  return resolved;
}

// ── Merge multiple viz input ports into a single deduplicated array ───────────
export function mergeVizInputs(inputs) {
  const seen   = new Set();
  const merged = [];
  Object.values(inputs).forEach(val => {
    if (!Array.isArray(val)) return;
    val.forEach(row => {
      if (!seen.has(row)) { seen.add(row); merged.push(row); }
    });
  });
  return merged;
}

// ── Execute a saved subgraph (subflow / for-each) ────────────────────────────
export async function runSubgraph(fnDef, inputRows, inputsMap) {
  if (!fnDef?.nodes?.length) return { data: [], _rows: [] };
  const state = getState();
  const subRunResults = {};

  const order = topoSort(fnDef.nodes, fnDef.edges || []);

  for (const nodeId of order) {
    const node = fnDef.nodes.find(n => n.id === nodeId);
    if (!node) continue;
    const inputs = resolveInputs(nodeId, { edges: fnDef.edges || [], runResults: subRunResults });

    // Inject external input into entry nodes (those with no incoming edges)
    const hasUpstream = (fnDef.edges || []).some(e => e.to === nodeId);
    if (!hasUpstream && inputRows.length) {
      inputs.data = inputs.data || inputRows;
    }

    const cfg    = state.configs[nodeId] || {};
    const _headers = [];
    const setHeaders = h => { _headers.splice(0, _headers.length, ...h); };

    const ctx = buildCtx({ node, cfg, inputs, setHeaders, state });
    try {
      const data = await callModule(node.moduleId, node, ctx);
      data._headers = _headers;
      subRunResults[nodeId] = { status: 'done', data };
    } catch (err) {
      subRunResults[nodeId] = { status: 'error', data: { _rows: [], _headers: [] }, error: err.message };
    }
  }

  // Collect outputs from sink nodes (those with no outgoing edges within the subgraph)
  const sinkNodes = fnDef.nodes.filter(n => !(fnDef.edges || []).some(e => e.from === n.id));
  const merged   = [];
  let lastHeaders = [];
  sinkNodes.forEach(n => {
    const res = subRunResults[n.id];
    if (res?.data?._rows) {
      merged.push(...res.data._rows);
      if (res.data._headers?.length) lastHeaders = res.data._headers;
    }
  });

  return { data: merged, _rows: merged, _headers: lastHeaders };
}

// ── Build context object for a module call ────────────────────────────────────
function buildCtx({ node, cfg, inputs, setHeaders, state, extraCtx = {} }) {
  const {
    rfRegistry, setRfRegistry, functions,
    openRFDashboard, openChartModal, openChartGridModal, openTableModal,
  } = state;

  return {
    cfg,
    inputs,
    setHeaders,
    rfRegistry,
    setRfRegistry,
    functions,
    openRFDashboard,
    openChart:     openChartModal,
    openChartGrid: openChartGridModal,
    openTable:     openTableModal,
    runSubgraph,
    callModuleCtx: {
      functions,
      /**
       * Runs a single module (mod::id) or a saved sub-flow (fn::name) with
       * a given subset of rows and returns the output row array.
       *
       * @param {string} fnSel        "mod::moduleId" or "fn::functionName"
       * @param {any[]}  rows         input data rows for this iteration
       * @param {object} innerCfg     config for the inner module (for mod:: path)
       * @param {object} innerNode    synthetic node object (for mod:: path)
       * @param {object} innerInputs  pre-built inputs map (optional override)
       * @param {any[]}  innerHeaders mutable array that receives header names
       */
      callModuleInContext: async (fnSel, rows, innerCfg, innerNode, innerInputs, innerHeaders = []) => {
        if (fnSel.startsWith('mod::')) {
          const modId = fnSel.slice(5);
          if (!MOD[modId]) throw new Error(`for_each mod: module "${modId}" not found`);

          const inputs     = innerInputs || { data: rows };
          const setHeaders = h => { innerHeaders.splice(0, innerHeaders.length, ...h); };
          const synNode    = innerNode || { id: `__fe_${modId}__`, moduleId: modId };

          const innerCtx = buildCtx({
            node:    synNode,
            cfg:     innerCfg || {},
            inputs,
            setHeaders,
            state,
            extraCtx,   // carries acct etc. from parent scope via closure
          });

          const result = await callModule(modId, synNode, innerCtx);
          return result._rows || result.data || [];
        }

        if (fnSel.startsWith('fn::')) {
          const fnName = fnSel.slice(4);
          const fn     = functions?.[fnName];
          if (!fn) throw new Error(`for_each fn: function "${fnName}" not found`);
          const res = await runSubgraph(fn, rows, { data: rows });
          return res._rows || res.data || [];
        }

        throw new Error(`for_each: unknown selector "${fnSel}"`);
      },
    },
    ...extraCtx,
  };
}

// ── Main flow runner ─────────────────────────────────────────────────────────
export async function runFlow(dryRun = false) {
  const state = getState();
  const {
    nodes, edges, configs, accounts, activeAccountId,
    setRunStatus, setRunResult, clearRunStatuses,
    appendRunLog,
  } = state;

  const acct = accounts.find(a => a.id === activeAccountId);
  if (!acct && !dryRun) throw new Error('No active account credentials');

  clearRunStatuses();

  const order = topoSort(nodes, edges);
  const runResults = {};
  const total = order.length;

  for (let i = 0; i < order.length; i++) {
    const nodeId = order[i];
    const node   = nodes.find(n => n.id === nodeId);
    if (!node) continue;

    const def = MOD[node.moduleId] || (node.moduleId.startsWith('subflow::') ? { label: node.moduleId } : null);
    setRunStatus(nodeId, 'running');
    appendRunLog?.(`[${i + 1}/${total}] ${def?.label ?? node.moduleId} (${nodeId})`);

    const inputs   = resolveInputs(nodeId, { edges, runResults });
    const cfg      = configs[nodeId] || {};
    const _headers = [];
    const setHeaders = h => { _headers.splice(0, _headers.length, ...h); };
    const ctx = buildCtx({ node, cfg, inputs, setHeaders, state, extraCtx: { acct } });

    if (dryRun) {
      runResults[nodeId] = { status: 'done', data: { _rows: [] } };
      setRunResult(nodeId, { _rows: [] });
      setRunStatus(nodeId, 'done');
      continue;
    }

    try {
      const data = await callModule(node.moduleId, node, ctx);
      data._headers = _headers;

      // Persist headers into configs so DynFieldSelect / getUpstreamFields can read them
      const headerPatch = { _headers };
      if (Array.isArray(data._headers_actuals)) {
        headerPatch._headers_actuals = data._headers_actuals;
      }
      // Write any named-port header arrays (e.g. _headers_features)
      Object.keys(data).forEach(k => {
        if (k.startsWith('_headers_') && Array.isArray(data[k])) {
          headerPatch[k] = data[k];
        }
      });
      state.bulkSetConfig(nodeId, headerPatch);

      runResults[nodeId] = { status: 'done', data };
      setRunResult(nodeId, data);
      setRunStatus(nodeId, 'done');
      appendRunLog?.(`  ✓ ${(data._rows?.length ?? '?')} rows`);
    } catch (err) {
      runResults[nodeId] = { status: 'error', error: err.message };
      setRunStatus(nodeId, 'error');
      appendRunLog?.(`  ✕ ${err.message}`);
    }
  }

  return runResults;
}
