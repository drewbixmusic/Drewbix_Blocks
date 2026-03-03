import React from 'react';
import { useStore } from '../../core/state.js';

export default function AccountsTab() {
  const {
    accounts, activeAccountId,
    addAccount, updateAccount, deleteAccount, setActiveAccount,
  } = useStore();

  return (
    <div className="sidebar-scroll">
      <div className="cred-section">
        {accounts.map(acct => (
          <div key={acct.id} className={`cred-card${acct.id === activeAccountId ? ' active-acct' : ''}`}>
            <div className="cred-card-head">
              <input
                className="cred-acct-name"
                value={acct.name}
                onChange={e => updateAccount(acct.id, { name: e.target.value })}
              />
              <span className={`cred-env ${acct.env}`}>{acct.env}</span>
            </div>
            <div className="cred-field">
              <label className="cred-label">Environment</label>
              <select
                className="field-select"
                value={acct.env}
                onChange={e => updateAccount(acct.id, { env: e.target.value })}
              >
                <option value="paper">Paper</option>
                <option value="live">Live</option>
              </select>
            </div>
            <div className="cred-field">
              <label className="cred-label">API Key</label>
              <input
                className="cred-input"
                value={acct.key}
                onChange={e => updateAccount(acct.id, { key: e.target.value })}
                placeholder="PKXXXXXX…"
              />
            </div>
            <div className="cred-field">
              <label className="cred-label">Secret</label>
              <input
                className="cred-input secret"
                value={acct.secret}
                onChange={e => updateAccount(acct.id, { secret: e.target.value })}
                placeholder="••••••••"
              />
            </div>
            <div className="cred-actions">
              <button
                className="mini-btn"
                style={{ borderColor: 'var(--green)', color: 'var(--green)' }}
                onClick={() => setActiveAccount(acct.id)}
              >
                {acct.id === activeAccountId ? '✓ Active' : 'Set Active'}
              </button>
              <button
                className="mini-btn"
                style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                onClick={() => deleteAccount(acct.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}

        {!accounts.length && (
          <div className="empty-state-side">No accounts yet. Add one below.</div>
        )}

        <button
          className="modal-btn primary"
          style={{ width: '100%', marginTop: 8 }}
          onClick={() => addAccount()}
        >
          + Add Account
        </button>
      </div>
    </div>
  );
}
