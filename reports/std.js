'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// reports/std.js — STANDARD REPORT TEMPLATE + consolidated report builders
// (Reports & Analytics consolidation, 2026-09-30)
//
// Every standard report returns ONE shape, rendered by one frontend template and
// one Excel / PDF / Print pipeline:
//
//   { std:true, report_type, title, description, metric,
//     kpis[]        executive KPI cards  { label, value, display, unit, sub, tone }
//     chart         ONE primary chart    { title, subtitle, labels, datasets[], drill:'month' }
//     month_table   exact values behind the chart
//     breakdowns[]  secondary analysis   { title, columns, rows, drill_param }
//     notes[]       data-quality notes   { text, columns, rows }
//     register_title + columns + rows    detailed register (the ONLY paginated part)
//     scope_total   primary-metric total for the filtered scope (drill-down reconciliation)
//     subtitle_lines / pre_sections / main_title   → Excel / PDF (same dataset) }
//
// RULES: one filtered population per report drives KPIs, chart, breakdowns,
// register and exports; KPI/chart totals never come from the visible page;
// units are elevator units (never row counts); currencies are never added
// together; business dates only (never created_at / updated_at).
// ══════════════════════════════════════════════════════════════════════════════
const { all, get } = require('../db/db.js');
const M = require('./metrics.js');
const { getMonthlyMaintenanceMetrics } = require('../db/maintMetrics.js');
const { currentEndSql, currentStartSql, mcNotCancelledSql, renewalInProgressSql } = require('../db/amcEligibility.js');

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const COLORS = { blue: '#2563ad', teal: '#0e7e6e', green: '#1e8449', amber: '#d97706', red: '#c0392b', purple: '#7c3aed', grey: '#94a3b8', sky: '#0ea5e9' };

