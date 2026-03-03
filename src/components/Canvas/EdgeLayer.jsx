import React from 'react';
import { nodeDef } from '../../core/registry.js';
import { portPos } from './FlowNode.jsx';

/** Cubic bezier SVG path between two points. */
function bezierPath(x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1) * 0.5;
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

// ── EdgeLayer ─────────────────────────────────────────────────────────────────
export default function EdgeLayer({ edges, nodes, functions, connecting, mousePos, onDeleteEdge }) {
  return (
    <svg
      id="canvas-svg"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
    >
      <g id="edges-group">
        {edges.map(edge => {
          const fromNode = nodes.find(n => n.id === edge.from);
          const toNode   = nodes.find(n => n.id === edge.to);
          if (!fromNode || !toNode) return null;

          const p1 = portPos(fromNode, edge.fromPort, 'out', functions);
          const p2 = portPos(toNode,   edge.toPort,   'in',  functions);
          const d  = bezierPath(p1.x, p1.y, p2.x, p2.y);
          const fromDef = nodeDef(fromNode, functions);
          const color   = fromDef?.color || '#888';

          return (
            <g key={edge.id}>
              {/* Invisible wide hit target */}
              <path
                className="edge-hit"
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={12}
                style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                onClick={() => onDeleteEdge(edge.id)}
              />
              {/* Visible edge */}
              <path
                className="edge-vis"
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                opacity={0.65}
              />
            </g>
          );
        })}

        {/* In-progress connection preview */}
        {connecting && mousePos && (() => {
          const node   = nodes.find(n => n.id === connecting.nodeId);
          if (!node) return null;
          const side   = connecting.type;
          const p1     = portPos(node, connecting.port, side, functions);
          const [x1, y1, x2, y2] = side === 'out'
            ? [p1.x, p1.y, mousePos.x, mousePos.y]
            : [mousePos.x, mousePos.y, p1.x, p1.y];
          const d = bezierPath(x1, y1, x2, y2);
          return (
            <path
              d={d}
              fill="none"
              stroke="var(--cyan)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              opacity={0.8}
            />
          );
        })()}
      </g>
    </svg>
  );
}
