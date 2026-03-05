// ══════════════════════════════════════════════════════════════
// SERIALIZATION — flow import/export and localStorage persistence
// ══════════════════════════════════════════════════════════════
import { getState, setState } from '../core/state.js';

const FLOW_VERSION = '1.2';
const LS_KEY_FLOWS    = 'drewbix_saved_flows';
const LS_KEY_ACCOUNTS = 'drewbix_accounts';

// ── Build a portable flow object from the current store ───────────────────────
function stripTrainRows(registry) {
  const out = {};
  Object.entries(registry || {}).forEach(([k, m]) => {
    if (m && typeof m === 'object') { const { trainRows, ...rest } = m; out[k] = rest; }
  });
  return out;
}

export function getFlowObject() {
  const {
    nodes, edges, configs, pan, zoom,
    flowName, accounts, activeAccountId,
    functions, rfRegistry, mvRegistry,
  } = getState();

  const rfModelsOut = Object.keys(rfRegistry || {}).length
    ? stripTrainRows(rfRegistry)
    : (configs['__rf_models__'] || {});

  const mvModelsOut = Object.keys(mvRegistry || {}).length
    ? stripTrainRows(mvRegistry)
    : (configs['__mv_models__'] || {});

  return {
    name:            flowName || 'Unnamed',
    version:         FLOW_VERSION,
    created:         new Date().toISOString(),
    accounts:        accounts.map(a => ({ id: a.id, name: a.name, env: a.env, key: a.key, secret: a.secret, cycleEnabled: a.cycleEnabled })),
    activeAccountId,
    nodes:           nodes.map(n => ({ id: n.id, moduleId: n.moduleId, x: n.x, y: n.y, config: configs[n.id] || {} })),
    edges,
    viewport:        { pan, zoom },
    functions,
    rf_models:       rfModelsOut,
    mv_models:       mvModelsOut,
  };
}

// ── Load a flow object into the store ─────────────────────────────────────────
export function loadFlowObject(flow) {
  const { loadFlow, setAccounts, setActiveAccount } = getState();
  const nodes   = (flow.nodes || []).map(n => ({ id: n.id, moduleId: n.moduleId, x: n.x, y: n.y }));
  const configs = {};
  (flow.nodes || []).forEach(n => { configs[n.id] = n.config || {}; });
  if (flow.rf_models && typeof flow.rf_models === 'object') {
    configs['__rf_models__'] = flow.rf_models;
  }

  loadFlow({
    name:      flow.name || 'Unnamed',
    nodes,
    edges:     flow.edges || [],
    configs,
    pan:       flow.viewport?.pan  ?? { x: 0, y: 0 },
    zoom:      flow.viewport?.zoom ?? 1,
    functions: (typeof flow.functions === 'object' && flow.functions) ? flow.functions : {},
  });

  setState({
    rfRegistry: (flow.rf_models && typeof flow.rf_models === 'object') ? flow.rf_models : {},
    mvRegistry: (flow.mv_models && typeof flow.mv_models === 'object') ? flow.mv_models : {},
  });

  if (Array.isArray(flow.accounts) && flow.accounts.length) {
    setAccounts(flow.accounts);
  }
  if (flow.activeAccountId) {
    setActiveAccount(flow.activeAccountId);
  }
}

// ── Download a JSON object as a file ─────────────────────────────────────────
export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename.replace(/\s+/g, '_') + '.flow.json';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Export current flow to a file ─────────────────────────────────────────────
export function exportFlow() {
  const flow = getFlowObject();
  downloadJson(flow, flow.name);
}

// ── Import flow from a FileReader event ──────────────────────────────────────
export function importFlowFromEvent(e, onSuccess, onError) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const flow = JSON.parse(ev.target.result);
      loadFlowObject(flow);
      onSuccess?.();
    } catch {
      onError?.('Invalid flow file');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ── localStorage persistence for saved flows ──────────────────────────────────
export function persistSavedFlows(flows) {
  try { localStorage.setItem(LS_KEY_FLOWS, JSON.stringify(flows)); } catch (_) {}
}

export function loadPersistedFlows() {
  try {
    const raw = localStorage.getItem(LS_KEY_FLOWS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function persistAccounts(accounts) {
  try { localStorage.setItem(LS_KEY_ACCOUNTS, JSON.stringify(accounts)); } catch (_) {}
}

export function loadPersistedAccounts() {
  try {
    const raw = localStorage.getItem(LS_KEY_ACCOUNTS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// ── Combined localStorage restore ─────────────────────────────────────────────
export function loadPersistedState() {
  const sidebarVisible = (() => {
    try { const v = localStorage.getItem('drewbix_sidebar_visible'); return v !== '0'; } catch { return true; }
  })();
  const inspectorVisible = (() => {
    try { const v = localStorage.getItem('drewbix_inspector_visible'); return v !== '0'; } catch { return true; }
  })();
  return {
    savedFlows:      loadPersistedFlows(),
    accounts:        loadPersistedAccounts(),
    activeAccountId: (() => {
      try { return localStorage.getItem('drewbix_active_account') || null; } catch { return null; }
    })(),
    sidebarVisible,
    inspectorVisible,
  };
}

// ── Alias: download current flow object as JSON ───────────────────────────────
export function downloadFlowJSON(flowObj) {
  downloadJson(flowObj, flowObj.name || 'flow');
}

// ── Import a flow via file picker — calls onLoad(parsedObj) ───────────────────
export function importFlowFromFile(onLoad, onError) {
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = '.json,.flow.json';
  input.onchange = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const flow = JSON.parse(ev.target.result);
        onLoad?.(flow);
      } catch {
        onError?.('Invalid flow file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };
  input.click();
}

// ── Load the startup data JSON from /public/ ──────────────────────────────────
export async function loadStartupData(path = '/Drewbix_Blocks_Data.json') {
  try {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } catch (e) {
    console.warn('[startup] Could not load startup data:', e.message);
    return null;
  }
}