// ── Shared helpers ────────────────────────────────────────────────────────────
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const money = (n, cur) => `${cur ? cur + ' ' : ''}${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = n => (Number(n) || 0).toLocaleString('en-US');
function yearOf(f) { return String(parseInt(f.year, 10) || new Date().getFullYear()); }
function monthOf(f) {
  if (!f.month) return null;
  const s = String(f.month);
  const m = parseInt(s.includes('-') ? s.split('-').pop() : s, 10);
  return m >= 1 && m <= 12 ? m : null;
}
const scopeLabel = (y, m) => m ? `${MONTH[m - 1]} ${y}` : `YTD ${y}`;
const monthIdx = d => d && /^\d{4}-\d{2}/.test(d) ? parseInt(String(d).slice(5, 7), 10) : null;

function kpi(label, value, o = {}) {
  let display;
  if (o.fmt === 'money') display = money(value, o.cur);
  else if (o.fmt === 'pct') display = `${value == null ? '—' : value}${value == null ? '' : '%'}`;
  else if (typeof value === 'number') display = num(value);
  else display = value == null || value === '' ? '—' : String(value);
  return { label, value, display, unit: o.unit || '', sub: o.sub || '', tone: o.tone || '' };
}

/** 12 monthly buckets for records. vals: { key: record => number } */
function monthBuckets(records, monthFn, vals) {
  const b = MON.map((label, i) => {
    const o = { month_num: i + 1, label, name: MONTH[i] };
    Object.keys(vals).forEach(k => { o[k] = 0; });
    return o;
  });
  for (const r of records) {
    const m = monthFn(r);
    if (!m) continue;
    for (const [k, fn] of Object.entries(vals)) b[m - 1][k] = r2(b[m - 1][k] + (Number(fn(r)) || 0));
  }
  return b;
}

/** Group records by a key → [{ name, <sums> }] sorted by the first sum desc. */
function groupBy(records, keyFn, vals) {
  const m = new Map();
  for (const r of records) {
    const k = String(keyFn(r) == null || keyFn(r) === '' ? 'Not set' : keyFn(r)).trim() || 'Not set';
    if (!m.has(k)) { const o = { name: k }; Object.keys(vals).forEach(x => { o[x] = 0; }); m.set(k, o); }
    const o = m.get(k);
    for (const [x, fn] of Object.entries(vals)) o[x] = r2(o[x] + (Number(fn(r)) || 0));
  }
  const first = Object.keys(vals)[0];
  return [...m.values()].sort((a, b) => b[first] - a[first] || a.name.localeCompare(b.name));
}

function sortRecords(rows, f, map, defKey, defDir = 'desc') {
  const key = map[f.sort_by] || map[defKey] || defKey;
  const dir = String(f.sort_dir || defDir).toLowerCase() === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    const c = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x == null ? '' : x).localeCompare(String(y == null ? '' : y));
    return (c || String(a.contract_ref || a.id || '').localeCompare(String(b.contract_ref || b.id || ''))) * dir;
  });
}

const FILTER_LABELS = { year: 'Year', month: 'Month', salesperson: 'Salesperson', emirate: 'Emirate', project_status: 'Project Status',
  status: 'Status', search: 'Search', maintenance_type: 'Maintenance Type', renewal_status: 'AMC Status', payment_status: 'Payment Status',
  shipping_status: 'Shipping Status', delivery_status: 'Delivery Status', factory_table: 'Source', payment_type: 'Payment Type',
  priority: 'Priority', complaint_type: 'Complaint Type', production_status: 'Production Status', factory_delivery_status: 'Factory Status',
  cancellation_type: 'Cancellation Type', refund_status: 'Refund Status', view_mode: 'View', supplier: 'Supplier', show_cancelled: 'Orders' };
function filterLine(f) {
  const bits = Object.entries(FILTER_LABELS).filter(([k]) => f[k]).map(([k, l]) => `${l}: ${k === 'month' && monthOf(f) ? MONTH[monthOf(f) - 1] : f[k]}`);
  return bits.length ? `Filters: ${bits.join(' · ')}` : 'Filters: none';
}

/**
 * Assemble the standard response (pagination only touches the register rows).
 * registerRows = full, already-sorted array of arrays.
 */
function stdOut(o, f) {
  const pageSize = Math.min(9999, Math.max(1, parseInt(f.page_size || '50', 10)));
  const page = Math.max(1, parseInt(f.page || '1', 10));
  const all_ = o.registerRows || [];
  const paged = all_.slice((page - 1) * pageSize, page * pageSize);
  const pre = [];
  if (o.kpis && o.kpis.length) pre.push({ title: 'Summary', columns: ['Metric', 'Value'],
    rows: o.kpis.map(k => [k.label, `${k.display}${k.unit ? ' ' + k.unit : ''}`]) });
  if (o.month_table) pre.push({ title: o.month_table.title, columns: o.month_table.columns, rows: o.month_table.rows.concat(o.month_table.total ? [o.month_table.total] : []) });
  (o.breakdowns || []).forEach(b => pre.push({ title: b.title, columns: b.columns, rows: b.rows }));
  (o.notes || []).filter(n => n.rows && n.rows.length).forEach(n => pre.push({ title: `Data quality — ${n.title || n.text}`, columns: n.columns, rows: n.rows }));
  return {
    std: true,
    report_type: o.type, title: o.title, description: o.description, metric: o.metric || '',
    year: o.year || null, month: o.month || null,
    kpis: o.kpis || [], chart: o.chart || null, month_table: o.month_table || null,
    breakdowns: o.breakdowns || [], notes: o.notes || [],
    register_title: o.register_title || 'Detailed Register',
    columns: o.columns, rows: paged, total: all_.length, page, pageSize, page_size: pageSize,
    scope_total: o.scope_total != null ? o.scope_total : null,
    summary: o.summary || {},
    subtitle_lines: [o.description, filterLine(f)].filter(Boolean),
    pre_sections: pre,
    main_title: o.register_title || 'Detailed Register',
    ...(o.extra || {}),
  };
}

/** Standard month table + trend chart for a unit-based milestone population. */
function unitTrend(yearRecs, y, m, noun, extraVals = {}, opts = {}) {
  const buckets = monthBuckets(yearRecs, r => monthIdx(r.milestone_date), { projects: () => 1, units: r => r.units, ...extraVals });
  let cum = 0;
  buckets.forEach(b => { cum += b.units; b.cumulative_units = cum; if (!opts.noAvgPerProject) b.avg_units_per_project = b.projects ? r2(b.units / b.projects) : 0; });
  const yearUnits = cum;
  buckets.forEach(b => { b.pct_of_ytd = yearUnits ? Math.round(b.units / yearUnits * 1000) / 10 : 0; });
  const chart = {
    title: `Monthly ${noun} Trend — ${y}`,
    subtitle: `Elevator units per month (bars) and cumulative units (line)${m ? ` · ${MONTH[m - 1]} highlighted` : ''}`,
    labels: MON, highlight: m ? m - 1 : null, drill: 'month',
    datasets: [
      { label: `${noun} Units`, data: buckets.map(b => b.units), type: 'bar', axis: 'y', color: COLORS.blue },
      { label: 'Cumulative Units', data: buckets.map(b => b.cumulative_units), type: 'line', axis: 'y1', color: COLORS.teal },
    ],
    y_title: 'Units / month', y1_title: 'Cumulative units',
  };
  // 2026-10-03: Delivery omits Avg Units / Project (opts.noAvgPerProject); Sales / Handover keep it
  const avg = !opts.noAvgPerProject;
  const month_table = {
    title: `Month-wise ${noun} Summary — ${y}`,
    columns: ['Month', 'Projects', 'Units', ...(avg ? ['Avg Units / Project'] : []), '% of Year Units', 'Cumulative Units'],
    rows: buckets.map(b => [b.name, b.projects, b.units, ...(avg ? [b.avg_units_per_project] : []), `${b.pct_of_ytd}%`, b.cumulative_units]),
    total: [`Total ${y}`, yearRecs.length, yearUnits, ...(avg ? [yearRecs.length ? r2(yearUnits / yearRecs.length) : 0] : []), yearUnits ? '100%' : '0%', yearUnits],
    highlight: m ? m - 1 : null, drill: 'month',
  };
  return { buckets, yearUnits, chart, month_table };
}

function dimBreakdown(title, scope, keyFn, colLabel, drillParam, withValue) {
  const vals = { units: r => r.units, projects: () => 1 };
  if (withValue) vals.value = r => r.contract_value;
  const g = groupBy(scope, keyFn, vals);
  const tot = g.reduce((s, x) => s + x.units, 0);
  const columns = [colLabel, 'Projects', 'Units', '% of Units'].concat(withValue ? ['Contract Value (AED)'] : []);
  return { title, columns, drill_param: drillParam,
    rows: g.map(x => [x.name, x.projects, x.units, `${tot ? Math.round(x.units / tot * 1000) / 10 : 0}%`].concat(withValue ? [money(x.value)] : [])) };
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTRACTS — milestone reports (Monthly Sales, Delivery, Handover)
// ══════════════════════════════════════════════════════════════════════════════
const MILESTONES = {
  'monthly-sales': { col: 'approval_date', noun: 'Sales', title: 'Monthly Sales Report', dateLabel: 'Approval Date',
    description: 'Confirmed contract units and projects by Approval Date', withValue: true },
  'delivery-report': { col: 'delivery_date', noun: 'Delivery', title: 'Delivery Report', dateLabel: 'Delivery Date',
    description: 'Delivered elevator units and projects by actual Delivery Date', noAvgPerProject: true, dq: ['delivery_status', 'Delivered', 'Delivered (legacy status) — no Delivery Date'] },
  'handover-report': { col: 'handover_date', noun: 'Handover', title: 'Handover Report', dateLabel: 'Handover Date',
    description: 'Elevator units handed over by actual Handover Date' },
};

function buildMilestoneReport(type, f) {
  const cfg = MILESTONES[type];
  const y = yearOf(f), m = monthOf(f);
  const dims = { salesperson: f.salesperson, emirate: f.emirate, project_status: f.project_status, search: f.search };
  const yearRecs = M.contractMilestoneRows(cfg.col, { year: y }, dims);
  const scope = m ? yearRecs.filter(r => monthIdx(r.milestone_date) === m) : yearRecs;
  const { buckets, yearUnits, chart, month_table } = unitTrend(yearRecs, y, m, cfg.noun, cfg.withValue ? { value: r => r.contract_value } : {}, { noAvgPerProject: cfg.noAvgPerProject });
  const units = M.sumUnits(scope);
  const active = buckets.filter(b => b.units > 0);
  const latest = [...buckets].reverse().find(b => b.units > 0);
  const sl = scopeLabel(y, m);
  const kpis = [
    kpi(`${cfg.noun} Units — ${sl}`, units, { unit: 'Units', tone: 'green' }),
    kpi(`Projects — ${sl}`, scope.length, { unit: 'Projects', tone: 'blue' }),
    ...(cfg.noAvgPerProject ? [] : [kpi('Avg Units / Project', scope.length ? r2(units / scope.length) : 0, { sub: 'units ÷ projects', tone: 'purple' })]),
    kpi('Avg Units / Active Month', active.length ? Math.round(yearUnits / active.length * 10) / 10 : 0, { sub: `${y} units ÷ ${active.length} active month(s)`, tone: 'amber' }),
    kpi(`Latest ${cfg.noun} Month`, latest ? `${latest.name} ${y}` : '—', { tone: 'teal' }),
  ];
  if (cfg.withValue) {
    const byCur = M.byCurrency(scope, 'contract_value', 'currency_code');
    Object.entries(byCur).forEach(([c, v]) => kpis.splice(2, 0, kpi(`Contract Value (${c})`, v, { fmt: 'money', cur: c, tone: 'blue' })));
  }
  const breakdowns = [
    dimBreakdown(`${cfg.noun} by Emirate — ${sl}`, scope, r => r.emirate, 'Emirate', 'emirate', cfg.withValue),
    dimBreakdown(`${cfg.noun} by Salesperson — ${sl}`, scope, r => r.sales_by, 'Salesperson', 'salesperson', cfg.withValue),
  ];
  const notes = [];
  let missing = [];
  if (type === 'handover-report') {
    const p = [];
    const w = ['c.is_deleted = 0', "(c.handover_date IS NULL OR c.handover_date = '')", "c.mechanical_status = 'Completed'",
      "c.electrical_status = 'Completed'", "COALESCE(c.project_status,'Active') <> 'Cancelled'", ...M.contractFilterSql({ salesperson: f.salesperson, emirate: f.emirate }, p)];
    missing = all(`SELECT c.contract_ref, c.client_name, c.emirate, c.sales_by, ${M.UNIT} units, c.delivery_date,
        COALESCE(c.project_status,'Active') project_status FROM contracts c WHERE ${w.join(' AND ')} ORDER BY c.contract_ref`, p);
    if (missing.length) notes.push({ title: 'Completed — no Handover Date', text: `${missing.length} contract(s) show Mechanical & Electrical "Completed" but have no Handover Date recorded — not included in any month.`,
      columns: ['Contract Ref.', 'Client', 'Emirate', 'Salesperson', 'Units', 'Delivery Date', 'Project Status'],
      rows: missing.map(r => [r.contract_ref, r.client_name, r.emirate, r.sales_by, r.units, r.delivery_date || '', r.project_status]) });
  } else if (cfg.dq) {
    missing = M.contractMissingDateRows(cfg.col, cfg.dq[0], cfg.dq[1], { salesperson: f.salesperson, emirate: f.emirate });
    if (missing.length) notes.push({ title: cfg.dq[2], text: `${missing.length} contract(s) carry the status "${cfg.dq[1]}" without a ${cfg.dateLabel} — they are not assigned to any month.`,
      columns: ['Contract Ref.', 'Client', 'Emirate', 'Salesperson', 'Units', 'Approval Date', 'Project Status'],
      rows: missing.map(r => [r.contract_ref, r.client_name, r.emirate, r.sales_by, r.units, r.approval_date || '', r.project_status]) });
  }

  // Register
  const days = (a, b) => (a && b && /^\d{4}-/.test(a) && /^\d{4}-/.test(b)) ? Math.round((new Date(b.slice(0, 10)) - new Date(a.slice(0, 10))) / 864e5) : '';
  const ms = (d, legacy) => d ? String(d).slice(0, 10) : (legacy ? `(${legacy})` : '');
  const SORT = { milestone_date: 'milestone_date', handover_date: 'milestone_date', delivery_date: 'milestone_date', approval_date: 'milestone_date',
    units: 'units', contract_ref: 'contract_ref', client_name: 'client_name', emirate: 'emirate', salesperson: 'sales_by', contract_value: 'contract_value' };
  const reg = sortRecords(scope, f, SORT, 'milestone_date');
  let columns, toRow;
  if (type === 'monthly-sales') {
    columns = ['Contract Ref.', 'Quote Ref.', 'Client', 'Project Description', 'Emirate', 'Salesperson', 'Units', 'Contract Value', 'Currency', 'Approval Date', 'Project Status'];
    toRow = r => [r.contract_ref, r.quote_ref || '', r.client_name || '', r.project_description || '', r.emirate || '', r.sales_by || '', r.units, r2(r.contract_value), r.currency_code, r.milestone_date, r.project_status];
  } else if (type === 'delivery-report') {
    columns = ['Contract Ref.', 'Client', 'Project Description', 'Emirate', 'Salesperson', 'Units', 'Approval Date', 'Delivery Date', 'Factory Ref.', 'Approval to Delivery (days)', 'Project Status'];
    toRow = r => [r.contract_ref, r.client_name || '', r.project_description || '', r.emirate || '', r.sales_by || '', r.units, r.approval_date || '', r.milestone_date, r.factory_ref || '', days(r.approval_date, r.milestone_date), r.project_status];
  } else {
    columns = ['Contract Ref', 'Client', 'Project Description', 'Emirate', 'Salesperson', 'Units', 'Approval Date', 'Delivery Date',
      'Mechanical Completion', 'Electrical Completion', 'Handover Date', 'Project Status', 'Delivery to Handover (days)'];
    toRow = r => [r.contract_ref, r.client_name || '', r.project_description || '', r.emirate || '', r.sales_by || '', r.units,
      r.approval_date || '', ms(r.delivery_date, r.delivery_status), ms(r.mechanical_completion_date, r.mechanical_status),
      ms(r.electrical_completion_date, r.electrical_status), r.milestone_date, r.project_status, days(r.delivery_date, r.milestone_date)];
  }
  const breakdownObjs = key => groupBy(scope, r => r[key], { projects: () => 1, units: r => r.units }).map(x => ({ name: x.name, projects: x.projects, units: x.units }));
  const summary = { year: y, month: m, scope_label: sl, total_units: units, total_projects: scope.length,
    ...(cfg.noAvgPerProject ? {} : { avg_units_per_project: scope.length ? r2(units / scope.length) : 0 }),
    avg_units_per_active_month: active.length ? Math.round(yearUnits / active.length * 10) / 10 : 0, active_months: active.length,
    [`latest_${cfg.noun.toLowerCase()}_month`]: latest ? `${latest.name} ${y}` : null,
    year_units: yearUnits, year_projects: yearRecs.length };
  return stdOut({
    type, title: `${cfg.title} — ${m ? MONTH[m - 1] + ' ' : ''}${y}`, description: cfg.description, metric: 'Elevator Units',
    year: y, month: m, kpis, chart, month_table, breakdowns, notes,
    register_title: `${cfg.noun === 'Sales' ? 'Contract' : cfg.noun} Register — ${sl}`,
    columns, registerRows: reg.map(toRow), scope_total: units, summary,
    extra: {
      monthly_summary: buckets.map(b => ({ month: String(b.month_num).padStart(2, '0'), month_num: b.month_num, label: b.label, name: b.name,
        projects: b.projects, units: b.units, cumulative_units: b.cumulative_units, ...(cfg.noAvgPerProject ? {} : { avg_units_per_project: b.avg_units_per_project }), pct_of_ytd: b.pct_of_ytd })),
      by_emirate: breakdownObjs('emirate'), by_salesperson: breakdownObjs('sales_by'),
      year_records: yearRecs.map(r => ({ ...r, month: monthIdx(r.milestone_date), [cfg.col]: r.milestone_date })),
      records: scope, missing_milestone_date: missing,
      ...(type === 'handover-report' ? { missing_handover_date: missing } : {}),
    },
  }, f);
}

// ── Installation Completion (Mechanical + Electrical) ─────────────────────────
function buildInstallationReport(f) {
  const y = yearOf(f), m = monthOf(f);
  const dims = { salesperson: f.salesperson, emirate: f.emirate, project_status: f.project_status, search: f.search };
  const mech = M.contractMilestoneRows('mechanical_completion_date', { year: y }, dims);
  const elec = M.contractMilestoneRows('electrical_completion_date', { year: y }, dims);
  const mechS = m ? mech.filter(r => monthIdx(r.milestone_date) === m) : mech;
  const elecS = m ? elec.filter(r => monthIdx(r.milestone_date) === m) : elec;
  const bm = monthBuckets(mech, r => monthIdx(r.milestone_date), { units: r => r.units, projects: () => 1 });
  const be = monthBuckets(elec, r => monthIdx(r.milestone_date), { units: r => r.units, projects: () => 1 });
  // Completion gap: mechanically completed (any date) but no electrical completion date, not cancelled
  const gp = [];
  const gw = ['c.is_deleted = 0', M.ISO('c.mechanical_completion_date'), "(c.electrical_completion_date IS NULL OR c.electrical_completion_date = '')",
    "COALESCE(c.project_status,'Active') <> 'Cancelled'", ...M.contractFilterSql(dims, gp)];
  const gap = all(`SELECT c.contract_ref, c.client_name, c.emirate, c.sales_by, ${M.UNIT} units, substr(c.mechanical_completion_date,1,10) mech_date,
      COALESCE(c.electrical_status,'') electrical_status FROM contracts c WHERE ${gw.join(' AND ')} ORDER BY c.mechanical_completion_date`, gp);
  const sl = scopeLabel(y, m);
  const mechU = M.sumUnits(mechS), elecU = M.sumUnits(elecS);
  const kpis = [
    kpi(`Mechanical Completion — ${sl}`, mechU, { unit: 'Units', sub: `${mechS.length} project(s)`, tone: 'blue' }),
    kpi(`Electrical Completion — ${sl}`, elecU, { unit: 'Units', sub: `${elecS.length} project(s)`, tone: 'green' }),
    kpi('Completion Gap (current)', M.sumUnits(gap), { unit: 'Units', sub: 'mechanically complete, electrical completion not dated', tone: gap.length ? 'amber' : '' }),
    kpi(`Mechanical Units — ${y}`, M.sumUnits(mech), { unit: 'Units', tone: 'purple' }),
    kpi(`Electrical Units — ${y}`, M.sumUnits(elec), { unit: 'Units', tone: 'teal' }),
  ];
  const chart = { title: `Monthly Installation Completion — ${y}`, subtitle: 'Elevator units completed per month — Mechanical vs Electrical',
    labels: MON, highlight: m ? m - 1 : null, drill: 'month',
    datasets: [
      { label: 'Mechanical Units', data: bm.map(b => b.units), type: 'bar', axis: 'y', color: COLORS.blue },
      { label: 'Electrical Units', data: be.map(b => b.units), type: 'bar', axis: 'y', color: COLORS.green },
    ], y_title: 'Units / month' };
  const month_table = { title: `Month-wise Installation Completion — ${y}`, highlight: m ? m - 1 : null, drill: 'month',
    columns: ['Month', 'Mechanical Projects', 'Mechanical Units', 'Electrical Projects', 'Electrical Units'],
    rows: MON.map((_, i) => [MONTH[i], bm[i].projects, bm[i].units, be[i].projects, be[i].units]),
    total: [`Total ${y}`, mech.length, M.sumUnits(mech), elec.length, M.sumUnits(elec)] };
  const em = groupBy([...mechS.map(r => ({ ...r, k: 'm' })), ...elecS.map(r => ({ ...r, k: 'e' }))], r => r.emirate,
    { mech: r => r.k === 'm' ? r.units : 0, elec: r => r.k === 'e' ? r.units : 0 });
  const breakdowns = [
    { title: `Installation by Emirate — ${sl}`, columns: ['Emirate', 'Mechanical Units', 'Electrical Units'], drill_param: 'emirate', rows: em.map(x => [x.name, x.mech, x.elec]) },
  ];
  const notes = [];
  if (gap.length) notes.push({ title: 'Completion gap', text: `${gap.length} project(s) are mechanically complete with no Electrical Completion Date yet.`,
    columns: ['Contract Ref.', 'Client', 'Emirate', 'Salesperson', 'Units', 'Mechanical Completion', 'Electrical Status'],
    rows: gap.map(r => [r.contract_ref, r.client_name, r.emirate, r.sales_by, r.units, r.mech_date, r.electrical_status]) });
  const mcDq = M.contractMissingDateRows('mechanical_completion_date', 'mechanical_status', 'Completed', dims).length;
  const ecDq = M.contractMissingDateRows('electrical_completion_date', 'electrical_status', 'Completed', dims).length;
  if (mcDq || ecDq) notes.push({ text: `${mcDq} contract(s) show Mechanical "Completed" and ${ecDq} show Electrical "Completed" without a completion date — not assigned to any month.` });
  // Register: every contract with a mech OR elec completion in scope (one row per contract)
  const map = new Map();
  [...mechS, ...elecS].forEach(r => map.set(r.id, r));
  const regAll = sortRecords([...map.values()].map(r => ({ ...r, mdate: r.mechanical_completion_date ? String(r.mechanical_completion_date).slice(0, 10) : '',
    edate: r.electrical_completion_date ? String(r.electrical_completion_date).slice(0, 10) : '' })), f,
    { mechanical_completion_date: 'mdate', electrical_completion_date: 'edate', units: 'units', contract_ref: 'contract_ref', client_name: 'client_name', emirate: 'emirate' }, 'mechanical_completion_date');
  const gapDays = r => (r.mdate && r.edate) ? Math.round((new Date(r.edate) - new Date(r.mdate)) / 864e5) : '';
  return stdOut({
    type: 'installation-completion', title: `Installation Completion Report — ${m ? MONTH[m - 1] + ' ' : ''}${y}`,
    description: 'Elevator units by Mechanical and Electrical Completion Date', metric: 'Elevator Units', year: y, month: m,
    kpis, chart, month_table, breakdowns, notes, register_title: `Installation Register — ${sl}`,
    columns: ['Contract Ref.', 'Client', 'Project Description', 'Emirate', 'Salesperson', 'Units', 'Delivery Date', 'Mechanical Completion', 'Electrical Completion', 'Mech. to Elec. (days)', 'Handover Date', 'Project Status'],
    registerRows: regAll.map(r => [r.contract_ref, r.client_name || '', r.project_description || '', r.emirate || '', r.sales_by || '', r.units,
      r.delivery_date ? String(r.delivery_date).slice(0, 10) : '', r.mdate, r.edate, gapDays(r), r.handover_date ? String(r.handover_date).slice(0, 10) : '', r.project_status]),
    scope_total: mechU + elecU,
  }, f);
}

// ── Contract Register (foundation register) ──────────────────────────────────
function buildContractRegister(f) {
  const p = [];
  const w = ['c.is_deleted = 0', ...M.contractFilterSql({ salesperson: f.salesperson, emirate: f.emirate, project_status: f.project_status, search: f.search }, p)];
  const y = f.year ? yearOf(f) : null, m = monthOf(f);
  if (y) { w.push(m ? 'substr(c.approval_date,1,7) = ?' : 'substr(c.approval_date,1,4) = ?'); p.push(m ? `${y}-${String(m).padStart(2, '0')}` : y); }
  if (f.contract_ref) { w.push('c.contract_ref LIKE ?'); p.push(`%${f.contract_ref}%`); }
  if (f.client)       { w.push('c.client_name LIKE ?');  p.push(`%${f.client}%`); }
  if (f.status) {                     // backward compatible (Contracts page export): project or delivery status
    if (['Active', 'Hold', 'Delay', 'Cancelled'].includes(f.status)) { w.push("COALESCE(c.project_status,'Active') = ?"); p.push(f.status); }
    else { w.push('c.delivery_status = ?'); p.push(f.status); }
  }
  const rows = all(`SELECT c.contract_ref, c.quote_ref, c.client_name, c.project_description, c.emirate, c.sales_by, ${M.UNIT} AS units,
      c.contract_value, COALESCE(c.currency_code,'AED') currency_code, substr(c.approval_date,1,10) approval_date,
      COALESCE(c.project_status,'Active') project_status,
      substr(c.delivery_date,1,10) delivery_date, c.delivery_status, substr(c.mechanical_completion_date,1,10) mech_date, c.mechanical_status,
      substr(c.electrical_completion_date,1,10) elec_date, c.electrical_status, substr(c.handover_date,1,10) handover_date,
      ${M.FACTORY_REF_SQL} factory_ref, ${M.MAINT_LINK_SQL} maintenance_id
    FROM contracts c WHERE ${w.join(' AND ')}`, p);
  const units = M.sumUnits(rows);
  const byStatus = groupBy(rows, r => r.project_status, { units: r => r.units, projects: () => 1 });
  const stage = r => r.handover_date ? 'Handed Over' : r.elec_date || r.mech_date ? 'Installation' : r.delivery_date ? 'Delivered' : 'Awaiting Delivery';
  const byStage = groupBy(rows.filter(r => r.project_status !== 'Cancelled'), stage, { units: r => r.units, projects: () => 1 });
  const val = M.byCurrency(rows, 'contract_value', 'currency_code');
  // 2026-10-03: Delay Units KPI removed — delay analysis belongs to Project Status (Delay rows stay in the
  // status breakdown and the register so the portfolio still reconciles)
  const kpis = [kpi('Contracts', rows.length, { unit: 'Projects', tone: 'blue' }), kpi('Elevator Units', units, { unit: 'Units', tone: 'green' })]
    .concat(Object.entries(val).map(([c, v]) => kpi(`Contract Value (${c})`, v, { fmt: 'money', cur: c, tone: 'purple' })))
    .concat(['Active', 'Hold', 'Cancelled'].map(s => { const x = byStatus.find(b => b.name === s); return kpi(`${s} Units`, x ? x.units : 0, { unit: 'Units', tone: s === 'Active' ? 'teal' : s === 'Cancelled' ? 'red' : 'amber' }); }));
  const breakdowns = [
    { title: 'Units by Project Status', columns: ['Project Status', 'Projects', 'Units'], drill_param: 'project_status', rows: byStatus.map(x => [x.name, x.projects, x.units]) },
    { title: 'Lifecycle Position (excl. Cancelled) — dated milestones', columns: ['Stage', 'Projects', 'Units'], rows: byStage.map(x => [x.name, x.projects, x.units]) },
  ];
  const reg = sortRecords(rows, f, { approval_date: 'approval_date', contract_value: 'contract_value', client_name: 'client_name', salesperson: 'sales_by',
    units: 'units', contract_ref: 'contract_ref', emirate: 'emirate', project_status: 'project_status', handover_date: 'handover_date' }, 'approval_date');
  const ms = (d, legacy) => d || (legacy ? `(${legacy})` : '');
  return stdOut({ type: 'contracts-list', title: `Contract Register${y ? ' — ' + (m ? MONTH[m - 1] + ' ' : '') + y : ''}`,
    description: 'Detailed contract portfolio and current project records', metric: 'Elevator Units',
    kpis, chart: null, breakdowns, register_title: 'Contract Register',
    columns: ['Contract Ref.', 'Client', 'Emirate', 'Units', 'Approval Date', 'Salesperson', 'Project Status', 'Delivery Date',
      'Mechanical Completion', 'Electrical Completion', 'Handover Date', 'Factory Ref.', 'Maintenance Link', 'Contract Value (AED)'],
    registerRows: reg.map(r => [r.contract_ref, r.client_name || '', r.emirate || '', r.units, r.approval_date || '', r.sales_by || '', r.project_status,
      ms(r.delivery_date, r.delivery_status), ms(r.mech_date, r.mechanical_status), ms(r.elec_date, r.electrical_status), r.handover_date || '',
      r.factory_ref || '', r.maintenance_id || '', r2(r.contract_value)]),
    scope_total: units, summary: { total_contracts: units, total_value: r2(rows.reduce((s, r) => s + (Number(r.contract_value) || 0), 0)) } }, f);
}

// ── Project Status (current snapshot) ─────────────────────────────────────────
function buildProjectStatusReport(f) {
  const p = [];
  const w = ['c.is_deleted = 0', ...M.contractFilterSql({ salesperson: f.salesperson, emirate: f.emirate, project_status: f.project_status, search: f.search }, p)];
  if (f.year) { w.push('substr(c.approval_date,1,4) = ?'); p.push(yearOf(f)); }
  const rows = all(`SELECT c.contract_ref, c.client_name, c.project_description, c.emirate, c.sales_by, ${M.UNIT} units,
      substr(c.approval_date,1,10) approval_date, COALESCE(c.project_status,'Active') project_status,
      substr(c.project_status_since,1,10) status_since, c.hold_reason, c.hold_remarks, c.delay_reason, c.delay_remarks,
      c.cancellation_type, substr(c.cancellation_date,1,10) cancellation_date, c.cancellation_remarks,
      substr(c.delivery_date,1,10) delivery_date, substr(c.handover_date,1,10) handover_date
    FROM contracts c WHERE ${w.join(' AND ')}`, p);
  const ST = ['Active', 'Hold', 'Delay', 'Cancelled'];
  const byS = s => rows.filter(r => r.project_status === s);
  const units = M.sumUnits(rows);
  const kpis = ST.map(s => kpi(`${s}`, M.sumUnits(byS(s)), { unit: 'Units', sub: `${byS(s).length} project(s)`, tone: s === 'Active' ? 'green' : s === 'Cancelled' ? 'red' : 'amber' }))
    .concat([kpi('Total', units, { unit: 'Units', sub: `${rows.length} project(s)`, tone: 'blue' })]);
  const chart = { title: 'Current Project Status', subtitle: 'Elevator units by current Project Status (snapshot — not a monthly trend)',
    labels: ST, horizontal: true, drill: 'project_status',
    datasets: [{ label: 'Units', data: ST.map(s => M.sumUnits(byS(s))), type: 'bar', axis: 'y', colors: [COLORS.green, COLORS.amber, COLORS.purple, COLORS.red] }], y_title: 'Units' };
  const em = groupBy(rows, r => r.emirate, Object.fromEntries(ST.map(s => [s, r => r.project_status === s ? r.units : 0])));
  const sp = groupBy(rows, r => r.sales_by, Object.fromEntries(ST.map(s => [s, r => r.project_status === s ? r.units : 0])));
  const breakdowns = [
    { title: 'Units by Emirate and Status', columns: ['Emirate', ...ST], drill_param: 'emirate', rows: em.map(x => [x.name, ...ST.map(s => x[s])]) },
    { title: 'Units by Salesperson and Status', columns: ['Salesperson', ...ST], drill_param: 'salesperson', rows: sp.map(x => [x.name, ...ST.map(s => x[s])]) },
  ];
  const reason = r => r.project_status === 'Hold' ? [r.hold_reason, r.hold_remarks].filter(Boolean).join(' — ')
    : r.project_status === 'Delay' ? [r.delay_reason, r.delay_remarks].filter(Boolean).join(' — ')
    : r.project_status === 'Cancelled' ? [r.cancellation_type, r.cancellation_remarks].filter(Boolean).join(' — ') : '';
  const statusOrder = { Hold: 0, Delay: 1, Cancelled: 2, Active: 3 };
  const reg = f.sort_by ? sortRecords(rows, f, { contract_ref: 'contract_ref', client_name: 'client_name', units: 'units', approval_date: 'approval_date', emirate: 'emirate', project_status: 'project_status', status_since: 'status_since' }, 'approval_date')
    : [...rows].sort((a, b) => statusOrder[a.project_status] - statusOrder[b.project_status] || String(b.approval_date).localeCompare(String(a.approval_date)));
  return stdOut({ type: 'project-status', title: 'Project Status Report', description: 'Current Project Status (Active / Hold / Delay / Cancelled) by elevator units',
    metric: 'Elevator Units', kpis, chart, breakdowns, register_title: 'Project Status Register',
    columns: ['Contract Ref.', 'Client', 'Project Description', 'Emirate', 'Salesperson', 'Units', 'Approval Date', 'Project Status', 'Status Since', 'Reason / Remarks', 'Delivery Date', 'Handover Date'],
    registerRows: reg.map(r => [r.contract_ref, r.client_name || '', r.project_description || '', r.emirate || '', r.sales_by || '', r.units, r.approval_date || '',
      r.project_status, r.status_since || r.cancellation_date || '', reason(r), r.delivery_date || '', r.handover_date || '']),
    scope_total: units }, f);
}

// ══════════════════════════════════════════════════════════════════════════════
// SALES & QUOTATIONS
// ══════════════════════════════════════════════════════════════════════════════
const QUOTE_STATUS = [['quoted', 'Quoted'], ['follow_up', 'Follow Up'], ['negotiation', 'Negotiation'], ['approved', 'Approved'], ['lost', 'Lost'], ['tender', 'Tender']];
const QLABEL = Object.fromEntries(QUOTE_STATUS);
const qKey = v => { const k = String(v || '').trim().toLowerCase().replace(/[\s-]+/g, '_'); return QLABEL[k] ? k : null; };
const qLabel = v => { const k = qKey(v); return k ? QLABEL[k] : (v ? `Unrecognised (${v})` : 'Unrecognised (blank)'); };
const PIPELINE = new Set(['Quoted', 'Follow Up', 'Negotiation', 'Tender']);

function quotationRows(f, opts = {}) {
  const p = [];
  const w = ['is_deleted = 0'];
  const y = f.year ? yearOf(f) : null, m = opts.ignoreMonth ? null : monthOf(f);
  if (y) { w.push(m ? 'substr(quotation_date,1,7) = ?' : 'substr(quotation_date,1,4) = ?'); p.push(m ? `${y}-${String(m).padStart(2, '0')}` : y); }
  if (f.salesperson) { w.push('salesperson = ?'); p.push(f.salesperson); }
  if (f.status && !opts.ignoreStatus) { const k = qKey(f.status); w.push('LOWER(status) = ?'); p.push(k || String(f.status).toLowerCase()); }
  if (f.search) { w.push(`(client_name LIKE ? OR COALESCE(quote_ref,'') LIKE ? OR COALESCE(project_name,'') LIKE ?)`); p.push(`%${f.search}%`, `%${f.search}%`, `%${f.search}%`); }
  if (f.client) { w.push('client_name LIKE ?'); p.push(`%${f.client}%`); }
  if (f.quote_ref) { w.push('quote_ref LIKE ?'); p.push(`%${f.quote_ref}%`); }
  return all(`SELECT id, quote_ref, client_name, COALESCE(project_name,'') project_name, salesperson, substr(quotation_date,1,10) quotation_date,
      COALESCE(contract_value,0) quoted_value, COALESCE(NULLIF(currency_code,''),'AED') currency_code, status, COALESCE(remarks,'') remarks
    FROM quotations WHERE ${w.join(' AND ')}`, p).map(r => ({ ...r, status_label: qLabel(r.status) }));
}

// 2026-10-03: Quotations & Status Analysis is COUNT / STATUS based only.
//  • No quoted-value analytics: a quotation is a proposal, not confirmed business value
//    (confirmed value = approved Contract Value in Contracts / Management / Accounts reports).
//    Quotation pricing stays untouched in the Sales Quotations module and its records.
//  • No follow-up action metrics (Overdue / Due Today / Upcoming): those live in
//    Sales Quotations → Sales Follow-Up. This report adds Quotation Aging instead
//    (age of OPEN quotations by Quotation Date — not follow-up overdue).
const AGE_BUCKETS = [['0–7 Days', 0, 7], ['8–15 Days', 8, 15], ['16–30 Days', 16, 30], ['31–60 Days', 31, 60], ['61–90 Days', 61, 90], ['90+ Days', 91, Infinity]];
function localISODate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const quoteAge = (date, today) => /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? Math.max(0, Math.round((new Date(today + 'T00:00:00') - new Date(date + 'T00:00:00')) / 864e5)) : null;
const pctOf = (n, d) => `${d ? Math.round(n / d * 1000) / 10 : 0}%`;
const decisionConv = (a, l) => a + l ? Math.round(a / (a + l) * 1000) / 10 : null;

function buildQuotationsReport(f) {
  const y = f.year ? yearOf(f) : null, m = monthOf(f);
  const today = localISODate();
  const rows = quotationRows(f).map(r => ({ ...r, age_days: PIPELINE.has(r.status_label) ? quoteAge(r.quotation_date, today) : null }));
  const yearRows = y ? quotationRows(f, { ignoreMonth: true }) : rows;
  const c = lbl => rows.filter(r => r.status_label === lbl).length;
  const approved = c('Approved'), lost = c('Lost');
  const open = rows.filter(r => PIPELINE.has(r.status_label));
  const conv = decisionConv(approved, lost);
  // Replacement KPI: Follow Up status (the most-used active status in practice); Negotiation / Tender shown alongside
  const kpis = [
    kpi('Total Quotations', rows.length, { unit: 'Quotations', sub: 'By Quotation Date', tone: 'blue' }),
    kpi('Approved', approved, { unit: 'Quotations', sub: 'Current status = Approved', tone: 'green' }),
    kpi('Lost', lost, { unit: 'Quotations', sub: 'Current status = Lost', tone: 'red' }),
    kpi('Active Pipeline', open.length, { unit: 'Quotations', sub: 'Quoted · Follow Up · Negotiation · Tender', tone: 'amber' }),
    kpi('Decision Conversion %', conv, { fmt: 'pct', sub: 'Approved ÷ (Approved + Lost)', tone: 'purple' }),
    kpi('In Follow Up Status', c('Follow Up'), { unit: 'Quotations', sub: `Negotiation ${c('Negotiation')} · Tender ${c('Tender')}`, tone: 'teal' }),
  ];
  const groups = ['Approved', 'Lost', 'Active Pipeline'];
  const grp = r => r.status_label === 'Approved' ? 'Approved' : r.status_label === 'Lost' ? 'Lost' : 'Active Pipeline';
  const b = monthBuckets(yearRows, r => monthIdx(r.quotation_date), Object.fromEntries([['total', () => 1], ...groups.map(g => [g, r => grp(r) === g ? 1 : 0])]));
  const chart = y ? { title: `Monthly Quotations Trend — ${y}`, subtitle: 'Quotation count by Quotation Date, split by current status group', labels: MON,
    highlight: m ? m - 1 : null, drill: 'month', stacked: true, y_title: 'Quotations',
    datasets: groups.map(g => ({ label: g, data: b.map(x => x[g]), type: 'bar', axis: 'y', stack: 's', color: g === 'Approved' ? COLORS.green : g === 'Lost' ? COLORS.red : COLORS.sky })) } : null;
  const statusRows = QUOTE_STATUS.map(([, l]) => l).concat([...new Set(rows.map(r => r.status_label))].filter(l => !QUOTE_STATUS.some(([, x]) => x === l)))
    .map(l => { const n = rows.filter(r => r.status_label === l).length; return [l, n, pctOf(n, rows.length)]; });
  statusRows.push(['Total', rows.length, rows.length ? '100%' : '0%']);
  const sp = groupBy(rows, r => r.salesperson, { total: () => 1, approved: r => r.status_label === 'Approved' ? 1 : 0, lost: r => r.status_label === 'Lost' ? 1 : 0,
    pipeline: r => PIPELINE.has(r.status_label) ? 1 : 0 });
  const spRows = sp.map(x => [x.name, x.total, x.approved, x.lost, x.pipeline, decisionConv(x.approved, x.lost) == null ? '—' : `${decisionConv(x.approved, x.lost)}%`]);
  if (spRows.length) spRows.push(['Total', rows.length, approved, lost, open.length, conv == null ? '—' : `${conv}%`]);
  const agingRows = AGE_BUCKETS.map(([l, lo, hi]) => { const n = open.filter(r => r.age_days != null && r.age_days >= lo && r.age_days <= hi).length; return [l, n, pctOf(n, open.length)]; });
  const noDate = open.filter(r => r.age_days == null).length;
  if (noDate) agingRows.push(['No Quotation Date', noDate, pctOf(noDate, open.length)]);
  agingRows.push(['Total Active Pipeline', open.length, open.length ? '100%' : '0%']);
  const breakdowns = [
    { title: 'Quotation Status Breakdown', columns: ['Status', 'Quotations', 'Share %'], drill_param: 'status', rows: statusRows },
    { title: 'Quotations by Salesperson', columns: ['Salesperson', 'Total Quotations', 'Approved', 'Lost', 'Active Pipeline', 'Decision Conversion %'], drill_param: 'salesperson', rows: spRows },
    { title: `Quotation Aging Summary — open quotations (as of ${today.split('-').reverse().join('/')})`, columns: ['Age Bucket', 'Open Quotations', 'Share %'], rows: agingRows },
  ];
  const reg = sortRecords(rows, f, { quotation_date: 'quotation_date', client_name: 'client_name', salesperson: 'salesperson', status: 'status_label', quote_ref: 'quote_ref', age: 'age_days' }, 'quotation_date');
  return stdOut({ type: 'quotations-register', title: `Quotations & Status Analysis${y ? ' — ' + (m ? MONTH[m - 1] + ' ' : '') + y : ''}`,
    description: 'Quotation count, status, pipeline, decision conversion, salesperson activity and aging (count-based; confirmed value is reported from approved Contracts)',
    metric: 'Quotations', year: y, month: m, kpis, chart, breakdowns, register_title: 'Quotations Register',
    notes: [{ text: 'Count-based analysis. Quoted amounts are proposals and are not reported here — confirmed sales value comes from approved Contract Value.' },
      { text: 'Quotation Age = days since Quotation Date for open quotations (Quoted / Follow Up / Negotiation / Tender). It is not follow-up overdue — follow-up actions are managed in Sales Quotations → Sales Follow-Up.' }],
    columns: ['Quote Ref.', 'Client', 'Project Description', 'Salesperson', 'Quotation Date', 'Status', 'Age (Days)', 'Remarks'],
    registerRows: reg.map(r => [r.quote_ref || '', r.client_name || '', r.project_name, r.salesperson || '', r.quotation_date || '', r.status_label, r.age_days == null ? '' : r.age_days, r.remarks]),
    scope_total: rows.length,
    summary: { totalQuotations: rows.length, approved, lost, activePipeline: open.length, conversionRate: conv,
      byStatus: Object.fromEntries(QUOTE_STATUS.map(([, l]) => [l, c(l)])), agingSummary: Object.fromEntries(agingRows.map(r => [r[0], r[1]])) } }, f);
}

function buildSalespersonReport(f) {
  const y = yearOf(f), m = monthOf(f);
  const quotes = quotationRows({ year: y, month: f.month, salesperson: f.salesperson });
  const sales = M.contractMilestoneRows('approval_date', { year: y, month: m }, { salesperson: f.salesperson });
  const yearSales = m ? M.contractMilestoneRows('approval_date', { year: y }, { salesperson: f.salesperson }) : sales;
  const targets = all('SELECT salesperson, target_units FROM sales_targets WHERE year = ?', [y]);
  const tmap = Object.fromEntries(targets.map(t => [t.salesperson, t.target_units]));
  const people = [...new Set([...quotes.map(q => q.salesperson), ...sales.map(s => s.sales_by), ...Object.keys(tmap)].filter(Boolean))]
    .filter(sp => !f.salesperson || sp === f.salesperson).sort();
  const rows = people.map(sp => {
    const q = quotes.filter(x => x.salesperson === sp), s = sales.filter(x => x.sales_by === sp), ys = yearSales.filter(x => x.sales_by === sp);
    const appr = q.filter(x => x.status_label === 'Approved').length, lost = q.filter(x => x.status_label === 'Lost').length;
    const ytdUnits = M.sumUnits(ys), target = tmap[sp] != null ? tmap[sp] : null;
    const val = M.byCurrency(s, 'contract_value', 'currency_code');
    return { salesperson: sp, quotations: q.length, approved_quotes: appr, lost_quotes: lost,
      conversion: appr + lost ? Math.round(appr / (appr + lost) * 1000) / 10 : null,
      contracts: s.length, units: M.sumUnits(s), value_aed: val.AED || 0, ytd_units: ytdUnits, target,
      achievement: target ? Math.round(ytdUnits / target * 1000) / 10 : null, remaining: target != null ? Math.max(0, target - ytdUnits) : null };
  });
  const tU = rows.reduce((s, r) => s + r.units, 0), tT = rows.reduce((s, r) => s + (r.target || 0), 0), tY = rows.reduce((s, r) => s + r.ytd_units, 0);
  const tQ = rows.reduce((s, r) => s + r.quotations, 0), tA = rows.reduce((s, r) => s + r.approved_quotes, 0), tL = rows.reduce((s, r) => s + r.lost_quotes, 0);
  const sl = scopeLabel(y, m);
  const kpis = [kpi(`Sales Units — ${sl}`, tU, { unit: 'Units', tone: 'green' }), kpi(`Target Units — ${y}`, tT, { unit: 'Units', tone: 'blue' }),
    kpi(`Achievement — YTD ${y}`, tT ? Math.round(tY / tT * 1000) / 10 : null, { fmt: 'pct', sub: `${tY} of ${tT} target units`, tone: 'purple' }),
    kpi(`Quotations — ${sl}`, tQ, { unit: 'Quotations', tone: 'teal' }), kpi('Conversion %', tA + tL ? Math.round(tA / (tA + tL) * 1000) / 10 : null, { fmt: 'pct', sub: 'Approved ÷ (Approved + Lost) quotations', tone: 'amber' })];
  const chart = { title: `Sales Units vs Target — ${y}`, subtitle: 'YTD contract units (Approval Date) against the annual unit target per salesperson', labels: rows.map(r => r.salesperson), horizontal: true, drill: 'salesperson',
    datasets: [{ label: `YTD Sales Units ${y}`, data: rows.map(r => r.ytd_units), type: 'bar', axis: 'y', color: COLORS.green },
      { label: `Target Units ${y}`, data: rows.map(r => r.target || 0), type: 'bar', axis: 'y', color: COLORS.grey }], y_title: 'Units' };
  const bySpMonth = monthBuckets(yearSales, r => monthIdx(r.milestone_date), Object.fromEntries(rows.map(r => [r.salesperson, x => x.sales_by === r.salesperson ? x.units : 0])));
  const month_table = { title: `Monthly Sales Units by Salesperson — ${y}`, highlight: m ? m - 1 : null,
    columns: ['Month', ...rows.map(r => r.salesperson), 'Total'], rows: bySpMonth.map(b => [b.name, ...rows.map(r => b[r.salesperson]), rows.reduce((s, r) => s + b[r.salesperson], 0)]),
    total: [`Total ${y}`, ...rows.map(r => r.ytd_units), tY] };
  return stdOut({ type: 'salesperson-performance', title: `Salesperson Performance — ${m ? MONTH[m - 1] + ' ' : ''}${y}`,
    description: 'Quotations, approved contracts, sales units and target achievement per salesperson (factual operational metrics)', metric: 'Elevator Units',
    year: y, month: m, kpis, chart, month_table, breakdowns: [], register_title: `Salesperson Summary — ${sl}`,
    columns: ['Salesperson', 'Quotations', 'Approved Quotes', 'Lost Quotes', 'Conversion %', 'Contracts', 'Sales Units', 'Contract Value (AED)', `YTD Units ${y}`, `Target Units ${y}`, 'Achievement %', 'Remaining Units'],
    registerRows: rows.map(r => [r.salesperson, r.quotations, r.approved_quotes, r.lost_quotes, r.conversion == null ? '' : `${r.conversion}%`, r.contracts, r.units, r2(r.value_aed),
      r.ytd_units, r.target == null ? '' : r.target, r.achievement == null ? '' : `${r.achievement}%`, r.remaining == null ? '' : r.remaining]),
    scope_total: tU }, f);
}

// ══════════════════════════════════════════════════════════════════════════════
// FACTORY, SHIPPING & SUPPLIER
// ══════════════════════════════════════════════════════════════════════════════
// 2026-10-03: supplier grouping by identity (supplier_id → Supplier Master name)
function supplierLabel() {
  let names = {};
  try { names = Object.fromEntries(all('SELECT id, name FROM suppliers').map(s => [s.id, s.name])); } catch (_) {}
  return r => (r.supplier_id != null && names[r.supplier_id]) || r.supplier_name;
}
const PROD_GROUP = s => ['Production', 'Under Production'].includes(s) ? 'Under Production' : ['Ready', 'Hold'].includes(s) ? 'Ready / Hold'
  : ['Shipping', 'On Shipping', 'In Transit'].includes(s) ? 'Shipping' : s === 'Delivered' ? 'Delivered' : s === 'Cancel' ? 'Cancelled' : 'Not set';

function buildFactoryOrdersReport(f) {
  const y = f.year ? yearOf(f) : null, m = monthOf(f);
  const p = [];
  const w = ['i.is_deleted = 0'];
  if (y) { w.push(M.ISO('i.order_date')); w.push(m ? 'substr(i.order_date,1,7) = ?' : 'substr(i.order_date,1,4) = ?'); p.push(m ? `${y}-${String(m).padStart(2, '0')}` : y); }
  if (f.search) { w.push(`(i.factory_ref LIKE ? OR COALESCE(i.contract_ref,'') LIKE ? OR COALESCE(c.client_name,i.client_name,'') LIKE ? OR COALESCE(i.supplier_name,'') LIKE ?)`); p.push(...Array(4).fill(`%${f.search}%`)); }
  if (f.emirate) { w.push('TRIM(c.emirate) = ?'); p.push(f.emirate); }
  if (f.supplier) { w.push('i.supplier_name LIKE ?'); p.push(`%${f.supplier}%`); }
  if (f.factory_delivery_status) { w.push('i.factory_delivery_status = ?'); p.push(f.factory_delivery_status); }
  if (f.production_status) { w.push('i.production_status = ?'); p.push(f.production_status); }
  if (f.show_cancelled === 'cancelled') w.push("i.factory_delivery_status = 'Cancel'");
  else if (f.show_cancelled !== 'all') w.push("COALESCE(i.factory_delivery_status,'') <> 'Cancel'");
  const rows = all(`SELECT i.id, i.factory_ref, i.contract_ref, COALESCE(c.client_name, i.client_name, '') client_name, COALESCE(c.emirate,'') emirate,
      i.supplier_name, i.supplier_id, COALESCE(i.quantity,0) units, substr(i.order_date,1,10) order_date, COALESCE(i.factory_quote_amount,0) amount,
      COALESCE(NULLIF(i.currency_code,''),'USD') currency, COALESCE(i.total_paid,0) total_paid, COALESCE(i.payment_status,'Unpaid') payment_status,
      COALESCE(i.production_status,'') production_status, COALESCE(i.factory_delivery_status,'') factory_status, COALESCE(i.shipping_status,'') shipping_status,
      i.needs_review
    FROM factory_ins_quotes i LEFT JOIN contracts c ON c.contract_ref = i.contract_ref AND c.is_deleted = 0
    WHERE ${w.join(' AND ')}`, p);
  const live = rows.filter(r => r.factory_status !== 'Cancel');
  const g = s => M.sumUnits(live.filter(r => PROD_GROUP(r.factory_status) === s));
  const kpis = [kpi('Ordered Units', M.sumUnits(live), { unit: 'Units', sub: `${live.length} order(s)`, tone: 'blue' }),
    kpi('Under Production', g('Under Production'), { unit: 'Units', tone: 'amber' }), kpi('Ready / Hold', g('Ready / Hold'), { unit: 'Units', tone: 'purple' }),
    kpi('Shipping', g('Shipping'), { unit: 'Units', tone: 'teal' }), kpi('Delivered', g('Delivered'), { unit: 'Units', tone: 'green' }),
    kpi('Cancelled', M.sumUnits(rows.filter(r => r.factory_status === 'Cancel')), { unit: 'Units', sub: f.show_cancelled ? '' : 'excluded by default (Orders filter)', tone: 'red' })];
  let chart = null, month_table = null;
  if (y) {
    const yr = m ? M.factoryOrderRows({ year: y }, {}).filter(r => r.factory_delivery_status !== 'Cancel') : live;
    const b = monthBuckets(y && m ? yr : live, r => monthIdx(r.order_date), { units: r => r.units, orders: () => 1 });
    let cum = 0; b.forEach(x => { cum += x.units; x.cum = cum; });
    chart = { title: `Monthly Ordered Units — ${y}`, subtitle: 'Factory ordered units by Order Date (bars) and cumulative (line)', labels: MON, highlight: m ? m - 1 : null, drill: 'month',
      datasets: [{ label: 'Ordered Units', data: b.map(x => x.units), type: 'bar', axis: 'y', color: COLORS.blue }, { label: 'Cumulative Units', data: b.map(x => x.cum), type: 'line', axis: 'y1', color: COLORS.teal }],
      y_title: 'Units / month', y1_title: 'Cumulative units' };
    month_table = { title: `Month-wise Factory Orders — ${y}`, highlight: m ? m - 1 : null, drill: 'month', columns: ['Month', 'Orders', 'Ordered Units', 'Cumulative Units'],
      rows: b.map(x => [x.name, x.orders, x.units, x.cum]), total: [`Total ${y}`, b.reduce((s, x) => s + x.orders, 0), cum, cum] };
  }
  const sup = groupBy(live, supplierLabel(), { units: r => r.units, orders: () => 1 });   // grouped by supplier_id (Supplier Master)
  const st = groupBy(live, r => PROD_GROUP(r.factory_status), { units: r => r.units, orders: () => 1 });
  const breakdowns = [{ title: 'Ordered Units by Supplier / Factory', columns: ['Supplier', 'Orders', 'Units'], drill_param: 'supplier', rows: sup.map(x => [x.name, x.orders, x.units]) },
    { title: 'Units by Factory / Delivery Status', columns: ['Status', 'Orders', 'Units'], rows: st.map(x => [x.name, x.orders, x.units]) }];
  const notes = [];
  const noDate = get(`SELECT COUNT(*) n, COALESCE(SUM(quantity),0) u FROM factory_ins_quotes WHERE is_deleted = 0 AND (order_date IS NULL OR order_date = '') AND COALESCE(factory_delivery_status,'') <> 'Cancel'`);
  if (y && noDate.n) notes.push({ text: `${noDate.n} order(s) (${noDate.u} units) have no Order Date — excluded from year/month figures; select All Years to include them.` });
  const reg = sortRecords(rows, f, { order_date: 'order_date', quantity: 'units', factory_ref: 'factory_ref', amount: 'amount', supplier_name: 'supplier_name' }, 'order_date');
  return stdOut({ type: 'ins-quotes-units', title: `Factory Orders & Production${y ? ' — ' + (m ? MONTH[m - 1] + ' ' : '') + y : ''}`,
    description: 'Factory ordered units by Order Date with current production / delivery status', metric: 'Elevator Units',
    year: y, month: m, kpis, chart, month_table, breakdowns, notes, register_title: 'Factory Order Register',
    columns: ['Factory Ref.', 'Contract Ref.', 'Client', 'Emirate', 'Supplier', 'Qty (Units)', 'Order Date', 'Amount', 'Currency', 'Payment Status', 'Production Status', 'Factory / Delivery Status', 'Shipping Status'],
    registerRows: reg.map(r => [r.factory_ref || '', r.contract_ref || '', r.client_name, r.emirate, r.supplier_name || '', r.units, r.order_date || '', r2(r.amount), r.currency,
      r.payment_status, r.production_status, r.factory_status, r.shipping_status]),
    scope_total: M.sumUnits(live), summary: { total_units: M.sumUnits(live) } }, f);
}

function buildShippingReport(f) {
  const y = f.year ? yearOf(f) : null, m = monthOf(f);
  const p = [];
  const w = ['s.is_deleted = 0'];
  const basis = "COALESCE(NULLIF(s.bl_no,''), NULLIF(s.etd,''))";              // ETA (stored in bl_no), else ETD
  if (y) { w.push(`${basis} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'`); w.push(m ? `substr(${basis},1,7) = ?` : `substr(${basis},1,4) = ?`); p.push(m ? `${y}-${String(m).padStart(2, '0')}` : y); }
  if (f.search) { w.push(`(s.factory_ref LIKE ? OR COALESCE(s.client_name,'') LIKE ? OR COALESCE(s.project_description,'') LIKE ? OR COALESCE(s.remarks,'') LIKE ?)`); p.push(...Array(4).fill(`%${f.search}%`)); }
  if (f.shipping_status) { w.push('s.shipping_status = ?'); p.push(f.shipping_status); }
  if (f.delivery_status) { w.push('s.delivery_status = ?'); p.push(f.delivery_status); }
  if (f.payment_status)  { w.push('s.payment_status = ?');  p.push(f.payment_status); }
  const rows = all(`SELECT s.id, s.factory_ref, s.client_name bl_ref, s.project_description, substr(s.etd,1,10) etd, substr(s.bl_no,1,10) eta,
      substr(${basis},1,10) basis_date, COALESCE(s.sea_cost,0) shipping_usd, COALESCE(s.clearance_cost,0) clearance_aed, COALESCE(s.total_paid,0) paid_usd,
      COALESCE(s.payment_status,'') payment_status, COALESCE(s.shipping_status,'') shipping_status, COALESCE(s.delivery_status,'') delivery_status, COALESCE(s.remarks,'') remarks
    FROM factory_sea_costs s WHERE ${w.join(' AND ')}`, p);
  const sum = k => r2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));
  const cnt = (k, v) => rows.filter(r => r[k] === v).length;
  const kpis = [kpi('Shipments', rows.length, { unit: 'Shipments', tone: 'blue' }), kpi('Shipping Cost (USD)', sum('shipping_usd'), { fmt: 'money', cur: 'USD', tone: 'teal' }),
    kpi('Clearance Cost (AED)', sum('clearance_aed'), { fmt: 'money', cur: 'AED', tone: 'purple', sub: 'kept separate from USD' }),
    kpi('Total Paid (USD)', sum('paid_usd'), { fmt: 'money', cur: 'USD', tone: 'green' }),
    kpi('Shipped / Delayed / Delivered', `${cnt('shipping_status', 'Shipped')} / ${cnt('shipping_status', 'Delayed')} / ${cnt('shipping_status', 'Delivered')}`, { sub: 'Shipping Status (shipments)', tone: 'amber' })];
  let chart = null, month_table = null;
  if (y) {
    const b = monthBuckets(rows, r => monthIdx(r.basis_date), { n: () => 1, usd: r => r.shipping_usd, aed: r => r.clearance_aed });
    chart = { title: `Monthly Shipments — ${y}`, subtitle: 'Shipments by ETA month (ETD when no ETA) — count (bars) and Shipping Cost USD (line)', labels: MON, highlight: m ? m - 1 : null, drill: 'month',
      datasets: [{ label: 'Shipments', data: b.map(x => x.n), type: 'bar', axis: 'y', color: COLORS.blue }, { label: 'Shipping Cost (USD)', data: b.map(x => x.usd), type: 'line', axis: 'y1', color: COLORS.amber }],
      y_title: 'Shipments', y1_title: 'USD' };
    month_table = { title: `Month-wise Shipments — ${y}`, highlight: m ? m - 1 : null, drill: 'month', columns: ['Month', 'Shipments', 'Shipping Cost (USD)', 'Clearance Cost (AED)'],
      rows: b.map(x => [x.name, x.n, money(x.usd), money(x.aed)]), total: [`Total ${y}`, rows.length, money(sum('shipping_usd')), money(sum('clearance_aed'))] };
  }
  const bs = k => groupBy(rows, r => r[k], { n: () => 1, usd: r => r.shipping_usd, aed: r => r.clearance_aed });
  const breakdowns = [
    { title: 'By Shipping Status', columns: ['Shipping Status', 'Shipments', 'Shipping Cost (USD)', 'Clearance (AED)'], drill_param: 'shipping_status', rows: bs('shipping_status').map(x => [x.name, x.n, money(x.usd), money(x.aed)]) },
    { title: 'By Delivery Status', columns: ['Delivery Status', 'Shipments', 'Shipping Cost (USD)', 'Clearance (AED)'], drill_param: 'delivery_status', rows: bs('delivery_status').map(x => [x.name, x.n, money(x.usd), money(x.aed)]) },
  ];
  const notes = [];
  const undated = get(`SELECT COUNT(*) n FROM factory_sea_costs s WHERE s.is_deleted = 0 AND NULLIF(s.bl_no,'') IS NULL AND NULLIF(s.etd,'') IS NULL`).n;
  if (y && undated) notes.push({ text: `${undated} shipment(s) have neither ETA nor ETD recorded (older records) — select All Years to include them.` });
  const reg = sortRecords(rows, f, { eta: 'eta', etd: 'etd', shipping_cost: 'shipping_usd', factory_ref: 'factory_ref', payment_status: 'payment_status', balance: 'paid_usd' }, 'eta');
  return stdOut({ type: 'sea-costs', title: `Shipping & Delivery${y ? ' — ' + (m ? MONTH[m - 1] + ' ' : '') + y : ''}`,
    description: 'Shipments by ETA / ETD with USD shipping and AED clearance costs (never added together)', metric: 'Shipments',
    year: y, month: m, kpis, chart, month_table, breakdowns, notes, register_title: 'Shipping Register',
    columns: ['Shipping Ref.', 'BL No. / Ref.', 'ETD', 'ETA', 'Shipping Cost (USD)', 'Clearance Cost (AED)', 'Total Paid (USD)', 'Shipping Balance (USD)', 'Payment Status', 'Shipping Status', 'Delivery Status', 'Remarks'],
    registerRows: reg.map(r => [r.factory_ref || '', r.bl_ref || '', r.etd || '', r.eta || '', r2(r.shipping_usd), r2(r.clearance_aed), r2(r.paid_usd), r2(r.shipping_usd - r.paid_usd),
      r.payment_status, r.shipping_status, r.delivery_status, r.remarks]),
    scope_total: rows.length }, f);
}

