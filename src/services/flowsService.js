import { supabase, isSupabaseConfigured } from './supabase.js';

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
    return data.data;
  } catch (e) {
    console.warn('[flowsService] loadDefaultFlow:', e);
    return null;
  }
}

/**
 * Save flow to Supabase: full replace only. Deletes any existing row(s) for this
 * name+owner and inserts one row with the given flowData. No merge, no conflicts,
 * no ever-growing data — one row per (name, owner) with the exact payload.
 */
export async function saveFlow(name, flowData) {
  if (!isSupabaseConfigured || !supabase) return { ok: false };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const ownerEmail = user.email;
  try {
    // Select existing row(s) for this name+owner (get is_default from first to preserve on replace)
    const { data: existingRows, error: selectErr } = await supabase
      .from('flows')
      .select('id, is_default')
      .eq('name', name)
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
    // Insert one row: full replace, no merge
    const { error: insertErr } = await supabase.from('flows').insert({
      name,
      owner_email: ownerEmail,
      data: flowData,
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
  try {
    const { data, error } = await supabase
      .from('flows')
      .select('data')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return data.data;
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
