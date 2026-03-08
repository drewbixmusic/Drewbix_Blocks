import React, { useState } from 'react';
import { usernameToEmail } from '../../services/flowsService.js';
import { supabase, isSupabaseConfigured } from '../../services/supabase.js';
import '../../styles/auth.css';

export default function LoginPage({ onSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    if (!isSupabaseConfigured || !supabase) {
      setError('Supabase not configured');
      setLoading(false);
      return;
    }
    try {
      const email = usernameToEmail(username);
      const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) {
        setError(err.message || 'Sign in failed');
        setLoading(false);
        return;
      }
      if (data?.session) {
        onSuccess?.();
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <span className="auth-logo">⬡ DREWBIX BLOCKS</span>
          <p className="auth-sub">Sign in to access flows</p>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleLogin} className="auth-form">
          <label>Username</label>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder=""
            disabled={loading}
          />
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={loading}
          />
          <button type="submit" disabled={loading}>
            {loading ? '…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