const SOURCE_LABEL = { ins_quotes: 'New Orders', otj_quotes: 'OTJ Orders', sea_costs: 'Shipping' };
function buildFactoryPaymentsReport(f) {
  const y = f.year ? yearOf(f) : null, m = monthOf(f);
  const dims = { factory_table: f.factory_table, payment_type: f.payment_type, supplier: f.supplier, search: f.search };
  const txns = M.factoryPaymentRows(y ? { year: y, month: m } : null, dims);
  const yearTx = y && m ? M.factoryPaymentRows({ year: y }, dims) : txns;
  // Payables — current balance per factory record (USD). Clearance (AED) is shown separately, never added to USD.
  const srcW = t => f.factory_table && f.factory_table !== t ? '1 = 0' : '1 = 1';
  const sw = f.supplier ? ` AND supplier_name LIKE '%' || ? || '%'` : '';
  const sp = f.supplier ? [f.supplier] : [];
  const payables = [
    ...all(`SELECT 'ins_quotes' src, factory_ref, supplier_name, contract_ref, COALESCE(factory_quote_amount,0) amount, COALESCE(total_paid,0) paid, 0 clearance, COALESCE(payment_status,'') payment_status, substr(order_date,1,10) ref_date FROM factory_ins_quotes WHERE is_deleted = 0 AND COALESCE(factory_delivery_status,'') <> 'Cancel' AND ${srcW('ins_quotes')}${sw}`, sp),
    ...all(`SELECT 'otj_quotes' src, factory_ref, supplier_name, contract_ref, COALESCE(other_job_cost,0) amount, COALESCE(total_paid,0) paid, 0 clearance, COALESCE(payment_status,'') payment_status, NULL ref_date FROM factory_otj_quotes WHERE is_deleted = 0 AND ${srcW('otj_quotes')}${sw}`, sp),
    ...all(`SELECT 'sea_costs' src, factory_ref, supplier_name, contract_ref, COALESCE(sea_cost,0) amount, COALESCE(total_paid,0) paid, COALESCE(clearance_cost,0) clearance, COALESCE(payment_status,'') payment_status, substr(bl_no,1,10) ref_date FROM factory_sea_costs WHERE is_deleted = 0 AND ${srcW('sea_costs')}${sw}`, sp),
  ].map(r => ({ ...r, outstanding: r2(Math.max(0, r.amount - r.paid)) }));
  const paidCur = M.byCurrency(txns);
  const outUsd = r2(payables.reduce((s, r) => s + r.outstanding, 0));
  const kpis = [kpi('Payments', txns.length, { unit: 'Transactions', tone: 'blue' })]
    .concat(Object.keys(paidCur).length ? Object.entries(paidCur).map(([c, v]) => kpi(`Total Paid (${c}) — ${y ? scopeLabel(y, m) : 'All'}`, v, { fmt: 'money', cur: c, tone: 'green' })) : [kpi('Total Paid', 0, { fmt: 'money', cur: 'USD', tone: 'green' })])
    .concat([kpi('Outstanding Payables (USD)', outUsd, { fmt: 'money', cur: 'USD', sub: 'current: amount − total paid per factory record', tone: outUsd ? 'red' : '' }),
      kpi('Open Payables', payables.filter(r => r.outstanding > 0).length, { unit: 'Records', tone: 'amber' })]);
  let chart = null, month_table = null;
  if (y) {
    const curs = [...new Set(yearTx.map(t => t.currency))];
    const b = monthBuckets(yearTx, r => monthIdx(r.payment_date), Object.fromEntries((curs.length ? curs : ['USD']).map(c => [c, r => r.currency === c ? r.amount : 0])));
    chart = { title: `Monthly Factory Payments — ${y}`, subtitle: 'Actual payments by Payment Date, per currency (currencies never combined)', labels: MON, highlight: m ? m - 1 : null, drill: 'month',
      datasets: (curs.length ? curs : ['USD']).map((c, i) => ({ label: `Paid (${c})`, data: b.map(x => x[c]), type: 'bar', axis: 'y', color: [COLORS.blue, COLORS.amber, COLORS.teal][i % 3] })), y_title: 'Amount' };
    month_table = { title: `Month-wise Factory Payments — ${y}`, highlight: m ? m - 1 : null, drill: 'month', columns: ['Month', ...(curs.length ? curs : ['USD']).map(c => `Paid (${c})`)],
      rows: b.map(x => [x.name, ...(curs.length ? curs : ['USD']).map(c => money(x[c]))]), total: [`Total ${y}`, ...(curs.length ? curs : ['USD']).map(c => money(M.byCurrency(yearTx)[c] || 0))] };
  }
  const bySup = groupBy(txns, supplierLabel(), { n: () => 1, amt: r => r.amount });   // grouped by supplier_id (Supplier Master)
  const bySrc = groupBy(payables, r => SOURCE_LABEL[r.src], { amount: r => r.amount, paid: r => r.paid, out: r => r.outstanding, clr: r => r.clearance });
  const breakdowns = [
    { title: 'Payments by Supplier', columns: ['Supplier', 'Payments', 'Paid'], drill_param: 'supplier', rows: bySup.map(x => [x.name, x.n, money(x.amt)]) },
    { title: 'Payables by Source (current)', columns: ['Source', 'Amount (USD)', 'Paid (USD)', 'Outstanding (USD)', 'Clearance (AED)'], rows: bySrc.map(x => [x.name, money(x.amount), money(x.paid), money(x.out), x.clr ? money(x.clr) : '—']) },
  ];
  const payablesMode = f.view_mode === 'payables';
  let columns, registerRows;
  if (payablesMode) {
    const reg = sortRecords(payables.filter(r => !f.search || [r.factory_ref, r.supplier_name, r.contract_ref].some(v => String(v || '').toLowerCase().includes(String(f.search).toLowerCase()))), f,
      { balance_amount: 'outstanding', factory_ref: 'factory_ref', supplier_name: 'supplier_name', total_amount: 'amount', paid_amount: 'paid' }, 'balance_amount');
    columns = ['Source', 'Factory Ref.', 'Supplier', 'Contract Ref.', 'Amount (USD)', 'Total Paid (USD)', 'Outstanding (USD)', 'Clearance (AED)', 'Payment Status', 'Order / ETA Date'];
    registerRows = reg.map(r => [SOURCE_LABEL[r.src], r.factory_ref || '', r.supplier_name || '', r.contract_ref || '', r2(r.amount), r2(r.paid), r.outstanding, r.clearance ? r2(r.clearance) : '', r.payment_status, r.ref_date || '']);
  } else {
    const reg = sortRecords(txns, f, { payment_date: 'payment_date', factory_ref: 'factory_ref', supplier_name: 'supplier_name', paid_amount: 'amount' }, 'payment_date');
    columns = ['Payment Ref.', 'Payment Date', 'Source', 'Factory Ref.', 'Contract Ref.', 'Supplier', 'Client', 'Payment Type', 'Payment Mode', 'Paid Amount', 'Currency', 'Remarks'];
    registerRows = reg.map(r => [r.payment_ref || '', r.payment_date || '', SOURCE_LABEL[r.factory_table] || r.factory_table || '', r.factory_ref || '', r.contract_ref || '', r.supplier_name || '', r.client_name || '', r.payment_type || '', r.payment_mode || '', r2(r.amount), r.currency, r.remarks || '']);
  }
  return stdOut({ type: 'factory-payments-register', title: `Factory Payments${y ? ' — ' + (m ? MONTH[m - 1] + ' ' : '') + y : ''}`,
    description: 'Factory & supplier payments by Payment Date (per currency) and current outstanding payables', metric: 'Amount (per currency)',
    year: y, month: m, kpis, chart, month_table, breakdowns, register_title: payablesMode ? 'Payables Register (current balances)' : 'Payment Transaction Register',
    columns, registerRows, scope_total: r2(Object.values(paidCur).reduce((s, v) => s + v, 0)), summary: { paid_by_currency: paidCur, outstanding_usd: outUsd } }, f);
}

