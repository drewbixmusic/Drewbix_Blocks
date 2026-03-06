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
    setPan, setZoom, fitToNodes,
    runStatuses, runResults, addNode,
    paramPickMode,
  } = useStore();

  const wrapRef      = useRef(null);
  const dragRef      = useRef(null);
  const panRef       = useRef(null);
  const pinchRef     = useRef(null);   // { dist, midX, midY }
  const zoomBoxRef   = useRef(null);   // { startX, startY } in canvas coords
  const [mousePos,   setMousePos]   = useState(null);
  const [zoomBoxing, setZoomBoxing] = useState(false);
  const [zoomRect,   setZoomRect]   = useState(null); // { x,y,w,h } screen coords

  // Expose zoom-window mode toggle to topbar via window event
  const [zoomWindowMode, setZoomWindowMode] = useState(false);
  useEffect(() => {
    const handler = () => setZoomWindowMode(v => !v);
    window.addEventListener('drewbix:toggleZoomWindow', handler);
    return () => window.removeEventListener('drewbix:toggleZoomWindow', handler);
  }, []);

  // Expose fitToNodes to topbar
  useEffect(() => {
    const handler = () => {
      if (!wrapRef.current) return;
      const { width, height } = wrapRef.current.getBoundingClientRect();
      fitToNodes(width, height);
    };
    window.addEventListener('drewbix:fitToNodes', handler);
    return () => window.removeEventListener('drewbix:fitToNodes', handler);
  }, [fitToNodes]);

  // ── Canvas coord helper ───────────────────────────────────────────────────
  const toCanvas = useCallback((clientX, clientY) => {
    const rect = wrapRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top  - pan.y) / zoom,
    };
  }, [pan, zoom]);

  // ── Mouse move ────────────────────────────────────────────────────────────
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
    // Zoom-window drag: update rect preview
    if (zoomBoxRef.current && zoomBoxing) {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (rect) {
        const sx = zoomBoxRef.current.clientX;
        const sy = zoomBoxRef.current.clientY;
        setZoomRect({
          x: Math.min(sx, e.clientX) - rect.left,
          y: Math.min(sy, e.clientY) - rect.top,
          w: Math.abs(e.clientX - sx),
          h: Math.abs(e.clientY - sy),
        });
      }
    }
  }, [connecting, pan, zoom, moveNode, setPan, zoomBoxing]);

  // ── Mouse up (global) ─────────────────────────────────────────────────────
  const onMouseUp = useCallback(e => {
    dragRef.current = null;
    panRef.current  = null;
    if (connecting) { setConnecting(null); setMousePos(null); }

    // Commit zoom-window
    if (zoomBoxRef.current && zoomBoxing && zoomRect && wrapRef.current) {
      const { w, h } = zoomRect;
      if (w > 10 && h > 10) {
        const rect = wrapRef.current.getBoundingClientRect();
        const canvasW = rect.width, canvasH = rect.height;
        const sx = zoomBoxRef.current.clientX;
        const sy = zoomBoxRef.current.clientY;
        const x1 = Math.min(sx, e.clientX) - rect.left;
        const y1 = Math.min(sy, e.clientY) - rect.top;
        const newZoom = Math.min(3, Math.max(0.15, Math.min(canvasW / w, canvasH / h) * zoom));
        // Center the selected region
        const midCanvasX = (x1 + w / 2 - pan.x) / zoom;
        const midCanvasY = (y1 + h / 2 - pan.y) / zoom;
        setPan(canvasW / 2 - midCanvasX * newZoom, canvasH / 2 - midCanvasY * newZoom);
        setZoom(newZoom);
      }
      zoomBoxRef.current = null;
      setZoomBoxing(false);
      setZoomRect(null);
      setZoomWindowMode(false);
    }
  }, [connecting, setConnecting, zoomBoxing, zoomRect, pan, zoom, setPan, setZoom]);

  // ── Touch support ─────────────────────────────────────────────────────────
  const onTouchMove = useCallback(e => {
    if (!wrapRef.current) return;

    // Pinch-to-zoom: 2 fingers
    if (e.touches.length === 2) {
      e.preventDefault();
      const t1 = e.touches[0], t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const midX = (t1.clientX + t2.clientX) / 2;
      const midY = (t1.clientY + t2.clientY) / 2;
      if (pinchRef.current) {
        const factor = dist / pinchRef.current.dist;
        const rect   = wrapRef.current.getBoundingClientRect();
        setZoom(zoom * factor, midX - rect.left, midY - rect.top);
      }
      pinchRef.current = { dist, midX, midY };
      return;
    }

    // 1-finger: pan/drag (only when actively dragging something)
    const t = e.touches[0] || e.changedTouches[0];
    if (!t) return;
    if (dragRef.current || panRef.current || connecting) {
      e.preventDefault();
      onMouseMove({ clientX: t.clientX, clientY: t.clientY });
    }
  }, [onMouseMove, connecting, zoom, setZoom]);

  const onTouchEnd = useCallback(() => {
    pinchRef.current = null;
    if (dragRef.current || panRef.current || connecting) onMouseUp({});
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

  // ── Wheel: ctrl=zoom, shift=horizontal pan, plain=vertical pan ──────────
  const onWheel = useCallback(e => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const rect   = wrapRef.current.getBoundingClientRect();
      const pivotX = e.clientX - rect.left;
      const pivotY = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      setZoom(zoom * factor, pivotX, pivotY);
    } else if (e.shiftKey) {
      setPan(pan.x - e.deltaY, pan.y);
    } else {
      setPan(pan.x - e.deltaX, pan.y - e.deltaY);
    }
  }, [zoom, pan, setZoom, setPan]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // ── Canvas background click — deselect / start pan or zoom-window ────────
  const onCanvasMouseDown = useCallback(e => {
    if (e.target.closest('.flow-node')) return;

    // Zoom-window mode: start drawing rect
    if (zoomWindowMode) {
      e.preventDefault();
      zoomBoxRef.current = { clientX: e.clientX, clientY: e.clientY };
      setZoomBoxing(true);
      setZoomRect(null);
      return;
    }

    clearSelection();
    panRef.current = { startX: e.clientX, startY: e.clientY, origPan: { ...pan } };
  }, [clearSelection, pan, zoomWindowMode]);

  const onCanvasTouchStart = useCallback(e => {
    if (!e.touches || !e.touches.length) return;
    if (e.touches.length === 2) {
      // Initialise pinch
      const t1 = e.touches[0], t2 = e.touches[1];
      pinchRef.current = { dist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY) };
      return;
    }
    const t = e.touches[0];
    onCanvasMouseDown({ target: e.target, clientX: t.clientX, clientY: t.clientY, preventDefault: () => {} });
  }, [onCanvasMouseDown]);

  // ── Node drag start ───────────────────────────────────────────────────────
  const onNodeDragStart = useCallback((nodeId, e) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    dragRef.current = { nodeId, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y };
  }, [nodes]);

  const onNodesAreaMouseDown = useCallback(e => {
    const nodeEl = e.target.closest('.flow-node');
    if (!nodeEl) return;
    if (e.target.closest('.port-dot') || e.target.closest('.node-del')) return;
    const nodeId = nodeEl.dataset.nodeid;
    if (!nodeId) return;
    // In param-pick mode: dispatch pick event instead of normal select/drag
    if (paramPickMode) {
      window.dispatchEvent(new CustomEvent('drewbix:paramPickNode', { detail: { nodeId } }));
      return;
    }
    selectNode(nodeId);
    onNodeDragStart(nodeId, e);
  }, [selectNode, onNodeDragStart, paramPickMode]);

  const onNodesAreaTouchStart = useCallback(e => {
    if (!e.touches || !e.touches.length || e.touches.length > 1) return;
    const t = e.touches[0];
    onNodesAreaMouseDown({ target: e.target, clientX: t.clientX, clientY: t.clientY });
  }, [onNodesAreaMouseDown]);

  // ── Port connect ──────────────────────────────────────────────────────────
  const onPortMouseDown = useCallback((nodeId, port, side, e) => {
    e.stopPropagation();
    if (side === 'out') setConnecting({ nodeId, port, type: 'out' });
  }, [setConnecting]);

  const onPortMouseUp = useCallback((nodeId, port, side, e) => {
    e.stopPropagation();
    if (!connecting) return;
    if (side === 'in' && connecting.type === 'out' && connecting.nodeId !== nodeId) {
      addEdge(connecting.nodeId, connecting.port, nodeId, port);
    }
    setConnecting(null);
    setMousePos(null);
  }, [connecting, addEdge, setConnecting]);

  // ── Drag-drop from sidebar ────────────────────────────────────────────────
  const onDrop = useCallback(e => {
    e.preventDefault();
    const moduleId = e.dataTransfer.getData('moduleId');
    if (!moduleId) return;
    addNode(moduleId, toCanvas(e.clientX, e.clientY).x, toCanvas(e.clientX, e.clientY).y);
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
      style={{ cursor: paramPickMode ? 'cell' : zoomWindowMode ? 'crosshair' : undefined }}
    >
      {!hasNodes && (
        <div id="canvas-empty">
          <div className="em-icon">⬡</div>
          <div className="em-text">Drewbix Blocks</div>
          <div className="em-sub">Drag modules from the sidebar to start building</div>
        </div>
      )}

      {/* Zoom-window selection rect */}
      {zoomBoxing && zoomRect && (
        <div style={{
          position: 'absolute',
          left: zoomRect.x, top: zoomRect.y,
          width: zoomRect.w, height: zoomRect.h,
          border: '2px dashed #4ade80',
          background: 'rgba(74,222,128,0.08)',
          pointerEvents: 'none', zIndex: 999,
        }} />
      )}

      <svg
        id="canvas-svg"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
      >
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          <EdgeLayer
            edges={edges} nodes={nodes} functions={functions}
            connecting={connecting} mousePos={mousePos} onDeleteEdge={deleteEdge}
          />
        </g>
      </svg>

      <div
        id="canvas-nodes"
        style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}
        onMouseDown={onNodesAreaMouseDown}
        onTouchStart={onNodesAreaTouchStart}
      >
        {nodes.map(node => (
          <FlowNode
            key={node.id} node={node} cfg={configs[node.id] || {}}
            selected={node.id === selectedId} runStatus={runStatuses[node.id]}
            runResult={runResults[node.id]} functions={functions}
            onSelect={selectNode} onDelete={deleteNode}
            onPortMouseDown={onPortMouseDown} onPortMouseUp={onPortMouseUp}
          />
        ))}
      </div>
    </div>
  );
}
