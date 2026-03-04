import { supabase, isSupabaseConfigured } from './supabase.js';

const RF_BUCKET = 'rf-models';

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
    // Load RF models from Storage (keeps flows table small); fall back to in-flow rf_models
    const rfFromStorage = await loadRfModels(user.id, flowData?.name);
    const rfModels = Object.keys(rfFromStorage).length ? rfFromStorage : (flowData?.rf_models || {});
    return { ...flowData, rf_models: rfModels };
  } catch (e) {
    console.warn('[flowsService] loadDefaultFlow:', e);
    return null;
  }
}

/**
 * Save flow to Supabase: full replace. Flow doc excludes rf_models to keep size small;
 * RF models go to Storage separately. Falls back to embedding rf_models (no trainRows) if Storage fails.
 */
export async function saveFlow(name, flowData, rfRegistry = null) {
  if (!isSupabaseConfigured || !supabase) return { ok: false };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const ownerEmail = user.email;
  const flowName = name || flowData?.name || 'Unnamed';

  // Build payload for flows table: exclude rf_models (handled via Storage)
  const { rf_models, ...flowWithoutRf } = flowData;
  let payload = flowWithoutRf;

  // If we have rfRegistry, try Storage first; on failure fall back to in-flow (lightweight: no trainRows)
  if (rfRegistry && Object.keys(rfRegistry).length) {
    const stripped = {};
    Object.entries(rfRegistry).forEach(([k, m]) => {
      if (m && typeof m === 'object') {
        const { trainRows, ...rest } = m;
        stripped[k] = rest;
      }
    });
    const storageOk = await saveRfModels(user.id, flowName, stripped);
    if (!storageOk) payload = { ...flowWithoutRf, rf_models: stripped };
  }

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
    const rfFromStorage = user ? await loadRfModels(user.id, flowData?.name) : {};
    const rfModels = Object.keys(rfFromStorage).length ? rfFromStorage : (flowData?.rf_models || {});
    return { ...flowData, rf_models };
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
