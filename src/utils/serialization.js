// ══════════════════════════════════════════════════════════════
// SERIALIZATION — flow import/export and localStorage persistence
// ══════════════════════════════════════════════════════════════
import { getState, setState } from '../core/state.js';

const FLOW_VERSION = '1.2';
const LS_KEY_FLOWS    = 'drewbix_saved_flows';
const LS_KEY_ACCOUNTS = 'drewbix_accounts';

// ── Build a portable flow object from the current store ───────────────────────
export function getFlowObject() {
  const {
    nodes, edges, configs, pan, zoom,
    flowName, accounts, activeAccountId,
    functions, rfRegistry,
  } = getState();
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
    // Persist RF model registry with the flow (supersedes legacy __rf_models__)
    rf_models:       rfRegistry && Object.keys(rfRegistry).length ? rfRegistry : (configs['__rf_models__'] || {}),
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

  // Hydrate RF registry from serialised models so stored models persist
  if (flow.rf_models && typeof flow.rf_models === 'object') {
    setState({ rfRegistry: flow.rf_models });
  } else {
    setState({ rfRegistry: {} });
  }

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
  return {
    savedFlows:      loadPersistedFlows(),
    accounts:        loadPersistedAccounts(),
    activeAccountId: (() => {
      try { return localStorage.getItem('drewbix_active_account') || null; } catch { return null; }
    })(),
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
