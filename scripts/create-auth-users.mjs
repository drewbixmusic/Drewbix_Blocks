#!/usr/bin/env node
/**
 * One-time setup: Create auth users for Drewbix Blocks.
 * Run: SUPABASE_SERVICE_KEY=<key> node scripts/create-auth-users.mjs
 *
 * Uses the Admin API. Get service_role key from Supabase Dashboard → Settings → API.
 */
const URL = 'https://amhrrvldpvhvlluzhxep.supabase.co';
const key = process.env.SUPABASE_SERVICE_KEY;
if (!key) {
  console.error('Set SUPABASE_SERVICE_KEY (from Supabase Dashboard → Settings → API)');
  process.exit(1);
}

const users = [
  { email: 'drewbixmusic@drewbixblocks.app', password: 'Drewbix1983!mt' },
  { email: 'guest@drewbixblocks.app', password: '111111' },
];

for (const u of users) {
  try {
    const res = await fetch(`${URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: u.email,
        password: u.password,
        email_confirm: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      console.log(`Created: ${u.email}`);
    } else {
      console.log(`Skip/fail ${u.email}:`, data.msg || res.status);
    }
  } catch (e) {
    console.error(`Error creating ${u.email}:`, e.message);
  }
}