// ══════════════════════════════════════════════════════════════════════════════
// MAINTENANCE
// ══════════════════════════════════════════════════════════════════════════════
/** Wrap the authoritative Monthly Maintenance builder output into the standard template. */
function standardiseMonthlyMaintenance(d, f) {
  const s = d.summary || {};
  const y = d.year, m = d.month;
  const kpis = [kpi('Due Units', s.due_this_month || 0, { unit: 'Units', tone: 'blue' }), kpi('Scheduled Units', s.scheduled_this_month || 0, { unit: 'Units', tone: 'purple' }),
    kpi('Completed Units', s.completed_this_month || 0, { unit: 'Units', tone: 'green' }), kpi('Partial', s.partial_this_month || 0, { unit: 'Units', tone: 'amber' }),
    kpi('Pending', s.pending_this_month || 0, { unit: 'Units', tone: (s.pending_this_month || 0) ? 'amber' : '' }), kpi('Postponed', s.postponed_this_month || 0, { unit: 'Units' }),
    kpi('Hold', s.hold_this_month || 0, { unit: 'Units' }), kpi('Missed', s.missed_this_month || 0, { unit: 'Units', tone: (s.missed_this_month || 0) ? 'red' : '' }),
    kpi('Completion %', s.completion_pct || 0, { fmt: 'pct', sub: 'Completed ÷ Due units', tone: (s.completion_pct || 0) >= 80 ? 'green' : 'amber' })];
  const ms = d.monthly_summary || [];
  const chart = { title: `12-Month Service Trend — ${y}`, subtitle: 'Due, scheduled and completed elevator units per month (maintenance schedule engine)', labels: MON, highlight: m ? m - 1 : null, drill: 'month',
    datasets: [{ label: 'Due Units', data: ms.map(x => x.due), type: 'bar', axis: 'y', color: COLORS.grey },
      { label: 'Completed Units', data: ms.map(x => x.completed), type: 'bar', axis: 'y', color: COLORS.green },
      { label: 'Scheduled Units', data: ms.map(x => x.scheduled), type: 'line', axis: 'y', color: COLORS.blue }], y_title: 'Units',
    reconcile: 1 };   // drill-down reconciles against Completed Units
  const month_table = { title: `Month-wise Maintenance Summary — ${y}`, highlight: m ? m - 1 : null, drill: 'month',
    columns: ['Month', 'Due', 'Scheduled', 'Completed', 'Partial', 'Pending', 'Postponed', 'Hold', 'Missed', 'Completion %'],
    rows: ms.map(x => [x.month, x.due, x.scheduled, x.completed, x.partial != null ? x.partial : '', x.pending, x.postponed, x.hold, x.missed != null ? x.missed : (x.overdue || 0), `${x.completion_pct}%`]) };
  const es = d.emirate_summary || [];
  const breakdowns = [{ title: `By Emirate — ${MONTH[m - 1]} ${y}`, columns: ['Emirate', 'Due', 'Scheduled', 'Completed', 'Pending', 'Completion %'], drill_param: 'emirate',
    rows: es.map(x => [x.emirate, x.due != null ? x.due : x.scheduled, x.scheduled, x.completed, x.pending, `${x.completion_pct}%`]) }];
  const out = stdOut({ type: 'monthly-maintenance', title: `Monthly Maintenance Report — ${MONTH[m - 1]} ${y}`,
    description: 'Monthly due, scheduled and serviced elevator units (authoritative maintenance schedule)', metric: 'Elevator Units',
    year: y, month: m, kpis, chart, month_table, breakdowns, register_title: `Visit Detail Register — ${MONTH[m - 1]} ${y}`,
    columns: d.columns, registerRows: d._allRows || d.rows, scope_total: s.completed_this_month || 0, summary: s }, f);
  return out;
}

