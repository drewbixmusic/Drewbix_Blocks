// ══════════════════════════════════════════════════════════════
// TRANSFORM MODULES — filter, multi_filter, join, select_fields, symbol_intersect, transpose
// ══════════════════════════════════════════════════════════════

function normalize(inp) {
  if (!inp) return [];
  if (!Array.isArray(inp)) return [inp];
  return inp.map(r => (r && typeof r === 'object' && !Array.isArray(r)) ? r : (typeof r === 'string' ? { value: r } : { value: String(r) }));
}

function applyOp(v, operator, value, scRows, value_src, inputs) {
  let val = value || '';
  if ((value_src || 'manual').startsWith('sc::') && inputs.sc !== undefined) {
    const scField = value_src.slice(4);
    const sc = inputs.sc;
    if (Array.isArray(sc) && sc.length) val = String(sc[0][scField] ?? '');
    else if (sc && typeof sc === 'object' && !Array.isArray(sc)) val = String(sc[scField] ?? '');
    else if (typeof sc === 'string') val = sc;
  }
  const vStr = String(v ?? '');
  const vNum = Number(v);
  switch (operator) {
    case '==':             return vStr === String(val);
    case '!=':             return vStr !== String(val);
    case '>':              return !isNaN(vNum) && vNum > Number(val);
    case '<':              return !isNaN(vNum) && vNum < Number(val);
    case '>=':             return !isNaN(vNum) && vNum >= Number(val);
    case '<=':             return !isNaN(vNum) && vNum <= Number(val);
    case 'in':             return String(val).split(',').map(s => s.trim()).includes(vStr);
    case 'not_in':         return !String(val).split(',').map(s => s.trim()).includes(vStr);
    case 'starts_with':    return vStr.startsWith(String(val));
    case 'not_starts_with':return !vStr.startsWith(String(val));
    case 'ends_with':      return vStr.endsWith(String(val));
    case 'not_ends_with':  return !vStr.endsWith(String(val));
    case 'contains':       return vStr.includes(String(val));
    case 'not_contains':   return !vStr.includes(String(val));
    case 'is_true':        return v === true || v === 'true' || v === 1 || v === '1' || v === 'True';
    case 'is_false':       return v === false || v === 'false' || v === 0 || v === '0' || v === 'False' || v === null || v === undefined || v === '';
    default: return true;
  }
}

export function runFilter(node, { cfg, inputs, setHeaders }) {
  const data = normalize(inputs.data || []);
  const { field, operator, value, value_src } = cfg;
  if (!field) { setHeaders(data.length ? Object.keys(data[0]).filter(k => !k.startsWith('_')) : []); return { data, _rows: data }; }
  const filtered = data.filter(row => applyOp(row[field], operator, value, null, value_src, inputs));
  setHeaders((filtered.length ? filtered : data).length ? Object.keys((filtered.length ? filtered : data)[0]).filter(k => !k.startsWith('_')) : []);
  return { data: filtered, _rows: filtered };
}

export function runMultiFilter(node, { cfg, inputs, setHeaders }) {
  const data = normalize(inputs.data || inputs.filtered_data || inputs.joined_data || []);
  const conditions = Array.isArray(cfg.conditions) ? cfg.conditions : [];
  const logic = cfg.logic || 'AND';
  const result = data.filter(row => {
    if (!conditions.length) return true;
    const tests = conditions.filter(c => c.field).map(c => applyOp(row[c.field], c.op || 'is_true', c.value, null, c.value_src, inputs));
    return logic === 'AND' ? tests.every(Boolean) : tests.some(Boolean);
  });
  setHeaders((result.length ? result : data).length ? Object.keys((result.length ? result : data)[0]).filter(k => !k.startsWith('_')) : []);
  return { data: result, _rows: result };
}

export function runJoin(node, { cfg, inputs, setHeaders }) {
  const left  = normalize(inputs.left  || []);
  const right = normalize(inputs.right || []);
  const key   = cfg.on  || 'symbol';
  const how   = cfg.how || 'inner';
  const rightMap = new Map();
  right.forEach(r => { const k = r[key]; if (k !== undefined && k !== null) rightMap.set(String(k), r); });
  const joined = [];
  left.forEach(l => {
    const k = l[key];
    const r = k !== undefined ? rightMap.get(String(k)) : undefined;
    if (how === 'inner' && !r) return;
    joined.push({ ...l, ...(r || {}) });
  });
  if (how === 'right' || how === 'outer') {
    const leftKeys = new Set(left.map(l => String(l[key])));
    right.forEach(r => { const k = String(r[key]); if (!leftKeys.has(k)) joined.push({ ...r }); });
  }
  if (joined.length) setHeaders(Object.keys(joined[0]).filter(k => !k.startsWith('_')));
  return { data: joined, _rows: joined };
}

export function runSelectFields(node, { cfg, inputs, setHeaders }) {
  const data = normalize(inputs.data || []);
  const fields = Array.isArray(cfg.fields) && cfg.fields.length
    ? cfg.fields.filter(f => f.visible !== false).map(f => f.name)
    : [];
  if (!fields.length) {
    setHeaders(data.length ? Object.keys(data[0]).filter(k => !k.startsWith('_')) : []);
    return { data, _rows: data };
  }
  const result = data.map(row => Object.fromEntries(fields.map(f => [f, row[f] ?? null])));
  setHeaders(fields);
  return { data: result, _rows: result };
}

export function runSymbolIntersect(node, { cfg, inputs }) {
  const field      = cfg.field || 'symbol';
  const candidates = normalize(inputs.candidates || inputs.left  || []);
  const whitelist  = normalize(inputs.whitelist  || inputs.right || []);
  const allowed    = new Set(whitelist.map(r => String(typeof r === 'object' ? r[field] : r)));
  const result     = candidates.filter(r => allowed.has(String(typeof r === 'object' ? r[field] : r)));
  return { data: result, _rows: result };
}

export function runTranspose(node, { inputs, setHeaders }) {
  const data = normalize(inputs.data || inputs.filtered_data || inputs.joined_data || []);
  if (!data.length) return { data: [], _rows: [] };
  if (data.length <= 3) {
    const result = [];
    data.forEach((row, ri) => {
      Object.entries(row).forEach(([k, v]) => {
        if (k.startsWith('_')) return;
        result.push({ field: data.length > 1 ? `[${ri}] ${k}` : k, value: String(v ?? '') });
      });
    });
    setHeaders(['field', 'value']);
    return { data: result, _rows: result };
  }
  const keys   = Object.keys(data[0]).filter(k => !k.startsWith('_'));
  const result = data.map(row => Object.fromEntries(keys.map(k => [k, row[k]])));
  setHeaders(keys);
  return { data: result, _rows: result };
}
