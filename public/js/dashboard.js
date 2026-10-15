// Main Dashboard — Executive Management Presentation Dashboard (v2026.07.28.05)
// Redesigned as CEO/Management boardroom-style dashboard:
//   ▸ Auto-generated executive summary banner
//   ▸ 8 premium executive KPI cards with count-up animations
//   ▸ Circular (donut) progress cards per salesperson
//   ▸ Medal-style ranking cards
//   ▸ Quotation → Contract conversion funnel
//   ▸ Target completion horizontal split bars
//   ▸ Project status progress bars
//   ▸ Monthly sales trend line chart
//   ▸ Salesperson comparison table with inline progress
//   ▸ Key insights panel
//   ▸ Subtle animations: count-up, donut fill, card hover
//
// NO changes to backend calculations, targets, data, or API. All data from /api/dashboard/summary.

// ── Chart.js loader (same pattern as _loadChartJs in maintenance_contracts.js) ──
var _dashProjChartCfg = null; // stores Chart.js config for Project Status re-render

function _dashLoadChartJs() {
  if (window.Chart) return Promise.resolve();
  return new Promise(function(res, rej) {
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

function _dashOpenPresentation(title, renderFn) {
  document.getElementById('dash-pres-overlay') && document.getElementById('dash-pres-overlay').remove();
  var overlay = document.createElement('div');
  overlay.id = 'dash-pres-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9990;background:rgba(10,20,45,.72);display:flex;align-items:center;justify-content:center;';
  var card = document.createElement('div');
  card.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 24px 64px rgba(0,0,0,.45);width:96vw;height:92vh;display:flex;flex-direction:column;overflow:hidden;';
  var hdr = document.createElement('div');
  hdr.style.cssText = 'padding:16px 20px 12px;border-bottom:1px solid #e8eef3;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;';
  hdr.innerHTML = '<span style="font-size:15px;font-weight:700;color:#0F4C81">' + esc(title) + '</span>';
  var closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Close';
  closeBtn.style.cssText = 'border:1px solid #ccc;background:#f8f9fa;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;';
  hdr.appendChild(closeBtn);
  var bodyEl = document.createElement('div');
  bodyEl.style.cssText = 'flex:1;min-height:0;padding:20px;display:flex;flex-direction:column;overflow:hidden;';
  card.appendChild(hdr);
  card.appendChild(bodyEl);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  function close() { overlay.remove(); document.removeEventListener('keydown', _escH); }
  var _escH = function(e) { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', _escH);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
  requestAnimationFrame(function() { closeBtn.focus(); renderFn(bodyEl); });
}

const SP_LABELS = { SY: 'SY', MM: 'MM', NM: 'NM', SS: 'SS', MGMT: 'MGMT' };
const SP_FULL_NAMES = {
  SY: 'Shathurudeen Yasir', MM: 'Mohammed Masthan',
  NM: 'Naina Mohammed', SS: 'Sanavadeen Sabir', MGMT: 'Management',
};
const SP_COLORS = { SY: '#0F4C81', MM: '#16877A', NM: '#C58A1A', SS: '#7E5CA8', MGMT: '#64748B' };

// ── Semantic color by achievement percentage ──────────────────────────────────
function saColor(pct) {
  const p = Number(pct);
  if (isNaN(p) || pct === null || pct === undefined) return '#64748B';
  if (p >= 75) return '#16875B';
  if (p >= 50) return '#C58A1A';
  return '#C85A3A';
}

// ── Performance badge ─────────────────────────────────────────────────────────
function saBadge(pct) {
  if (pct === null || pct === undefined || isNaN(Number(pct))) {
    return '<span style="font-size:11px;color:#888">N/A</span>';
  }
  const p = Number(pct);
  if (p >= 75) return '<span class="badge" style="background:#e8f5ef;color:#16875b">On Track</span>';
  if (p >= 50) return '<span class="badge" style="background:#e8f0fb;color:#2563ad">Progressing</span>';
  if (p >= 25) return '<span class="badge" style="background:#fdf2dc;color:#c58a1a">Needs Attention</span>';
  return '<span class="badge" style="background:#fde6e3;color:#c85a3a">At Risk</span>';
}

// ── Donut / Circular progress SVG ────────────────────────────────────────────
// Starts at stroke-dasharray 0 (animated to target by initDashboardAnimations)
function donutSvg(pct, color, size) {
  size = size || 112;
  const r = size * 0.42;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const sw = size * 0.085;
  const fill = Math.min(100, Math.max(0, Number(pct) || 0)) / 100 * circ;
  const pctLabel = pct !== null && pct !== undefined ? pct + '%' : '?';
  return `<svg class="donut-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="#E8EEF3" stroke-width="${sw.toFixed(1)}"/>
    <circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="${color}"
      stroke-width="${sw.toFixed(1)}" stroke-linecap="round"
      stroke-dasharray="0 ${circ.toFixed(2)}"
      data-target="${fill.toFixed(2)} ${circ.toFixed(2)}"
      class="donut-arc"
      transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle"
      font-size="${Math.round(size * 0.135)}" font-weight="700" fill="${color}">${esc(pctLabel)}</text>
  </svg>`;
}

// ── Monthly SVG bar chart (for Quotations chart) ──────────────────────────────
function svgBarChart({ categories, series, height }) {
  height = height || 160;
  if (!categories || !categories.length) return '<div class="empty-state" style="height:80px">No data</div>';
  const W = 640, H = height, padL = 36, padR = 10, padT = 20, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxVal = Math.max(1, ...series.flatMap(function(s) { return s.values; }));
  const groupW = plotW / categories.length;
  const barGap = 3;
  const barW = Math.max(6, (groupW - barGap * (series.length + 1)) / series.length);
  let bars = '', xLabels = '';
  categories.forEach(function(cat, ci) {
    const groupX = padL + ci * groupW;
    series.forEach(function(s, si) {
      const v = s.values[ci] || 0;
      const barH = (v / maxVal) * plotH;
      const x = groupX + barGap + si * (barW + barGap);
      const y = padT + plotH - barH;
      bars += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + barH.toFixed(1) + '" fill="' + s.color + '" rx="2"><title>' + esc(cat) + ': ' + v + '</title></rect>';
      if (barH > 14) bars += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (y - 4).toFixed(1) + '" font-size="9" text-anchor="middle" fill="#555">' + v + '</text>';
    });
    xLabels += '<text x="' + (groupX + groupW / 2).toFixed(1) + '" y="' + (H - padB + 14) + '" font-size="10" text-anchor="middle" fill="#666">' + esc(cat) + '</text>';
  });
  let grid = '';
  [0, 0.5, 1].forEach(function(f) {
    const y = padT + plotH - f * plotH;
    grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#e8eef3" stroke-width="1"/>';
    grid += '<text x="' + (padL - 4).toFixed(1) + '" y="' + (y + 3).toFixed(1) + '" font-size="8" text-anchor="end" fill="#888">' + Math.round(f * maxVal) + '</text>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" xmlns="http://www.w3.org/2000/svg">' + grid + bars + xLabels + '</svg>';
}

// ── Monthly sales line chart ───────────────────────────────────────────────────
function buildLineChart(monthly, filterCode) {
  if (!monthly || !monthly.length) return '<div class="empty-state">No monthly data</div>';
  const W = 580, H = 150, padL = 36, padR = 10, padT = 18, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const months = monthly.map(function(m) { return m.month.slice(5); });
  const values = monthly.map(function(m) {
    return filterCode === 'total' ? (m.total || 0) : (m[filterCode] || 0);
  });
  const maxVal = Math.max(1, Math.max.apply(null, values));
  const n = months.length;
  const color = filterCode === 'total' ? '#0F4C81' : (SP_COLORS[filterCode] || '#0F4C81');
  const pts = values.map(function(v, i) {
    return {
      x: padL + (n > 1 ? (i / (n - 1)) : 0.5) * plotW,
      y: padT + plotH - (v / maxVal) * plotH,
      v: v,
    };
  });
  const polyPoints = pts.map(function(p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
  const areaPath = 'M' + pts[0].x.toFixed(1) + ',' + (padT + plotH).toFixed(1) + ' ' +
    pts.map(function(p) { return 'L' + p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ') +
    ' L' + pts[pts.length - 1].x.toFixed(1) + ',' + (padT + plotH).toFixed(1) + ' Z';
  let dots = '', xLbls = '';
  pts.forEach(function(p, i) {
    dots += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4" fill="' + color + '" stroke="white" stroke-width="1.5"/>';
    if (p.v > 0) {
      const yLbl = p.y < padT + 16 ? p.y + 17 : p.y - 7;
      dots += '<text x="' + p.x.toFixed(1) + '" y="' + yLbl.toFixed(1) + '" font-size="9" text-anchor="middle" fill="' + color + '" font-weight="600">' + p.v + '</text>';
    }
    xLbls += '<text x="' + p.x.toFixed(1) + '" y="' + (H - padB + 14) + '" font-size="9" text-anchor="middle" fill="#888">' + esc(months[i]) + '</text>';
  });
  let grid = '';
  [0, 0.5, 1].forEach(function(f) {
    const y = padT + plotH - f * plotH;
    grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#e8eef3" stroke-width="1"/>';
    grid += '<text x="' + (padL - 4).toFixed(1) + '" y="' + (y + 3).toFixed(1) + '" font-size="8" text-anchor="end" fill="#888">' + Math.round(f * maxVal) + '</text>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" xmlns="http://www.w3.org/2000/svg">' +
    '<defs><linearGradient id="lineGrad-' + esc(filterCode) + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.18"/>' +
    '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/>' +
    '</linearGradient></defs>' +
    grid +
    '<path d="' + areaPath + '" fill="url(#lineGrad-' + esc(filterCode) + ')"/>' +
    '<polyline points="' + polyPoints + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
    dots + xLbls + '</svg>';
}

function chartLegend(series) {
  return '<div class="chart-legend">' + series.map(function(s) {
    return '<span class="legend-item"><span class="legend-dot" style="background:' + s.color + '"></span>' + esc(s.name) + '</span>';
  }).join('') + '</div>';
}

// ── Section 1: Executive Summary Banner ───────────────────────────────────────
function buildExecutiveSummary(d, targeted, sp) {
  const totalTarget = d.sales_target_2026 || 0;
  const achieved = d.total_sales_units_2026 || 0;
  const pct = Number(d.achievement_pct) || 0;
  const remaining = Math.max(0, totalTarget - achieved);
  const best = targeted.filter(function(r) { return r.percentage_of_achievement !== null; })
    .slice().sort(function(a, b) { return (b.percentage_of_achievement || 0) - (a.percentage_of_achievement || 0); });
  const bestR = best[0];
  const bestName = bestR ? (SP_FULL_NAMES[bestR.salesperson] || bestR.salesperson) : '—';
  const bestPct = bestR ? bestR.percentage_of_achievement : null;
  const totalQ = sp.reduce(function(s, r) { return s + r.total_quotations_submitted; }, 0);
  const totalC = sp.reduce(function(s, r) { return s + r.current_sales_achievement; }, 0);
  const conv = totalQ > 0 ? Math.round(totalC / totalQ * 1000) / 10 : null;
  const statusWord = pct >= 75 ? 'strong' : pct >= 50 ? 'progressing steadily' : pct >= 25 ? 'below target' : 'significantly below target';
  const statusColor = saColor(pct);
  return '<div class="exec-summary">' +
    '<div class="exec-summary-left">' +
    '<div class="exec-summary-label">Sales Performance Overview — 2026</div>' +
    '<div class="exec-summary-body">The company has achieved <strong>' + achieved + ' of ' + totalTarget + ' target units</strong> ' +
    '(<strong style="color:' + statusColor + '">' + pct + '% — ' + statusWord + '</strong>). ' +
    '<strong>' + esc(bestName) + '</strong> is the top performer' +
    (bestPct !== null ? ' at <strong>' + bestPct + '% achievement</strong>' : '') + '. ' +
    '<strong>' + remaining + ' unit' + (remaining !== 1 ? 's' : '') + '</strong> remain to meet the annual goal. ' +
    totalQ + ' quotation' + (totalQ !== 1 ? 's' : '') + ' submitted → ' +
    '<strong>' + totalC + ' contract' + (totalC !== 1 ? 's' : '') + ' confirmed</strong>' +
    (conv !== null ? ' (' + conv + '% conversion)' : '') + '.' +
    '</div></div>' +
    '<div class="exec-summary-right">' +
    '<div class="exec-summary-big" style="color:' + statusColor + '">' + pct + '%</div>' +
    '<div class="exec-summary-sub">Overall Achievement</div>' +
    '</div></div>';
}

// ── Section 2: Executive KPI Cards ────────────────────────────────────────────
function buildExecKpiCards(d, targeted, sp) {
  const totalQ = sp.reduce(function(s, r) { return s + r.total_quotations_submitted; }, 0);
  const totalC = sp.reduce(function(s, r) { return s + r.current_sales_achievement; }, 0);
  const convRaw = totalQ > 0 ? Math.round(totalC / totalQ * 1000) / 10 : null;
  const best = targeted.filter(function(r) { return r.percentage_of_achievement !== null; })
    .slice().sort(function(a, b) { return (b.percentage_of_achievement || 0) - (a.percentage_of_achievement || 0); });
  const bestR = best[0];
  const remaining = Math.max(0, (d.sales_target_2026 || 0) - (d.total_sales_units_2026 || 0));
  const pct = Number(d.achievement_pct) || 0;
  function cls(v, hi, mid) {
    const n = Number(v);
    if (isNaN(n)) return 'grey';
    if (n >= (hi || 75)) return 'green';
    if (n >= (mid || 50)) return 'amber';
    return 'red';
  }
  const cards = [
    { icon: '🎯', label: '2026 Sales Target', val: d.sales_target_2026 || 0, suffix: ' Units', sub: 'Annual company target', c: 'blue' },
    { icon: '✅', label: 'Units Achieved', val: d.total_sales_units_2026 || 0, suffix: ' Units', sub: pct + '% of ' + (d.sales_target_2026 || 0) + ' target', c: cls(pct) },
    { icon: '📉', label: 'Remaining Units', val: remaining, suffix: ' Units', sub: 'To complete annual target', c: remaining === 0 ? 'green' : 'grey' },
    { icon: '📊', label: 'Achievement Rate', val: pct, suffix: '%', sub: 'Overall target achievement', c: cls(pct) },
    { icon: '💬', label: 'Quotations 2026', val: totalQ, suffix: '', sub: 'Quotations submitted this year', c: 'blue', click: true },
    { icon: '🔁', label: 'Conversion Rate', val: convRaw !== null ? convRaw : null, suffix: '%', sub: totalC + ' contracts from ' + totalQ + ' quotations', c: convRaw !== null ? cls(convRaw, 30, 15) : 'grey', noVal: convRaw === null },
    { icon: '🏆', label: 'Best Performer', val: bestR ? (SP_LABELS[bestR.salesperson] || bestR.salesperson) : '—', suffix: '', sub: bestR ? esc(SP_FULL_NAMES[bestR.salesperson] || '') + ' — ' + bestR.percentage_of_achievement + '%' : 'No data', c: 'gold', text: true },
    { icon: '🚚', label: 'Delivered to Site', val: d.units_delivered_2026 || 0, suffix: ' Units',
      sub: (d.units_delivered_this_month || 0) + ' this month · YTD ' + (d.units_delivered_2026 || 0),
      c: 'green', click: true, id: 'exec-kpi-delivered' },
    { icon: '🏁', label: 'Handover Completed', val: d.handover_units_ytd || 0, suffix: ' Units',
      sub: (d.handover_projects_ytd || 0) + ' projects handed over ' + new Date().getFullYear(),
      c: 'teal', click: true, id: 'exec-kpi-handover' },
  ];
  return '<div class="exec-kpi-grid">' + cards.map(function(card) {
    const isNum = !card.text && !card.noVal && typeof card.val === 'number' && !isNaN(card.val);
    const dispVal = card.noVal ? '—' : (card.text ? esc(String(card.val)) : (isNum ? '0' + esc(card.suffix) : esc(String(card.val)) + esc(card.suffix)));
    const attrs = isNum ? ' data-countup="' + card.val + '" data-suffix="' + esc(card.suffix) + '"' : '';
    const cardId = card.id ? ' id="' + card.id + '"' : (card.click ? ' id="exec-kpi-quot"' : '');
    return '<div class="exec-kpi-card ' + card.c + (card.click ? ' clickable' : '') + '"' + cardId + '>' +
      '<div class="exec-kpi-top"><span class="exec-kpi-icon">' + card.icon + '</span><span class="exec-kpi-label">' + esc(card.label) + '</span></div>' +
      '<div class="exec-kpi-val"' + attrs + '>' + (card.noVal ? '—' : (card.text ? esc(String(card.val)) + esc(card.suffix) : dispVal)) + '</div>' +
      '<div class="exec-kpi-sub">' + card.sub + '</div>' +
      '</div>';
  }).join('') + '</div>';
}

// ── Section 3: SP Circular Progress Cards ─────────────────────────────────────
function buildSpCircularCards(targeted) {
  if (!targeted.length) return '<div class="empty-state">No salesperson data.</div>';
  return '<div class="sp-circle-grid">' + targeted.map(function(r) {
    const code = SP_LABELS[r.salesperson] || r.salesperson;
    const fullName = SP_FULL_NAMES[r.salesperson] || r.salesperson;
    const pct = r.percentage_of_achievement;
    const color = saColor(pct);
    const target = r.target_units_2026 || 0;
    const achieved = r.current_sales_achievement || 0;
    const remaining = Math.max(0, target - achieved);
    return '<div class="sp-circle-card">' +
      '<div class="sp-circle-name">' + esc(code) + '</div>' +
      '<div class="sp-circle-fullname">' + esc(fullName) + '</div>' +
      '<div class="sp-circle-donut">' + donutSvg(pct !== null ? pct : 0, color, 112) + '</div>' +
      '<div style="text-align:center;margin:4px 0">' + saBadge(pct) + '</div>' +
      '<div class="sp-circle-stats">' +
      '<div class="sp-circle-stat"><span class="sp-stat-val" style="color:' + color + '" data-countup="' + achieved + '" data-suffix="">' + achieved + '</span><span class="sp-stat-label">Achieved</span></div>' +
      '<div class="sp-circle-stat sp-circle-stat-mid"><span class="sp-stat-val" data-countup="' + target + '" data-suffix="">' + target + '</span><span class="sp-stat-label">Target</span></div>' +
      '<div class="sp-circle-stat"><span class="sp-stat-val" style="color:' + color + '" data-countup="' + remaining + '" data-suffix="">' + remaining + '</span><span class="sp-stat-label">Remaining</span></div>' +
      '</div></div>';
  }).join('') + '</div>';
}

// ── Section 4: Sales Ranking Cards ────────────────────────────────────────────
function buildRankingCards(targeted) {
  const ranked = targeted.filter(function(r) { return r.percentage_of_achievement !== null; })
    .slice().sort(function(a, b) { return (b.percentage_of_achievement || 0) - (a.percentage_of_achievement || 0); });
  if (!ranked.length) return '<div class="empty-state">No ranking data.</div>';
  const medals = ['🥇', '🥈', '🥉'];
  return '<div class="ranking-list">' + ranked.map(function(r, i) {
    const code = SP_LABELS[r.salesperson] || r.salesperson;
    const fullName = SP_FULL_NAMES[r.salesperson] || r.salesperson;
    const pct = r.percentage_of_achievement;
    const color = saColor(pct);
    const target = r.target_units_2026 || 0;
    const achieved = r.current_sales_achievement || 0;
    const barPct = target > 0 ? Math.min(100, Math.round(achieved / target * 100)) : 0;
    return '<div class="ranking-card">' +
      '<span class="ranking-medal">' + (medals[i] !== undefined ? medals[i] : (i + 1) + '.') + '</span>' +
      '<div class="ranking-body">' +
      '<div class="ranking-head"><strong class="ranking-code" style="color:' + color + '">' + esc(code) + '</strong>' +
      '<span class="ranking-name">' + esc(fullName) + '</span>' +
      '<span class="ranking-pct" style="color:' + color + '">' + pct + '%</span></div>' +
      '<div class="ranking-units">' + achieved + ' / ' + target + ' Units</div>' +
      '<div class="ranking-track"><div class="ranking-fill" style="width:' + barPct + '%;background:' + color + '"></div></div>' +
      '<div style="margin-top:4px">' + saBadge(pct) + '</div>' +
      '</div></div>';
  }).join('') + '</div>';
}

// ── Section 5: Quotation → Contract Funnel ────────────────────────────────────
function buildFunnel(totalQ, totalC) {
  if (!totalQ) return '<div class="empty-state">No quotation data available.</div>';
  const conv = totalQ > 0 ? Math.round(totalC / totalQ * 1000) / 10 : null;
  const stages = [
    { label: 'Quotations Submitted', val: totalQ, bg: '#AFC6D9', fg: '#1d4e7a', pct: 100 },
    { label: 'Contracts Confirmed', val: totalC, bg: '#176B87', fg: '#ffffff', pct: conv || 0 },
  ];
  return '<div class="exec-funnel">' +
    '<div class="funnel-title">Quotation → Contract Funnel</div>' +
    stages.map(function(s, i) {
      const w = i === 0 ? 100 : Math.max(25, Math.round(s.pct));
      return (i > 0 ? '<div class="funnel-connector">↓ ' + (conv !== null ? conv + '% conversion rate' : '') + '</div>' : '') +
        '<div class="funnel-item" style="width:' + w + '%;background:' + s.bg + ';color:' + s.fg + '">' +
        '<span class="funnel-item-val">' + s.val + '</span>' +
        '<span class="funnel-item-label">' + esc(s.label) + '</span>' +
        '</div>';
    }).join('') +
    '<div class="funnel-footer">' +
    (conv !== null ? '<strong>' + conv + '%</strong> conversion — ' + totalC + ' of ' + totalQ + ' quotations became contracts' : 'No quotation data available') +
    '</div></div>';
}

// ── Section 6: Target Completion Split Bars ───────────────────────────────────
function buildTargetCompletion(rows) {
  if (!rows.length) return '<div class="empty-state">No target data.</div>';
  return '<div class="tc-list">' + rows.map(function(r) {
    const pct = r.percentage_of_achievement;
    const target = r.target_units_2026 || 0;
    const achieved = r.current_sales_achievement || 0;
    const remaining = Math.max(0, target - achieved);
    const barPct = target > 0 ? Math.min(100, Math.round(achieved / target * 100)) : 0;
    const color = saColor(pct);
    const code = SP_LABELS[r.salesperson] || r.salesperson;
    const fullName = SP_FULL_NAMES[r.salesperson] || r.salesperson;
    return '<div class="tc-row">' +
      '<div class="tc-label">' +
      '<span class="tc-code">' + esc(code) + '</span>' +
      '<span class="tc-name">' + esc(fullName) + '</span>' +
      '<span class="tc-pct" style="color:' + color + '">' + (pct !== null ? pct + '%' : 'N/A') + '</span>' +
      '</div>' +
      '<div class="tc-bar-wrap">' +
      '<div class="tc-bar-fill" style="width:' + barPct + '%;background:' + color + '"></div>' +
      '<div class="tc-bar-remain" style="width:' + (100 - barPct) + '%;background:#E8EEF3"></div>' +
      '</div>' +
      '<div class="tc-numbers">' +
      '<span style="color:' + color + '">✓ ' + achieved + ' achieved</span>' +
      '<span style="color:#94A3B8">◯ ' + remaining + ' remaining</span>' +
      '<span>of ' + target + '</span>' +
      '</div></div>';
  }).join('') + '</div>';
}

// ── Section 7: Project Status ─────────────────────────────────────────────────
function buildProjectStatus(d, sp) {
  const delivered = d.units_delivered_2026 || 0;
  const total2026 = sp.reduce(function(s, r) { return s + r.current_sales_achievement; }, 0);
  const cancelled2026 = sp.reduce(function(s, r) { return s + (r.cancelled_achievement || 0); }, 0);
  const inProgress = Math.max(0, total2026 - delivered - cancelled2026);
  const maxVal = Math.max(1, total2026);
  const stages = [
    { label: 'Contracts Confirmed', val: total2026, color: '#0F4C81' },
    { label: 'In Progress / Active', val: inProgress, color: '#16877A' },
    { label: 'Delivered to Site', val: delivered, color: '#16875B' },
    { label: 'Cancelled (2026)', val: cancelled2026, color: '#C85A3A' },
  ];
  return '<div class="proj-status-list">' + stages.map(function(s) {
    const barPct = Math.round(s.val / maxVal * 100);
    return '<div class="proj-status-row">' +
      '<div class="proj-status-label">' +
      '<span class="proj-status-dot" style="background:' + s.color + '"></span>' +
      '<span>' + esc(s.label) + '</span>' +
      '<span class="proj-status-count" style="color:' + s.color + '">' + s.val + '</span>' +
      '</div>' +
      '<div class="proj-status-track"><div class="proj-status-fill" style="width:' + barPct + '%;background:' + s.color + '"></div></div>' +
      '<div class="proj-status-pct">' + barPct + '%</div>' +
      '</div>';
  }).join('') + '</div>';
}

// ── Section 8: Salesperson Comparison Table ────────────────────────────────────
function buildComparisonTable(sp) {
  if (!sp.length) return '<div class="empty-state">No data.</div>';
  return '<div style="overflow-x:auto"><table class="data-table" style="font-size:12px">' +
    '<thead><tr><th>Salesperson</th><th>Target</th><th>Quot.</th>' +
    '<th>Achieved</th><th>Remaining</th><th>Ach.%</th><th>Conv.%</th>' +
    '<th>Status</th><th style="min-width:90px">Progress</th></tr></thead>' +
    '<tbody>' + sp.map(function(r) {
      const code = SP_LABELS[r.salesperson] || r.salesperson;
      const fullName = SP_FULL_NAMES[r.salesperson] || r.salesperson;
      const pct = r.percentage_of_achievement;
      const target = r.target_units_2026;
      const achieved = r.current_sales_achievement || 0;
      const remaining = target !== null ? Math.max(0, (target || 0) - achieved) : '—';
      const conv = r.total_quotations_submitted > 0
        ? (Math.round(achieved / r.total_quotations_submitted * 1000) / 10) + '%' : '—';
      const barPct = target ? Math.min(100, Math.round(achieved / target * 100)) : 0;
      const color = saColor(pct);
      return '<tr>' +
        '<td><strong>' + esc(code) + '</strong> <span class="text-mute" style="font-size:11px">' + esc(fullName) + '</span></td>' +
        '<td>' + (target !== null ? target : '<span class="text-mute">—</span>') + '</td>' +
        '<td>' + (r.total_quotations_submitted || '—') + '</td>' +
        '<td><strong>' + achieved + '</strong></td>' +
        '<td>' + remaining + '</td>' +
        '<td style="font-weight:700;color:' + color + '">' + (pct !== null ? pct + '%' : '—') + '</td>' +
        '<td>' + conv + '</td>' +
        '<td>' + saBadge(pct) + '</td>' +
        '<td><div class="comp-bar-track"><div class="comp-bar-fill" style="width:' + barPct + '%;background:' + color + '"></div></div>' +
        '<div style="font-size:10px;color:var(--color-muted);text-align:right">' + barPct + '%</div></td>' +
        '</tr>';
    }).join('') + '</tbody></table></div>';
}

// ── Section 9: Key Insights Panel ────────────────────────────────────────────
function buildInsightsPanel(d, targeted, sp) {
  const ranked = targeted.filter(function(r) { return r.percentage_of_achievement !== null; })
    .slice().sort(function(a, b) { return (b.percentage_of_achievement || 0) - (a.percentage_of_achievement || 0); });
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const mostQ = sp.slice().sort(function(a, b) { return b.total_quotations_submitted - a.total_quotations_submitted; })[0];
  const withConv = sp.filter(function(r) { return r.total_quotations_submitted > 0; });
  const bestConv = withConv.length
    ? withConv.slice().sort(function(a, b) {
        return (b.current_sales_achievement / b.total_quotations_submitted) - (a.current_sales_achievement / a.total_quotations_submitted);
      })[0] : null;
  const remaining = Math.max(0, (d.sales_target_2026 || 0) - (d.total_sales_units_2026 || 0));
  const totalQ = sp.reduce(function(s, r) { return s + r.total_quotations_submitted; }, 0);
  const totalC = sp.reduce(function(s, r) { return s + r.current_sales_achievement; }, 0);
  const insights = [
    { label: '🏆 Best Performer', val: best ? (SP_LABELS[best.salesperson] || best.salesperson) + ' — ' + best.percentage_of_achievement + '%' : '—', color: '#16875b' },
    { label: '⚠️ Needs Attention', val: worst && Number(worst.percentage_of_achievement) < 50 ? (SP_LABELS[worst.salesperson] || worst.salesperson) + ' — ' + worst.percentage_of_achievement + '%' : 'All progressing well', color: worst && Number(worst.percentage_of_achievement) < 50 ? '#c85a3a' : '#16875b' },
    { label: '📋 Most Quotations', val: mostQ ? (SP_LABELS[mostQ.salesperson] || mostQ.salesperson) + ' (' + mostQ.total_quotations_submitted + ' quot.)' : '—', color: '#0F4C81' },
    { label: '🔁 Highest Conversion', val: bestConv ? (SP_LABELS[bestConv.salesperson] || bestConv.salesperson) + ' — ' + (Math.round(bestConv.current_sales_achievement / bestConv.total_quotations_submitted * 1000) / 10) + '%' : '—', color: '#16877A' },
    { label: '🎯 Remaining Target', val: remaining + ' units to reach ' + (d.sales_target_2026 || 0), color: remaining === 0 ? '#16875b' : '#c85a3a' },
    { label: '📊 Total Quotations', val: totalQ + ' submitted in 2026', color: '#64748B' },
    { label: '✅ Contracts Confirmed', val: totalC + ' contracts this year', color: '#16875b' },
    { label: '🚚 Delivered to Site', val: (d.units_delivered_2026 || 0) + ' units YTD · ' + (d.units_delivered_this_month || 0) + ' this month', color: '#16877A' },
    { label: '🏁 Handover Completed', val: (d.handover_units_ytd || 0) + ' units · ' + (d.handover_projects_ytd || 0) + ' projects', color: '#0F4C81' },
  ];
  return '<div class="insights-grid">' + insights.map(function(ins) {
    return '<div class="insight-item">' +
      '<div class="insight-label">' + esc(ins.label) + '</div>' +
      '<div class="insight-val" style="color:' + ins.color + '">' + esc(ins.val) + '</div>' +
      '</div>';
  }).join('') + '</div>';
}

// ── Animations ─────────────────────────────────────────────────────────────────
function initDashboardAnimations() {
  // Donut arcs: start at 0, animate to target
  setTimeout(function() {
    document.querySelectorAll('.donut-arc').forEach(function(el) {
      var t = el.getAttribute('data-target');
      if (t) el.setAttribute('stroke-dasharray', t);
    });
  }, 80);

  // Count-up numbers
  document.querySelectorAll('[data-countup]').forEach(function(el) {
    var target = parseFloat(el.getAttribute('data-countup'));
    var suffix = el.getAttribute('data-suffix') || '';
    if (isNaN(target)) return;
    var duration = 900;
    var startTime = null;
    function step(ts) {
      if (!startTime) startTime = ts;
      var elapsed = ts - startTime;
      var progress = Math.min(elapsed / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      if (progress >= 1) {
        el.textContent = target + suffix;
      } else {
        el.textContent = Math.round(eased * target) + suffix;
        requestAnimationFrame(step);
      }
    }
    requestAnimationFrame(step);
  });
}

// ── Render Sales Analytics ─────────────────────────────────────────────────────
function renderSalesAnalytics(d, cfg) {
  var sp = d.salesperson_performance || [];
  var targeted = sp.filter(function(r) { return r.salesperson !== 'MGMT'; });
  var sortField = cfg.sortField || 'percentage_of_achievement';
  var sortDir = cfg.sortDir || 'desc';
  var totalQ = sp.reduce(function(s, r) { return s + r.total_quotations_submitted; }, 0);
  var totalC = sp.reduce(function(s, r) { return s + r.current_sales_achievement; }, 0);

  var augmented = targeted.map(function(r) {
    return Object.assign({}, r, {
      remaining_units: r.target_units_2026 !== null
        ? Math.max(0, (r.target_units_2026 || 0) - r.current_sales_achievement) : null,
    });
  });

  var sorted = augmented.slice().sort(function(a, b) {
    var av = a[sortField], bv = b[sortField];
    var inf = sortDir === 'asc' ? Infinity : -Infinity;
    if (av === null || av === undefined) av = inf;
    if (bv === null || bv === undefined) bv = inf;
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  var SORT_OPTS = [
    ['percentage_of_achievement', 'Achievement %'],
    ['current_sales_achievement', 'Units Achieved'],
    ['target_units_2026', 'Target Units'],
    ['remaining_units', 'Remaining Units'],
    ['total_quotations_submitted', 'Quotations'],
    ['salesperson', 'Salesperson Code'],
  ];

  var saSection = document.getElementById('sa-section');
  if (!saSection) return;

  saSection.innerHTML =
    buildExecutiveSummary(d, targeted, sp) +

    '<div class="exec-section-head" style="margin-top:8px">Sales Performance KPIs</div>' +
    buildExecKpiCards(d, targeted, sp) +

    '<div class="exec-section-head">Salesperson Progress</div>' +
    buildSpCircularCards(targeted) +

    '<div class="panel"><h3>Salesperson Comparison</h3>' + buildComparisonTable(sp) + '</div>' +

    '<div class="panel"><h3>Key Insights</h3>' + buildInsightsPanel(d, targeted, sp) + '</div>';

  // Quotations card click
  var quotCard = document.getElementById('exec-kpi-quot');
  if (quotCard) quotCard.addEventListener('click', function() {
    QuotationsState.filters.year = '2026';
    QuotationsState.page = 1;
    navigateTo('quotations');
  });

  // Delivered to Site card click — drill-down modal
  var deliveredCard = document.getElementById('exec-kpi-delivered');
  if (deliveredCard) deliveredCard.addEventListener('click', function() {
    _showDeliveryDrillModal(d);
  });

  // Handover Completed card click — drill-down modal
  var handoverCard = document.getElementById('exec-kpi-handover');
  if (handoverCard) handoverCard.addEventListener('click', function() {
    _showHandoverDrillModal(d);
  });

  initDashboardAnimations();
}

// ── Delivered to Site drill-down modal (2026-09-16) ───────────────────────────
async function _showDeliveryDrillModal(d) {
  var yr = String(new Date().getFullYear());
  openModal('<div style="padding:8px"><h3 style="margin:0 0 12px">🚚 Delivered to Site — ' + yr + '</h3><div style="color:#667">Loading…</div></div>');
  try {
    var data = await API.get('/api/contracts/delivery-drill?year=' + yr);
    var rows = data.rows || [];
    var missingMsg = (d.units_delivered_missing_date || 0) > 0
      ? '<div style="background:#fff8f0;border:1px solid #f59e0b;border-radius:6px;padding:8px 12px;margin-bottom:12px;font-size:13px">⚠️ <b>' + d.units_delivered_missing_date + ' contract(s)</b> marked Delivered but have no recorded delivery date — they are not shown below. Add the <b>Site Delivery Date</b> in the contract record to include them.</div>'
      : '';
    var tableHtml = rows.length === 0
      ? '<div class="empty-state">No deliveries recorded with actual delivery dates in ' + yr + '.</div>'
      : '<div style="overflow-x:auto;max-height:400px;overflow-y:auto"><table class="data-table" style="font-size:12px;min-width:100%">' +
        '<thead><tr><th>Contract Ref</th><th>Client</th><th>Emirate</th><th>Salesperson</th><th>Delivery Date</th><th>Units</th><th>Approval Date</th></tr></thead>' +
        '<tbody>' + rows.map(function(r) {
          return '<tr><td><b>' + esc(r.contract_ref || '') + '</b></td>' +
            '<td>' + esc(r.client_name || '') + '</td>' +
            '<td>' + esc(r.emirate || '') + '</td>' +
            '<td>' + esc(r.sales_by || '') + '</td>' +
            '<td>' + esc(r.actual_delivery_date || '') + '</td>' +
            '<td style="text-align:center"><b>' + (r.units || 1) + '</b></td>' +
            '<td style="color:#94a3b8">' + esc(r.approval_date || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    var content = '<div style="padding:8px">' +
      '<h3 style="margin:0 0 4px">🚚 Delivered to Site — ' + yr + '</h3>' +
      '<div style="font-size:13px;color:#667;margin-bottom:12px">YTD: <b>' + (d.units_delivered_2026 || 0) + ' units</b> &nbsp;|&nbsp; This month: <b>' + (d.units_delivered_this_month || 0) + ' units</b></div>' +
      missingMsg + tableHtml + '</div>';
    openModal(content);
  } catch(e) {
    openModal('<div style="padding:12px;color:red">Error loading delivery data: ' + esc(e.message || String(e)) + '</div>');
  }
}

// ── Handover Completed drill-down modal (2026-09-16) ──────────────────────────
async function _showHandoverDrillModal(d) {
  var yr = String(new Date().getFullYear());
  openModal('<div style="padding:8px"><h3 style="margin:0 0 12px">🏁 Handover Completed — ' + yr + '</h3><div style="color:#667">Loading…</div></div>');
  try {
    var data = await API.get('/api/contracts/handover-drill?year=' + yr);
    var rows = data.rows || [];
    var tableHtml = rows.length === 0
      ? '<div class="empty-state">No handovers recorded in ' + yr + '.</div>'
      : '<div style="overflow-x:auto;max-height:400px;overflow-y:auto"><table class="data-table" style="font-size:12px;min-width:100%">' +
        '<thead><tr><th>Contract Ref</th><th>Client</th><th>Emirate</th><th>Salesperson</th><th>Handover Date</th><th>Units</th><th>M Status</th><th>E Status</th></tr></thead>' +
        '<tbody>' + rows.map(function(r) {
          return '<tr><td><b>' + esc(r.contract_ref || '') + '</b></td>' +
            '<td>' + esc(r.client_name || '') + '</td>' +
            '<td>' + esc(r.emirate || '') + '</td>' +
            '<td>' + esc(r.sales_by || '') + '</td>' +
            '<td>' + esc(r.handover_date || '') + '</td>' +
            '<td style="text-align:center"><b>' + (r.units || 1) + '</b></td>' +
            '<td>' + esc(r.mechanical_status || '') + '</td>' +
            '<td>' + esc(r.electrical_status || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    var content = '<div style="padding:8px">' +
      '<h3 style="margin:0 0 4px">🏁 Handover Completed — ' + yr + '</h3>' +
      '<div style="font-size:13px;color:#667;margin-bottom:12px">YTD: <b>' + (d.handover_units_ytd || 0) + ' units</b> across <b>' + (d.handover_projects_ytd || 0) + ' projects</b></div>' +
      tableHtml + '</div>';
    openModal(content);
  } catch(e) {
    openModal('<div style="padding:12px;color:red">Error loading handover data: ' + esc(e.message || String(e)) + '</div>');
  }
}

// ── Monthly Charts ─────────────────────────────────────────────────────────────
function renderMonthlySections(d) {
  var sp = d.salesperson_performance || [];
  var monthly = d.monthly_sales_2026 || [];
  var monthlyQ = d.monthly_quotations_2026 || [];

  var chart6 = svgBarChart({
    categories: monthlyQ.map(function(m) { return m.month.slice(5); }),
    series: [{ name: 'Quotations Submitted', color: '#AFC6D9', values: monthlyQ.map(function(m) { return m.total; }) }],
  });

  var spOpts = ['total'].concat(SALESPERSON_CODES_FALLBACK(sp)).map(function(code) {
    return '<option value="' + code + '">' + (code === 'total' ? 'All Salespeople' : (SP_LABELS[code] || code)) + '</option>';
  }).join('');

  var sec = document.getElementById('monthly-section');
  if (!sec) return;

  sec.innerHTML =
    '<div class="panel" style="margin-bottom:16px">' +
    '<div class="sa-header">' +
    '<h3 style="margin:0">Monthly Sales Trend — 2026</h3>' +
    '<div style="display:flex;align-items:center;gap:8px">' +
    '<div class="sa-controls"><label class="sa-ctrl-label">Salesperson:</label>' +
    '<select id="monthly-sp-filter" class="sa-select">' + spOpts + '</select></div>' +
    '<button id="dash-zoom-sales" title="Presentation View" style="background:#f4f7fb;border:1px solid #c8d6e5;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:14px;line-height:1">⛶</button>' +
    '</div></div>' +
    '<div id="monthly-chart-holder"></div>' +
    '<div class="meta">Monthly contracts confirmed, 2026.</div>' +
    '</div>' +
    '<div class="panel">' +
    '<div class="sa-header">' +
    '<h3 style="margin:0">Monthly Quotations — 2026</h3>' +
    '<button id="dash-zoom-quot" title="Presentation View" style="background:#f4f7fb;border:1px solid #c8d6e5;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:14px;line-height:1">⛶</button>' +
    '</div>' +
    chart6 + chartLegend([{ name: 'Quotations Submitted', color: '#AFC6D9' }]) +
    '<div class="meta">Quotations submitted per month in 2026.</div>' +
    '</div>';

  function renderMonthlyChart(code) {
    var holder = document.getElementById('monthly-chart-holder');
    if (holder) holder.innerHTML = buildLineChart(monthly, code);
  }
  renderMonthlyChart('total');
  var spFil = document.getElementById('monthly-sp-filter');
  if (spFil) spFil.addEventListener('change', function(e) { renderMonthlyChart(e.target.value); });

  var salesZoom = document.getElementById('dash-zoom-sales');
  if (salesZoom) salesZoom.addEventListener('click', function() {
    var code = spFil ? spFil.value : 'total';
    var spName = code === 'total' ? 'All Salespeople' : (SP_LABELS[code] || code);
    _dashOpenPresentation('Monthly Sales Trend — 2026 · ' + spName, function(bodyEl) {
      bodyEl.style.overflow = 'auto';
      bodyEl.innerHTML = '<div style="width:100%;min-height:280px">' + buildLineChart(monthly, code) + '</div>';
    });
  });

  var quotZoom = document.getElementById('dash-zoom-quot');
  if (quotZoom) quotZoom.addEventListener('click', function() {
    _dashOpenPresentation('Monthly Quotations — 2026', function(bodyEl) {
      bodyEl.style.overflow = 'auto';
      bodyEl.innerHTML = '<div style="width:100%;min-height:280px">' + svgBarChart({
        categories: monthlyQ.map(function(m) { return m.month.slice(5); }),
        series: [{ name: 'Quotations Submitted', color: '#AFC6D9', values: monthlyQ.map(function(m) { return m.total; }) }],
        height: 340,
      }) + '</div>';
    });
  });
}

// ── Project Status drill-down modal ───────────────────────────────────────────
async function _showProjectStatusDrillModal(year, mo, series, monthLabel, seriesLabel) {
  openModal('<div style="padding:8px"><h3 style="margin:0 0 12px">📊 ' + esc(seriesLabel) + ' — ' + esc(monthLabel) + ' ' + year + '</h3><div style="color:#667">Loading…</div></div>');
  try {
    var data = await API.get('/api/dashboard/project-status/detail?year=' + year + '&month=' + mo + '&series=' + encodeURIComponent(series));
    var rows = data.rows || [];
    var colMap = {
      sales:      ['Contract Ref','Client','Emirate','Salesperson','Approval Date','Units','Status'],
      production: ['Contract Ref','Client','Emirate','Order Date','Units','Status'],
      delivery:   ['Contract Ref','Client','Emirate','Delivery Date','Units'],
      handover:   ['Contract Ref','Client','Emirate','Salesperson','Handover Date','Units','M.Status','E.Status'],
    };
    var rowFnMap = {
      sales:      function(r) { return '<tr><td><b>' + esc(r.contract_ref||'') + '</b></td><td>' + esc(r.client_name||'') + '</td><td>' + esc(r.emirate||'') + '</td><td>' + esc(r.sales_by||'') + '</td><td>' + esc(r.approval_date||'') + '</td><td style="text-align:center"><b>' + (r.units||1) + '</b></td><td>' + esc(r.delivery_status||'') + '</td></tr>'; },
      production: function(r) { return '<tr><td><b>' + esc(r.contract_ref||'') + '</b></td><td>' + esc(r.client_name||'') + '</td><td>' + esc(r.emirate||'') + '</td><td>' + esc(r.order_date||'') + '</td><td style="text-align:center"><b>' + (r.units||1) + '</b></td><td>' + esc(r.delivery_status||'') + '</td></tr>'; },
      delivery:   function(r) { return '<tr><td><b>' + esc(r.contract_ref||'') + '</b></td><td>' + esc(r.client_name||'') + '</td><td>' + esc(r.emirate||'') + '</td><td>' + esc(r.delivery_date||'') + '</td><td style="text-align:center"><b>' + (r.units||1) + '</b></td></tr>'; },
      handover:   function(r) { return '<tr><td><b>' + esc(r.contract_ref||'') + '</b></td><td>' + esc(r.client_name||'') + '</td><td>' + esc(r.emirate||'') + '</td><td>' + esc(r.sales_by||'') + '</td><td>' + esc(r.handover_date||'') + '</td><td style="text-align:center"><b>' + (r.units||1) + '</b></td><td>' + esc(r.mechanical_status||'') + '</td><td>' + esc(r.electrical_status||'') + '</td></tr>'; },
    };
    var cols = colMap[series] || [];
    var rowFn = rowFnMap[series] || function(r) { return '<tr><td colspan="5">' + esc(JSON.stringify(r)) + '</td></tr>'; };
    var totalUnits = rows.reduce(function(s, r) { return s + (r.units||1); }, 0);
    var tableHtml = rows.length === 0
      ? '<div class="empty-state">No ' + esc(seriesLabel) + ' records for ' + esc(monthLabel) + ' ' + year + '.</div>'
      : '<div style="overflow-x:auto;max-height:420px;overflow-y:auto"><table class="data-table" style="font-size:12px;min-width:100%">' +
        '<thead><tr>' + cols.map(function(c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead>' +
        '<tbody>' + rows.map(rowFn).join('') + '</tbody></table></div>';
    openModal('<div style="padding:8px">' +
      '<h3 style="margin:0 0 4px">📊 ' + esc(seriesLabel) + ' — ' + esc(monthLabel) + ' ' + year + '</h3>' +
      '<div style="font-size:13px;color:#667;margin-bottom:12px"><b>' + rows.length + ' project' + (rows.length !== 1 ? 's' : '') + '</b> · <b>' + totalUnits + ' unit' + (totalUnits !== 1 ? 's' : '') + '</b></div>' +
      tableHtml + '</div>');
  } catch(e) {
    openModal('<div style="padding:12px;color:red">Error loading detail: ' + esc(e.message || String(e)) + '</div>');
  }
}

// ── Project Status — 2026 (full-width Chart.js grouped bar) ──────────────────
async function renderProjectStatusSection() {
  var sec = document.getElementById('project-status-section');
  if (!sec) return;
  sec.innerHTML = '<div class="panel" style="min-height:160px"><div class="empty-state">Loading Project Status…</div></div>';

  // Load Chart.js (dynamic inject, same as maintenance dashboard pattern).
  // Must complete before the canvas is in the DOM to avoid timing races.
  try {
    await _dashLoadChartJs();
  } catch(e) {
    sec.innerHTML = '<div class="panel"><div class="empty-state" style="color:#c85a3a">Unable to load chart library. Check your internet connection and <button onclick="renderProjectStatusSection()" style="background:none;border:none;color:#0F4C81;cursor:pointer;text-decoration:underline;padding:0">retry</button>.</div></div>';
    return;
  }

  var psData;
  try {
    psData = await API.get('/api/dashboard/project-status?year=2026');
  } catch(e) {
    sec.innerHTML = '<div class="panel"><div class="empty-state" style="color:#c85a3a">Unable to load Project Status data. <button onclick="renderProjectStatusSection()" style="background:none;border:none;color:#0F4C81;cursor:pointer;text-decoration:underline;padding:0">Retry</button></div></div>';
    return;
  }
  var months = psData.months || [];
  var labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var seriesCfg = [
    { key: 'sales',      label: 'Sales Confirmed',   color: '#0F4C81' },
    { key: 'production', label: 'Production Started', color: '#16877A' },
    { key: 'delivery',   label: 'Delivered to Site',  color: '#16875B' },
    { key: 'handover',   label: 'Handover Completed', color: '#C58A1A' },
  ];
  _dashProjChartCfg = {
    type: 'bar',
    data: {
      labels: labels,
      datasets: seriesCfg.map(function(s) {
        return {
          label: s.label,
          data: months.map(function(m) { return m[s.key] || 0; }),
          backgroundColor: s.color,
          borderRadius: 3,
          borderSkipped: false,
        };
      }),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { padding: 16, font: { size: 12 } } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 }, grid: { color: '#e8eef3' } },
      },
      onClick: function(evt, elements) {
        if (!elements || !elements.length) return;
        var di = elements[0].datasetIndex;
        var mi = elements[0].index;
        var sk = seriesCfg[di];
        var mo = String(mi + 1).padStart(2, '0');
        _showProjectStatusDrillModal(2026, mo, sk.key, labels[mi], sk.label);
      },
    },
  };
  sec.innerHTML =
    '<div class="panel">' +
    '<div class="sa-header">' +
    '<div>' +
    '<h3 style="margin:0 0 2px">Project Status — 2026</h3>' +
    '<div style="font-size:12px;color:#94a3b8;margin-top:2px">Unit-based lifecycle milestones · click any bar to drill down</div>' +
    '</div>' +
    '<button id="dash-zoom-proj" title="Presentation View" style="background:#f4f7fb;border:1px solid #c8d6e5;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:14px;line-height:1">⛶</button>' +
    '</div>' +
    '<div style="position:relative;height:380px;width:100%;margin-top:12px"><canvas id="dash-proj-canvas"></canvas></div>' +
    '<div class="meta" style="margin-top:10px">Sales: contract approval date · Production: factory order date · Delivery: actual site delivery date · Handover: project T&amp;C handover date. Shipping &amp; Installation excluded — no milestone date in schema.</div>' +
    '</div>';
  // Chart.js is guaranteed loaded by the await above. Create chart immediately after DOM update.
  requestAnimationFrame(function() {
    var canvas = document.getElementById('dash-proj-canvas');
    if (!canvas) return;
    // Destroy any previous instance on this canvas to prevent "Canvas is already in use" error.
    var existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
    new Chart(canvas.getContext('2d'), _dashProjChartCfg);
  });
  var projZoom = document.getElementById('dash-zoom-proj');
  if (projZoom) projZoom.addEventListener('click', function() {
    _dashOpenPresentation('Project Status — 2026', function(bodyEl) {
      if (!_dashProjChartCfg || !window.Chart) {
        bodyEl.innerHTML = '<div class="empty-state">Chart not available.</div>';
        return;
      }
      var canvas = document.createElement('canvas');
      canvas.style.cssText = 'flex:1;min-height:0;width:100%;';
      bodyEl.appendChild(canvas);
      var presOpts = JSON.parse(JSON.stringify(_dashProjChartCfg.options));
      presOpts.maintainAspectRatio = false;
      presOpts.onClick = undefined;
      if (presOpts.plugins && presOpts.plugins.legend) presOpts.plugins.legend.labels = { padding: 20, font: { size: 14 } };
      if (presOpts.scales) {
        if (presOpts.scales.x) presOpts.scales.x.ticks = { font: { size: 13 } };
        if (presOpts.scales.y) presOpts.scales.y.ticks = { stepSize: 1, precision: 0, font: { size: 13 } };
      }
      requestAnimationFrame(function() {
        var existing = Chart.getChart(canvas);
        if (existing) existing.destroy();
        new Chart(canvas.getContext('2d'), { type: _dashProjChartCfg.type, data: _dashProjChartCfg.data, options: presOpts });
      });
    });
  });
}

// ── Main entry point ───────────────────────────────────────────────────────────
async function renderDashboard(root) {
  root.innerHTML = '<div class="empty-state" style="padding:56px 0">Loading dashboard…</div>';
  let d;
  try {
    d = await API.get('/api/dashboard/summary');
  } catch (err) {
    root.innerHTML = '<div class="empty-state" style="color:#c85a3a;padding:56px 0">Unable to load dashboard data. Please refresh the page.</div>';
    return;
  }

  // 2026-10-03 modern dashboard: KPI cards (existing /api/dashboard/summary values only),
  // Quick Actions (by permission), Upcoming Alerts (Alerts & Notifications queue) and
  // Recent Activity (audit log). Existing analytics sections follow unchanged.
  const overAchieved = d.balance_units_2026 < 0;
  const can = k => (typeof navAllowed === 'function' ? navAllowed({ key: k }) : true);
  const num = v => (v === undefined || v === null ? 0 : Number(v).toLocaleString('en-US'));
  const kpis = [
    { icon: 'file-text',  tone: '#0e8a9a', val: num(d.quotations_2026), label: 'Quotations 2026', sub: 'By Quotation Date', go: 'quotations' },
    { icon: 'handshake',  tone: '#16875b', val: num(d.total_sales_active), label: 'Active Contracts',
      sub: `${num(d.total_sales)} all-time · ${num(d.total_sales_cancelled)} cancelled`, go: 'contracts' },
    { icon: 'trending-up', tone: '#2563eb', val: num(d.total_sales_units_2026), label: 'Sales Units 2026',
      sub: d.sales_target_2026 ? `Target ${num(d.sales_target_2026)} · ${d.achievement_pct}% achieved` : '' },
    { icon: overAchieved ? 'award' : 'target', tone: overAchieved || d.balance_units_2026 === 0 ? '#16875b' : '#b7791f',
      val: num(Math.abs(d.balance_units_2026)), label: overAchieved ? 'Over Target 2026' : 'Balance Units 2026', sub: 'Units vs 2026 target' },
    { icon: 'truck',      tone: '#7c3aed', val: num(d.units_delivered_2026), label: 'Units Delivered 2026', sub: `${num(d.units_in_production_2026)} in production` },
    { icon: 'key-round',  tone: '#d9730d', val: num(d.handover_units_ytd), label: 'Handover Units YTD', sub: `${num(d.handover_projects_ytd)} project(s)` },
  ];
  const QA = [
    { key: 'quotations', icon: 'file-plus', label: 'Add Quotation', btn: 'qf-add', before: () => { QuotationsState.view = 'register'; } },
    { key: 'contracts', icon: 'file-signature', label: 'New Contract', btn: 'cf-add', before: () => { ContractsState.sub = 'list'; } },
    { key: 'maintenance_contracts', icon: 'wrench', label: 'Add Maintenance', btn: 'mf-add', before: () => { MaintContractsState.tab = 'records'; } },
    { key: 'factory', icon: 'package-plus', label: 'New Factory Order', btn: 'factory-add-new', before: () => { FactoryState.sheet = 'ins-quotes'; } },
    { key: 'reports', icon: 'bar-chart-3', label: 'View Reports' },
    { key: 'backup', icon: 'database-backup', label: 'System Backup' },
  ].filter(a => can(a.key));

  root.innerHTML =
    '<div class="dash-kpi-grid">' + kpis.map((k, i) =>
      `<div class="dash-kpi ${k.go ? 'clickable' : ''}" data-kpi="${i}" style="--kpi-tone:${k.tone}">
         <span class="dash-kpi-icon"><i data-lucide="${k.icon}" aria-hidden="true"></i></span>
         <div class="dash-kpi-body"><div class="dash-kpi-val">${k.val}</div><div class="dash-kpi-label">${esc(k.label)}</div>
         ${k.sub ? `<div class="dash-kpi-sub">${esc(k.sub)}</div>` : ''}</div></div>`).join('') + '</div>' +
    (QA.length ? '<div class="dash-card dash-qa"><div class="dash-card-title">Quick Actions</div><div class="dash-qa-row">' +
      QA.map((a, i) => `<button type="button" class="dash-qa-btn" data-qa="${i}"><i data-lucide="${a.icon}" aria-hidden="true"></i><span>${esc(a.label)}</span></button>`).join('') +
      '</div></div>' : '') +
    '<div class="dash-two-col">' +
      (can('alerts') ? '<div class="dash-card"><div class="dash-card-title">Upcoming Alerts <a href="#" class="dash-link" id="dash-alerts-all">View all</a></div><div id="dash-alerts"><div class="dash-muted">Loading…</div></div></div>' : '') +
      '<div class="dash-card"><div class="dash-card-title">Recent Activity</div><div id="dash-activity"><div class="dash-muted">Loading…</div></div></div>' +
    '</div>' +
    '<div id="sa-section"></div>' +
    '<div id="project-status-section" style="margin-top:0"></div>' +
    '<div id="monthly-section"></div>';
  if (typeof renderIcons === 'function') renderIcons();

  root.querySelectorAll('[data-kpi]').forEach(el => el.addEventListener('click', () => {
    const k = kpis[Number(el.dataset.kpi)]; if (!k.go) return;
    if (k.go === 'quotations') { QuotationsState.filters.year = '2026'; QuotationsState.page = 1; QuotationsState.view = 'register'; }
    navigateTo(k.go);
  }));
  root.querySelectorAll('[data-qa]').forEach(el => el.addEventListener('click', async () => {
    const a = QA[Number(el.dataset.qa)];
    if (a.before) a.before();
    await navigateTo(a.key);
    if (a.btn) { const b = document.getElementById(a.btn); if (b) b.click(); else toast('Your role cannot create records in this module.', true); }
  }));
  const allLink = document.getElementById('dash-alerts-all');
  if (allLink) allLink.addEventListener('click', e => { e.preventDefault(); navigateTo('alerts'); });

  // Upcoming Alerts — Alerts & Notifications → Expiring Contracts (action-required AMC queue)
  if (can('alerts')) API.get('/api/alerts/expiring-contracts').then(a => {
    const box = document.getElementById('dash-alerts'); if (!box) return;
    const rows = (a.rows || []).slice().sort((x, y) => (x.days_remaining ?? 99999) - (y.days_remaining ?? 99999)).slice(0, 6);
    const tone = r => r.alert_level === 'expired' ? '#c43d3d' : ['within-7', 'within-15'].includes(r.alert_level) ? '#d9730d' : '#b7791f';
    const when = r => r.days_remaining == null ? '' : r.days_remaining < 0 ? `Expired ${Math.abs(r.days_remaining)}d ago` : r.days_remaining === 0 ? 'Expires today' : `Expires in ${r.days_remaining}d`;
    box.innerHTML = rows.length ? `<div class="dash-list">${rows.map(r => `<div class="dash-li">
        <span class="dash-dot" style="background:${tone(r)}"></span>
        <div class="dash-li-main"><div class="dash-li-title">${esc(r.contract_ref || '')} — ${esc(r.client_name || '')}</div>
        <div class="dash-li-sub">${esc(r.action_reason || (r.action_reasons || [])[0] || 'Action required')}</div></div>
        <div class="dash-li-meta">${esc(when(r))}</div></div>`).join('')}</div>
        <div class="dash-muted" style="margin-top:6px">${(a.summary && a.summary.total) || rows.length} AMC item(s) need action in total</div>`
      : '<div class="dash-muted">No AMC alerts need action.</div>';
  }).catch(() => { const box = document.getElementById('dash-alerts'); if (box) box.innerHTML = '<div class="dash-muted">Alerts unavailable.</div>'; });

  // Recent Activity — audit log (business modules the role can access)
  API.get('/api/dashboard/recent-activity?limit=8').then(a => {
    const box = document.getElementById('dash-activity'); if (!box) return;
    const ago = t => { const d0 = new Date(String(t).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? '' : 'Z')); const m = Math.round((Date.now() - d0) / 60000);
      return isNaN(m) ? '' : m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
    box.innerHTML = (a.rows || []).length ? `<div class="dash-list">${a.rows.map(r => `<div class="dash-li">
        <span class="dash-dot" style="background:#94a3b8"></span>
        <div class="dash-li-main"><div class="dash-li-title">${esc(r.verb)} · ${esc(r.record_ref || r.source || '')}</div>
        <div class="dash-li-sub">${esc(r.module_label)} · by ${esc(r.performed_by || 'system')}</div></div>
        <div class="dash-li-meta">${esc(ago(r.performed_at))}</div></div>`).join('')}</div>`
      : '<div class="dash-muted">No recent activity.</div>';
  }).catch(() => { const box = document.getElementById('dash-activity'); if (box) box.innerHTML = '<div class="dash-muted">Activity unavailable.</div>'; });

  renderSalesAnalytics(d, { sortField: 'percentage_of_achievement', sortDir: 'desc' });
  renderProjectStatusSection();
  renderMonthlySections(d);
}

function SALESPERSON_CODES_FALLBACK(sp) {
  return sp.map(function(r) { return r.salesperson; });
}
