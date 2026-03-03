import React, { useEffect, useRef } from 'react';
import { useStore } from '../../core/state.js';
import { renderChartToContext } from '../../utils/chartRenderer.js';

function drawChart(canvas, chartData) {
  const W = canvas.offsetWidth  || 800;
  const H = canvas.offsetHeight || 500;
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Support both new format { datasets, cfg, title } and legacy { xField, yField, ... }
  const { datasets = [], cfg = {}, title } = chartData;
  // Merge all datasets into a single flat array for the renderer
  const rows = datasets.flat();
  renderChartToContext(ctx, W, H, rows, { ...cfg, title: title || cfg.title || '' });
}

export default function ChartModal() {
  const { chartModal, closeChartModal } = useStore();
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!chartModal || !canvasRef.current) return;
    drawChart(canvasRef.current, chartModal);
  }, [chartModal]);

  if (!chartModal) return null;

  return (
    <div id="chart-modal-overlay" className="show">
      <div id="chart-modal">
        <div id="chart-modal-header">
          <span id="chart-modal-title">{chartModal.title || 'Chart'}</span>
          <button id="chart-modal-close" onClick={closeChartModal}>×</button>
        </div>
        <div id="chart-modal-body">
          <canvas ref={canvasRef} id="chart-canvas" />
        </div>
      </div>
    </div>
  );
}