// ── Monthly Service Register (technician field sheet) — 2026-10-01 ───────────
// READ-ONLY. Population = the authoritative monthly service population from
// db/maintMetrics.js (same as Monthly Schedule / Calendar / Dashboard / Monthly
// Maintenance): scheduled regular + manual recovery months for eligible AMC, plus
// off-schedule services actually performed. Not-due interval months, Hold/
// Cancelled contracts (unless serviced) and empty placeholder visits are excluded
// by that engine — no separate schedule calculation exists here.
//   Contracts = one row per maintenance record (grouped refs stay one row)
//   Units     = Σ scheduled elevator units of those rows (multi-unit aware)
//   Last Service = MAX(completion_date) of Completed visits up to month end
//                  (same definition as Maintenance Records' last_service_date)
//   Scheduled Date = planned date of the month's schedule row, else the visit's
//                  planned/postponed date, else BLANK (never invented, no placeholder)
const SR_STATUS = { Pending: 'Scheduled', Scheduled: 'Scheduled', Completed: 'Completed', 'Partially Completed': 'Partial (Serviced)',
  Postponed: 'Postponed', Hold: 'Hold', Missed: 'Missed', Cancelled: 'Cancelled' };
function serviceAlert(status, dueDate, y, m) {
  if (['Completed', 'Partial (Serviced)', 'Hold', 'Missed', 'Cancelled'].includes(status)) return 'Closed';
  const t = new Date(); t.setHours(0, 0, 0, 0);
  if (dueDate) {
    const d = new Date(dueDate.slice(0, 10) + 'T00:00:00');
    const diff = Math.floor((d - t) / 864e5);
    return diff < 0 ? 'Overdue' : diff === 0 ? 'Due Today' : diff <= 7 ? 'Upcoming' : 'Scheduled';
  }
  // No planned date → month-based (a not-yet-ended month is never Overdue)
  const cur = t.getFullYear() * 12 + t.getMonth(), sel = Number(y) * 12 + (m - 1);
  return sel < cur ? 'Overdue' : sel === cur ? 'Due This Month' : 'Upcoming';
}

function buildServiceRegister(f) {
  const now = new Date();
  const y = String(parseInt(f.year, 10) || now.getFullYear());
  const m = monthOf(f) || (now.getMonth() + 1);
  const mm = getMonthlyMaintenanceMetrics(Number(y), m, { emirate: f.emirate, maintenance_type: f.maintenance_type });
  const monthEnd = `${y}-${String(m).padStart(2, '0')}-31`;
  const lastSvc = new Map(all(`SELECT maintenance_contract_id id, MAX(substr(completion_date,1,10)) d FROM maintenance_visits
      WHERE maintenance_status = 'Completed' AND completion_date IS NOT NULL AND completion_date <> '' AND substr(completion_date,1,10) <= ?
      GROUP BY maintenance_contract_id`, [monthEnd]).map(r => [r.id, r.d]));
  let rows = mm.rows.map(r => {
    const status = SR_STATUS[r.status] || r.status || 'Scheduled';
    // Only a genuine YYYY-MM-DD planned date counts; NULL / '' / legacy blank → no date (cell left blank)
    const isoOr = v => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v).trim())) ? String(v).trim().slice(0, 10) : null;
    const planned = isoOr(r.schedule_date) || (r.status === 'Postponed' && isoOr(r.postponed_date)) || isoOr(r.scheduled_date) || null;
    return { contract_id: r.contract_id, contract_ref: r.contract_ref || '', client_name: r.client_name || '', emirate: String(r.emirate || '').trim(),
      maintenance_type: r.maintenance_type || '', period: r.maintenance_period || '', units: Number(r.sched_units) || 0,
      last_service: lastSvc.get(r.contract_id) || null, scheduled: planned ? String(planned).slice(0, 10) : null, status,
      alert: serviceAlert(status, planned ? String(planned) : null, y, m) };
  });
  if (f.search) { const q = String(f.search).toLowerCase(); rows = rows.filter(r => r.contract_ref.toLowerCase().includes(q) || r.client_name.toLowerCase().includes(q)); }
  if (f.status) rows = rows.filter(r => r.status === f.status);
  // Default order: confirmed Scheduled Dates ascending, blank dates after, then Contract Ref.
  const key = f.sort_by || 'scheduled_date';
  const dir = String(f.sort_dir || (key === 'scheduled_date' ? 'asc' : 'asc')).toLowerCase() === 'desc' ? -1 : 1;
  const refCmp = (a, b) => a.contract_ref.localeCompare(b.contract_ref, undefined, { numeric: true });
  const field = { contract_ref: 'contract_ref', client_name: 'client_name', emirate: 'emirate', last_service_date: 'last_service', status: 'status', maintenance_type: 'maintenance_type' }[key];
  rows.sort((a, b) => {
    if (key === 'scheduled_date') {
      if (!a.scheduled !== !b.scheduled) return a.scheduled ? -1 : 1;           // blank dates always after dated rows
      return ((a.scheduled || '').localeCompare(b.scheduled || '')) * dir || refCmp(a, b);
    }
    const x = a[field] || '', z = b[field] || '';
    if (!x !== !z) return x ? -1 : 1;
    return String(x).localeCompare(String(z), undefined, { numeric: true }) * dir || refCmp(a, b);
  });
  const contracts = new Set(rows.map(r => r.contract_id)).size;
  const units = rows.reduce((s, r) => s + r.units, 0);
  const title = `Monthly Service Register — ${MONTH[m - 1]} ${y}`;
  const kpis = [kpi('Total AMC Contracts', contracts, { unit: 'Contracts', sub: `maintenance projects in the ${MONTH[m - 1]} ${y} service list`, tone: 'blue' }),
    kpi('Total AMC Units', units, { unit: 'Units', sub: 'elevator units scheduled for service', tone: 'green' })];
  const out = stdOut({ type: 'service-register', title, description: 'Monthly technician maintenance planning and service list (authoritative monthly schedule)',
    metric: 'Maintenance projects / elevator units', year: y, month: m, kpis, chart: null, breakdowns: [], register_title: title,
    columns: ['S. No.', 'Contract Ref.', 'Client', 'Emirate', 'Type', 'Period', 'Last Service Date', 'Scheduled Date', 'Status', 'Alert'],
    registerRows: rows.map((r, i) => [i + 1, r.contract_ref, r.client_name, r.emirate, r.maintenance_type, r.period, r.last_service || '', r.scheduled || '', r.status, r.alert]),
    scope_total: units, summary: { total_contracts: contracts, total_units: units },
    extra: { excel_date_cols: ['Last Service Date', 'Scheduled Date'], empty_message: 'No maintenance services scheduled for the selected month.', col_weights: [4, 9, 22, 8, 10, 9, 9, 9, 10, 10] } }, f);
  out.subtitle_lines = [`Month: ${MONTH[m - 1]} ${y} · Total AMC Contracts: ${contracts} · Total AMC Units: ${units}`, out.subtitle_lines[1]];
  return out;
}

