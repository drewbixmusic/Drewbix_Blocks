import React, { useMemo } from 'react';
import { useStore } from '../../core/state.js';
import { MOD }      from '../../core/registry.js';
import { topoSort } from '../../core/engine.js';

export default function DiagnosticsModal({ onClose }) {
  const { nodes, edges, configs, accounts, activeAccountId, runResults, flowName } = useStore();

  const text = useMemo(() => {
    const order = topoSort(nodes, edges);
    const acct  = accounts.find(a => a.id === activeAccountId);
    const lines = [];

    lines.push(`◈ FLOW: ${flowName}`);
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push(`Nodes: ${nodes.length}  Edges: ${edges.length}  Account: ${acct?.name || '(none)'}`);
    lines.push('─'.repeat(64));
    lines.push('\nEXECUTION ORDER\n');

    order.forEach((nodeId, i) => {
      const n   = nodes.find(x => x.id === nodeId);
      if (!n) return;
      const def = MOD[n.moduleId] || { icon: '?', label: n.moduleId };
      const cfg = configs[nodeId] || {};
      const inEdges  = edges.filter(e => e.to   === nodeId);
      const outEdges = edges.filter(e => e.from === nodeId);

      lines.push(`[${i + 1}] ${def.icon} ${def.label}  (${nodeId})`);

      Object.entries(cfg)
        .filter(([k]) => !k.startsWith('_'))
        .forEach(([k, v]) => lines.push(`     cfg.${k} = ${JSON.stringify(v)}`));

      if (Array.isArray(cfg._headers) && cfg._headers.length) {
        lines.push(`     headers: [${cfg._headers.join(', ')}]`);
      }

      inEdges.forEach(e => {
        const src = nodes.find(x => x.id === e.from);
        const srcDef = MOD[src?.moduleId] || { label: '?' };
        lines.push(`     ← ${srcDef.label} (${e.from}).${e.fromPort}  →  .${e.toPort}`);
      });
      outEdges.forEach(e => {
        const dst = nodes.find(x => x.id === e.to);
        const dstDef = MOD[dst?.moduleId] || { label: '?' };
        lines.push(`     → .${e.fromPort}  →  ${dstDef.label} (${e.to}).${e.toPort}`);
      });

      const result = runResults[nodeId];
      if (result) {
        if (result.error) {
          lines.push(`     ✕ ERROR: ${result.error}`);
        } else if (result._mv_stored_error) {
          lines.push(`     ✕ MV Stored: ${result._mv_stored_error}`);
        } else {
          const rows = result._rows || result.data?._rows;
          if (Array.isArray(rows)) {
            lines.push(`     ✓ ${rows.length} rows`);
            if (rows.length) {
              lines.push(`     keys: ${Object.keys(rows[0]).filter(k => !k.startsWith('_')).join(', ')}`);
              lines.push(`     row[0]: ${JSON.stringify(rows[0]).slice(0, 280)}`);
            } else {
              lines.push(`     ⚠ 0 rows`);
            }
          }
        }
      } else {
        lines.push('     (not run)');
      }
      lines.push('');
    });

    lines.push('─'.repeat(64));
    lines.push('\nEDGE MAP\n');
    edges.forEach(e => {
      const fn  = nodes.find(n => n.id === e.from);
      const tn  = nodes.find(n => n.id === e.to);
      const fl  = MOD[fn?.moduleId]?.label || '?';
      const tl  = MOD[tn?.moduleId]?.label || '?';
      lines.push(`  ${fl} (${e.from}).${e.fromPort}  →  ${tl} (${e.to}).${e.toPort}`);
    });

    lines.push('\n' + '─'.repeat(64));
    lines.push('\nACCOUNTS\n');
    accounts.forEach(a => {
      lines.push(`  ${a.name} [${a.env}]  key: ${a.key ? a.key.slice(0, 8) + '…' : '(none)'}`);
    });

    return lines.join('\n');
  }, [nodes, edges, configs, accounts, activeAccountId, runResults, flowName]);

  const copy = () => navigator.clipboard.writeText(text).catch(() => {});

  return (
    <div
      style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%,-50%)',
        background: '#0d0d1a', border: '2px solid var(--amber)',
        borderRadius: 8, zIndex: 9999,
        width: 'min(780px,94vw)', maxHeight: '82vh',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'var(--font)',
        boxShadow: '0 0 60px rgba(245,158,11,0.25)',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', background: '#111122',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <span style={{ color: 'var(--amber)', fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>◈ FLOW TRACE</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={copy} style={{
            background: 'transparent', border: '1px solid var(--amber)44',
            color: 'var(--amber)', borderRadius: 3, padding: '3px 10px',
            fontFamily: 'inherit', fontSize: 10, cursor: 'pointer',
          }}>Copy</button>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none',
            color: 'var(--red)', fontSize: 20, cursor: 'pointer', lineHeight: 1,
          }}>×</button>
        </div>
      </div>
      <pre style={{
        margin: 0, padding: '14px 18px', overflow: 'auto',
        fontSize: 11, color: 'var(--text)', whiteSpace: 'pre-wrap',
        wordBreak: 'break-all', flex: 1,
      }}>{text}</pre>
    </div>
  );
}
