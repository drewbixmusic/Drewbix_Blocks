// ══════════════════════════════════════════════════════════════
// Full canvas chart renderer — ported from Drewbix_Blocks_App.html
// renderChartToContext(ctx, W, H, rows, cfg)
//   cfg: { series, key_field, cols, x_pad, y_pad, overlap,
//           x_fmt, y_pri_fmt, y_sec_fmt, centroid_field, centroid_pos, title }
//   series[i]: { x_field, y_field, axis, line_style, line_weight, line_alpha,
//                marker_style, marker_size, marker_alpha, color, zoom_include,
//                m_field, b_field, x2_field, y2_field, x_end_field }
// ══════════════════════════════════════════════════════════════

const FONT = '9px monospace';
const FONT_BOLD = 'bold 11px monospace';

function hexAlpha(hex, a) {
  if (!hex || hex.length < 7) return `rgba(0,212,255,${a / 100})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a / 100})`;
}

function niceStep(range, targetCount) {
  const rough = range / targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rough) || 1)));
  const norm = rough / mag;
  const nice = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return nice * mag;
}

function fmtRaw(v) {
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toPrecision(3) + 'B';
  if (abs >= 1e6) return (v / 1e6).toPrecision(3) + 'M';
  if (abs >= 1e3) return (v / 1e3).toPrecision(3) + 'K';
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 1)   return v.toPrecision(4);
  return v.toPrecision(3);
}

function fmtDate(v) {
  if (Math.abs(v) > 1e10) {
    const d = new Date(v);
    if (!isNaN(d)) return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
  }
  const sign = v < 0 ? '-' : '';
  const days = Math.abs(Math.round(v));
  if (days >= 365) return `${sign}${(days / 365).toFixed(1)}y`;
  if (days >= 30)  return `${sign}${Math.round(days / 30)}mo`;
  return `${sign}${days}d`;
}

function fmtAxis(v, fmt) {
  if (fmt === 'date') return fmtDate(v);
  if (fmt === '%')    return (v * 100).toFixed(1) + '%';
  if (fmt === '$')    return '$' + fmtRaw(v);
  return fmtRaw(v);
}