function buildAmcPortfolioReport(f) {
  const y = yearOf(f), m = monthOf(f);
  const p = [];
  const w = ['mc.is_deleted = 0'];
  if (f.emirate) { w.push('TRIM(mc.emirate) = ?'); p.push(f.emirate); }
  if (f.maintenance_type) { w.push('mc.maintenance_type = ?'); p.push(f.maintenance_type); }
  if (f.search) { w.push('(mc.contract_ref LIKE ? OR mc.client_name LIKE ? OR mc.maintenance_id LIKE ?)'); p.push(`%${f.search}%`, `%${f.search}%`, `%${f.search}%`); }
  const today = new Date().toISOString().slice(0, 10);
  const rows = all(`SELECT mc.id, mc.maintenance_id, mc.contract_ref, mc.client_name, TRIM(mc.emirate) emirate, mc.maintenance_type, mc.maintenance_period,
      COALESCE(NULLIF(mc.total_elevator_units,0),1) units, mc.renewal_status, ${currentStartSql('mc')} cur_start, ${currentEndSql('mc')} cur_end,
      ${mcNotCancelledSql('mc')} not_cancelled, ${renewalInProgressSql('mc')} in_progress,
      (SELECT r.renewal_ref || '|' || r.renewal_status || '|' || COALESCE(r.amc_activation_status,'') FROM amc_renewals r WHERE r.contract_ref = mc.contract_ref AND r.is_deleted = 0
        ORDER BY COALESCE(r.new_start_date,'9999') DESC, r.id DESC LIMIT 1) latest
    FROM maintenance_contracts mc WHERE ${w.join(' AND ')}`, p).map(r => {
      const [ref, rs, act] = String(r.latest || '||').split('|');
      const days = r.cur_end ? Math.round((new Date(r.cur_end) - new Date(today)) / 864e5) : null;
      const st = !r.not_cancelled ? 'Cancelled' : r.renewal_status === 'Hold' ? 'Hold' : r.renewal_status === 'Renewed' ? 'Superseded'
        : (r.cur_end && r.cur_end < today) ? 'Expired' : 'Active';
      return { ...r, latest_ref: ref || '', latest_status: rs || '', latest_activation: act || '', days, portfolio_status: st };
    });
  const scope = f.renewal_status ? rows.filter(r => r.portfolio_status === f.renewal_status) : rows;
  const u = s => M.sumUnits(scope.filter(r => r.portfolio_status === s));
  const exp30 = M.sumUnits(scope.filter(r => r.portfolio_status === 'Active' && r.days != null && r.days <= 30));
  // 2026-10-07: Renewal Performance from the ONE renewal service (db/amcRenewals.js) —
  // renewal HISTORY (not the Renewal Status action queue, not current-only), completed =
  // Approved + Active + paid > 0, month = first valid payment date, units = Maintenance
  // Record units (one row per renewal — payments never multiply units). Same service as
  // Maintenance Dashboard → Renewal Performance and the Monthly Management Report.
  const AR = require('../db/amcRenewals.js');
  const rf = { emirate: f.emirate, maintenance_type: f.maintenance_type, payment_status: f.payment_status, search: f.search };
  const perf = AR.getRenewalPerformance(y, rf);
  const renScope = m ? perf.months[m - 1] : perf.total;
  const kpis = [kpi('Active AMC', u('Active'), { unit: 'Units', sub: 'current portfolio', tone: 'green' }),
    kpi(`Renewed — ${scopeLabel(y, m)}`, renScope.units, { unit: 'Units', sub: `${renScope.projects} project(s) · ${renScope.renewals} renewal(s)`, tone: 'blue' }),
    kpi('Expiring ≤ 30 Days', exp30, { unit: 'Units', tone: exp30 ? 'amber' : '' }), kpi('Expired', u('Expired'), { unit: 'Units', tone: u('Expired') ? 'red' : '' }),
    kpi('Hold', u('Hold'), { unit: 'Units', tone: 'purple' }), kpi('Cancelled', u('Cancelled'), { unit: 'Units', tone: 'red' })];
  const chart = { title: `AMC Renewal Performance — ${y}`, subtitle: 'Renewed elevator units per month — completed renewals (Approved + Active + payment received) by Renewal Date = first payment date. Click a month for its renewals.',
    labels: MON, highlight: m ? m - 1 : null, drill: 'month', drill_table: 'month_renewals', reconcile: 0,
    datasets: [{ label: 'Renewed Units', data: perf.months.map(x => x.units), type: 'bar', axis: 'y', color: COLORS.purple }], y_title: 'Units' };
  const month_table = { title: `Month-wise AMC Renewals — ${y}`, highlight: m ? m - 1 : null, drill: 'month', columns: ['Month', 'Renewed Projects', 'Renewed Units'],
    rows: perf.months.map(x => [x.label, x.projects, x.units]), total: [`Total ${y}`, perf.total.projects, perf.total.units] };
  const ST = ['Active', 'Expired', 'Hold', 'Cancelled'];
  const byType = groupBy(scope, r => r.maintenance_type, Object.fromEntries(ST.map(s => [s, r => r.portfolio_status === s ? r.units : 0])));
  const byEm = groupBy(scope, r => r.emirate, Object.fromEntries(ST.map(s => [s, r => r.portfolio_status === s ? r.units : 0])));
  const breakdowns = [{ title: 'Portfolio by Maintenance Type (units)', columns: ['Type', ...ST], drill_param: 'maintenance_type', rows: byType.map(x => [x.name, ...ST.map(s => x[s])]) },
    { title: 'Portfolio by Emirate (units)', columns: ['Emirate', ...ST], drill_param: 'emirate', rows: byEm.map(x => [x.name, ...ST.map(s => x[s])]) }];
  const notes = [];
  if (m) {
    const md = AR.getRenewalMonthDetails(y, m, rf);
    breakdowns.push({ key: 'month_renewals', total_value: md.units, empty_message: 'No AMC renewals found for this month.',
      title: `AMC Renewals — ${MONTH[m - 1]} ${y} · Renewed Projects: ${md.projects} · Renewed Units: ${md.units}`,
      columns: ['Renewal Ref.', 'Contract Ref.', 'Client', 'Emirate', 'AMC Type', 'Units', 'Previous Period', 'New Period', 'Renewal Date', 'Renewal Status', 'Activation', 'Payment Status', 'Received (AED)', 'Outstanding (AED)'],
      rows: md.rows.map(r => [r.renewal_ref, r.contract_ref, r.client_name || '', r.emirate || '', r.maintenance_type || '', r.units,
        r.prev_start_date || r.prev_end_date ? `${r.prev_start_date || '?'} – ${r.prev_end_date || '?'}` : '—', `${r.new_start_date || '?'} – ${r.new_end_date || '?'}`,
        r.renewal_date, r.cancelled_after_renewal ? `${r.renewal_status} (after renewal)` : r.renewal_status, r.amc_activation_status || '', r.payment_status, money(r.received), money(r.outstanding)])
        .concat(md.rows.length ? [['Total', `${md.projects} project(s)`, '', '', '', md.units, '', '', '', '', '', '', money(md.rows.reduce((a, r) => a + r.received, 0)), money(md.rows.reduce((a, r) => a + r.outstanding, 0))]] : []) });
  }
  if (perf.pending.length) notes.push({ text: `${perf.pending.length} renewal(s) not yet completed (pending approval / activation / initial payment) — not counted as renewed.`,
    title: 'Pending Renewals (not counted)', columns: ['Renewal Ref.', 'Contract Ref.', 'Client', 'Renewal Status', 'Activation', 'Reason', 'New Period'],
    rows: perf.pending.map(r => [r.renewal_ref, r.contract_ref, r.client_name || '', r.renewal_status, r.amc_activation_status || '', r.pending_reason, `${r.new_start_date || '?'} – ${r.new_end_date || '?'}`]) });
  if (perf.undated.length) notes.push({ text: `${perf.undated.length} completed renewal(s) have no dated payment — Renewal Date Missing, not placed in any month.`,
    title: 'Renewal Date Missing', columns: ['Renewal Ref.', 'Contract Ref.', 'Client', 'Units', 'Received (AED)'], rows: perf.undated.map(r => [r.renewal_ref, r.contract_ref, r.client_name || '', r.units, money(r.received)]) });
  if (perf.legacy_review.length) notes.push({ text: `${perf.legacy_review.length} completed renewal(s) need Legacy Data Review (unit quantity / Maintenance Record link).`,
    title: 'Legacy Data Review', columns: ['Renewal Ref.', 'Contract Ref.', 'Client', 'Issue'], rows: perf.legacy_review.map(r => [r.renewal_ref, r.contract_ref, r.client_name || '', r.flags.join('; ')]) });
  if (f.payment_status) notes.push({ text: `Payment Status "${f.payment_status}" filters Renewal Performance (chart, month table, drill-down). Portfolio status KPIs and the register show the current portfolio.` });
  const reg = sortRecords(scope, f, { end_date: 'cur_end', client_name: 'client_name', emirate: 'emirate', renewal_status: 'portfolio_status', days_to_expiry: 'days', contract_ref: 'contract_ref', units: 'units' }, 'end_date', 'asc');
  return stdOut({ type: 'amc-portfolio', title: `AMC Portfolio & Renewal — ${m ? MONTH[m - 1] + ' ' : ''}${y}`,
    description: 'Current AMC portfolio by elevator units (current AMC period) and completed AMC renewals by Renewal Date (first payment date)', metric: 'Elevator Units',
    year: y, month: m, kpis, chart, month_table, breakdowns, notes, register_title: 'Current AMC Portfolio Register (current position)',
    columns: ['AMC ID', 'Contract Ref.', 'Client', 'Emirate', 'Type', 'Period', 'Units', 'Current Start', 'Current End', 'Days to Expiry', 'Portfolio Status', 'Latest Renewal', 'Renewal Status', 'Activation'],
    registerRows: reg.map(r => [r.maintenance_id || '', r.contract_ref || '', r.client_name || '', r.emirate || '', r.maintenance_type || '', r.maintenance_period || '', r.units,
      r.cur_start || '', r.cur_end || '', r.days == null ? '' : r.days, r.portfolio_status, r.latest_ref, r.latest_status, r.latest_activation]),
    scope_total: renScope.units, summary: { renewal_performance: { months: perf.months, total: perf.total } } }, f);
}

function buildAmcPaymentsReport(f) {
  const amcPay = require('../db/amcPayments.js');
  const y = yearOf(f), m = monthOf(f);
  const out = amcPay.getOutstandingAMC({ emirate: f.emirate, maintenance_type: f.maintenance_type });
  // Current approved renewals (same population as the outstanding calculation) for AMC value / received
  const cur = all(`${amcPay.CURRENT_LEDGER_CTE} SELECT * FROM cur`).filter(r => r.renewal_status === 'Approved' && Number(r.new_amc_value) > 0
    && (!f.emirate || String(r.emirate || '').trim() === f.emirate) && (!f.maintenance_type || r.maintenance_type === f.maintenance_type)
    && (!f.search || [r.contract_ref, r.client_name, r.renewal_ref].some(v => String(v || '').toLowerCase().includes(String(f.search).toLowerCase()))));
  const status = r => { const v = r2(r.new_amc_value), rc = r2(r.total_received); return rc <= 0 ? 'Unpaid' : rc >= v - 0.005 ? 'Paid' : 'Partial'; };
  const scope = f.payment_status ? cur.filter(r => status(r) === f.payment_status) : cur;
  const value = r2(scope.reduce((s, r) => s + Number(r.new_amc_value || 0), 0));
  const received = r2(scope.reduce((s, r) => s + Number(r.total_received || 0), 0));
  const outstanding = r2(scope.reduce((s, r) => s + Math.max(0, r2(Number(r.new_amc_value || 0) - Number(r.total_received || 0))), 0));
  const cnt = s => scope.filter(r => status(r) === s).length;
  // 2026-10-07: Collections (cash received by Payment Date) come from the ONE authoritative
  // service shared with the Maintenance Dashboard (db/amcCollections.js). Only emirate /
  // maintenance type apply; payment status & search are portfolio filters and never hide
  // historical receipts. KPIs below the first two describe the CURRENT portfolio position.
  const amcCol = require('../db/amcCollections.js');
  const cf = { emirate: f.emirate, maintenance_type: f.maintenance_type };
  const col = amcCol.getAmcCollections(y, cf);
  const colScope = m ? col.months[m - 1] : col.total;
  // 2026-10-07: "Received on Current AMCs" removed from this report's KPI row (duplicated
  // the collection figure). The value stays in summary for API consumers; nothing shared changed.
  // Collected label is scope-aware: current year → "YTD <y>" (future-dated payments are
  // rejected by the ledger, so Jan–Dec of the current year = YTD); past/future year → "<y>";
  // a selected month → "<Mon> <y>". The value always equals the chart / month-table sum.
  const curYear = Number(String(amcPay.localToday()).slice(0, 4));
  const colLabel = m ? `${MON[m - 1]} ${y}` : (Number(y) === curYear ? `YTD ${y}` : `${y}`);
  const kpis = [kpi('AMC Value (AED)', value, { fmt: 'money', cur: 'AED', sub: `${scope.length} current approved renewal(s)`, tone: 'blue' }),
    kpi(`Collected — ${colLabel} (AED)`, colScope.received_amount, { fmt: 'money', cur: 'AED', sub: `${colScope.payment_count} payment(s) by Payment Date`, tone: 'green' }),
    kpi('Outstanding (AED)', outstanding, { fmt: 'money', cur: 'AED', sub: 'Current AMC portfolio balance', tone: outstanding ? 'red' : '' }),
    kpi('Paid', cnt('Paid'), { unit: 'Renewals', tone: 'green' }), kpi('Partial', cnt('Partial'), { unit: 'Renewals', tone: 'amber' }), kpi('Unpaid', cnt('Unpaid'), { unit: 'Renewals', tone: 'red' })];
  const chart = { title: `AMC Payments Received — ${y}`, subtitle: 'AMC Collections — valid AMC payment ledger transactions by actual Payment Date (AED). Same calculation as Maintenance Dashboard → AMC Collections. Click a month to list its receipts.',
    labels: MON, highlight: m ? m - 1 : null, drill: 'month', drill_table: 'month_payments',
    datasets: [{ label: 'Received (AED)', data: col.months.map(x => x.received_amount), type: 'bar', axis: 'y', color: COLORS.green }], y_title: 'AED', reconcile: 0 };
  const month_table = { title: `Month-wise AMC Receipts — ${y}`, highlight: m ? m - 1 : null, drill: 'month', columns: ['Month', 'Payments', 'Received (AED)'],
    rows: col.months.map(x => [x.label, x.payment_count, money(x.received_amount)]), total: [`Total ${y}`, col.total.payment_count, money(col.total.received_amount)] };
  const ps = ['Paid', 'Partial', 'Unpaid'].map(s => { const rs = scope.filter(r => status(r) === s);
    return [s, rs.length, M.sumUnits(rs), money(rs.reduce((a, r) => a + Number(r.new_amc_value || 0), 0)), money(rs.reduce((a, r) => a + Number(r.total_received || 0), 0)),
      money(rs.reduce((a, r) => a + Math.max(0, Number(r.new_amc_value || 0) - Number(r.total_received || 0)), 0))]; });
  const em = groupBy(scope, r => r.emirate, { out: r => Math.max(0, Number(r.new_amc_value || 0) - Number(r.total_received || 0)), n: () => 1 });
  const breakdowns = [{ title: 'By Payment Status', columns: ['Payment Status', 'Renewals', 'Units', 'AMC Value (AED)', 'Received (AED)', 'Outstanding (AED)'], drill_param: 'payment_status', rows: ps },
    { title: 'Outstanding by Emirate', columns: ['Emirate', 'Renewals', 'Outstanding (AED)'], drill_param: 'emirate', rows: em.map(x => [x.name, x.n, money(x.out)]) }];
  const notes = [];
  if (m) {
    const mt = amcCol.getAmcCollectionTransactions(y, m, cf);
    breakdowns.push({ key: 'month_payments', total_value: mt.received_amount, payment_count: mt.payment_count, empty_message: 'No AMC payments received in this month.',
      title: `AMC Payments Received — ${MONTH[m - 1]} ${y} (${mt.payment_count} payment(s))`,
      columns: ['Payment Date', 'Payment Ref.', 'Renewal Ref.', 'Contract Ref.', 'Client', 'AMC Period', 'Amount (AED)', 'Payment Mode', 'Recorded By', 'Remarks'],
      rows: mt.rows.map(t => [t.payment_date, t.payment_ref || '', t.renewal_ref || '', t.contract_ref || '', t.client_name || '',
        `${t.new_start_date || '?'} – ${t.new_end_date || '?'}`, money(t.amount), t.payment_method || '', t.entered_by || '', t.remarks || ''])
        .concat([['Total', '', '', '', '', '', money(mt.received_amount), '', '', '']]) });
  }
  if (col.missing_date.payment_count) {
    const md = amcCol.getAmcMissingDateTransactions(cf);
    notes.push({ text: `${md.payment_count} valid AMC payment(s) totalling ${money(md.received_amount)} have no Payment Date — not assigned to any month (Payment Date Missing).`,
      title: 'Payment Date Missing', columns: ['Payment Ref.', 'Renewal Ref.', 'Contract Ref.', 'Client', 'Renewal Status', 'Amount (AED)', 'Flag'],
      rows: md.rows.map(t => [t.payment_ref || '', t.renewal_ref || '', t.contract_ref || '', t.client_name || '', t.renewal_status || '', money(t.amount), t.flag]) });
  }
  if (f.payment_status || f.search) notes.push({ text: 'Payment Status / Search filters apply to the portfolio KPIs and receivables register only — AMC Collections (chart, month table, drill-down) always include all valid historical receipts.' });
  const reg = sortRecords(scope.map(r => ({ ...r, bal: r2(Math.max(0, Number(r.new_amc_value || 0) - Number(r.total_received || 0))), pstat: status(r) })), f,
    { balance: 'bal', contract_ref: 'contract_ref', client_name: 'client_name', new_amc_value: 'new_amc_value', latest_payment_date: 'latest_payment_date' }, 'balance');
  return stdOut({ type: 'amc-payments', title: `AMC Payments & Outstanding — ${y}`,
    description: 'Current AMC portfolio value, actual AMC collections and outstanding balance based on the AMC payment ledger', metric: 'AED',
    year: y, month: m, kpis, chart, month_table, breakdowns, notes, register_title: 'AMC Receivables Register (current renewals)',
    columns: ['Contract Ref.', 'Renewal Ref.', 'Client', 'Emirate', 'Type', 'Units', 'AMC Start', 'AMC End', 'AMC Value (AED)', 'Received (AED)', 'Outstanding (AED)', 'Payment Status', 'Last Payment Date', 'Activation'],
    registerRows: reg.map(r => [r.contract_ref, r.renewal_ref || '', r.client_name || '', r.emirate || '', r.maintenance_type || '', r.units, r.new_start_date || '', r.new_end_date || '',
      r2(r.new_amc_value), r2(r.total_received), r.bal, r.pstat, r.latest_payment_date || '', r.amc_activation_status || '']),
    scope_total: outstanding, summary: { outstanding_total_due: out.total_due, collections: col, received_on_current_amcs: received } }, f);
}

