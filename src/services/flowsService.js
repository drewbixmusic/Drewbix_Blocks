import { supabase, isSupabaseConfigured } from './supabase.js';

const RF_BUCKET = 'rf-models';
const MV_BUCKET = 'mv-models';

function sanitizePath(s) {
  return (s || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'default';
}

/**
 * Username → email mapping (credentials live only in Supabase Auth, never in code)
 */
const USERNAME_TO_EMAIL = {
  drewbixmusic: 'drewbixmusic@drewbixblocks.app',
  guest: 'guest@drewbixblocks.app',
};

export function usernameToEmail(username) {
  const u = (username || '').trim().toLowerCase();
  return USERNAME_TO_EMAIL[u] || (u.includes('@') ? u : `${u}@drewbixblocks.app`);
}

/** Save RF models to Supabase Storage (one JSON file per user/flow). Keeps flows table lightweight. */
export async function saveRfModels(userId, flowName, rfRegistry) {
  if (!isSupabaseConfigured || !supabase || !userId || !rfRegistry || Object.keys(rfRegistry).length === 0) return { ok: true };
  const path = `${userId}/${sanitizePath(flowName)}.json`;
  try {
    const payload = JSON.stringify(rfRegistry);
    const { error } = await supabase.storage.from(RF_BUCKET).upload(path, payload, { upsert: true, contentType: 'application/json' });
    if (error) {
      console.warn('[flowsService] saveRfModels:', error);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[flowsService] saveRfModels:', e);
    return { ok: false };
  }
}

/** Save MV regression models to Supabase Storage (coefficients + R², no trainRows). */
export async function saveMvModels(userId, flowName, mvRegistry) {
  if (!isSupabaseConfigured || !supabase || !userId || !mvRegistry || !Object.keys(mvRegistry).length) return { ok: true };
  const path = `${userId}/${sanitizePath(flowName)}.json`;
  try {
    const stripped = {};
    Object.entries(mvRegistry).forEach(([k, m]) => {
      if (m && typeof m === 'object') { const { trainRows, ...rest } = m; stripped[k] = rest; }
    });
    const { error } = await supabase.storage.from(MV_BUCKET).upload(path, JSON.stringify(stripped), { upsert: true, contentType: 'application/json' });
    if (error) { console.warn('[flowsService] saveMvModels:', error); return { ok: false }; }
    return { ok: true };
  } catch (e) { console.warn('[flowsService] saveMvModels:', e); return { ok: false }; }
}

/** Load MV models from Supabase Storage. Returns {} on miss or error. */
export async function loadMvModels(userId, flowName) {
  if (!isSupabaseConfigured || !supabase || !userId) return {};
  const path = `${userId}/${sanitizePath(flowName)}.json`;
  try {
    const { data, error } = await supabase.storage.from(MV_BUCKET).download(path);
    if (error || !data) return {};
    const parsed = JSON.parse(await data.text());
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (e) { return {}; }
}

/** Load RF models from Supabase Storage. Returns {} on miss or error. */
export async function loadRfModels(userId, flowName) {
  if (!isSupabaseConfigured || !supabase || !userId) return {};
  const path = `${userId}/${sanitizePath(flowName)}.json`;
  try {
    const { data, error } = await supabase.storage.from(RF_BUCKET).download(path);
    if (error || !data) return {};
    const text = await data.text();
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (e) {
    return {};
  }
}

export async function loadDefaultFlow() {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  try {
    const { data, error } = await supabase
      .from('flows')
      .select('data')
      .eq('is_default', true)
      .limit(1)
      .maybeSingle();
    if (error || !data?.data) return null;
    const flowData = data.data;
    const [rfFromStorage, mvFromStorage] = await Promise.all([
      loadRfModels(user.id, flowData?.name),
      loadMvModels(user.id, flowData?.name),
    ]);
    return {
      ...flowData,
      rf_models: Object.keys(rfFromStorage).length ? rfFromStorage : (flowData?.rf_models || {}),
      mv_models: Object.keys(mvFromStorage).length ? mvFromStorage : (flowData?.mv_models || {}),
    };
  } catch (e) {
    console.warn('[flowsService] loadDefaultFlow:', e);
    return null;
  }
}

/**
 * Save flow to Supabase: full replace. Flow doc excludes rf_models to keep size small;
 * RF models go to Storage separately. Falls back to embedding rf_models (no trainRows) if Storage fails.
 */
export async function saveFlow(name, flowData, rfRegistry = null, mvRegistry = null) {
  if (!isSupabaseConfigured || !supabase) return { ok: false };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const ownerEmail = user.email;
  const flowName = name || flowData?.name || 'Unnamed';

  // Strip model registries from flow doc; Storage handles them
  const { rf_models, mv_models, ...flowWithoutModels } = flowData;
  let payload = flowWithoutModels;

  function stripRegistry(reg) {
    const out = {};
    Object.entries(reg || {}).forEach(([k, m]) => {
      if (m && typeof m === 'object') { const { trainRows, ...rest } = m; out[k] = rest; }
    });
    return out;
  }

  // Save RF + MV to Storage in parallel; embed stripped fallback if Storage fails
  const [rfOk, mvOk] = await Promise.all([
    rfRegistry && Object.keys(rfRegistry).length ? saveRfModels(user.id, flowName, stripRegistry(rfRegistry)) : Promise.resolve({ ok: true }),
    mvRegistry && Object.keys(mvRegistry).length ? saveMvModels(user.id, flowName, mvRegistry) : Promise.resolve({ ok: true }),
  ]);
  if (!rfOk.ok && rfRegistry && Object.keys(rfRegistry).length) payload = { ...payload, rf_models: stripRegistry(rfRegistry) };
  if (!mvOk.ok && mvRegistry && Object.keys(mvRegistry).length) payload = { ...payload, mv_models: stripRegistry(mvRegistry) };

  try {
    const { data: existingRows, error: selectErr } = await supabase
      .from('flows')
      .select('id, is_default')
      .eq('name', flowName)
      .eq('owner_email', ownerEmail);
    if (selectErr) {
      console.warn('[flowsService] saveFlow select:', selectErr);
      return { ok: false };
    }
    const wasDefault = existingRows?.[0]?.is_default === true;
    if (existingRows?.length) {
      for (const row of existingRows) {
        const { error: delErr } = await supabase.from('flows').delete().eq('id', row.id);
        if (delErr) console.warn('[flowsService] saveFlow delete:', delErr);
      }
    }
    const { error: insertErr } = await supabase.from('flows').insert({
      name: flowName,
      owner_email: ownerEmail,
      data: payload,
      is_default: wasDefault,
    });
    if (insertErr) {
      console.warn('[flowsService] saveFlow insert:', insertErr);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[flowsService] saveFlow:', e);
    return { ok: false };
  }
}

export async function loadFlowById(id) {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  try {
    const { data, error } = await supabase
      .from('flows')
      .select('data')
      .eq('id', id)
      .maybeSingle();
    if (error || !data?.data) return null;
    const flowData = data.data;
    const [rfFromStorage, mvFromStorage] = await Promise.all([
      user ? loadRfModels(user.id, flowData?.name) : {},
      user ? loadMvModels(user.id, flowData?.name) : {},
    ]);
    return {
      ...flowData,
      rf_models: Object.keys(rfFromStorage).length ? rfFromStorage : (flowData?.rf_models || {}),
      mv_models: Object.keys(mvFromStorage).length ? mvFromStorage : (flowData?.mv_models || {}),
    };
  } catch (e) {
    console.warn('[flowsService] loadFlowById:', e);
    return null;
  }
}

export async function listFlows() {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from('flows')
      .select('id, name, created_at, updated_at')
      .order('updated_at', { ascending: false });
    if (error) return [];
    return data || [];
  } catch (e) {
    console.warn('[flowsService] listFlows:', e);
    return [];
  }
}

export async function deleteFlow(id) {
  if (!isSupabaseConfigured || !supabase) return { ok: false };
  try {
    const { error } = await supabase.from('flows').delete().eq('id', id);
    return { ok: !error };
  } catch (e) {
    console.warn('[flowsService] deleteFlow:', e);
    return { ok: false };
  }
}
