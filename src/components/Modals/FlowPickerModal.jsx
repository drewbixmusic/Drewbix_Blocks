import React, { useState } from 'react';

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 2000,
    background: 'rgba(0,0,0,0.80)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: '#0d1117', border: '1px solid #1e2a1e',
    borderRadius: 10, width: 480, maxWidth: '94vw',
    boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
    overflow: 'hidden',
  },
  header: {
    padding: '18px 20px 14px',
    borderBottom: '1px solid #1e2a1e',
    display: 'flex', alignItems: 'center', gap: 10,
  },
  icon:    { fontSize: 20 },
  title:   { fontSize: 15, fontWeight: 700, color: '#e2e8f0' },
  sub:     { fontSize: 11, color: '#64748b', marginTop: 2 },
  list:    { maxHeight: 320, overflowY: 'auto', padding: '10px 12px' },
  card: (selected) => ({
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '10px 14px', borderRadius: 7, cursor: 'pointer', marginBottom: 6,
    border: `1px solid ${selected ? '#4ade80' : '#1e2a1e'}`,
    background: selected ? 'rgba(74,222,128,0.07)' : '#111827',
    transition: 'border-color 0.15s, background 0.15s',
  }),
  cardIcon: { fontSize: 22, flexShrink: 0 },
  cardBody: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 13, fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  cardMeta: { fontSize: 10, color: '#64748b', marginTop: 2 },
  check:    { color: '#4ade80', fontSize: 16, flexShrink: 0 },
  footer: {
    padding: '14px 20px',
    borderTop: '1px solid #1e2a1e',
    display: 'flex', gap: 10, justifyContent: 'flex-end',
  },
  btnOpen: {
    padding: '8px 22px', borderRadius: 6, border: 'none', cursor: 'pointer',
    background: '#4ade80', color: '#0a1a0a', fontWeight: 700, fontSize: 13,
  },
  btnEmpty: {
    padding: '8px 16px', borderRadius: 6, border: '1px solid #334155',
    cursor: 'pointer', background: 'transparent', color: '#64748b', fontSize: 13,
  },
  loading: { padding: '32px 20px', textAlign: 'center', color: '#64748b', fontSize: 13 },
  empty:   { padding: '32px 20px', textAlign: 'center', color: '#64748b', fontSize: 13 },
};

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

export default function FlowPickerModal({ flows, loading, onSelect, onEmpty }) {
  const [selected, setSelected] = useState(flows?.length === 1 ? flows[0].id : null);

  if (loading) return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <div style={S.loading}>Loading your flows…</div>
      </div>
    </div>
  );

  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <div style={S.header}>
          <span style={S.icon}>⊞</span>
          <div>
            <div style={S.title}>Open Flow</div>
            <div style={S.sub}>{flows.length} flow{flows.length !== 1 ? 's' : ''} found in your account — select one to open</div>
          </div>
        </div>

        <div style={S.list}>
          {flows.length === 0 ? (
            <div style={S.empty}>No saved flows yet.</div>
          ) : (
            flows.map(f => (
              <div
                key={f.id}
                style={S.card(selected === f.id)}
                onClick={() => setSelected(f.id)}
                onDoubleClick={() => onSelect(f.id)}
              >
                <span style={S.cardIcon}>🔷</span>
                <div style={S.cardBody}>
                  <div style={S.cardName}>{f.name}</div>
                  <div style={S.cardMeta}>Last saved: {fmtDate(f.updated_at || f.created_at)}</div>
                </div>
                {selected === f.id && <span style={S.check}>✓</span>}
              </div>
            ))
          )}
        </div>

        <div style={S.footer}>
          <button style={S.btnEmpty} onClick={onEmpty}>Start Empty</button>
          {flows.length > 0 && (
            <button
              style={{ ...S.btnOpen, opacity: selected ? 1 : 0.4, cursor: selected ? 'pointer' : 'default' }}
              onClick={() => selected && onSelect(selected)}
              disabled={!selected}
            >
              Open Flow
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