function buildAmcExpiryReport(f) {
  const y = yearOf(f), m = monthOf(f);
  const p = [];
  const w = ['mc.is_deleted = 0', mcNotCancelledSql('mc'), "COALESCE(mc.renewal_status,'') NOT IN ('Renewed')"];
  if (f.emirate) { w.push('TRIM(mc.emirate) = ?'); p.push(f.emirate); }
  if (f.maintenance_type) { w.push('mc.maintenance_type = ?'); p.push(f.maintenance_type); }
  if (f.search) { w.push('(mc.contract_ref LIKE ? OR mc.client_name LIKE ?)'); p.push(`%${f.search}%`, `%${f.search}%`); }
  const today = new Date().toISOString().slice(0, 10);
  const rows = all(`SELECT * FROM (SELECT mc.maintenance_id, mc.contract_ref, mc.client_name, TRIM(mc.emirate) emirate, mc.maintenance_type,
      COALESCE(NULLIF(mc.total_elevator_units,0),1) units, mc.renewal_status, ${currentEndSql('mc')} cur_end, ${renewalInProgressSql('mc')} in_progress,
      (SELECT r.renewal_ref || '|' || r.renewal_status FROM amc_renewals r WHERE r.contract_ref = mc.contract_ref AND r.is_deleted = 0 ORDER BY r.id DESC LIMIT 1) latest
    FROM maintenance_contracts mc WHERE ${w.join(' AND ')}) WHERE substr(cur_end,1,4) = ?`, [...p, y]).map(r => {
      const days = Math.round((new Date(r.cur_end) - new Date(today)) / 864e5);
      const [ref, rs] = String(r.latest || '|').split('|');
      return { ...r, days, milestone_date: r.cur_end, coverage: r.in_progress ? 'Renewal in progress' : days < 0 ? 'Lapsed — no renewal' : 'Not started', latest_ref: ref || '', latest_status: rs || '' };
    });
  const scope = m ? rows.filter(r => monthIdx(r.cur_end) === m) : rows;
  const sU = pred => M.sumUnits(scope.filter(pred));
  const kpis = [kpi(`Expiring — ${scopeLabel(y, m)}`, M.sumUnits(scope), { unit: 'Units', sub: `${scope.length} AMC record(s) whose current period ends`, tone: 'blue' }),
    kpi('Already Expired', sU(r => r.days < 0), { unit: 'Units', tone: 'red' }), kpi('Expiring ≤ 30 Days', sU(r => r.days >= 0 && r.days <= 30), { unit: 'Units', tone: 'amber' }),
    kpi('31 – 90 Days', sU(r => r.days > 30 && r.days <= 90), { unit: 'Units', tone: 'purple' }), kpi('Renewal in Progress', sU(r => r.in_progress), { unit: 'Units', tone: 'green' }),
    kpi('No Renewal Started', sU(r => !r.in_progress), { unit: 'Units', tone: 'red' })];
  const cov = ['Renewal in progress', 'Not started', 'Lapsed — no renewal'];
  const b = monthBuckets(rows, r => monthIdx(r.cur_end), Object.fromEntries(cov.map(c => [c, r => r.coverage === c ? r.units : 0])));
  const chart = { title: `AMC Expiry Timeline — ${y}`, subtitle: 'Units whose CURRENT AMC period ends each month, by renewal coverage (analysis — the action queue is in Alerts → Expiring Contracts)',
    labels: MON, highlight: m ? m - 1 : null, drill: 'month', stacked: true,
    datasets: cov.map((c, i) => ({ label: c, data: b.map(x => x[c]), type: 'bar', axis: 'y', stack: 's', color: [COLORS.green, COLORS.amber, COLORS.red][i] })), y_title: 'Units' };
  const month_table = { title: `Month-wise AMC Expiry — ${y}`, highlight: m ? m - 1 : null, drill: 'month', columns: ['Month', ...cov, 'Total Units'],
    rows: b.map(x => [x.name, ...cov.map(c => x[c]), cov.reduce((s, c) => s + x[c], 0)]), total: [`Total ${y}`, ...cov.map(c => M.sumUnits(rows.filter(r => r.coverage === c))), M.sumUnits(rows)] };
  const breakdowns = [{ title: 'Expiring Units by Maintenance Type', columns: ['Type', 'Records', 'Units'], drill_param: 'maintenance_type', rows: groupBy(scope, r => r.maintenance_type, { units: r => r.units, n: () => 1 }).map(x => [x.name, x.n, x.units]) },
    { title: 'Expiring Units by Emirate', columns: ['Emirate', 'Records', 'Units'], drill_param: 'emirate', rows: groupBy(scope, r => r.emirate, { units: r => r.units, n: () => 1 }).map(x => [x.name, x.n, x.units]) }];
  const reg = sortRecords(scope, f, { end_date: 'cur_end', days_to_expiry: 'days', client_name: 'client_name', emirate: 'emirate' }, 'end_date', 'asc');
  return stdOut({ type: 'maintenance-expiring', title: `AMC Expiry & Renewal Analysis — ${m ? MONTH[m - 1] + ' ' : ''}${y}`,
    description: 'AMC units by current-period expiry month and renewal coverage (Cancelled excluded)', metric: 'Elevator Units',
    year: y, month: m, kpis, chart, month_table, breakdowns, register_title: 'Expiry Register',
    columns: ['AMC ID', 'Contract Ref.', 'Client', 'Emirate', 'Type', 'Units', 'Current AMC End', 'Days to Expiry', 'Renewal Coverage', 'Latest Renewal', 'Renewal Status'],
    registerRows: reg.map(r => [r.maintenance_id || '', r.contract_ref || '', r.client_name || '', r.emirate || '', r.maintenance_type || '', r.units, r.cur_end, r.days, r.coverage, r.latest_ref, r.latest_status]),
    scope_total: M.sumUnits(scope) }, f);
}

// ══════════════════════════════════════════════════════════════════════════════
// CALL BACK & EMERGENCY
// ══════════════════════════════════════════════════════════════════════════════
function buildCallbackReport(f) {
  const y = yearOf(f), m = monthOf(f);
  const p = [y];
  const w = ['cb.is_deleted = 0', `substr(cb.complaint_datetime,1,4) = ?`];
  if (f.status) { w.push('cb.callback_status = ?'); p.push(f.status); }
  if (f.priority) { w.push('cb.priority = ?'); p.push(f.priority); }
  if (f.complaint_type) { w.push('TRIM(cb.complaint_type) = ?'); p.push(f.complaint_type); }
  if (f.search) { w.push(`(cb.client_name LIKE ? OR cb.contract_ref LIKE ? OR cb.callback_ref LIKE ? OR COALESCE(cb.location,'') LIKE ?)`); p.push(...Array(4).fill(`%${f.search}%`)); }
  const EM = `COALESCE(NULLIF(TRIM((SELECT c.emirate FROM contracts c WHERE c.contract_ref = cb.contract_ref AND c.is_deleted = 0 LIMIT 1)),''),
    NULLIF(TRIM((SELECT mc.emirate FROM maintenance_contracts mc WHERE mc.contract_ref = cb.contract_ref AND mc.is_deleted = 0 LIMIT 1)),''), 'Not linked')`;
  let yearRows = all(`SELECT cb.callback_ref, cb.contract_ref, cb.client_name, COALESCE(cb.location,'') location, cb.lift_unit_no, cb.complaint_datetime,
      TRIM(COALESCE(cb.complaint_type,'')) complaint_type, cb.priority, cb.callback_status, COALESCE(cb.assigned_technician,'') technician,
      cb.attended_datetime, cb.completion_datetime, COALESCE(cb.issue_description,'') issue, COALESCE(cb.action_taken,'') action_taken, COALESCE(cb.remarks,'') remarks, ${EM} emirate
    FROM alert_callbacks cb WHERE ${w.join(' AND ')}`, p);
  if (f.emirate) yearRows = yearRows.filter(r => r.emirate === f.emirate);
  const scope = m ? yearRows.filter(r => monthIdx(r.complaint_datetime) === m) : yearRows;
  const hrs = r => (r.attended_datetime && r.complaint_datetime) ? (new Date(r.attended_datetime) - new Date(r.complaint_datetime)) / 36e5 : null;
  const resp = scope.map(hrs).filter(h => h != null && h >= 0);
  const c = (k, v) => scope.filter(r => r[k] === v).length;
  const sl = scopeLabel(y, m);
  const kpis = [kpi(`Call Backs — ${sl}`, scope.length, { unit: 'Tickets', tone: 'blue' }), kpi('Emergency', c('priority', 'Emergency'), { unit: 'Tickets', tone: 'red' }),
    kpi('Urgent', c('priority', 'Urgent'), { unit: 'Tickets', tone: 'amber' }), kpi('Open', c('callback_status', 'Open'), { unit: 'Tickets', tone: c('callback_status', 'Open') ? 'red' : '' }),
    kpi('Completed', c('callback_status', 'Completed'), { unit: 'Tickets', tone: 'green' }),
    kpi('Avg Response', resp.length ? Math.round(resp.reduce((s, h) => s + h, 0) / resp.length * 10) / 10 : null, { unit: resp.length ? 'hours' : '', sub: 'complaint → attended', tone: 'purple' })];
  const pr = ['Normal', 'Urgent', 'Emergency'];
  const b = monthBuckets(yearRows, r => monthIdx(r.complaint_datetime), Object.fromEntries(pr.map(x => [x, r => r.priority === x ? 1 : 0])));
  const chart = { title: `Monthly Call Backs — ${y}`, subtitle: 'Tickets by complaint date, split by priority', labels: MON, highlight: m ? m - 1 : null, drill: 'month', stacked: true,
    datasets: pr.map((x, i) => ({ label: x, data: b.map(q => q[x]), type: 'bar', axis: 'y', stack: 's', color: [COLORS.sky, COLORS.amber, COLORS.red][i] })), y_title: 'Tickets' };
  const month_table = { title: `Month-wise Call Backs — ${y}`, highlight: m ? m - 1 : null, drill: 'month', columns: ['Month', ...pr, 'Total'],
    rows: b.map(q => [q.name, ...pr.map(x => q[x]), pr.reduce((s, x) => s + q[x], 0)]), total: [`Total ${y}`, ...pr.map(x => yearRows.filter(r => r.priority === x).length), yearRows.length] };
  const breakdowns = [{ title: 'By Complaint Type', columns: ['Complaint Type', 'Tickets'], drill_param: 'complaint_type', rows: groupBy(scope, r => r.complaint_type, { n: () => 1 }).map(x => [x.name, x.n]) },
    { title: 'By Emirate', columns: ['Emirate', 'Tickets'], drill_param: 'emirate', rows: groupBy(scope, r => r.emirate, { n: () => 1 }).map(x => [x.name, x.n]) },
    { title: 'By Status', columns: ['Status', 'Tickets'], drill_param: 'status', rows: groupBy(scope, r => r.callback_status, { n: () => 1 }).map(x => [x.name, x.n]) }];
  const reg = sortRecords(scope, f, { complaint_datetime: 'complaint_datetime', client_name: 'client_name', priority: 'priority', callback_status: 'callback_status' }, 'complaint_datetime');
  return stdOut({ type: 'callback-detail', title: `Call Back & Emergency Analysis — ${m ? MONTH[m - 1] + ' ' : ''}${y}`,
    description: 'Call back / emergency tickets by complaint date — volume, priority, response and resolution', metric: 'Tickets',
    year: y, month: m, kpis, chart, month_table, breakdowns, register_title: `Call Back Register — ${sl}`,
    columns: ['CB Ref.', 'Contract Ref.', 'Client', 'Emirate', 'Location', 'Lift No.', 'Complaint Date/Time', 'Complaint Type', 'Priority', 'Status', 'Technician', 'Attended', 'Completed', 'Issue Description', 'Action Taken', 'Remarks'],
    registerRows: reg.map(r => [r.callback_ref, r.contract_ref || '', r.client_name || '', r.emirate, r.location, r.lift_unit_no || '', r.complaint_datetime || '', r.complaint_type, r.priority || '',
      r.callback_status || '', r.technician, r.attended_datetime || '', r.completion_datetime || '', r.issue, r.action_taken, r.remarks]),
    scope_total: scope.length }, f);
}

// ══════════════════════════════════════════════════════════════════════════════
// ACCOUNTS & PAYMENTS
// ══════════════════════════════════════════════════════════════════════════════
/** Wrap an existing accounts builder (payment-pending / client-payment-entry) into the standard template. */
function standardiseReceivables(d, allRows, f) {
  // allRows = full filtered objects (not paginated)
  const s = d.summary || {};
  const cv = r2(allRows.reduce((a, r) => a + (Number(r.contract_value) || 0), 0));
  const kpis = [kpi('Contracts with Balance', allRows.length, { unit: 'Contracts', tone: 'blue' }), kpi('Receivable (AED)', cv, { fmt: 'money', cur: 'AED', sub: 'contract value of listed contracts', tone: 'purple' }),
    kpi('Received (AED)', s.total_received || 0, { fmt: 'money', cur: 'AED', tone: 'green' }), kpi('Outstanding (AED)', s.total_outstanding || 0, { fmt: 'money', cur: 'AED', tone: 'red' })];
  const g = key => groupBy(allRows, r => r[key], { n: () => 1, out: r => r.balance_receivable, rec: r => r.received_amount });
  const breakdowns = [{ title: 'Outstanding by Payment Status', columns: ['Payment Status', 'Contracts', 'Received (AED)', 'Outstanding (AED)'], drill_param: 'payment_status', rows: g('payment_status').map(x => [x.name, x.n, money(x.rec), money(x.out)]) },
    { title: 'Outstanding by Salesperson', columns: ['Salesperson', 'Contracts', 'Outstanding (AED)'], drill_param: 'salesperson', rows: g('salesperson').map(x => [x.name, x.n, money(x.out)]) },
    { title: 'Outstanding by Emirate', columns: ['Emirate', 'Contracts', 'Outstanding (AED)'], drill_param: 'emirate', rows: g('emirate').map(x => [x.name, x.n, money(x.out)]) }];
  return stdOut({ type: 'payment-pending', title: 'Client Receivables', description: 'Contracts with an outstanding client balance (client payment ledger totals, AED)', metric: 'AED',
    kpis, chart: null, breakdowns, register_title: 'Receivables Register', columns: d.columns, registerRows: d._allRows, scope_total: s.total_outstanding || 0, summary: s }, f);
}

