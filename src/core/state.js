import { create } from 'zustand';
import { MOD, modCfg } from './registry.js';

// ── Constants ─────────────────────────────────────────────────────────────────
export const NODE_W   = 180;
export const NODE_H   = 34;
export const PORT_GAP = 22;

let _counter = 1;
export function uid() { return 'n' + (_counter++); }
export function snap(v, g = 20) { return Math.round(v / g) * g; }

// ── Default config for a module ───────────────────────────────────────────────
function defaultConfig(moduleId) {
  if (moduleId.startsWith('subflow::')) return {};
  const def = MOD[moduleId];
  if (!def) return {};
  const cfg = modCfg(def);
  return Object.fromEntries(
    Object.entries(cfg).map(([k, v]) => [k, v.d ?? ''])
  );
}

// ── Zustand store ─────────────────────────────────────────────────────────────
export const useStore = create((set, get) => ({

  // ── Flow canvas state ────────────────────────────────────────────────────
  nodes:          [],   // [{ id, moduleId, x, y }]
  edges:          [],   // [{ id, from, fromPort, to, toPort }]
  configs:        {},   // { [nodeId]: { fieldKey: value, … } }
  nodeIdCounter:  1,

  // ── Canvas viewport ───────────────────────────────────────────────────────
  pan:  { x: 0, y: 0 },
  zoom: 1,

  // ── Interaction (ephemeral, not serialised) ───────────────────────────────
  selectedId:  null,
  connecting:  null,   // { nodeId, port, type, x, y }
  dragging:    null,   // { nodeId, startX, startY, origX, origY }
  panning:     null,   // { startX, startY, origPan }

  // ── Named sub-flows (functions) ───────────────────────────────────────────
  functions: {},   // { [name]: { name, nodes, edges, configs, viewport, created } }

  // ── Saved flows (localStorage) ────────────────────────────────────────────
  savedFlows: [],  // [{ id, name, nodes, edges, configs, pan, zoom, savedAt }]

  // ── Accounts / credentials ────────────────────────────────────────────────
  accounts:        [],   // [{ id, name, env, key, secret, cycleEnabled }]
  activeAccountId: null,
  cycleIndex:      0,
  cycleRunning:    false,

  // ── Current flow meta ─────────────────────────────────────────────────────
  flowName: 'My Flow',

  // ── Random Forest model registry ──────────────────────────────────────────
  rfRegistry: {},   // { [modelName]: { name, runCount, totalSamples, trees, featureSet, … } }

  // ── Multivariate Regression model registry ────────────────────────────────
  mvRegistry: {},   // { [modelName]: { name, runCount, totalSamples, depVars, coefficients, featureSet, trainR2, testR2 } }

  // ── Feature Engineering model registry ────────────────────────────────────
  feRegistry: {},   // { [modelName]: { name, depVars, features, indivSpecs, coSpecs, updated, trainRows } }

  // ── Run-engine output cache (nodeId → result rows) ────────────────────────
  runResults:   {},   // { [nodeId]: { port: rows[] } }
  runStatuses:  {},   // { [nodeId]: 'running' | 'done' | 'error' }
  runLog:       [],   // [string]

  // ── Unified visualization hub ─────────────────────────────────────────────
  vizTabs:      [],     // [{ id, type, title, data }]  type: 'table'|'chart'|'chart_grid'|'rf_dashboard'
  vizHubOpen:   false,
  vizActiveTab: 0,

  // ── UI sidebar tab ────────────────────────────────────────────────────────
  sidebarTab:       'modules',
  sidebarVisible:   true,
  inspectorVisible: true,

  // ── Undo / Redo history ───────────────────────────────────────────────────
  _history:    [],
  _historyIdx: -1,

  // ── Pinned parameters ─────────────────────────────────────────────────────
  pinnedParams: [],  // [{ id, nodeId, fieldKey, label }]
  paramPickMode: false,  // true while user is clicking a node to pin a field

  // ═══════════════════════════════════════════════════════════════════════════
  // UNDO / REDO
  // ═══════════════════════════════════════════════════════════════════════════
  _pushHistory() {
    const { nodes, edges, configs, _history, _historyIdx } = get();
    const snap = { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)), configs: JSON.parse(JSON.stringify(configs)) };
    const MAX = 40;
    const trimmed = _history.slice(0, _historyIdx + 1);
    const next = [...trimmed, snap].slice(-MAX);
    set({ _history: next, _historyIdx: next.length - 1 });
  },

  undo() {
    const { _history, _historyIdx } = get();
    if (_historyIdx <= 0) return;
    const idx  = _historyIdx - 1;
    const snap = _history[idx];
    set({ nodes: snap.nodes, edges: snap.edges, configs: snap.configs, _historyIdx: idx, selectedId: null });
  },

  redo() {
    const { _history, _historyIdx } = get();
    if (_historyIdx >= _history.length - 1) return;
    const idx  = _historyIdx + 1;
    const snap = _history[idx];
    set({ nodes: snap.nodes, edges: snap.edges, configs: snap.configs, _historyIdx: idx, selectedId: null });
  },

  canUndo() { const { _historyIdx } = get(); return _historyIdx > 0; },
  canRedo() { const { _history, _historyIdx } = get(); return _historyIdx < _history.length - 1; },

  // ═══════════════════════════════════════════════════════════════════════════
  // NODE ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  addNode(moduleId, x, y) {
    get()._pushHistory();
    const id  = uid();
    const cfg = defaultConfig(moduleId);
    set(s => ({
      nodes:   [...s.nodes, { id, moduleId, x: snap(x), y: snap(y) }],
      configs: { ...s.configs, [id]: cfg },
    }));
    return id;
  },

  deleteNode(nodeId) {
    get()._pushHistory();
    set(s => {
      const newConfigs = { ...s.configs };
      delete newConfigs[nodeId];
      return {
        nodes:      s.nodes.filter(n => n.id !== nodeId),
        edges:      s.edges.filter(e => e.from !== nodeId && e.to !== nodeId),
        configs:    newConfigs,
        selectedId: s.selectedId === nodeId ? null : s.selectedId,
      };
    });
  },

  moveNode(nodeId, x, y) {
    set(s => ({
      nodes: s.nodes.map(n => n.id === nodeId ? { ...n, x: snap(x), y: snap(y) } : n),
    }));
  },

  selectNode(nodeId) {
    set({ selectedId: nodeId });
  },

  clearSelection() {
    set({ selectedId: null });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EDGE ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  addEdge(from, fromPort, to, toPort) {
    get()._pushHistory();
    const { edges } = get();
    const exists = edges.some(e => e.to === to && e.toPort === toPort);
    if (exists) {
      set(s => ({
        edges: s.edges.filter(e => !(e.to === to && e.toPort === toPort)),
      }));
    }
    const id = `e_${from}_${fromPort}_${to}_${toPort}`;
    set(s => ({
      edges: [...s.edges, { id, from, fromPort, to, toPort }],
    }));
  },

  deleteEdge(edgeId) {
    get()._pushHistory();
    set(s => ({ edges: s.edges.filter(e => e.id !== edgeId) }));
  },

  deleteEdgeByPorts(from, fromPort, to, toPort) {
    set(s => ({
      edges: s.edges.filter(
        e => !(e.from === from && e.fromPort === fromPort && e.to === to && e.toPort === toPort)
      ),
    }));
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIG ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  setConfig(nodeId, key, value) {
    set(s => ({
      configs: {
        ...s.configs,
        [nodeId]: { ...s.configs[nodeId], [key]: value },
      },
    }));
  },

  // Update a config value for a node that lives inside a named function (For-Each inner node)
  setInnerConfig(fnKey, nodeId, key, value) {
    set(s => {
      const fn = s.functions[fnKey];
      if (!fn) return {};
      const updatedFn = {
        ...fn,
        configs: { ...fn.configs, [nodeId]: { ...(fn.configs?.[nodeId] || {}), [key]: value } },
      };
      const updated = { ...s.functions, [fnKey]: updatedFn };
      try { localStorage.setItem('drewbix_functions', JSON.stringify(updated)); } catch (_) {}
      return { functions: updated };
    });
  },

  bulkSetConfig(nodeId, patch) {
    set(s => ({
      configs: {
        ...s.configs,
        [nodeId]: { ...s.configs[nodeId], ...patch },
      },
    }));
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEWPORT ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  setPan(x, y) { set({ pan: { x, y } }); },

  setZoom(zoom, pivotX, pivotY) {
    const MIN_ZOOM = 0.15, MAX_ZOOM = 3;
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    if (pivotX !== undefined && pivotY !== undefined) {
      const { pan, zoom: oldZoom } = get();
      const scale = clamped / oldZoom;
      set({
        zoom: clamped,
        pan:  { x: pivotX - scale * (pivotX - pan.x), y: pivotY - scale * (pivotY - pan.y) },
      });
    } else {
      set({ zoom: clamped });
    }
  },

  resetViewport() { set({ pan: { x: 0, y: 0 }, zoom: 1 }); },

  fitToNodes(canvasW, canvasH) {
    const { nodes } = get();
    if (!nodes.length) { set({ pan: { x: 0, y: 0 }, zoom: 1 }); return; }
    const NODE_W = 160, NODE_H = 80, PAD = 60;
    const xs = nodes.map(n => n.x);
    const ys = nodes.map(n => n.y);
    const minX = Math.min(...xs) - PAD;
    const minY = Math.min(...ys) - PAD;
    const maxX = Math.max(...xs) + NODE_W + PAD;
    const maxY = Math.max(...ys) + NODE_H + PAD;
    const scaleX = canvasW / (maxX - minX);
    const scaleY = canvasH / (maxY - minY);
    const MIN_ZOOM = 0.15, MAX_ZOOM = 3;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(scaleX, scaleY)));
    set({ zoom, pan: { x: -minX * zoom + (canvasW - (maxX - minX) * zoom) / 2, y: -minY * zoom + (canvasH - (maxY - minY) * zoom) / 2 } });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERACTION STATE
  // ═══════════════════════════════════════════════════════════════════════════
  setConnecting(val) { set({ connecting: val }); },
  setDragging(val)   { set({ dragging: val }); },
  setPanning(val)    { set({ panning: val }); },

  // ═══════════════════════════════════════════════════════════════════════════
  // FUNCTIONS (sub-flows)
  // ═══════════════════════════════════════════════════════════════════════════
  saveFunction(name) {
    const { nodes, edges, configs, pan, zoom, functions } = get();
    // Strip model registry keys — trees belong in Storage, not in function definitions
    const { __rf_models__, __mv_models__, ...cleanConfigs } = configs;
    const fn = {
      name,
      nodes:    JSON.parse(JSON.stringify(nodes)),
      edges:    JSON.parse(JSON.stringify(edges)),
      configs:  JSON.parse(JSON.stringify(cleanConfigs)),
      viewport: { pan, zoom },
      created:  Date.now(),
    };
    const updated = { ...functions, [name]: fn };
    set({ functions: updated });
    try { localStorage.setItem('drewbix_functions', JSON.stringify(updated)); } catch (_) {}
    return fn;
  },

  deleteFunction(name) {
    set(s => {
      const fns = { ...s.functions };
      delete fns[name];
      return { functions: fns };
    });
  },

  setFunctions(fns) { set({ functions: fns }); },

  // ═══════════════════════════════════════════════════════════════════════════
  // SAVED FLOWS
  // ═══════════════════════════════════════════════════════════════════════════
  setSavedFlows(flows) { set({ savedFlows: flows }); },

  saveCurrentFlow() {
    const { nodes, edges, configs, pan, zoom, flowName, savedFlows } = get();
    const { __rf_models__, __mv_models__, ...cleanConfigs } = configs;
    const id      = 'f_' + Date.now();
    const payload = {
      id,
      name:    flowName,
      nodes:   JSON.parse(JSON.stringify(nodes)),
      edges:   JSON.parse(JSON.stringify(edges)),
      configs: JSON.parse(JSON.stringify(cleanConfigs)),
      pan,
      zoom,
      savedAt: Date.now(),
    };
    const updated = [...savedFlows.filter(f => f.name !== flowName), payload];
    set({ savedFlows: updated });
    try { localStorage.setItem('drewbix_saved_flows', JSON.stringify(updated)); } catch (_) {}
    return payload;
  },

  loadSavedFlow(flowId) {
    const flow = get().savedFlows.find(f => f.id === flowId);
    if (!flow) return;
    set({
      nodes:     flow.nodes,
      edges:     flow.edges,
      configs:   flow.configs,
      pan:       flow.pan   ?? { x: 0, y: 0 },
      zoom:      flow.zoom  ?? 1,
      flowName:  flow.name,
      selectedId: null,
      runResults: {},
      runStatuses:{},
      runLog:     [],
    });
  },

  deleteSavedFlow(flowId) {
    set(s => {
      const updated = s.savedFlows.filter(f => f.id !== flowId);
      try { localStorage.setItem('drewbix_saved_flows', JSON.stringify(updated)); } catch (_) {}
      return { savedFlows: updated };
    });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FLOW LOAD (from serialised object, e.g. imported JSON or Data.json)
  // ═══════════════════════════════════════════════════════════════════════════
  loadFlow(obj) {
    // Bump nodeIdCounter past any IDs in the loaded set
    let maxCounter = 1;
    (obj.nodes || []).forEach(n => {
      const num = parseInt(n.id.replace(/\D/g, ''), 10);
      if (!isNaN(num) && num >= maxCounter) maxCounter = num + 1;
    });
    _counter = maxCounter;

    set({
      nodes:       obj.nodes    || [],
      edges:       obj.edges    || [],
      configs:     obj.configs  || {},
      pan:         obj.pan      ?? { x: 0, y: 0 },
      zoom:        obj.zoom     ?? 1,
      flowName:    obj.name     ?? 'My Flow',
      functions:   obj.functions ?? {},
      selectedId:  null,
      runResults:  {},
      runStatuses: {},
      runLog:      [],
    });
  },

  clearCanvas() {
    _counter = 1;
    set({
      nodes:       [],
      edges:       [],
      configs:     {},
      selectedId:  null,
      runResults:  {},
      runStatuses: {},
      runLog:      [],
    });
  },

  setFlowName(name) { set({ flowName: name }); },

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCOUNTS
  // ═══════════════════════════════════════════════════════════════════════════
  setAccounts(accounts) { set({ accounts }); },

  addAccount() {
    const id = 'acct_' + Date.now();
    set(s => ({
      accounts: [...s.accounts, { id, name: 'New Account', env: 'paper', key: '', secret: '', cycleEnabled: false }],
    }));
    return id;
  },

  updateAccount(id, patch) {
    set(s => ({
      accounts: s.accounts.map(a => a.id === id ? { ...a, ...patch } : a),
    }));
  },

  deleteAccount(id) {
    set(s => ({
      accounts:        s.accounts.filter(a => a.id !== id),
      activeAccountId: s.activeAccountId === id ? (s.accounts[0]?.id ?? null) : s.activeAccountId,
    }));
  },

  setActiveAccount(id) { set({ activeAccountId: id }); },
  setCycleIndex(i)     { set({ cycleIndex: i }); },
  setCycleRunning(v)   { set({ cycleRunning: v }); },

  // ═══════════════════════════════════════════════════════════════════════════
  // RUN ENGINE OUTPUT
  // ═══════════════════════════════════════════════════════════════════════════
  setRunResult(nodeId, portResults) {
    set(s => ({ runResults: { ...s.runResults, [nodeId]: portResults } }));
  },

  setRunStatus(nodeId, status) {
    set(s => ({ runStatuses: { ...s.runStatuses, [nodeId]: status } }));
  },

  clearRunStatuses() { set({ runStatuses: {}, runResults: {}, runLog: [] }); },

  appendRunLog(msg) {
    set(s => ({ runLog: [...s.runLog, msg] }));
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MODALS / VIZ HUB
  // ═══════════════════════════════════════════════════════════════════════════
  setRfRegistry(reg) { set({ rfRegistry: reg }); },
  setMvRegistry(reg) { set({ mvRegistry: reg }); },
  setFeRegistry(reg) { set({ feRegistry: reg }); },

  openVizTab(type, data, title) {
    const id = `vt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    set(s => ({
      vizTabs:      [...s.vizTabs, { id, type, title: title || type, data }],
      vizHubOpen:   true,
      vizActiveTab: s.vizTabs.length,  // new tab index
    }));
  },
  closeVizTab(tabId) {
    set(s => {
      const newTabs = s.vizTabs.filter(t => t.id !== tabId);
      return {
        vizTabs:      newTabs,
        vizHubOpen:   newTabs.length > 0,
        vizActiveTab: Math.min(s.vizActiveTab, Math.max(0, newTabs.length - 1)),
      };
    });
  },
  setVizActiveTab(i) { set({ vizActiveTab: i }); },
  closeVizHub()       { set({ vizHubOpen: false, vizTabs: [], vizActiveTab: 0 }); },
  clearVizTabs()      { set({ vizTabs: [], vizHubOpen: false, vizActiveTab: 0 }); },

  // Legacy aliases — engine/modules still call these; redirect to openVizTab
  openTableModal(payload)        { get().openVizTab('table',       payload, payload?.title || 'Table'); },
  openChartModal(payload)        { get().openVizTab('chart',       payload, payload?.title || 'Chart'); },
  openChartGrid(payload)         { get().openVizTab('chart_grid',  payload, payload?.title || 'Chart Grid'); },
  openChartGridModal(payload)    { get().openVizTab('chart_grid',  payload, payload?.title || 'Chart Grid'); },
  openRFDashboard(payload)       { get().openVizTab('rf_dashboard',payload, 'RF Dashboard'); },
  openMvDashboard(payload)       { get().openVizTab('mv_dashboard',payload, 'MV Dashboard'); },
  openFEDashboard(payload)       { get().openVizTab('fe_dashboard', payload, payload?.title || 'FE Dashboard'); },

  // ═══════════════════════════════════════════════════════════════════════════
  // UI
  // ═══════════════════════════════════════════════════════════════════════════
  setSidebarTab(tab)        { set({ sidebarTab: tab }); },
  setSidebarVisible(v)      {
    set({ sidebarVisible: v });
    try { localStorage.setItem('drewbix_sidebar_visible', v ? '1' : '0'); } catch (_) {}
  },
  setInspectorVisible(v)    {
    set({ inspectorVisible: v });
    try { localStorage.setItem('drewbix_inspector_visible', v ? '1' : '0'); } catch (_) {}
  },
  toggleSidebar()           { set(s => { const v = !s.sidebarVisible; try { localStorage.setItem('drewbix_sidebar_visible', v ? '1' : '0'); } catch (_) {} return { sidebarVisible: v }; }); },
  toggleInspector()        { set(s => { const v = !s.inspectorVisible; try { localStorage.setItem('drewbix_inspector_visible', v ? '1' : '0'); } catch (_) {} return { inspectorVisible: v }; }); },

  // ── Pinned params actions ────────────────────────────────────────────────
  setPinnedParams(params)  { set({ pinnedParams: params }); },
  addPinnedParam(param)    { set(s => ({ pinnedParams: [...s.pinnedParams, param] })); },
  removePinnedParam(id)    { set(s => ({ pinnedParams: s.pinnedParams.filter(p => p.id !== id) })); },
  setParamPickMode(v)      { set({ paramPickMode: v }); },
}));

// ── Singleton accessor (for non-React code like the engine) ───────────────────
export const getState  = () => useStore.getState();
export const setState  = (patch) => useStore.setState(patch);