export function renderChartToContext(ctx, W, H, rows, cfg) {
  ctx.clearRect(0, 0, W, H);

  const series = Array.isArray(cfg.series) ? cfg.series.filter(s => s.x_field && s.y_field) : [];
  if (!series.length || !rows.length) {
    ctx.fillStyle = '#475569';
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.fillText(series.length ? 'No data' : 'No series configured', W / 2, H / 2);
    return;
  }

  const MARGIN = { top: 26, right: 70, bottom: 44, left: 62 };
  const hasRight = series.some(s => s.axis === 'sec');
  if (!hasRight) MARGIN.right = 16;

  const overlap     = cfg.overlap !== false;
  const hasSeries_sec = series.some(s => s.axis === 'sec');
  const doSplit     = !overlap && hasSeries_sec;

  const totalH = H - MARGIN.top - MARGIN.bottom;
  const priH   = doSplit ? Math.floor(totalH * 0.75) - 4 : totalH;
  const secH   = doSplit ? totalH - priH - 8 : 0;
  const secTop = doSplit ? MARGIN.top + priH + 8 : 0;
  const plotW  = W - MARGIN.left - MARGIN.right;
  const plotH  = priH;

  // Parse series
  const parsed = series.map(s => {
    const isSegment = s.line_style === 'segment';
    const isRay     = s.line_style === 'ray';
    const pts = rows.map(r => {
      const x = Number(r[s.x_field]), y = Number(r[s.y_field]);
      if (isNaN(x) || isNaN(y)) return null;
      const p = { x, y };
      if (isSegment) {
        p.x2 = Number(r[s.x2_field]); p.y2 = Number(r[s.y2_field]);
        if (isNaN(p.x2) || isNaN(p.y2)) return null;
      }
      if (isRay) {
        p.m = Number(r[s.m_field]); p.b = Number(r[s.b_field]);
        if (isNaN(p.m) || isNaN(p.b)) return null;
        if (s.x_end_field) p.xEnd = Number(r[s.x_end_field]);
      }
      return p;
    }).filter(Boolean);
    if (!isSegment && !isRay) pts.sort((a, b) => a.x - b.x);
    return { ...s, pts };
  });

  // Auto-range
  const tempXMax = Math.max(...parsed.filter(s => s.zoom_include !== false).flatMap(s => s.pts).map(p => p.x).filter(v => !isNaN(v)), 1);
  const expandedPts = parsed.filter(s => s.zoom_include !== false).flatMap(s => {
    if (s.line_style === 'ray')     return s.pts.flatMap(p => [{ x: p.x, y: p.y }, { x: tempXMax, y: p.m * tempXMax + p.b }]);
    if (s.line_style === 'segment') return s.pts.flatMap(p => [{ x: p.x, y: p.y }, { x: p.x2, y: p.y2 }]);
    return s.pts;
  });
  const priPts = parsed.filter(s => (s.axis || 'pri') !== 'sec' && s.zoom_include !== false).flatMap(s => {
    if (s.line_style === 'ray')     return s.pts.flatMap(p => [{ x: p.x, y: p.y }, { x: tempXMax, y: p.m * tempXMax + p.b }]);
    if (s.line_style === 'segment') return s.pts.flatMap(p => [{ x: p.x, y: p.y }, { x: p.x2, y: p.y2 }]);
    return s.pts;
  });
  const secPts = parsed.filter(s => (s.axis || 'pri') === 'sec' && s.zoom_include !== false).flatMap(s => s.pts);

  if (!expandedPts.length) {
    ctx.fillStyle = '#475569'; ctx.font = FONT; ctx.textAlign = 'center';
    ctx.fillText('No plottable data', W / 2, H / 2);
    return;
  }

  const xPadPct = parseFloat(cfg.x_pad || '10%') / 100;
  const yPadPct = parseFloat(cfg.y_pad || '10%') / 100;

  let xMin = Math.min(...expandedPts.map(p => p.x));
  let xMax = Math.max(...expandedPts.map(p => p.x));

  // Centroid
  const centroidField = cfg.centroid_field || '';
  const centroidPos   = cfg.centroid_pos || 'off';
  if (centroidField && centroidPos !== 'off') {
    const cSeries = parsed.find(s => s.y_field === centroidField || s.x_field === centroidField);
    if (cSeries && cSeries.pts.length) {
      const cPts = cSeries.pts;
      const ci = centroidPos === 'first' ? 0 : centroidPos === 'last' ? cPts.length - 1 : Math.floor(cPts.length / 2);
      const cx = cPts[ci].x;
      const dLeft = cx - xMin, dRight = xMax - cx;
      const half = Math.max(dLeft, dRight);
      xMin = cx - half; xMax = cx + half;
    }
  }
  const xPad = (xMax - xMin || 1) * xPadPct;

  function calcPriYRange(pts) {
    if (!pts.length) return { min: 0, max: 1 };
    let yMin = Math.min(...pts.map(p => p.y));
    let yMax = Math.max(...pts.map(p => p.y));
    if (centroidField && centroidPos !== 'off') {
      const cSeries = parsed.find(s => s.y_field === centroidField);
      if (cSeries && cSeries.pts.length) {
        const cPts = cSeries.pts;
        const ci = centroidPos === 'first' ? 0 : centroidPos === 'last' ? cPts.length - 1 : Math.floor(cPts.length / 2);
        const cy = cPts[ci].y;
        const half = Math.max(cy - yMin, yMax - cy);
        const minPad = Math.max(half, (yMax - yMin || 1) * yPadPct);
        return { min: cy - minPad, max: cy + minPad };
      }
    }
    const yRange = yMax - yMin || 1;
    const yPad = yRange * yPadPct;
    return { min: yMin - yPad, max: yMax + yPad };
  }

  function calcSecYRange(pts) {
    if (!pts.length) return { min: 0, max: 1 };
    const yMin = Math.min(...pts.map(p => p.y));
    const yMax = Math.max(...pts.map(p => p.y));
    const yRange = yMax - yMin || 1;
    return { min: yMin - yRange * yPadPct, max: yMax + yRange * yPadPct };
  }

  const priRange = calcPriYRange(priPts.length ? priPts : expandedPts);
  const secRange = calcSecYRange(secPts);
  const hasSec   = secPts.length > 0;

  const xMinP = xMin - xPad, xMaxP = xMax + xPad;

  function toCanvasX(x) { return MARGIN.left + (x - xMinP) / (xMaxP - xMinP) * plotW; }
  function toCanvasY(y, axis) {
    if (axis === 'sec') {
      if (doSplit) return secTop + (1 - (y - secRange.min) / (secRange.max - secRange.min)) * secH;
      return MARGIN.top + (1 - (y - secRange.min) / (secRange.max - secRange.min)) * plotH;
    }
    return MARGIN.top + (1 - (y - priRange.min) / (priRange.max - priRange.min)) * plotH;
  }

  // Background
  ctx.fillStyle = '#080810';
  ctx.fillRect(0, 0, W, H);

  // Split panel
  if (doSplit) {
    ctx.fillStyle = '#0a0a16';
    ctx.fillRect(MARGIN.left, secTop, plotW, secH);
    ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(MARGIN.left, secTop - 4); ctx.lineTo(MARGIN.left + plotW, secTop - 4); ctx.stroke();
    ctx.fillStyle = '#475569'; ctx.font = FONT; ctx.textAlign = 'left';
    ctx.fillText('SEC', MARGIN.left + 3, secTop + 10);
  }

  const xFmt    = cfg.x_fmt     || 'none';
  const yPriFmt = cfg.y_pri_fmt || 'none';
  const ySecFmt = cfg.y_sec_fmt || 'none';
  const fmtNum  = v => fmtAxis(v, xFmt);
  const fmtNumL = v => fmtAxis(v, yPriFmt);
  const fmtNumR = v => fmtAxis(v, ySecFmt);

  // Grid
  const xStep  = niceStep(xMaxP - xMinP, 8);
  const xStart = Math.ceil(xMinP / xStep) * xStep;
  const yStepL = niceStep(priRange.max - priRange.min, 6);
  const yStartL = Math.ceil(priRange.min / yStepL) * yStepL;

  ctx.strokeStyle = '#0f0f1e'; ctx.lineWidth = 0.5;
  const xMinorStep = xStep / 5;
  for (let x = Math.ceil(xMinP / xMinorStep) * xMinorStep; x <= xMaxP + xMinorStep * 0.01; x += xMinorStep) {
    const cx2 = toCanvasX(x);
    ctx.beginPath(); ctx.moveTo(cx2, MARGIN.top); ctx.lineTo(cx2, MARGIN.top + plotH); ctx.stroke();
  }
  const yMinorStep = yStepL / 5;
  for (let y = Math.ceil(priRange.min / yMinorStep) * yMinorStep; y <= priRange.max + yMinorStep * 0.01; y += yMinorStep) {
    const cy2 = toCanvasY(y, 'pri');
    ctx.beginPath(); ctx.moveTo(MARGIN.left, cy2); ctx.lineTo(MARGIN.left + plotW, cy2); ctx.stroke();
  }

  if (doSplit && secH > 0) {
    ctx.strokeStyle = '#0f0f1e'; ctx.lineWidth = 0.5;
    const secYMinorStep = niceStep(secRange.max - secRange.min, 6) / 5;
    for (let y = Math.ceil(secRange.min / secYMinorStep) * secYMinorStep; y <= secRange.max + secYMinorStep * 0.01; y += secYMinorStep) {
      const cy2 = toCanvasY(y, 'sec');
      ctx.beginPath(); ctx.moveTo(MARGIN.left, cy2); ctx.lineTo(MARGIN.left + plotW, cy2); ctx.stroke();
    }
    ctx.strokeStyle = '#1e1e3a'; ctx.lineWidth = 1;
    const secYStep = niceStep(secRange.max - secRange.min, 5);
    const secYStart = Math.ceil(secRange.min / secYStep) * secYStep;
    for (let y = secYStart; y <= secRange.max + secYStep * 0.01; y += secYStep) {
      const cy2 = toCanvasY(y, 'sec');
      ctx.beginPath(); ctx.moveTo(MARGIN.left, cy2); ctx.lineTo(MARGIN.left + plotW, cy2); ctx.stroke();
      ctx.fillStyle = '#475569'; ctx.font = FONT; ctx.textAlign = 'left';
      if (cy2 >= secTop - 5 && cy2 <= secTop + secH + 5) ctx.fillText(fmtNumR(y), MARGIN.left + plotW + 4, cy2 + 3);
    }
    ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
    ctx.strokeRect(MARGIN.left, secTop, plotW, secH);
  }

  ctx.strokeStyle = '#1e1e3a'; ctx.lineWidth = 1;
  for (let x = xStart; x <= xMaxP + xStep * 0.01; x += xStep) {
    const cx2 = toCanvasX(x);
    ctx.beginPath(); ctx.moveTo(cx2, MARGIN.top); ctx.lineTo(cx2, MARGIN.top + plotH); ctx.stroke();
  }
  for (let y = yStartL; y <= priRange.max + yStepL * 0.01; y += yStepL) {
    const cy2 = toCanvasY(y, 'pri');
    ctx.beginPath(); ctx.moveTo(MARGIN.left, cy2); ctx.lineTo(MARGIN.left + plotW, cy2); ctx.stroke();
  }

  // Axes + labels
  ctx.strokeStyle = '#334155'; ctx.lineWidth = 1.5;
  ctx.strokeRect(MARGIN.left, MARGIN.top, plotW, plotH);

  ctx.fillStyle = '#475569'; ctx.font = FONT; ctx.textAlign = 'right';
  for (let y = yStartL; y <= priRange.max + yStepL * 0.01; y += yStepL) {
    const cy2 = toCanvasY(y, 'pri');
    if (cy2 < MARGIN.top - 5 || cy2 > MARGIN.top + plotH + 5) continue;
    ctx.fillText(fmtNumL(y), MARGIN.left - 4, cy2 + 3);
  }
  if (hasRight && hasSec && !doSplit) {
    ctx.textAlign = 'left';
    const yStepR = niceStep(secRange.max - secRange.min, 6);
    const yStartR = Math.ceil(secRange.min / yStepR) * yStepR;
    for (let y = yStartR; y <= secRange.max + yStepR * 0.01; y += yStepR) {
      const cy2 = toCanvasY(y, 'sec');
      if (cy2 < MARGIN.top - 5 || cy2 > MARGIN.top + plotH + 5) continue;
      ctx.fillText(fmtNumR(y), MARGIN.left + plotW + 4, cy2 + 3);
    }
  }
  ctx.textAlign = 'center';
  for (let x = xStart; x <= xMaxP + xStep * 0.01; x += xStep) {
    const cx2 = toCanvasX(x);
    if (cx2 < MARGIN.left - 5 || cx2 > MARGIN.left + plotW + 5) continue;
    ctx.fillText(fmtNum(x), cx2, MARGIN.top + plotH + 14);
  }

  // Clip + draw series
  ctx.save();
  ctx.beginPath(); ctx.rect(MARGIN.left, MARGIN.top, plotW, plotH); ctx.clip();

  parsed.forEach(s => {
    if (!s.pts.length) return;
    const isSec = (s.axis || 'pri') === 'sec';
    if (doSplit) {
      ctx.restore(); ctx.save();
      if (isSec) { ctx.beginPath(); ctx.rect(MARGIN.left, secTop, plotW, secH); ctx.clip(); }
      else        { ctx.beginPath(); ctx.rect(MARGIN.left, MARGIN.top, plotW, plotH); ctx.clip(); }
    }

    const rawColor   = s.color || '#00d4ff';
    const lineAlpha  = s.line_alpha  ?? 80;
    const mrkAlpha   = s.marker_alpha ?? 80;
    const axis       = s.axis || 'pri';

    if (s.line_style === 'bar') {
      const range = isSec ? secRange : priRange;
      const zeroY = toCanvasY(Math.max(range.min, Math.min(0, range.max)), axis);
      const barW  = s.pts.length > 1
        ? Math.max(1, Math.min(20, (toCanvasX(s.pts[1].x) - toCanvasX(s.pts[0].x)) * 0.7)) : 8;
      ctx.fillStyle   = hexAlpha(rawColor, lineAlpha);
      ctx.strokeStyle = hexAlpha(rawColor, Math.min(100, lineAlpha + 15));
      ctx.lineWidth = 0.5;
      s.pts.forEach(p => {
        const cx2 = toCanvasX(p.x), cy2 = toCanvasY(p.y, axis);
        const top = Math.min(cy2, zeroY), h = Math.max(1, Math.abs(cy2 - zeroY));
        ctx.fillRect(cx2 - barW / 2, top, barW, h);
        ctx.strokeRect(cx2 - barW / 2, top, barW, h);
      });
    }

    if (s.line_style === 'segment') {
      ctx.strokeStyle = hexAlpha(rawColor, lineAlpha);
      ctx.lineWidth = s.line_weight || 1.5;
      ctx.setLineDash([]);
      s.pts.forEach(p => {
        if (isNaN(p.x2) || isNaN(p.y2)) return;
        ctx.beginPath();
        ctx.moveTo(toCanvasX(p.x),  toCanvasY(p.y,  axis));
        ctx.lineTo(toCanvasX(p.x2), toCanvasY(p.y2, axis));
        ctx.stroke();
      });
    }

    if (s.line_style === 'ray') {
      ctx.strokeStyle = hexAlpha(rawColor, lineAlpha);
      ctx.lineWidth = s.line_weight || 1;
      ctx.setLineDash([4, 4]);
      s.pts.forEach(p => {
        const xEnd = (s.x_end_field && p.xEnd !== undefined && !isNaN(p.xEnd)) ? p.xEnd : xMaxP;
        const yEnd = p.m * xEnd + p.b;
        ctx.beginPath();
        ctx.moveTo(toCanvasX(p.x),   toCanvasY(p.y,   axis));
        ctx.lineTo(toCanvasX(xEnd),  toCanvasY(yEnd,  axis));
        ctx.stroke();
      });
      ctx.setLineDash([]);
    }

    if (s.line_style && !['off','bar','segment','ray'].includes(s.line_style)) {
      ctx.strokeStyle = hexAlpha(rawColor, lineAlpha);
      ctx.lineWidth = s.line_weight || 1.5;
      ctx.setLineDash(s.line_style === 'dashed' ? [6, 4] : s.line_style === 'dotted' ? [2, 3] : []);
      ctx.beginPath();
      s.pts.forEach((p, i) => {
        const cx2 = toCanvasX(p.x), cy2 = toCanvasY(p.y, axis);
        i === 0 ? ctx.moveTo(cx2, cy2) : ctx.lineTo(cx2, cy2);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (s.marker_style && s.marker_style !== 'off') {
      ctx.strokeStyle = hexAlpha(rawColor, mrkAlpha);
      ctx.fillStyle   = hexAlpha(rawColor, mrkAlpha);
      ctx.lineWidth   = s.line_weight || 1.5;
      const sz = s.marker_size || 4;
      s.pts.forEach(p => {
        const cx2 = toCanvasX(p.x), cy2 = toCanvasY(p.y, axis);
        ctx.beginPath();
        if (s.marker_style === 'o') {
          ctx.arc(cx2, cy2, sz / 2, 0, Math.PI * 2); ctx.fill();
        } else if (s.marker_style === 'x') {
          ctx.moveTo(cx2 - sz/2, cy2 - sz/2); ctx.lineTo(cx2 + sz/2, cy2 + sz/2);
          ctx.moveTo(cx2 + sz/2, cy2 - sz/2); ctx.lineTo(cx2 - sz/2, cy2 + sz/2);
          ctx.stroke();
        } else if (s.marker_style === '+') {
          ctx.moveTo(cx2, cy2 - sz/2); ctx.lineTo(cx2, cy2 + sz/2);
          ctx.moveTo(cx2 - sz/2, cy2); ctx.lineTo(cx2 + sz/2, cy2);
          ctx.stroke();
        } else if (s.marker_style === '*') {
          for (let a = 0; a < 3; a++) {
            const ang = a * Math.PI / 3;
            ctx.moveTo(cx2 + Math.cos(ang) * sz/2, cy2 + Math.sin(ang) * sz/2);
            ctx.lineTo(cx2 - Math.cos(ang) * sz/2, cy2 - Math.sin(ang) * sz/2);
          }
          ctx.stroke();
        } else if (s.marker_style === '-') {
          ctx.moveTo(cx2 - sz/2, cy2); ctx.lineTo(cx2 + sz/2, cy2); ctx.stroke();
        }
      });
    }
  });

  ctx.restore();

  // Title
  if (cfg.title) {
    ctx.fillStyle = '#06b6d4'; ctx.font = FONT_BOLD; ctx.textAlign = 'center';
    ctx.fillText(cfg.title, W / 2, 16);
  }

  // Legend
  let legX = MARGIN.left + 8, legY = MARGIN.top + 12;
  ctx.font = FONT;
  parsed.forEach(s => {
    const col = s.color || '#00d4ff';
    ctx.fillStyle = col;
    ctx.fillRect(legX, legY - 7, 14, 2);
    ctx.fillStyle = '#e2e8f0'; ctx.textAlign = 'left';
    const lbl = `${s.y_field}`;
    ctx.fillText(lbl, legX + 18, legY);
    legX += ctx.measureText(lbl).width + 42;
    if (legX > W - 80) { legX = MARGIN.left + 8; legY += 12; }
  });
}
