import React, { useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '../../services/supabase.js';
import LoginPage from './LoginPage.jsx';

export default function AuthGuard({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      setSession('no-auth'); // allow app to run without Supabase
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription?.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg0)' }}>
        <span style={{ color: 'var(--muted)', fontSize: 14 }}>Loading…</span>
      </div>
    );
  }

  // No Supabase configured — render app directly (local-only mode)
  if (session === 'no-auth') {
    return children;
  }

  // Supabase configured but not signed in — show login
  if (!session) {
    return (
      <LoginPage
        onSuccess={() => {
          supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s));
        }}
      />
    );
  }

  return children;
}
