import React from 'react';
import { nodeDef } from '../../core/registry.js';
import { useStore, NODE_W, NODE_H, PORT_GAP } from '../../core/state.js';

/**
 * Port layout helper — mirrors the original HTML port row positioning.
 * Returns `{ ports: [{name, y}], totalHeight }`.
 */
export function getPortLayout(def) {
  const inPorts  = def?.in  || [];
  const outPorts = def?.out || [];
  const n = Math.max(inPorts.length, outPorts.length);
  const bodyH = Math.max(n * PORT_GAP, PORT_GAP);
  return { inPorts, outPorts, bodyH };
}

/** Absolute canvas coords of a port centre (for edge routing). */
export function portPos(node, portName, side, functions) {
  const def     = nodeDef(node, functions);
  const { inPorts, outPorts, bodyH } = getPortLayout(def);
  const ports   = side === 'in' ? inPorts : outPorts;
  const idx     = ports.indexOf(portName);
  if (idx < 0) return { x: node.x + NODE_W / 2, y: node.y + NODE_H / 2 };
  const y = node.y + NODE_H + (idx + 0.5) * PORT_GAP;
  const x = side === 'out' ? node.x + NODE_W : node.x;
  return { x, y };
}

// ── FlowNode component ────────────────────────────────────────────────────────
export default function FlowNode({
  node, cfg, selected, runStatus, runResult,
  functions, onSelect, onDelete, onPortMouseDown, onPortMouseUp,
}) {
  const { openVizTab } = useStore();
  const def   = nodeDef(node, functions) || { label: node.moduleId, color: '#888', icon: '?', in: [], out: [] };
  const color = def.color || '#888';
  const { inPorts, outPorts, bodyH } = getPortLayout(def);

  const rows    = runResult?._rows;
  const rowCount = Array.isArray(rows) ? rows.length : null;
  const statusClass = runStatus ? ` ${runStatus}` : '';

  const handleViewData = e => {
    e.stopPropagation();
    if (rows?.length) {
      const title = cfg?._label || def.label;
      openVizTab('table', { rows, title }, title);
    }
  };

  return (
    <div
      className={`flow-node${selected ? ' selected' : ''}`}
      style={{
        left:      node.x,
        top:       node.y,
        width:     NODE_W,
        '--node-color': color,
      }}
      data-nodeid={node.id}
    >
      {/* Header */}
      <div className="node-header" style={{ background: color + '22' }}>
        <span className="node-icon">{def.icon}</span>
        <span className="node-label-wrap">
          {cfg?._label && <span className="node-user-label" style={{ color }}>{cfg._label}</span>}
          <span className="node-label">{def.label}</span>
        </span>
        {runStatus && (
          <span className={`node-status-badge${statusClass}`}>
            {runStatus === 'running' ? '…' : runStatus === 'done' ? '✓' : '✕'}
          </span>
        )}
        <button className="node-del" onClick={e => { e.stopPropagation(); onDelete(node.id); }}>×</button>
      </div>

      {/* Row count badge — clickable to open table */}
      {rowCount !== null && (
        <div
          className="node-row-badge"
          style={{
            display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
            gap: 4, padding: '1px 6px 2px',
            background: color + '11', borderBottom: `1px solid ${color}22`,
            cursor: rowCount > 0 ? 'pointer' : 'default',
          }}
          onClick={rowCount > 0 ? handleViewData : undefined}
          title={rowCount > 0 ? `${rowCount} rows — click to view` : 'No data'}
        >
          <span style={{ fontSize: 8, color: rowCount > 0 ? color : 'var(--dim)' }}>
            {rowCount > 0 ? `${rowCount} rows ⊞` : '0 rows'}
          </span>
        </div>
      )}

      {/* Ports area */}
      <div className="node-ports" style={{ height: bodyH, position: 'relative' }}>
        {inPorts.map((p, i) => (
          <div
            key={p}
            className="port-row in"
            style={{ top: i * PORT_GAP + PORT_GAP / 4, left: 0 }}
          >
            <div
              className="port-dot"
              data-node={node.id}
              data-port={p}
              data-side="in"
              onMouseDown={e => { e.stopPropagation(); onPortMouseDown(node.id, p, 'in', e); }}
              onMouseUp={e => { e.stopPropagation(); onPortMouseUp(node.id, p, 'in', e); }}
              onTouchStart={e => { e.stopPropagation(); onPortMouseDown(node.id, p, 'in', e); }}
              onTouchEnd={e => { e.stopPropagation(); onPortMouseUp(node.id, p, 'in', e); }}
            />
            <span className="port-label">{p}</span>
          </div>
        ))}
        {outPorts.map((p, i) => (
          <div
            key={p}
            className="port-row out"
            style={{ top: i * PORT_GAP + PORT_GAP / 4, right: 0 }}
          >
            <span className="port-label">{p}</span>
            <div
              className="port-dot"
              data-node={node.id}
              data-port={p}
              data-side="out"
              onMouseDown={e => { e.stopPropagation(); onPortMouseDown(node.id, p, 'out', e); }}
              onMouseUp={e => { e.stopPropagation(); onPortMouseUp(node.id, p, 'out', e); }}
              onTouchStart={e => { e.stopPropagation(); onPortMouseDown(node.id, p, 'out', e); }}
              onTouchEnd={e => { e.stopPropagation(); onPortMouseUp(node.id, p, 'out', e); }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
