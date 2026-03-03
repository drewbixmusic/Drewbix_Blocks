import React, { useRef, useCallback, useEffect, useState } from 'react';
import { useStore } from '../../core/state.js';
import FlowNode from './FlowNode.jsx';
import EdgeLayer from './EdgeLayer.jsx';
import '../../styles/canvas.css';

const ZOOM_FACTOR = 1.12;

export default function Canvas() {
  const {
    nodes, edges, configs, functions,
    selectedId, connecting, pan, zoom,
    selectNode, clearSelection, deleteNode,
    addEdge, deleteEdge,
    moveNode, setConnecting,
    setPan, setZoom,
    runStatuses, runResults, addNode,
  } = useStore();

  const wrapRef    = useRef(null);
  const dragRef    = useRef(null);   // { nodeId, startX, startY, origX, origY }
  const panRef     = useRef(null);   // { startX, startY, origPan }
  const [mousePos, setMousePos] = useState(null);

  // ── Canvas coord helper ──────────────────────────────────────────────────
  const toCanvas = useCallback((clientX, clientY) => {
    const rect = wrapRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top  - pan.y) / zoom,
    };
  }, [pan, zoom]);

  // ── Mouse move ───────────────────────────────────────────────────────────
  const onMouseMove = useCallback(e => {
    if (connecting) {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (rect) setMousePos({ x: (e.clientX - rect.left - pan.x) / zoom, y: (e.clientY - rect.top - pan.y) / zoom });
    }
    if (dragRef.current) {
      const { nodeId, startX, startY, origX, origY } = dragRef.current;
      const dx = (e.clientX - startX) / zoom;
      const dy = (e.clientY - startY) / zoom;
      moveNode(nodeId, origX + dx, origY + dy);
    }
    if (panRef.current) {
      const { startX, startY, origPan } = panRef.current;
      setPan(origPan.x + (e.clientX - startX), origPan.y + (e.clientY - startY));
    }
  }, [connecting, pan, zoom, moveNode, setPan]);

  // ── Mouse up (global) ────────────────────────────────────────────────────
  const onMouseUp = useCallback(() => {
    dragRef.current = null;
    panRef.current  = null;
    if (connecting) {
      setConnecting(null);
      setMousePos(null);
    }
  }, [connecting, setConnecting]);

  // ── Touch support: map touch events → mouse handlers for mobile ────────────
  const onTouchMove = useCallback(e => {
    if (!wrapRef.current) return;
    const t = e.touches[0] || e.changedTouches[0];
    if (!t) return;
    if (dragRef.current || panRef.current || connecting) {
      e.preventDefault();
      onMouseMove({ clientX: t.clientX, clientY: t.clientY });
    }
  }, [onMouseMove, connecting]);

  const onTouchEnd = useCallback(() => {
    if (dragRef.current || panRef.current || connecting) {
      onMouseUp();
    }
  }, [onMouseUp, connecting]);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend',  onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend',  onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [onMouseMove, onMouseUp, onTouchMove, onTouchEnd]);

  // ── Wheel zoom ───────────────────────────────────────────────────────────
  const onWheel = useCallback(e => {
    e.preventDefault();
    const rect   = wrapRef.current.getBoundingClientRect();
    const pivotX = e.clientX - rect.left;
    const pivotY = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    setZoom(zoom * factor, pivotX, pivotY);
  }, [zoom, setZoom]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // ── Canvas background click — deselect / start pan ───────────────────────
  const onCanvasMouseDown = useCallback(e => {
    // Only pan/deselect when clicking the bare canvas background (not a node or port)
    if (e.target.closest('.flow-node')) return;
    clearSelection();
    panRef.current = { startX: e.clientX, startY: e.clientY, origPan: { ...pan } };
  }, [clearSelection, pan]);

  const onCanvasTouchStart = useCallback(e => {
    if (!e.touches || !e.touches.length) return;
    const t = e.touches[0];
    onCanvasMouseDown({ target: e.target, clientX: t.clientX, clientY: t.clientY });
  }, [onCanvasMouseDown]);

  // ── Node drag start ───────────────────────────────────────────────────────
  const onNodeDragStart = useCallback((nodeId, e) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    dragRef.current = { nodeId, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y };
  }, [nodes]);

  // Intercept mousedown on nodes to initiate drag
  const onNodesAreaMouseDown = useCallback(e => {
    const nodeEl = e.target.closest('.flow-node');
    if (!nodeEl) return;
    if (e.target.closest('.port-dot') || e.target.closest('.node-del')) return;
    const nodeId = nodeEl.dataset.nodeid;
    if (nodeId) {
      selectNode(nodeId);
      onNodeDragStart(nodeId, e);
    }
  }, [selectNode, onNodeDragStart]);

  const onNodesAreaTouchStart = useCallback(e => {
    if (!e.touches || !e.touches.length) return;
    const t = e.touches[0];
    const synthetic = { target: e.target, clientX: t.clientX, clientY: t.clientY };
    onNodesAreaMouseDown(synthetic);
  }, [onNodesAreaMouseDown]);

  // ── Port connect ─────────────────────────────────────────────────────────
  const onPortMouseDown = useCallback((nodeId, port, side, e) => {
    e.stopPropagation();
    if (side === 'out') {
      setConnecting({ nodeId, port, type: 'out' });
    }
  }, [setConnecting]);

  const onPortMouseUp = useCallback((nodeId, port, side, e) => {
    e.stopPropagation();
    if (!connecting) return;
    if (side === 'in' && connecting.type === 'out' && connecting.nodeId !== nodeId) {
      addEdge(connecting.nodeId, connecting.port, nodeId, port);
    } else if (side === 'out' && !connecting) {
      setConnecting({ nodeId, port, type: 'out' });
    }
    setConnecting(null);
    setMousePos(null);
  }, [connecting, addEdge, setConnecting]);

  // ── Drag-over drop target (from sidebar palette drag) ────────────────────
  const onDrop = useCallback(e => {
    e.preventDefault();
    const moduleId = e.dataTransfer.getData('moduleId');
    if (!moduleId) return;
    const pt = toCanvas(e.clientX, e.clientY);
    addNode(moduleId, pt.x, pt.y);
  }, [addNode, toCanvas]);

  const onDragOver = e => e.preventDefault();

  const hasNodes = nodes.length > 0;

  return (
    <div
      id="canvas-wrap"
      ref={wrapRef}
      onMouseDown={onCanvasMouseDown}
      onTouchStart={onCanvasTouchStart}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      {/* Empty state hint */}
      {!hasNodes && (
        <div id="canvas-empty">
          <div className="em-icon">⬡</div>
          <div className="em-text">Drewbix Blocks</div>
          <div className="em-sub">Drag modules from the sidebar to start building</div>
        </div>
      )}

      {/* SVG edge layer — rendered behind nodes */}
      <svg
        id="canvas-svg"
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none', overflow: 'visible',
        }}
      >
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          <EdgeLayer
            edges={edges}
            nodes={nodes}
            functions={functions}
            connecting={connecting}
            mousePos={mousePos}
            onDeleteEdge={deleteEdge}
          />
        </g>
      </svg>

      {/* Node layer */}
      <div
        id="canvas-nodes"
        style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}
        onMouseDown={onNodesAreaMouseDown}
        onTouchStart={onNodesAreaTouchStart}
      >
        {nodes.map(node => (
          <FlowNode
            key={node.id}
            node={node}
            cfg={configs[node.id] || {}}
            selected={node.id === selectedId}
            runStatus={runStatuses[node.id]}
            runResult={runResults[node.id]}
            functions={functions}
            onSelect={selectNode}
            onDelete={deleteNode}
            onPortMouseDown={onPortMouseDown}
            onPortMouseUp={onPortMouseUp}
          />
        ))}
      </div>
    </div>
  );
}