function standardiseClientPayments(d, allRows, f) {
  const y = f.year ? yearOf(f) : null, m = monthOf(f);
  const total = r2(allRows.reduce((a, r) => a + (Number(r.received_amount) || 0), 0));
  const contracts = new Set(allRows.map(r => r.contract_ref).filter(Boolean)).size;
  const flagged = allRows.filter(r => r.is_unlinked || r.has_mismatch || r.payment_status === 'Overpaid').length;
  const kpis = [kpi('Payments', allRows.length, { unit: 'Transactions', tone: 'blue' }), kpi('Received (AED)', total, { fmt: 'money', cur: 'AED', tone: 'green' }),
    kpi('Contracts Paid', contracts, { unit: 'Contracts', tone: 'purple' }), kpi('Average Payment (AED)', allRows.length ? r2(total / allRows.length) : 0, { fmt: 'money', cur: 'AED', tone: 'teal' }),
    kpi('Needs Review', flagged, { unit: 'Transactions', sub: 'unlinked / mismatch / overpaid', tone: flagged ? 'red' : '' })];
  let chart = null, month_table = null;
  if (y) {
    const yearAll = m ? d._yearRows || allRows : allRows;
    const b = monthBuckets(yearAll, r => monthIdx(r.payment_date), { amt: r => r.received_amount, n: () => 1 });
    chart = { title: `Monthly Client Receipts — ${y}`, subtitle: 'Client payments by payment (entry) date, AED', labels: MON, highlight: m ? m - 1 : null, drill: 'month',
      datasets: [{ label: 'Received (AED)', data: b.map(x => x.amt), type: 'bar', axis: 'y', color: COLORS.green }], y_title: 'AED' };
    month_table = { title: `Month-wise Client Receipts — ${y}`, highlight: m ? m - 1 : null, drill: 'month', columns: ['Month', 'Payments', 'Received (AED)'],
      rows: b.map(x => [x.name, x.n, money(x.amt)]), total: [`Total ${y}`, yearAll.length, money(yearAll.reduce((a, r) => a + (Number(r.received_amount) || 0), 0))] };
  }
  const g = key => groupBy(allRows, r => r[key], { amt: r => r.received_amount, n: () => 1 });
  const breakdowns = [{ title: 'Receipts by Payment Type', columns: ['Payment Type', 'Payments', 'Received (AED)'], drill_param: 'payment_type', rows: g('payment_type').map(x => [x.name, x.n, money(x.amt)]) },
    { title: 'Receipts by Salesperson', columns: ['Salesperson', 'Payments', 'Received (AED)'], drill_param: 'salesperson', rows: g('salesperson').map(x => [x.name, x.n, money(x.amt)]) }];
  const notes = [];
  const adj = allRows.filter(r => r.payment_type === 'Reconciliation Adjustment');
  if (adj.length) notes.push({ text: `${adj.length} receipt(s) (${money(adj.reduce((a2, r) => a2 + (Number(r.received_amount) || 0), 0), 'AED')}) are "Reconciliation Adjustment" entries dated on the reconciliation day — their month reflects when the ledger was reconciled, not the actual cash receipt date.` });
  return stdOut({ type: 'client-payment-entry', title: `Client Payment Transactions${y ? ' — ' + (m ? MONTH[m - 1] + ' ' : '') + y : ''}`,
    description: 'Client payment ledger — every receipt by payment date (AED)', metric: 'AED', year: y, month: m,
    kpis, chart, month_table, breakdowns, notes, register_title: f.view_mode === 'summary' ? 'Payments by Contract' : 'Payment Transaction Register',
    columns: d.columns, registerRows: d._allRows, scope_total: total, summary: d.summary, extra: { view_mode: d.view_mode } }, f);
}

function buildCashFlowReport(f) {
  const y = yearOf(f), m = monthOf(f);
  const cp = all(`SELECT substr(entry_date,1,10) d, COALESCE(received_amount,0) amt, COALESCE(NULLIF(currency_code,''),'AED') cur, payment_type FROM client_payments WHERE is_deleted = 0 AND substr(entry_date,1,4) = ?`, [y]);
  const fp = M.factoryPaymentRows({ year: y });
  const curs = [...new Set(fp.map(r => r.currency))].sort();
  const bIn = monthBuckets(cp, r => monthIdx(r.d), { AED: r => r.cur === 'AED' ? r.amt : 0 });
  const bOut = monthBuckets(fp, r => monthIdx(r.payment_date), Object.fromEntries((curs.length ? curs : ['USD']).map(c => [c, r => r.currency === c ? r.amount : 0])));
  const rowsAll = MON.map((_, i) => ({ month: MONTH[i], inAed: bIn[i].AED, out: Object.fromEntries((curs.length ? curs : ['USD']).map(c => [c, bOut[i][c]])) }));
  const scope = m ? [rowsAll[m - 1]] : rowsAll;
  const inT = r2(scope.reduce((s, r) => s + r.inAed, 0));
  const outT = Object.fromEntries((curs.length ? curs : ['USD']).map(c => [c, r2(scope.reduce((s, r) => s + r.out[c], 0))]));
  const sl = scopeLabel(y, m);
  const kpis = [kpi(`Client Receipts (AED) — ${sl}`, inT, { fmt: 'money', cur: 'AED', tone: 'green' })]
    .concat(Object.entries(outT).map(([c, v]) => kpi(`Factory Payments (${c}) — ${sl}`, v, { fmt: 'money', cur: c, tone: 'red' })))
    .concat(outT.AED != null ? [kpi('Net AED Movement', r2(inT - outT.AED), { fmt: 'money', cur: 'AED', tone: 'blue' })] : [kpi('Net Movement', 'Not calculated', { sub: 'receipts are AED, factory payments are not AED — no exchange-rate conversion is applied', tone: 'amber' })]);
  const chart = { title: `Monthly Cash Flow — ${y}`, subtitle: 'Client receipts (AED, left axis) vs factory payments (right axis, own currency) — currencies are not netted', labels: MON, highlight: m ? m - 1 : null, drill: 'month',
    datasets: [{ label: 'Client Receipts (AED)', data: rowsAll.map(r => r.inAed), type: 'bar', axis: 'y', color: COLORS.green }]
      .concat((curs.length ? curs : ['USD']).map((c, i) => ({ label: `Factory Payments (${c})`, data: rowsAll.map(r => r.out[c]), type: 'line', axis: c === 'AED' ? 'y' : 'y1', color: [COLORS.red, COLORS.amber][i % 2] }))),
    y_title: 'AED', y1_title: curs.filter(c => c !== 'AED').join(' / ') || 'USD' };
  const cols = ['Month', 'Client Receipts (AED)', ...(curs.length ? curs : ['USD']).map(c => `Factory Payments (${c})`)].concat(curs.includes('AED') ? ['Net AED Movement'] : []);
  const toRow = r => [r.month, r2(r.inAed), ...(curs.length ? curs : ['USD']).map(c => r2(r.out[c]))].concat(curs.includes('AED') ? [r2(r.inAed - r.out.AED)] : []);
  const adj = cp.filter(r => r.payment_type === 'Reconciliation Adjustment');
  const notes = adj.length ? [{ text: `${adj.length} client receipt(s) (${money(adj.reduce((a2, r) => a2 + r.amt, 0), 'AED')}) in ${y} are "Reconciliation Adjustment" entries dated on the reconciliation day, not the actual receipt date — monthly receipts are affected.` }] : [];
  return stdOut({ type: 'monthly-cashflow', title: `Monthly Cash Flow — ${m ? MONTH[m - 1] + ' ' : ''}${y}`,
    description: 'Actual client receipts vs actual factory payments by month, each in its own currency', metric: 'Amount (per currency)', year: y, month: m,
    kpis, chart, breakdowns: [], notes, register_title: `Cash Flow by Month — ${sl}`, columns: cols, registerRows: scope.map(toRow), scope_total: inT }, f);
}

// ══════════════════════════════════════════════════════════════════════════════
// HISTORICAL & CANCELLED
// ══════════════════════════════════════════════════════════════════════════════
function buildCancelledContractsReport(f) {
  const y = f.year ? yearOf(f) : null, m = monthOf(f);
  const p = [];
  const w = ['c.is_deleted = 0', "(c.cancellation_type IS NOT NULL OR COALESCE(c.project_status,'') = 'Cancelled')",
    ...M.contractFilterSql({ salesperson: f.salesperson, emirate: f.emirate, search: f.search }, p)];
  if (f.cancellation_type) { w.push('c.cancellation_type = ?'); p.push(f.cancellation_type); }
  if (f.refund_status) { w.push('c.refund_status = ?'); p.push(f.refund_status); }
  const rows = all(`SELECT c.contract_ref, c.client_name, c.project_description, c.emirate, c.sales_by, ${M.UNIT} units, COALESCE(c.contract_value,0) contract_value,
      COALESCE(c.total_received,0) total_received, c.cancellation_type, substr(c.cancellation_date,1,10) cancellation_date, COALESCE(c.payment_retention_status,'') retention,
      COALESCE(c.refund_status,'') refund_status, COALESCE(c.cancellation_remarks,'') remarks, substr(c.approval_date,1,10) approval_date
    FROM contracts c WHERE ${w.join(' AND ')}`, p);
  const inYear = y ? rows.filter(r => r.cancellation_date && r.cancellation_date.slice(0, 4) === y) : rows;
  const scope = m ? inYear.filter(r => monthIdx(r.cancellation_date) === m) : inYear;
  const kpis = [kpi('Cancelled Units', M.sumUnits(scope), { unit: 'Units', sub: `${scope.length} contract(s)`, tone: 'red' }),
    kpi('Contract Value (AED)', r2(scope.reduce((s, r) => s + r.contract_value, 0)), { fmt: 'money', cur: 'AED', tone: 'purple' }),
    kpi('Received (AED)', r2(scope.reduce((s, r) => s + r.total_received, 0)), { fmt: 'money', cur: 'AED', tone: 'blue' }),
    kpi('Retained — No Refund (AED)', r2(scope.filter(r => r.refund_status === 'No Refund').reduce((s, r) => s + r.total_received, 0)), { fmt: 'money', cur: 'AED', tone: 'green' })];
  let chart = null;
  if (y) { const b = monthBuckets(inYear, r => monthIdx(r.cancellation_date), { units: r => r.units });
    chart = { title: `Cancellations by Month — ${y}`, subtitle: 'Units by Cancellation Date (original sales stay in their approval month)', labels: MON, highlight: m ? m - 1 : null, drill: 'month',
      datasets: [{ label: 'Cancelled Units', data: b.map(x => x.units), type: 'bar', axis: 'y', color: COLORS.red }], y_title: 'Units' }; }
  const breakdowns = [{ title: 'By Cancellation Type', columns: ['Type', 'Contracts', 'Units'], drill_param: 'cancellation_type', rows: groupBy(scope, r => r.cancellation_type, { n: () => 1, u: r => r.units }).map(x => [x.name, x.n, x.u]) },
    { title: 'By Refund Status', columns: ['Refund Status', 'Contracts', 'Received (AED)'], drill_param: 'refund_status', rows: groupBy(scope, r => r.refund_status, { n: () => 1, rc: r => r.total_received }).map(x => [x.name, x.n, money(x.rc)]) }];
  const notes = [];
  const undated = rows.filter(r => !r.cancellation_date).length;
  if (y && undated) notes.push({ text: `${undated} cancelled contract(s) have no Cancellation Date — select All Years to include them.` });
  const reg = sortRecords(scope, f, { cancellation_date: 'cancellation_date', contract_ref: 'contract_ref', client_name: 'client_name', contract_value: 'contract_value' }, 'cancellation_date');
  return stdOut({ type: 'cancelled-contracts', title: `Cancelled / Terminated Contracts${y ? ' — ' + (m ? MONTH[m - 1] + ' ' : '') + y : ''}`,
    description: 'Contracts cancelled or terminated after approval — units, value, retention and refunds', metric: 'Elevator Units', year: y, month: m,
    kpis, chart, breakdowns, notes, register_title: 'Cancelled Contracts Register',
    columns: ['Contract Ref.', 'Client', 'Project', 'Emirate', 'Salesperson', 'Units', 'Approval Date', 'Cancellation Type', 'Cancellation Date', 'Contract Value (AED)', 'Received (AED)', 'Payment Retention', 'Refund Status', 'Remarks'],
    registerRows: reg.map(r => [r.contract_ref, r.client_name || '', r.project_description || '', r.emirate || '', r.sales_by || '', r.units, r.approval_date || '', r.cancellation_type || '',
      r.cancellation_date || '', r2(r.contract_value), r2(r.total_received), r.retention, r.refund_status, r.remarks]),
    scope_total: M.sumUnits(scope) }, f);
}

function buildCancelledAmcReport(f) {
  const y = f.year ? yearOf(f) : null, m = monthOf(f);
  const p = [];
  const w = ['mc.is_deleted = 0', "(mc.renewal_status = 'Cancelled' OR mc.current_status = 'Cancelled')"];
  if (f.emirate) { w.push('TRIM(mc.emirate) = ?'); p.push(f.emirate); }
  if (f.maintenance_type) { w.push('mc.maintenance_type = ?'); p.push(f.maintenance_type); }
  if (f.search) { w.push('(mc.client_name LIKE ? OR mc.contract_ref LIKE ? OR mc.maintenance_id LIKE ?)'); p.push(`%${f.search}%`, `%${f.search}%`, `%${f.search}%`); }
  const rows = all(`SELECT mc.maintenance_id, mc.contract_ref, mc.client_name, TRIM(mc.emirate) emirate, mc.maintenance_type, mc.maintenance_period,
      COALESCE(NULLIF(mc.total_elevator_units,0),1) units, mc.start_date, mc.end_date, substr(mc.cancellation_date,1,10) cancellation_date,
      COALESCE(mc.cancellation_reason,'') reason, mc.last_service_date FROM maintenance_contracts mc WHERE ${w.join(' AND ')}`, p);
  const inYear = y ? rows.filter(r => r.cancellation_date && r.cancellation_date.slice(0, 4) === y) : rows;
  const scope = m ? inYear.filter(r => monthIdx(r.cancellation_date) === m) : inYear;
  const kpis = [kpi('Cancelled AMC Units', M.sumUnits(scope), { unit: 'Units', sub: `${scope.length} AMC record(s)`, tone: 'red' }),
    kpi('Records with Reason', scope.filter(r => r.reason).length, { unit: 'Records', tone: 'blue' })];
  let chart = null;
  if (y) { const b = monthBuckets(inYear, r => monthIdx(r.cancellation_date), { units: r => r.units });
    chart = { title: `AMC Cancellations by Month — ${y}`, subtitle: 'Units by AMC Cancellation Date', labels: MON, highlight: m ? m - 1 : null, drill: 'month',
      datasets: [{ label: 'Cancelled AMC Units', data: b.map(x => x.units), type: 'bar', axis: 'y', color: COLORS.red }], y_title: 'Units' }; }
  const breakdowns = [{ title: 'By Maintenance Type', columns: ['Type', 'Records', 'Units'], drill_param: 'maintenance_type', rows: groupBy(scope, r => r.maintenance_type, { n: () => 1, u: r => r.units }).map(x => [x.name, x.n, x.u]) },
    { title: 'By Emirate', columns: ['Emirate', 'Records', 'Units'], drill_param: 'emirate', rows: groupBy(scope, r => r.emirate, { n: () => 1, u: r => r.units }).map(x => [x.name, x.n, x.u]) }];
  const notes = [];
  const undated = rows.filter(r => !r.cancellation_date).length;
  if (y && undated) notes.push({ text: `${undated} cancelled AMC record(s) have no Cancellation Date — select All Years to include them.` });
  const reg = sortRecords(scope, f, { cancellation_date: 'cancellation_date', client_name: 'client_name', emirate: 'emirate' }, 'cancellation_date');
  return stdOut({ type: 'maintenance-cancelled', title: `Cancelled AMC Contracts${y ? ' — ' + (m ? MONTH[m - 1] + ' ' : '') + y : ''}`,
    description: 'Cancelled maintenance (AMC) records by cancellation date — history preserved', metric: 'Elevator Units', year: y, month: m,
    kpis, chart, breakdowns, notes, register_title: 'Cancelled AMC Register',
    columns: ['AMC ID', 'Contract Ref.', 'Client', 'Emirate', 'Type', 'Period', 'Units', 'Start Date', 'End Date', 'Cancellation Date', 'Cancellation Reason', 'Last Service'],
    registerRows: reg.map(r => [r.maintenance_id || '', r.contract_ref || '', r.client_name || '', r.emirate || '', r.maintenance_type || '', r.maintenance_period || '', r.units,
      r.start_date || '', r.end_date || '', r.cancellation_date || '', r.reason, r.last_service_date || '']),
    scope_total: M.sumUnits(scope) }, f);
}

module.exports = {
  stdOut, kpi, MON, MONTH, monthOf, yearOf,
  buildMilestoneReport, buildInstallationReport, buildContractRegister, buildProjectStatusReport,
  buildQuotationsReport, buildSalespersonReport,
  buildFactoryOrdersReport, buildShippingReport, buildFactoryPaymentsReport,
  standardiseMonthlyMaintenance, buildServiceRegister, buildAmcPortfolioReport, buildAmcPaymentsReport, buildAmcExpiryReport,
  buildCallbackReport, standardiseReceivables, standardiseClientPayments, buildCashFlowReport,
  buildCancelledContractsReport, buildCancelledAmcReport,
};
