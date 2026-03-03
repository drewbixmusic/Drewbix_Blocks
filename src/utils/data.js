// ══════════════════════════════════════════════════════════════
// DATA UTILITIES — parsing, flattening, field discovery
// ══════════════════════════════════════════════════════════════
import { MOD } from '../core/registry.js';

// ── Flatten a single row object into scalar leaf values ───────────────────────
export function flattenRow(obj, prefix = '') {
  const out = {};
  if (obj === null || obj === undefined) return out;
  if (typeof obj !== 'object') { out[prefix || 'value'] = obj; return out; }
  if (Array.isArray(obj)) {
    if (!obj.length) { if (prefix) out[prefix] = ''; return out; }
    if (typeof obj[0] !== 'object') { out[prefix || 'value'] = obj.join(', '); return out; }
    obj.forEach((item, i) => Object.assign(out, flattenRow(item, prefix ? `${prefix}_${i}` : String(i))));
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}_${k}` : k;
    if (v !== null && typeof v === 'object') {
      Object.assign(out, flattenRow(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

/** Alias kept for backwards compatibility inside callModule. */
export function flattenObj(obj, prefix) { return flattenRow(obj, prefix); }

// ── Generic JSON response → flat row array ────────────────────────────────────
export function extractRows(json) {
  if (!json) return [];
  if (Array.isArray(json)) {
    if (!json.length) return [];
    if (typeof json[0] === 'object' && json[0] !== null) return json.map(r => flattenRow(r));
    return json.map(v => ({ value: v }));
  }
  if (typeof json !== 'object') return [{ value: json }];

  for (const [key, val] of Object.entries(json)) {
    if (!val || key === 'next_page_token' || key === 'currency') continue;

    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
      const siblings = Object.entries(json).filter(
        ([k2, v2]) => k2 !== key && Array.isArray(v2) && v2.length > 0 && typeof v2[0] === 'object'
      );
      if (siblings.length > 0) {
        const rows = [];
        [[key, val], ...siblings].forEach(([k2, arr]) => {
          arr.forEach(item => rows.push(flattenRow({ _group: k2, ...item })));
        });
        return rows;
      }
      return val.map(r => flattenRow(r));
    }

    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const subVals = Object.values(val);
      if (subVals.length > 0 && subVals.every(sv => Array.isArray(sv))) {
        const rows = [];
        for (const [sym, arr] of Object.entries(val)) {
          for (const item of arr) rows.push(flattenRow({ symbol: sym, ...item }));
        }
        if (rows.length) return rows;
      }
      if (subVals.length > 0 && subVals.every(sv => sv && typeof sv === 'object' && !Array.isArray(sv))) {
        const rows = Object.entries(val).map(([sym, obj]) => flattenRow({ symbol: sym, ...obj }));
        if (rows.length) return rows;
      }
    }
  }

  return [flattenRow(json)];
}

// ── Union of all keys across rows with priority ordering ─────────────────────
export function unionKeys(rows) {
  const freq = {};
  rows.forEach(r => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return;
    Object.keys(r).forEach(k => { freq[k] = (freq[k] || 0) + 1; });
  });
  const PRIORITY = ['direction', 'symbol', 'name', 'ticker'];
  return Object.keys(freq)
    .sort((a, b) => {
      const pa = PRIORITY.indexOf(a), pb = PRIORITY.indexOf(b);
      if (pa !== -1 && pb !== -1) return pa - pb;
      if (pa !== -1) return -1;
      if (pb !== -1) return 1;
      return freq[b] - freq[a];
    })
    .filter(k => k !== '_note' && k !== '_rows');
}

// ── Expand comma-joined tag strings into boolean columns ─────────────────────
export function postProcessRows(rows) {
  if (!rows || !rows.length) return rows;
  const tagFields = new Set();
  rows.forEach(row => {
    for (const [k, v] of Object.entries(row)) {
      if (typeof v !== 'string' || !v.trim()) continue;
      const trimmed = v.trim();
      if (/^[a-z][a-z_0-9]*(?:,[a-z][a-z_0-9]*)*$/.test(trimmed)) tagFields.add(k);
    }
  });
  if (!tagFields.size) return rows;
  const allTags = new Set();
  rows.forEach(row => {
    tagFields.forEach(field => {
      const v = row[field];
      if (typeof v === 'string' && v)
        v.split(',').map(t => t.trim()).filter(Boolean).forEach(t => allTags.add(t));
    });
  });
  return rows.map(row => {
    const out = { ...row };
    const presentTags = new Set();
    tagFields.forEach(field => {
      const v = row[field];
      if (typeof v === 'string' && v)
        v.split(',').map(t => t.trim()).filter(Boolean).forEach(t => presentTags.add(t));
    });
    allTags.forEach(tag => { out[tag] = presentTags.has(tag); });
    return out;
  });
}

// ── Dynamic precision formatting ──────────────────────────────────────────────
export function dynPrec(val) {
  if (typeof val !== 'number' && typeof val !== 'string') return val;
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(n) || !isFinite(n)) return val;
  if (Math.abs(n) >= 1 && Number.isInteger(n)) return n.toString();
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  const log = Math.floor(Math.log10(abs));
  let decimalPlaces;
  if (abs >= 1) {
    decimalPlaces = Math.max(4 - (log + 1), 2);
  } else {
    decimalPlaces = (-log) + 3;
  }
  const formatted = n.toFixed(decimalPlaces);
  if (abs >= 1 && formatted.includes('.') && parseFloat(formatted) === Math.round(parseFloat(formatted))) {
    return Math.round(n).toString();
  }
  return formatted;
}

export function applyPrecisionToRows(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map(row => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = (typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(Number(v)) && v.trim() !== ''))
        ? dynPrec(typeof v === 'number' ? v : Number(v))
        : v;
    }
    return out;
  });
}

// ── Upstream field discovery for dynamic dropdown population ─────────────────
const PASS_THROUGH_MODS = new Set([
  'filter', 'multi_filter', 'select_fields', 'join', 'dataset',
  'dp_precision', 'symbol_intersect', 'transpose', 'gate_and',
  'gate_or', 'gate_nand', 'gate_nor', 'gate_xor', 'gate_inverter',
]);

export function getUpstreamFields(nodeId, edges, nodes, configs, visited = new Set()) {
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);

  const fields = new Set();
  edges.filter(e => e.to === nodeId).forEach(e => {
    const upNode = nodes.find(n => n.id === e.from);
    if (!upNode) return;

    const portKey = e.fromPort && e.fromPort !== 'data' ? `_headers_${e.fromPort}` : null;
    const portHeaders = portKey ? configs[upNode.id]?.[portKey] : null;
    if (Array.isArray(portHeaders) && portHeaders.length) {
      portHeaders.forEach(f => fields.add(f));
      return;
    }
    const liveHeaders = configs[upNode.id]?._headers;
    if (Array.isArray(liveHeaders) && liveHeaders.length) {
      liveHeaders.forEach(f => fields.add(f));
      return;
    }
    if (PASS_THROUGH_MODS.has(upNode.moduleId)) {
      getUpstreamFields(upNode.id, edges, nodes, configs, visited).forEach(f => fields.add(f));
      return;
    }
    MOD[upNode.moduleId]?.out.filter(p => p !== 'data').forEach(f => fields.add(f));
  });

  return [...fields].filter(f => !f.startsWith('_'));
}

// ── Merge col-order config with live upstream fields ──────────────────────────
export function mergeColOrder(saved, upFields) {
  const seen = new Set(saved.map(c => c.name));
  const merged = saved.filter(c => upFields.length === 0 || upFields.includes(c.name));
  upFields.forEach(f => { if (!seen.has(f)) merged.push({ name: f, visible: true }); });
  return merged;
}

// ── HTML escape utility ───────────────────────────────────────────────────────
export function escH(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
