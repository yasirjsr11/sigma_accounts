// public/js/maintenance_contracts.js — rebuilt 2026-07-11
// Per-month visit management: completion checkbox, status/alert badges,
// technician multi-select, elevator units, postponed/hold forms, auto visit log.
'use strict';

const MaintContractsState = {
  tab: 'mdash',            // 2026-10-03: Maintenance Dashboard is the default landing tab
  page: 1,
  sort: 'contract_ref',
  dir: 'asc',
  filters: {},
  schedule: { year: null, month: null, team: '' },
  dashYear: null,
  dashMonth: null,
  dashCard: null,
  dashFilters: {},
  calYear: null,
  calMonth: null,
  calFilters: {},
  _calEntries: [],
  cbFilters: { sort_by: 'complaint_datetime', sort_dir: 'desc' },
  cancelledPage: 1,
  cancelledFilters: {},
};

const MAINT_RENEWAL_OPTS       = ['Active Maintenance','Hold','Expired / Renewal Required','Cancelled'];
const MAINT_CURRENT_STATUS_OPTS = ['Linked','Pending Contract Ref','Contract Ref Not Found'];
const MAINT_TYPE_OPTS          = ['Free AMC','Paid Comprehensive','Non-Comprehensive','One-Time Service'];
const MAINT_PERIOD_OPTS        = ['Every Month','Every 2 Months','Every 3 Months','Every 4 Months','Every 6 Months','Quarterly','Half Yearly','Yearly','Custom'];
const MAINT_VISIT_TYPE_OPTS    = ['Routine','Emergency','Callback','Follow-up','Inspection','Repair'];
const MAINT_VISIT_STATUS_OPTS  = ['Pending','Scheduled','Completed','Partially Completed','Postponed','Hold','Missed','Cancelled'];
const MAINT_ALERT_COLORS = { Upcoming:'#b7950b', 'Due Today':'#e67e22', Overdue:'#c0392b', Closed:'#1e8449', Scheduled:'#555' };
const MAINT_STATUS_COLORS = { Pending:'#555', Scheduled:'#2980b9', Completed:'#1e8449', Postponed:'#b7950b', Hold:'#e67e22', Missed:'#c0392b', Cancelled:'#95a5a6' };
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_ABBR  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// fmtSchedMonth — converts 'YYYY-MM' → 'Month YYYY' (e.g. '2026-09' → 'September 2026')
function fmtSchedMonth(v) {
  if (!v) return '-';
  const m = String(v).match(/^(\d{4})-(\d{2})$/);
  if (!m) return esc(v);
  const mo = parseInt(m[2], 10);
  return (MONTH_NAMES[mo - 1] || m[2]) + ' ' + m[1];
}

function alertBadge(status) {
  const color = MAINT_ALERT_COLORS[status] || '#555';
  if (!status || status === 'Scheduled') return '';
  return `<span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}66">${esc(status)}</span>`;
}
// Returns an "Expired — Renewal Pending" info badge when end_date has passed
// and the contract is not yet Renewed or Cancelled.
function _expiredPendingBadge(renewalStatus, endDate) {
  if (!endDate) return '';
  if (['Active Maintenance','Renewed','Cancelled'].includes(renewalStatus)) return '';
  const today = new Date(); today.setHours(0,0,0,0);
  const end = new Date(endDate); end.setHours(0,0,0,0);
  if (end >= today) return '';
  return `<span class="badge" style="background:#fff3cd;color:#856404;border:1px solid #ffc10766;font-size:10px;white-space:nowrap" title="AMC period has ended — renewal not yet finalised">Expired — Renewal Pending</span>`;
}
function statusBadge(status) {
  const color = MAINT_STATUS_COLORS[status] || '#555';
  return `<span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}66">${esc(status||'Pending')}</span>`;
}

// 2026-10-03: single source of the Maintenance tab order + URL slugs (#maintenance/<slug>)
const MAINT_TABS = [
  { key: 'mdash',     slug: 'dashboard', icon: 'gauge',          label: 'Maintenance Dashboard' },
  { key: 'records',   slug: 'records',   icon: 'clipboard-list', label: 'Maintenance Records' },
  { key: 'schedule',  slug: 'schedule',  icon: 'calendar-clock', label: 'Monthly Schedule' },
  { key: 'mcal',      slug: 'calendar',  icon: 'calendar-days',  label: 'Monthly Calendar' },
  { key: 'callbacks', slug: 'callbacks', icon: 'siren',          label: 'Call Back / Emergency' },
  { key: 'cancelled', slug: 'cancelled', icon: 'circle-x',       label: 'Cancelled AMC' },
];
const MAINT_DEFAULT_TAB = 'mdash';
function maintTabSlug(key) { const t = MAINT_TABS.find(x => x.key === key); return t ? t.slug : 'dashboard'; }
function maintTabFromSlug(slug) { const t = MAINT_TABS.find(x => x.slug === slug || x.key === slug); return t ? t.key : MAINT_DEFAULT_TAB; }
// Sidebar "Maintenance" always lands on the Dashboard (internal re-renders keep the current tab)
function maintResetToDefaultTab() { MaintContractsState.tab = MAINT_DEFAULT_TAB; }

async function renderMaintenanceContracts(root) {
  const now = new Date();
  if (!MaintContractsState.schedule.year) MaintContractsState.schedule.year = now.getFullYear();
  if (!MaintContractsState.schedule.month) MaintContractsState.schedule.month = now.getMonth() + 1;
  if (!MaintContractsState.dashYear) MaintContractsState.dashYear = now.getFullYear();
  if (!MaintContractsState.dashMonth) MaintContractsState.dashMonth = now.getMonth() + 1;
  if (!MaintContractsState.calYear)  MaintContractsState.calYear  = now.getFullYear();
  if (!MaintContractsState.calMonth) MaintContractsState.calMonth = now.getMonth() + 1;

  // 2026-10-03: tab order = MAINT_TABS (Dashboard first); same order for display, keyboard and routing
  if (!MAINT_TABS.some(t => t.key === MaintContractsState.tab)) MaintContractsState.tab = MAINT_DEFAULT_TAB;
  root.innerHTML = `
    <div class="tabs" role="tablist" aria-label="Maintenance">
      ${MAINT_TABS.map(t => { const on = MaintContractsState.tab === t.key; return `
      <div class="tab ${on ? 'active' : ''}" data-mtab="${t.key}" role="tab" tabindex="${on ? 0 : -1}" aria-selected="${on}"${on ? ' aria-current="page"' : ''}>
        <i data-lucide="${t.icon}" class="tab-icon" aria-hidden="true"></i>${t.label}
      </div>`; }).join('')}
    </div>
    <div id="maint-tab-body"></div>
  `;
  renderIcons();
  const _goTab = key => {
    if (key === MaintContractsState.tab) return;
    MaintContractsState.tab = key;
    if (typeof appPushHistory === 'function') appPushHistory('maintenance_contracts');   // URL #maintenance/<tab> (refresh / back / bookmarks)
    renderMaintenanceContracts(root);
  };
  root.querySelectorAll('[data-mtab]').forEach(el => {
    el.addEventListener('click', () => _goTab(el.dataset.mtab));
    el.addEventListener('keydown', e => {             // keyboard: Enter/Space open, ←/→ move along the same order
      const i = MAINT_TABS.findIndex(t => t.key === el.dataset.mtab);
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _goTab(el.dataset.mtab); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const n = MAINT_TABS[(i + (e.key === 'ArrowRight' ? 1 : MAINT_TABS.length - 1)) % MAINT_TABS.length];
        const nx = root.querySelector(`[data-mtab="${n.key}"]`); if (nx) nx.focus();
      }
    });
  });
  const body = document.getElementById('maint-tab-body');
  if (MaintContractsState.tab === 'schedule')        await renderMaintScheduleTab(body);
  else if (MaintContractsState.tab === 'mcal')       await renderMaintCalendarTab(body);
  else if (MaintContractsState.tab === 'mdash')      await renderMaintDashboardTab(body);
  else if (MaintContractsState.tab === 'callbacks')  await renderMaintCallbacksTab(body);
  else if (MaintContractsState.tab === 'cancelled')  await renderMaintCancelledTab(body);
  else await renderMaintRecordsTab(body);
}

// ─── Maintenance Dashboard ────────────────────────────────────────────────────
let _mdashCharts = {};
function _mdashDestroyCharts() {
  Object.values(_mdashCharts).forEach(c => { try { c.destroy(); } catch(e){} });
  _mdashCharts = {};
}
// 2026-10-08: memoised — concurrent callers share ONE script load (never two Chart.js copies).
let _chartJsPromise = null;
function _loadChartJs() {
  if (window.Chart) return Promise.resolve();
  if (_chartJsPromise) return _chartJsPromise;
  _chartJsPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
    s.onload = res; s.onerror = e => { _chartJsPromise = null; rej(e); };
    document.head.appendChild(s);
  });
  return _chartJsPromise;
}
function _fmtAED(v) {
  if (!v && v!==0) return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  if (n >= 1000000) return 'AED ' + (n/1000000).toFixed(2) + 'M';
  if (n >= 1000)    return 'AED ' + (n/1000).toFixed(1) + 'K';
  return 'AED ' + n.toFixed(0);
}
function _mdashKpiCard(num, label, color, sub, onclick) {
  const c = color || '#2563ad';
  const clickStyle = onclick ? 'cursor:pointer;' : '';
  const clickAttr  = onclick ? ` onclick="${onclick.replace(/"/g,'&quot;')}"` : '';
  return `<div class="kpi-card" style="border-top:3px solid ${c};${clickStyle}"${clickAttr}>
    <div class="num" style="color:${c}">${num ?? 0}</div>
    <div class="label">${esc(label)}</div>
    ${sub ? `<div style="font-size:11px;color:#888;margin-top:2px">${sub}</div>` : ''}
  </div>`;
}

// ─── Comprehensive Drill-Down System ────────────────────────────────────────
let _finDetailData = null;
let _opDetailData  = null;

function _openWideModal(title, html) {
  openModal(`<div class="modal-content">${html}</div>`, { title: title, wide: true, readOnly: true });
}

function _payBadge(status) {
  const map = { Paid:'#1e8449', Partial:'#e67e22', Unpaid:'#c0392b' };
  const c = map[status] || '#555';
  return `<span class="badge" style="background:${c}22;color:${c};border:1px solid ${c}55">${esc(status||'—')}</span>`;
}

function _finDetailRender(searchTerm) {
  const d = _finDetailData;
  if (!d) return;
  const box = document.getElementById('modal-box');
  if (!box) return;

  const term = (searchTerm || '').toLowerCase();
  let rows = d.rows || [];
  if (term) {
    rows = rows.filter(r =>
      (r.renewal_ref||'').toLowerCase().includes(term) ||
      (r.contract_ref||'').toLowerCase().includes(term) ||
      (r.client_name||'').toLowerCase().includes(term)
    );
  }

  const isMissing = d.type === 'missing_payment_date';
  const isOutstanding = d.type === 'outstanding';
  const isReceivedPeriod = d.type === 'received_period';

  // 2026-10-07: AMC Collections / Payment Date Missing are TRANSACTION lists from the
  // authoritative collections service (same as Reports → AMC Payments).
  if (d.row_kind === 'transaction') {
    const aedX = v => 'AED ' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });   // exact — reconciliation view
    if (term) rows = (d.rows || []).filter(r => [r.renewal_ref, r.contract_ref, r.client_name, r.payment_ref].some(v => String(v || '').toLowerCase().includes(term)));
    const shownTotal = rows.reduce((s, r) => s + Math.round(Number(r.amount || 0) * 100), 0) / 100;
    const sumHtml = `<div style="background:#f0f4fa;border-radius:4px;padding:8px 12px;margin-bottom:10px;font-size:13px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <span><strong>${rows.length}</strong> payment(s)</span>
      <span>Total: <strong style="color:#1e8449">${aedX(term ? shownTotal : d.summary.total)}</strong></span>
      ${isMissing ? '<span style="color:#e67e22;font-size:11px">⚠️ Payment Date Missing — not assigned to any month until the payment date is entered.</span>'
        : '<span style="color:#667;font-size:11px">Valid AMC payment ledger transactions by actual Payment Date — total equals the AMC Collections figure.</span>'}
      <span style="margin-left:auto"><button class="btn btn-sm" onclick="_finDetailExportCSV()" style="font-size:12px">⬇ Export CSV</button></span>
    </div>`;
    const tb = rows.length === 0
      ? `<tr><td colspan="11" style="text-align:center;padding:20px;color:#888">No payments match.</td></tr>`
      : rows.map(r => `<tr>
          <td style="white-space:nowrap">${r.payment_date ? fmtDate(r.payment_date) : '<span style="color:#c05621;font-weight:600">Payment Date Missing</span>'}</td>
          <td style="font-family:monospace;white-space:nowrap">${esc(r.payment_ref||'—')}</td>
          <td style="font-family:monospace;white-space:nowrap">${esc(r.renewal_ref||'—')}</td>
          <td style="font-family:monospace;white-space:nowrap">${esc(r.contract_ref||'—')}</td>
          <td>${esc(r.client_name||'—')}</td>
          <td style="white-space:nowrap">${fmtDate(r.new_start_date)} – ${fmtDate(r.new_end_date)}</td>
          <td style="text-align:right;color:#1e8449;font-weight:600">${aedX(r.amount)}</td>
          <td>${esc(r.payment_method||'—')}</td>
          <td>${esc(r.entered_by||'—')}</td>
          <td>${esc(r.remarks||'')}</td>
          <td>${isMissing ? `<button class="btn btn-sm" style="font-size:11px;padding:2px 8px" onclick="_mfdUpdatePayment(${r.amc_renewal_id}, ${JSON.stringify({renewal_ref:r.renewal_ref,client_name:r.client_name,amount_paid:r.renewal_total_received,invoice_ref:r.invoice_ref,payment_status:r.payment_status}).replace(/"/g,'&quot;')})">Enter Date</button>` : esc(r.renewal_status||'')}</td></tr>`).join('');
    const tbl = `<div class="table-wrap"><table class="data-table" style="font-size:0.82em"><thead><tr>
      <th>Payment Date</th><th>Payment Ref.</th><th>Renewal Ref.</th><th>Contract Ref.</th><th>Client</th><th>AMC Period</th>
      <th style="text-align:right">Amount</th><th>Payment Mode</th><th>Recorded By</th><th>Remarks</th><th>${isMissing ? '' : 'Renewal Status'}</th></tr></thead><tbody>${tb}</tbody></table></div>`;
    const ca = document.getElementById('_fdContent');
    if (ca) ca.innerHTML = sumHtml + tbl;
    return;
  }

  const summaryHtml = `<div style="background:#f0f4fa;border-radius:4px;padding:8px 12px;margin-bottom:10px;font-size:13px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
    <span><strong>${rows.length}</strong> record(s)</span>
    <span>Total: <strong style="color:#1e8449">${_fmtAED(d.summary.total)}</strong></span>
    ${isMissing ? '<span style="color:#e67e22;font-size:11px">⚠️ Excluded from period collections until payment date is entered.</span>' : ''}
    <span style="margin-left:auto;display:flex;gap:8px">
      <button class="btn btn-sm" onclick="_finDetailExportCSV()" style="font-size:12px">⬇ Export CSV</button>
    </span>
  </div>`;

  let theadCols = `<th>Renewal Ref</th><th>Contract</th><th>Client</th><th>Emirate</th><th>Type</th>
    <th style="text-align:right">AMC Value</th><th style="text-align:right">Paid</th>`;
  if (isOutstanding) theadCols = `<th>Contract</th><th>Renewal Ref</th><th>Client</th><th>AMC Period</th>
    <th style="text-align:right">AMC Value</th><th style="text-align:right">Total Received</th><th style="text-align:right">Outstanding</th>
    <th>Payment</th><th>Latest Payment</th><th title="Days since last payment (or since approval / AMC start if none) — ageing indicator only">Days Since</th><th>Operational</th><th></th>`;
  if (isReceivedPeriod || d.type === 'received_all') theadCols += `<th>Payment Date</th>`;
  if (isMissing) theadCols += `<th>Invoice Ref</th><th>Approval Date</th>`;
  theadCols += `<th>Pay Status</th><th>Renewal Status</th>`;
  if (isMissing) theadCols += `<th></th>`;

  const rowsHtml = rows.length === 0
    ? `<tr><td colspan="12" style="text-align:center;padding:20px;color:#888">No records match your search.</td></tr>`
    : rows.map(r => {
        let tds = `
          <td style="font-family:monospace;white-space:nowrap">${esc(r.renewal_ref||'—')}</td>
          <td style="font-family:monospace;white-space:nowrap">${esc(r.contract_ref||'—')}</td>
          <td>${esc(r.client_name||'—')}</td>
          <td>${esc(r.emirate||'—')}</td>
          <td>${esc(r.maintenance_type||'—')}</td>
          <td style="text-align:right">${_fmtAED(r.new_amc_value)}</td>
          <td style="text-align:right;color:#1e8449;font-weight:600">${_fmtAED(r.amount_paid)}</td>`;
        if (isOutstanding) return `<tr>
          <td style="font-family:monospace;white-space:nowrap">${esc(r.contract_ref||'—')}</td>
          <td style="font-family:monospace;white-space:nowrap">${esc(r.renewal_ref||'—')}</td>
          <td>${esc(r.client_name||'—')}</td>
          <td style="white-space:nowrap">${fmtDate(r.new_start_date)} – ${fmtDate(r.new_end_date)}</td>
          <td style="text-align:right">${_fmtAED(r.new_amc_value)}</td>
          <td style="text-align:right;color:#1e8449;font-weight:600">${_fmtAED(r.total_received)}</td>
          <td style="text-align:right;color:#c0392b;font-weight:600">${_fmtAED(r.balance)}</td>
          <td>${_payBadge(r.payment_status)}</td>
          <td>${r.latest_payment_date ? fmtDate(r.latest_payment_date) : '<span style="color:#aaa">—</span>'}</td>
          <td title="${esc(r.ageing_basis||'')}">${r.days_since != null ? r.days_since + 'd' : '—'}</td>
          <td>${esc(r.operational_status||'—')}</td>
          <td>${r.mc_id ? `<button class="btn btn-sm" style="font-size:11px;padding:2px 8px" onclick="closeModal();openMaintModal(${r.mc_id})">Add Payment</button>` : ''}</td></tr>`;
        if (isReceivedPeriod || d.type === 'received_all') tds += `<td>${fmtDate(r.payment_date)}</td>`;
        if (isMissing) tds += `<td>${esc(r.invoice_ref||'—')}</td><td>${fmtDate(r.approval_date)}</td>`;
        tds += `<td>${_payBadge(r.payment_status)}</td><td>${esc(r.renewal_status||'—')}</td>`;
        if (isMissing) tds += `<td><button class="btn btn-sm" style="font-size:11px;padding:2px 8px" onclick="_mfdUpdatePayment(${r.id}, ${JSON.stringify({renewal_ref:r.renewal_ref,client_name:r.client_name,amount_paid:r.amount_paid,invoice_ref:r.invoice_ref,payment_status:r.payment_status}).replace(/"/g,'&quot;')})">Update Payment</button></td>`;
        return `<tr>${tds}</tr>`;
      }).join('');

  const tableHtml = `<div class="table-wrap"><table class="data-table" style="font-size:0.82em">
    <thead><tr>${theadCols}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table></div>`;

  // Re-render just the content area inside the modal (preserving search input focus)
  const contentArea = document.getElementById('_fdContent');
  if (contentArea) {
    contentArea.innerHTML = summaryHtml + tableHtml;
  } else {
    // Full render (first time)
    const periodStr = d.monthAll ? `All Months ${d.year}` : `${MONTH_NAMES[(d.month||1)-1]} ${d.year}`;
    const headerHtml = `<div style="font-size:12px;color:#667;margin-bottom:8px">
      Period: <strong>${esc(periodStr)}</strong> &nbsp;·&nbsp; Filter: ${Object.entries(MaintContractsState.dashFilters||{}).filter(([,v])=>v).map(([k,v])=>`<strong>${esc(k)}</strong>: ${esc(v)}`).join(', ')||'None'}
    </div>
    <div style="margin-bottom:8px;display:flex;gap:8px;align-items:center">
      <input id="_fdSearch" type="text" placeholder="Search contract ref, client, renewal ref…" value="${esc(searchTerm||'')}"
        style="flex:1;padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px"
        oninput="_finDetailSearch()">
    </div>
    <div id="_fdContent">${summaryHtml}${tableHtml}</div>`;
    box.querySelector('.modal-content') && (box.querySelector('.modal-content').innerHTML = headerHtml);
  }
}

function _finDetailSearch() {
  const term = document.getElementById('_fdSearch')?.value || '';
  _finDetailRender(term);
}

function _finDetailExportCSV() {
  if (!_finDetailData) return;
  const d = _finDetailData;
  const isMissing = d.type === 'missing_payment_date';
  const cols = ['renewal_ref','contract_ref','client_name','emirate','maintenance_type','new_amc_value','amount_paid'];
  if (d.row_kind === 'transaction') { cols.length = 0; cols.push('payment_date','payment_ref','renewal_ref','contract_ref','client_name','new_start_date','new_end_date','amount','payment_method','entered_by','remarks','renewal_status'); }
  if (d.type === 'outstanding') { cols.length = 0; cols.push('contract_ref','renewal_ref','client_name','new_start_date','new_end_date','new_amc_value','total_received','balance','payment_status','latest_payment_date','days_since','operational_status'); }
  if (d.row_kind !== 'transaction') {
    if (d.type === 'received_all') cols.push('payment_date');
    if (isMissing) cols.push('invoice_ref','approval_date');
    if (d.type !== 'outstanding') cols.push('payment_status','renewal_status');
  }
  const headers = cols.map(c => c.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase()));
  const csv = [headers.join(','), ...(d.rows||[]).map(r =>
    cols.map(c => { const v = r[c]??''; return typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v; }).join(',')
  )].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
  a.download = `financial_detail_${d.type}_${d.year}.csv`;
  a.click();
}

// ── Service Status Drill-down modal ──────────────────────────────────────────
// Shows detail rows from d.service_status.detail[key] (pre-fetched with dashboard data)
function _showSvcStatusDetail(key) {
  if (!_mdashLastData) return;
  const ss     = _mdashLastData.service_status || {};
  const yr     = _mdashLastData.meta?.year || MaintContractsState.dashYear;
  const mo     = _mdashLastData.meta?.month;
  const mAll   = _mdashLastData.meta?.month_mode === 'all';
  const period = mAll ? `Full Year ${yr}` : `${MONTH_NAMES[(mo||1)-1]} ${yr}`;
  const rows   = (ss.detail || {})[key] || [];
  const LABEL  = { completed:'Completed', pending:'Pending', hold:'Hold',
                   partial:'Partial (Partially Serviced)', postponed:'Postponed', missed:'Missed' };
  const COLOR  = { completed:'#1e8449', pending:'#6b7280', hold:'#d97706',
                   partial:'#2563ad', postponed:'#c05621', missed:'#c0392b' };
  const label  = LABEL[key] || key;
  const color  = COLOR[key] || '#333';

  const thead = `<thead style="background:#eaf0fb"><tr>
    <th style="padding:6px 8px;text-align:left;font-size:11px;border:1px solid #dde4f0">Contract Ref</th>
    <th style="padding:6px 8px;text-align:left;font-size:11px;border:1px solid #dde4f0">Client</th>
    <th style="padding:6px 8px;text-align:left;font-size:11px;border:1px solid #dde4f0">Emirate</th>
    <th style="padding:6px 8px;text-align:left;font-size:11px;border:1px solid #dde4f0">Type</th>
    <th style="padding:6px 8px;text-align:center;font-size:11px;border:1px solid #dde4f0">Sched. Month</th>
    <th style="padding:6px 8px;text-align:center;font-size:11px;border:1px solid #dde4f0">Units Sched.</th>
    <th style="padding:6px 8px;text-align:center;font-size:11px;border:1px solid #dde4f0">Units Serviced</th>
    <th style="padding:6px 8px;text-align:left;font-size:11px;border:1px solid #dde4f0">Completion Date</th>
  </tr></thead>`;

  let totSched = 0, totServed = 0;
  const trows = rows.map(r => {
    const s = Number(r.sched_units)||1;
    const v = Number(r.units_serviced)||0;
    totSched += s; totServed += v;
    return `<tr>
      <td style="padding:5px 8px;border:1px solid #eaecf0;font-family:monospace;font-size:12px">${esc(r.contract_ref||'-')}</td>
      <td style="padding:5px 8px;border:1px solid #eaecf0;font-size:12px">${esc(r.client_name||'-')}</td>
      <td style="padding:5px 8px;border:1px solid #eaecf0;font-size:12px">${esc(r.emirate||'-')}</td>
      <td style="padding:5px 8px;border:1px solid #eaecf0;font-size:12px">${esc(r.maintenance_type||'-')}</td>
      <td style="padding:5px 8px;border:1px solid #eaecf0;text-align:center;font-size:12px">${MONTH_NAMES[(r.scheduled_month||1)-1]}</td>
      <td style="padding:5px 8px;border:1px solid #eaecf0;text-align:center;font-weight:600;font-size:12px">${s}</td>
      <td style="padding:5px 8px;border:1px solid #eaecf0;text-align:center;font-weight:600;font-size:12px;color:${color}">${v||'—'}</td>
      <td style="padding:5px 8px;border:1px solid #eaecf0;font-size:12px">${fmtDate(r.completion_date)||'—'}</td>
    </tr>`;
  }).join('');
  const tfoot = rows.length ? `<tfoot style="background:#f8fafd"><tr>
    <td colspan="5" style="padding:5px 8px;border:1px solid #dde4f0;font-weight:700;font-size:12px">Total (${rows.length} contracts)</td>
    <td style="padding:5px 8px;border:1px solid #dde4f0;text-align:center;font-weight:700;font-size:12px">${totSched}</td>
    <td style="padding:5px 8px;border:1px solid #dde4f0;text-align:center;font-weight:700;font-size:12px;color:${color}">${totServed||'—'}</td>
    <td style="padding:5px 8px;border:1px solid #dde4f0"></td>
  </tr></tfoot>` : '';

  const html = `
    <h3 style="margin:0 0 8px;color:${color}">${label} — ${esc(period)}</h3>
    <div style="font-size:12px;color:#667;margin-bottom:12px">
      <b>${rows.length}</b> contract(s) · <b>${totSched}</b> scheduled units
      ${key==='completed'||key==='partial' ? ` · <b>${totServed}</b> serviced units` : ''}
      ${ss.scheduled_units > 0 ? ` · <b>${Math.round(totSched/ss.scheduled_units*100)}%</b> of period schedule` : ''}
    </div>
    ${rows.length
      ? `<div style="overflow:auto;max-height:360px">
           <table style="width:100%;border-collapse:collapse">${thead}<tbody>${trows}</tbody>${tfoot}</table>
         </div>`
      : `<div style="color:#888;padding:16px 0">No records for this status in the selected period.</div>`}`;
  openModal(html);
}

async function _showFinDrilldown(type, monthOverride) {
  const yr = MaintContractsState.dashYear || new Date().getFullYear();
  const mo = monthOverride || MaintContractsState.dashMonth || 'all';
  const df = MaintContractsState.dashFilters || {};
  const TITLES = {
    portfolio: 'Total AMC Portfolio',
    received_all: 'Received on Current AMCs (portfolio position)',
    received_period: `AMC Collections — ${mo === 'all' ? `All ${yr}` : `${MONTH_NAMES[(mo||1)-1]} ${yr}`}`,
    outstanding: 'Outstanding Balance',
    missing_payment_date: 'Payment Date Missing',
  };
  _openWideModal(TITLES[type] || type, '<div style="text-align:center;padding:40px;color:#888">Loading financial details…</div>');
  try {
    const p = new URLSearchParams({ type, year: yr, month: mo === 'all' || !mo ? 'all' : String(mo) });
    if (df.emirate)        p.set('emirate',        df.emirate);
    if (df.type)           p.set('mtype',          df.type);
    if (df.renewal_status) p.set('renewal_status', df.renewal_status);
    const d = await API.get('/api/maintenance-contracts/maint-dashboard/financial-detail?' + p);
    _finDetailData = d;
    const periodStr = d.monthAll ? `All Months ${d.year}` : `${MONTH_NAMES[(d.month||1)-1]} ${d.year}`;
    const box = document.getElementById('modal-box');
    if (!box) return;
    const isMissing = type === 'missing_payment_date';
    const headerHtml = `<div style="font-size:12px;color:#667;margin-bottom:8px">
      Period: <strong>${esc(periodStr)}</strong> &nbsp;·&nbsp; Filters: ${Object.entries(df).filter(([,v])=>v).map(([k,v])=>`<strong>${esc(k)}</strong>: ${esc(v)}`).join(', ')||'None'}
    </div>
    <div style="margin-bottom:8px;display:flex;gap:8px;align-items:center">
      <input id="_fdSearch" type="text" placeholder="Search contract ref, client, renewal ref…"
        style="flex:1;padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px"
        oninput="_finDetailSearch()">
    </div>
    <div id="_fdContent"></div>`;
    // Find the .modal-content div or inject directly
    const mc = box.querySelector('.modal-content');
    if (mc) mc.innerHTML = headerHtml;
    else box.insertAdjacentHTML('beforeend', headerHtml);
    _finDetailRender('');
  } catch (e) {
    const box = document.getElementById('modal-box');
    const mc = box?.querySelector('.modal-content');
    const target = mc || box;
    if (target) target.innerHTML += `<p style="color:#c0392b;padding:10px">Failed to load details: ${esc(e.message)}</p>`;
  }
}

function _mfdUpdatePayment(id, rowData) {
  const inv   = rowData.invoice_ref  || '';
  const paid  = rowData.amount_paid  || '';
  const pstat = rowData.payment_status || 'Partial';
  const form  = `<div style="font-size:13px;margin-bottom:8px;color:#555">
    <strong>${esc(rowData.renewal_ref)}</strong> — ${esc(rowData.client_name)}
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
    <label style="font-size:12px;font-weight:600">Payment Date <span style="color:#c0392b">*</span>
      <input id="_mfd_date" type="date" style="width:100%;margin-top:3px;padding:5px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px">
    </label>
    <label style="font-size:12px;font-weight:600">Amount Paid (AED)
      <input id="_mfd_amount" type="number" value="${esc(String(paid))}" step="0.01" min="0"
        style="width:100%;margin-top:3px;padding:5px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px">
    </label>
    <label style="font-size:12px;font-weight:600">Payment Status
      <select id="_mfd_status" style="width:100%;margin-top:3px;padding:5px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px">
        ${['Paid','Partial','Unpaid'].map(s=>`<option value="${s}"${s===pstat?' selected':''}>${s}</option>`).join('')}
      </select>
    </label>
    <label style="font-size:12px;font-weight:600">Invoice Ref
      <input id="_mfd_inv" type="text" value="${esc(inv)}"
        style="width:100%;margin-top:3px;padding:5px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px">
    </label>
  </div>
  <div id="_mfd_err" style="color:#c0392b;font-size:12px;margin-bottom:6px"></div>
  <div style="display:flex;gap:8px;justify-content:flex-end">
    <button class="btn" onclick="closeModal()" style="font-size:13px">Cancel</button>
    <button class="btn btn-primary" onclick="_mfdSavePayment(${id})" style="font-size:13px">Save Payment</button>
  </div>`;
  openModal(`<h3 style="margin:0 0 12px;font-size:1rem;color:#1a3a5c">Update Payment</h3>${form}`);
}

async function _mfdSavePayment(id) {
  const dateVal = document.getElementById('_mfd_date')?.value;
  const errEl   = document.getElementById('_mfd_err');
  if (!dateVal) { if (errEl) errEl.textContent = 'Payment date is required.'; return; }
  const body = {
    payment_date:   dateVal,
    amount_paid:    parseFloat(document.getElementById('_mfd_amount')?.value) || null,
    payment_status: document.getElementById('_mfd_status')?.value || 'Paid',
    invoice_ref:    document.getElementById('_mfd_inv')?.value || null,
  };
  try {
    await API.post(`/api/renewals/${id}/payment`, body);
    closeModal();
    loadMaintDashboard(null);
    setTimeout(() => _showFinDrilldown('missing_payment_date'), 500);
  } catch (e) {
    if (errEl) errEl.textContent = 'Save failed: ' + e.message;
  }
}

// ─── Operational Drill-Down ──────────────────────────────────────────────────
function _opDetailRender(searchTerm) {
  const d = _opDetailData;
  if (!d) return;
  const box = document.getElementById('modal-box');
  if (!box) return;

  const term = (searchTerm || '').toLowerCase();
  let rows = d.rows || [];
  if (term) {
    rows = rows.filter(r =>
      (r.contract_ref||'').toLowerCase().includes(term) ||
      (r.client_name||'').toLowerCase().includes(term) ||
      (r.maintenance_id||'').toLowerCase().includes(term)
    );
  }

  const isExpiring = ['expiring_30','expiring_60','expiring_90','expired'].includes(d.optype);
  const isRenewed  = d.optype === 'renewed';

  const summaryHtml = `<div style="background:#f0f4fa;border-radius:4px;padding:8px 12px;margin-bottom:10px;font-size:13px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
    <span><strong>${rows.length}</strong> record(s)</span>
    <span style="margin-left:auto">
      <button class="btn btn-sm" onclick="_opDetailExportCSV()" style="font-size:12px">⬇ Export CSV</button>
    </span>
  </div>`;

  let theadCols = `<th>Maint. ID</th><th>Contract</th><th>Client</th><th>Emirate</th><th>Type</th><th>Units</th>`;
  if (isExpiring) theadCols += `<th>End Date</th><th>Days Left</th>`;
  else theadCols += `<th>Start Date</th><th>End Date</th>`;
  theadCols += `<th>Status</th>`;
  if (isRenewed) theadCols += `<th>Renewal Ref</th><th>AMC Value</th><th>Paid</th>`;

  const today = new Date(); today.setHours(0,0,0,0);
  const rowsHtml = rows.length === 0
    ? `<tr><td colspan="12" style="text-align:center;padding:20px;color:#888">No records match your search.</td></tr>`
    : rows.map(r => {
        const daysLeft = r.end_date ? Math.ceil((new Date(r.end_date)-today)/86400000) : null;
        const daysColor = daysLeft !== null ? (daysLeft < 0 ? '#c0392b' : daysLeft <= 30 ? '#e74c3c' : daysLeft <= 60 ? '#e67e22' : '#555') : '#555';
        let tds = `
          <td style="font-family:monospace;font-size:11px">${esc(r.maintenance_id||'—')}</td>
          <td style="font-family:monospace;white-space:nowrap">${esc(r.contract_ref||'—')}</td>
          <td>${esc(r.client_name||'—')}</td>
          <td>${esc(r.emirate||'—')}</td>
          <td>${esc(r.maintenance_type||'—')}</td>
          <td style="text-align:center">${r.total_elevator_units||0}</td>`;
        if (isExpiring) tds += `<td>${fmtDate(r.end_date)}</td><td style="color:${daysColor};font-weight:600">${daysLeft !== null ? daysLeft + 'd' : '—'}</td>`;
        else tds += `<td>${fmtDate(r.start_date)}</td><td>${fmtDate(r.end_date)}</td>`;
        tds += `<td>${esc(r.renewal_status||'—')}</td>`;
        if (isRenewed) tds += `<td style="font-family:monospace;font-size:11px">${esc(r.renewal_ref||'—')}</td><td style="text-align:right">${_fmtAED(r.new_amc_value)}</td><td style="text-align:right;color:#1e8449">${_fmtAED(r.amount_paid)}</td>`;
        return `<tr>${tds}</tr>`;
      }).join('');

  const tableHtml = `<div class="table-wrap"><table class="data-table" style="font-size:0.82em">
    <thead><tr>${theadCols}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table></div>`;

  const contentArea = document.getElementById('_odContent');
  if (contentArea) {
    contentArea.innerHTML = summaryHtml + tableHtml;
  }
}

function _opDetailExportCSV() {
  if (!_opDetailData) return;
  const d = _opDetailData;
  const isRenewed = d.optype === 'renewed';
  const cols = ['maintenance_id','contract_ref','client_name','emirate','maintenance_type','total_elevator_units','start_date','end_date','renewal_status'];
  if (isRenewed) cols.push('renewal_ref','new_amc_value','amount_paid');
  const headers = cols.map(c => c.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase()));
  const csv = [headers.join(','), ...(d.rows||[]).map(r =>
    cols.map(c => { const v = r[c]??''; return typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v; }).join(',')
  )].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
  a.download = `operational_detail_${d.optype}.csv`;
  a.click();
}

async function _showOpDrilldown(optype) {
  const df = MaintContractsState.dashFilters || {};
  const TITLES = {
    total:'Total Contracts', active:'Active Maintenance', hold:'On Hold',
    cancelled:'Cancelled', expiring_30:'Expiring ≤30 Days', expiring_60:'Expiring ≤60 Days',
    expiring_90:'Expiring ≤90 Days', expired:'Expired / Renewal Required', renewed:'Renewed (Active)',
  };
  _openWideModal(TITLES[optype] || optype, '<div style="text-align:center;padding:40px;color:#888">Loading details…</div>');
  try {
    const p = new URLSearchParams({ optype });
    if (df.emirate)        p.set('emirate',        df.emirate);
    if (df.type)           p.set('mtype',          df.type);
    if (df.renewal_status) p.set('renewal_status', df.renewal_status);
    const d = await API.get('/api/maintenance-contracts/maint-dashboard/operational-detail?' + p);
    _opDetailData = d;
    const box = document.getElementById('modal-box');
    if (!box) return;
    const headerHtml = `<div style="font-size:12px;color:#667;margin-bottom:8px">
      Filters: ${Object.entries(df).filter(([,v])=>v).map(([k,v])=>`<strong>${esc(k)}</strong>: ${esc(v)}`).join(', ')||'None'}
    </div>
    <div style="margin-bottom:8px">
      <input id="_odSearch" type="text" placeholder="Search maint. ID, contract, client…"
        style="width:100%;padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;box-sizing:border-box"
        oninput="_opDetailRender(this.value)">
    </div>
    <div id="_odContent"></div>`;
    const mc = box.querySelector('.modal-content');
    if (mc) mc.innerHTML = headerHtml;
    else box.insertAdjacentHTML('beforeend', headerHtml);
    _opDetailRender('');
  } catch (e) {
    const box = document.getElementById('modal-box');
    const mc = box?.querySelector('.modal-content');
    const target = mc || box;
    if (target) target.innerHTML += `<p style="color:#c0392b;padding:10px">Failed to load details: ${esc(e.message)}</p>`;
  }
}
async function _showRenewalMonthDetail(yr, mo) {
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const title = `Renewals — ${MONTH_NAMES[mo-1]} ${yr}`;
  _openWideModal(title, '<div style="text-align:center;padding:40px;color:#888">Loading…</div>');
  try {
    const df = MaintContractsState.dashFilters || {};
    const qp = new URLSearchParams({ year: yr, mo });
    if (df.emirate) qp.set('emirate', df.emirate);
    if (df.type) qp.set('type', df.type);
    if (df.payment_status) qp.set('payment_status', df.payment_status);
    const d = await API.get(`/api/maintenance-contracts/maint-dashboard/renewal-month-detail?${qp}`);
    const box = document.getElementById('modal-box');
    if (!box) return;
    const mc = box.querySelector('.modal-content');
    const fmt = v => v ? `AED ${(+v).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0})}` : '—';
    const fmtDate = v => v ? v.slice(0,10) : '—';
    const summaryHtml = `<div class="cmd-kpi-row" style="margin-bottom:12px">
      <div class="cmd-card" style="border-top:3px solid #2563ad"><div class="cmd-card-val">${d.totals.projects != null ? d.totals.projects : d.totals.renewals}</div><div class="cmd-card-lbl">Projects Renewed</div></div>
      <div class="cmd-card" style="border-top:3px solid #1e8449"><div class="cmd-card-val">${d.totals.units}</div><div class="cmd-card-lbl">Units Renewed</div></div>
      <div class="cmd-card" style="border-top:3px solid #7c3aed"><div class="cmd-card-val">${fmt(d.totals.amc_value)}</div><div class="cmd-card-lbl">Total AMC Value</div></div>
      <div class="cmd-card" style="border-top:3px solid #0891b2"><div class="cmd-card-val">${fmt(d.totals.paid)}</div><div class="cmd-card-lbl">Amount Received</div></div>
    </div>`;
    const tableHtml = d.rows.length
      ? `<div class="table-wrap"><table class="data-table" style="font-size:0.82em">
          <thead><tr>
            <th>Renewal Ref</th><th>Contract Ref</th><th>Client</th>
            <th>New Period</th><th>Units</th>
            <th>AMC Value</th><th>Received</th><th>Pmt Status</th>
            <th>First Pmt Date</th>
          </tr></thead>
          <tbody>${d.rows.map(r => `<tr>
            <td style="font-family:monospace;font-size:11px">${esc(r.renewal_ref||'—')}</td>
            <td style="font-family:monospace;font-size:11px">${esc(r.contract_ref||'—')}</td>
            <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.client_name||'—')}</td>
            <td style="font-size:11px">${fmtDate(r.new_start_date)}–${fmtDate(r.new_end_date)}</td>
            <td style="text-align:center;font-weight:700">${r.units != null ? r.units : (r.total_elevator_units||0)}</td>
            <td style="text-align:right">${fmt(r.new_amc_value)}</td>
            <td style="text-align:right">${fmt(r.total_paid)}</td>
            <td><span class="badge" style="font-size:10px">${esc(r.payment_status||'—')}</span></td>
            <td style="font-size:11px">${fmtDate(r.first_pmt_date)}</td>
          </tr>`).join('')}</tbody>
        </table></div>`
      : '<div style="color:#888;padding:20px;text-align:center">No AMC renewals found for this month.</div>';
    const html = summaryHtml + tableHtml;
    if (mc) mc.innerHTML = `<h3 style="margin:0 0 12px;color:#1a2a3a">${esc(title)}</h3>` + html;
    else box.insertAdjacentHTML('beforeend', html);
  } catch (e) {
    const box = document.getElementById('modal-box');
    const mc = box?.querySelector('.modal-content');
    const t = mc || box;
    if (t) t.innerHTML += `<p style="color:#c0392b;padding:10px">Failed to load: ${esc(e.message)}</p>`;
  }
}
function _mdashBadge(txt, color) {
  return `<span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}55">${esc(txt)}</span>`;
}

// Store last loaded dashboard data for print use
let _mdashLastData = null;

function _mdashPrint() {
  const body = document.getElementById('mdash-body');
  if (!body || !_mdashLastData) {
    alert('Dashboard data not yet loaded. Please wait for the dashboard to finish loading.');
    return;
  }
  const d         = _mdashLastData;
  const pf        = d.portfolio     || {};
  const fin       = d.financial     || {};
  const ren       = d.renewals      || {};
  const svc       = d.service_health || {};
  const exc       = d.exceptions    || {};
  const cb        = d.callbacks     || {};
  const yr        = d.meta?.year    || MaintContractsState.dashYear;
  const mo        = d.meta?.month;
  const monthMode = d.meta?.month_mode || 'month';
  const periodLabel = monthMode === 'all'
    ? `All Months — ${yr}`
    : `${MONTH_NAMES[(mo||1)-1]} ${yr}`;
  const df = MaintContractsState.dashFilters || {};

  // Convert canvas charts to base64 image data-URLs before building print HTML
  const getCanvasImg = (id) => {
    const el = document.getElementById(id);
    if (!el || !(el instanceof HTMLCanvasElement)) return null;
    try { return el.toDataURL('image/png'); } catch(e) { return null; }
  };
  const svcImg = getCanvasImg('mdash-svc-chart');
  const renImg = getCanvasImg('mdash-ren-chart');
  const colImg = getCanvasImg('mdash-col-chart');

  const kpi = (num, label, color) =>
    `<div style="display:inline-block;min-width:110px;padding:8px 12px;margin:4px;border-top:3px solid ${color||'#2563ad'};background:#fff;border-radius:4px;box-shadow:0 1px 3px #0001;vertical-align:top">
       <div style="font-size:1.4em;font-weight:700;color:${color||'#2563ad'}">${num??0}</div>
       <div style="font-size:10px;color:#555;margin-top:2px">${esc(String(label))}</div>
     </div>`;

  const tbl = (thead, rows) => rows.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:6px">
         <thead style="background:#eaf0fb">${thead}</thead><tbody>${rows}</tbody>
       </table>`
    : `<div style="color:#888;font-size:10px;padding:4px 0">No data</div>`;
  const th = (txt) => `<th style="padding:4px 6px;text-align:left;border:1px solid #dde4f0">${esc(txt)}</th>`;
  const td = (txt, extra='') => `<td style="padding:3px 6px;border:1px solid #eaecf0;${extra}">${txt??''}</td>`;
  const sec = (title, body_) =>
    `<div style="margin-bottom:14px;page-break-inside:avoid">
       <div style="font-size:11px;font-weight:700;color:#1a3a5c;border-bottom:2px solid #2563ad;padding-bottom:4px;margin-bottom:8px">${esc(title)}</div>
       ${body_}
     </div>`;

  const filterLine = [
    df.emirate        ? `Emirate: ${df.emirate}` : null,
    df.type           ? `Type: ${df.type}` : null,
    df.renewal_status ? `Renewal: ${df.renewal_status}` : null,
    df.payment_status ? `Payment: ${df.payment_status}` : null,
  ].filter(Boolean).join(' | ');

  // Expiry table helper
  const expTbl = (rows, label, color) => {
    if (!rows?.length) return `<div style="color:#888;font-size:10px">${label}: None</div>`;
    return `<div style="margin-bottom:8px"><div style="font-size:10px;font-weight:600;color:${color};margin-bottom:3px">${label} (${rows.length})</div>`
      + tbl(`<tr>${th('Contract Ref')}${th('Client')}${th('Emirate')}${th('Type')}${th('Expiry')}${th('Units')}</tr>`,
          rows.map(r=>`<tr>${td(esc(r.contract_ref||'-'),'font-family:monospace')}${td(esc(r.client_name||'-'))}${td(esc(r.emirate||'-'))}${td(esc(r.maintenance_type||'-'))}${td(fmtDate(r.end_date))}${td(r.total_elevator_units||0)}</tr>`).join(''))
      + '</div>';
  };

  // Section 1 — Portfolio Health
  const portHtml = kpi(pf.total, 'Total Contracts', '#2563ad')
    + kpi(pf.total_units, 'Total Units', '#2563ad')
    + kpi(pf.active, 'Active', '#1e8449')
    + kpi(pf.hold, 'On Hold', '#e67e22')
    + kpi(pf.cancelled, 'Cancelled', '#95a5a6')
    + kpi(pf.expiring_30, 'Expiring ≤30d', '#e74c3c')
    + kpi(pf.expired, 'Expired', '#c0392b')
    + kpi(pf.renewed, 'Renewed (Active)', '#27ae60')
    + kpi(pf.renewed_units, 'Renewed Units', '#27ae60');

  // Section 2 — Maintenance Performance (unit-based, period-scoped)
  const ss_p = d.service_status || {};
  const ss_sched = ss_p.scheduled_units || 0;
  const ss_comp  = ss_p.completed_units || 0;
  const ss_pct   = ss_sched > 0 ? Math.round(ss_comp / ss_sched * 100) : 0;
  const perfStatHtml = `<div style="font-size:10px;margin-bottom:6px;background:#f8fafd;padding:6px 8px;border-radius:4px;border:1px solid #eef1f8">
    <strong>${esc(periodLabel)}</strong> (Unit-Based Service Status)
    &nbsp;·&nbsp; Scheduled: <b>${ss_sched}</b> &nbsp;·&nbsp; Completed: <b>${ss_comp}</b>
    &nbsp;·&nbsp; Completion: <b>${ss_pct}%</b>
    &nbsp;|&nbsp; Pending: ${ss_p.pending_units||0} &nbsp;·&nbsp; Hold: ${ss_p.hold_units||0}
    &nbsp;·&nbsp; Partial: ${ss_p.partial_units||0} &nbsp;·&nbsp; Postponed: ${ss_p.postponed_units||0} &nbsp;·&nbsp; Missed: ${ss_p.missed_units||0}
    <br>Portfolio Last Service Health &nbsp;·&nbsp; Serviced ≤30d: ${svc.serviced_30d||0} &nbsp;·&nbsp; 31–90d: ${svc.serviced_31_90d||0} &nbsp;·&nbsp; Overdue >90d: ${svc.overdue_90d||0} &nbsp;·&nbsp; No History: ${svc.no_history||0}
  </div>`;

  // Section 3 — Financial Health
  const printPeriodLabel = monthMode === 'all' ? `AMC Collected — ${yr}` : `AMC Collected — ${periodLabel}`;
  const finHtml = kpi(_fmtAED(fin.total_amc_value), 'AMC Portfolio', '#2563ad')
    + kpi(_fmtAED(fin.total_received), 'Received on Current AMCs', '#1e8449')
    + kpi(_fmtAED(fin.received_period), printPeriodLabel, '#27ae60')
    + kpi(_fmtAED(fin.total_receivable), 'Outstanding Balance', '#c0392b')
    + kpi(fin.unpaid_count||0, 'Unpaid Contracts', '#c0392b');

  // Section 4 — Monthly Collections
  const mc_ = Array.from({length:12}, (_, i) => {
    const mc_by_mo = {}; (fin.monthly_collection||[]).forEach(r=>{mc_by_mo[r.mo]=r;});
    return { mo: i+1, collected: mc_by_mo[i+1]?.collected||0, c: mc_by_mo[i+1]?.c||0 };
  });
  const colTableHtml = mc_.some(r=>r.collected>0) ? tbl(
    `<tr>${th('Month')}${th('Collected (AED)')}${th('Payments')}</tr>`,
    mc_.map(r=>`<tr style="${monthMode==='month'&&r.mo===mo?'background:#eaf0fb;font-weight:600':''}">
      ${td(MONTH_NAMES[r.mo-1]+' '+yr+(monthMode==='month'&&r.mo===mo?' ◀':''))}
      ${td(_fmtAED(r.collected),'font-weight:600;color:#1e8449')}${td(r.c)}</tr>`).join('')
  ) : '<div style="color:#888;font-size:10px">No collection data for this year</div>';

  // Section 5 — Renewal Performance
  const renHtml = kpi(ren.total, `Renewals — Period`, '#2563ad')
    + kpi(ren.approved, `Approved`, '#1e8449')
    + kpi(ren.pending, `Pending (Portfolio)`, '#e67e22')
    + kpi(ren.cancelled, `Cancelled / Rejected (Portfolio)`, '#c0392b')
    + kpi(ren.total_portfolio, 'Portfolio Total', '#667')
    + kpi(ren.approved_portfolio, 'Portfolio Approved', '#27ae60');

  // Top receivables table
  const recRows = (d.receivables || []);
  const recTableHtml = recRows.length ? tbl(
    `<tr>${th('Client')}${th('Renewals')}${th('AMC Value')}${th('Paid')}${th('Balance')}</tr>`,
    recRows.map(r=>`<tr>${td(esc(r.client_name||'-'))}${td(r.renewals||0)}${td(_fmtAED(r.amc_value))}${td(_fmtAED(r.paid),'color:#1e8449')}${td(_fmtAED(r.balance),'color:#c0392b;font-weight:600')}</tr>`).join('')
  ) : '<div style="color:#888;font-size:10px">No outstanding receivables</div>';

  // Callbacks
  const cbHtml = kpi(cb.total, 'Total Callbacks', '#2563ad')
    + kpi(cb.open, 'Open', '#c0392b')
    + kpi(cb.in_progress, 'In Progress', '#e67e22')
    + kpi(cb.resolved, 'Resolved', '#1e8449')
    + kpi(cb.high_priority, 'High Priority', '#c0392b');

  const printContent = `
    ${filterLine ? `<div style="background:#fff3cd;border:1px solid #ffc107;padding:6px 10px;font-size:10px;margin-bottom:12px;border-radius:3px">
      <strong>Filters Active:</strong> ${esc(filterLine)} &nbsp;|&nbsp; Financial portfolio totals show all payment statuses.
    </div>` : ''}

    ${sec('Portfolio Health', portHtml)}

    ${sec('Financial Health', finHtml)}

    ${sec('Maintenance Performance — ' + esc(periodLabel), perfStatHtml
      + (svcImg ? `<img src="${svcImg}" style="width:100%;max-height:140px;object-fit:contain;margin-top:6px">` : ''))}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div>${sec('AMC Collections — ' + yr, colTableHtml)}</div>
      <div>${sec('Renewal Performance — ' + esc(periodLabel), renHtml)
        + (renImg ? `<img src="${renImg}" style="width:100%;max-height:120px;object-fit:contain;margin-top:4px">` : '')}</div>
    </div>

    ${sec('AMC Expiry Analysis',
      expTbl(d.expiry_analysis?.d30, 'Expiring ≤30 Days', '#e74c3c') +
      expTbl(d.expiry_analysis?.d60, 'Expiring 31–60 Days', '#e67e22') +
      expTbl(d.expiry_analysis?.d90, 'Expiring 61–90 Days', '#f39c12')
    )}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      ${sec('Outstanding Receivables', recTableHtml)}
      ${sec('Callbacks Snapshot', cbHtml)}
    </div>
  `;

  const filtersObj = {};
  if (df.emirate)        filtersObj['Emirate']        = df.emirate;
  if (df.type)           filtersObj['Type']           = df.type;
  if (df.renewal_status) filtersObj['Renewal Status'] = df.renewal_status;
  if (df.payment_status) filtersObj['Payment Status'] = df.payment_status;

  shPrint({
    title:       'Maintenance Command Center',
    subtitle:    `Period: ${esc(periodLabel)}`,
    contentHtml: printContent,
    filters:     filtersObj,
    landscape:   true,
  });
}

async function renderMaintDashboardTab(root) {
  await _loadChartJs().catch(()=>{});
  if (!MaintContractsState.dashFilters) MaintContractsState.dashFilters = {};
  const df = MaintContractsState.dashFilters;

  const now = new Date();
  const curYear = now.getFullYear();
  const yearOpts = [];
  for (let y = curYear - 2; y <= curYear + 2; y++) yearOpts.push(y);

  let emirates = [];
  try { const r = await API.get('/api/maintenance-contracts/meta/emirates'); emirates = r.rows || []; } catch(e){}

  root.innerHTML = `
    <div style="background:#fff;border:1px solid #dde4f0;border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        <label style="font-size:12px;color:#667;white-space:nowrap">Year</label>
        <select id="mdash-year" style="width:80px;font-size:13px">${yearOpts.map(y=>`<option value="${y}" ${y===MaintContractsState.dashYear?'selected':''}>${y}</option>`).join('')}</select>
      </div>
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        <label style="font-size:12px;color:#667;white-space:nowrap">Month</label>
        <select id="mdash-month" style="width:118px;font-size:13px">
          <option value="all" ${MaintContractsState.dashMonth==='all'?'selected':''}>All Months</option>
          ${MONTH_NAMES.map((n,i)=>`<option value="${i+1}" ${(i+1)===MaintContractsState.dashMonth?'selected':''}>${n}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        <label style="font-size:12px;color:#667;white-space:nowrap">Emirate</label>
        <select id="mdash-emirate" style="width:120px;font-size:13px">
          <option value="">All Emirates</option>
          ${emirates.map(e=>`<option value="${esc(e)}" ${df.emirate===e?'selected':''}>${esc(e)}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        <label style="font-size:12px;color:#667;white-space:nowrap">Type</label>
        <select id="mdash-type" style="width:148px;font-size:13px">
          <option value="">All Types</option>
          ${MAINT_TYPE_OPTS.map(t=>`<option value="${t}" ${df.type===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        <label style="font-size:12px;color:#667;white-space:nowrap">Renewal</label>
        <select id="mdash-rstatus" style="width:168px;font-size:13px">
          <option value="">All Statuses</option>
          ${['Active Maintenance','Hold','Expired / Renewal Required','Cancelled','Renewed'].map(s=>`<option value="${s}" ${df.renewal_status===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        <label style="font-size:12px;color:#667;white-space:nowrap">Payment</label>
        <select id="mdash-pstatus" style="width:110px;font-size:13px">
          <option value="">All</option>
          ${['Unpaid','Partial','Paid','Later','Overdue','Hold'].map(s=>`<option value="${s}" ${df.payment_status===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
      <div style="margin-left:auto;display:flex;gap:6px;flex-shrink:0">
        <button id="mdash-reset-btn" class="btn secondary btn-sm" style="font-size:12px;padding:4px 10px">Reset</button>
        <button id="mdash-print-btn" class="btn btn-sm" style="font-size:12px;padding:4px 10px">
          <i data-lucide="printer" style="width:13px;height:13px;vertical-align:-2px"></i> Print
        </button>
      </div>
    </div>
    <div id="mdash-body" style="min-height:200px"><div style="padding:40px;text-align:center;color:#888">Loading dashboard…</div></div>
  `;
  renderIcons();

  const wireFilter = (id, key, isNum) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', e => {
      const raw = e.target.value;
      let v;
      if (id === 'mdash-month') {
        // Month can be 'all' (string) or a numeric month (1-12)
        v = raw === 'all' ? 'all' : Number(raw);
      } else {
        v = isNum ? Number(raw) : raw;
      }
      if (id === 'mdash-year')        MaintContractsState.dashYear  = v;
      else if (id === 'mdash-month')  MaintContractsState.dashMonth = v;
      else MaintContractsState.dashFilters[key] = v || undefined;
      loadMaintDashboard(root);
    });
  };
  wireFilter('mdash-year',    null,         true);
  wireFilter('mdash-month',   null,         false);
  wireFilter('mdash-emirate', 'emirate',    false);
  wireFilter('mdash-type',    'type',       false);
  wireFilter('mdash-rstatus', 'renewal_status', false);
  wireFilter('mdash-pstatus', 'payment_status', false);

  document.getElementById('mdash-reset-btn')?.addEventListener('click', () => {
    MaintContractsState.dashFilters = {};
    MaintContractsState.dashYear  = new Date().getFullYear();
    MaintContractsState.dashMonth = 'all';
    renderMaintDashboardTab(root);
  });
  document.getElementById('mdash-print-btn')?.addEventListener('click', () => {
    _mdashPrint();
  });

  await loadMaintDashboard(root);
}

async function loadMaintDashboard(root) {
  _mdashDestroyCharts();
  const body = document.getElementById('mdash-body');
  if (body) body.innerHTML = '<div style="padding:40px;text-align:center;color:#888">Loading dashboard…</div>';
  const df = MaintContractsState.dashFilters || {};
  const dashMonth = MaintContractsState.dashMonth;
  const p = new URLSearchParams({ year: MaintContractsState.dashYear });
  p.set('month', dashMonth === 'all' || !dashMonth ? 'all' : String(dashMonth));
  if (df.emirate)        p.set('emirate',        df.emirate);
  if (df.type)           p.set('type',           df.type);
  if (df.renewal_status) p.set('renewal_status', df.renewal_status);
  if (df.payment_status) p.set('payment_status', df.payment_status);
  try {
    const d = await API.get('/api/maintenance-contracts/maint-dashboard?' + p);
    _mdashLastData = d;
    renderDashboardBody(d, root);
  } catch(e) {
    if (body) body.innerHTML = `<div style="padding:20px;color:#c0392b">Failed to load dashboard: ${esc(e.message)}</div>`;
  }
}

// ─── Presentation View — reusable fullscreen chart overlay ───────────────────
function _mdashOpenPresentation(title, renderFn) {
  document.getElementById('mdash-pres-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'mdash-pres-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', title);
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9990;background:rgba(10,20,45,.72);display:flex;align-items:center;justify-content:center;';

  const card = document.createElement('div');
  card.style.cssText = 'background:#fff;border-radius:10px;box-shadow:0 28px 80px rgba(0,0,0,.45);width:96vw;height:92vh;display:flex;flex-direction:column;overflow:hidden;';

  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:13px 20px;border-bottom:1px solid #dde4f0;background:#f8fafd;flex-shrink:0;';

  const titleEl = document.createElement('span');
  titleEl.style.cssText = 'font-size:1rem;font-weight:700;color:#0f2d5e;';
  titleEl.textContent = title;

  const closeBtn = document.createElement('button');
  closeBtn.id = 'mdash-pres-close';
  closeBtn.setAttribute('aria-label', 'Close presentation view');
  closeBtn.style.cssText = 'background:#e8eef8;border:1px solid #c2d4ef;border-radius:6px;cursor:pointer;padding:5px 14px;font-size:13px;font-weight:600;color:#2563ad;';
  closeBtn.textContent = '✕ Close';

  hdr.appendChild(titleEl);
  hdr.appendChild(closeBtn);

  const bodyEl = document.createElement('div');
  bodyEl.id = 'mdash-pres-body';
  bodyEl.style.cssText = 'flex:1;overflow:auto;padding:20px 24px;display:flex;flex-direction:column;min-height:0;';

  card.appendChild(hdr);
  card.appendChild(bodyEl);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  let closed = false, cleanup = null;
  const close = () => {
    if (closed) return;
    closed = true;
    if (typeof cleanup === 'function') { try { cleanup(); } catch (_) {} }   // e.g. destroy the presentation chart
    overlay.remove();
    document.removeEventListener('keydown', _escH);
  };
  const _escH = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', _escH);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Render after DOM is painted so container dimensions are available
  requestAnimationFrame(() => { closeBtn.focus(); if (!closed) cleanup = renderFn(bodyEl); });
}

// Store chart configs so presentation view can re-draw at full size
let _mdashChartCfgs = {};

// ─── Premium Maintenance Command Center ──────────────────────────────────────
function renderDashboardBody(d, root) {
  const body = document.getElementById('mdash-body');
  if (!body) return;
  _mdashDestroyCharts();

  const pf        = d.portfolio      || {};
  const fin       = d.financial      || {};
  const svc       = d.service_health || {};
  const exc       = d.exceptions     || {};
  const cb        = d.callbacks      || {};
  const ren       = d.renewals       || {};
  const yr        = d.meta?.year     || MaintContractsState.dashYear;
  const mo        = d.meta?.month;
  const monthMode = d.meta?.month_mode || 'month';
  const periodLabel = monthMode === 'all'
    ? `Full Year ${yr}`
    : `${MONTH_NAMES[(mo||1)-1]} ${yr}`;

  // ── Design tokens ────────────────────────────────────────────────────────
  const C = {
    navy:   '#0f2d5e',
    blue:   '#2563ad',
    green:  '#1e8449',
    teal:   '#0e7e6e',
    amber:  '#d97706',
    orange: '#c05621',
    red:    '#c0392b',
    gray:   '#6b7280',
    bg:     '#f4f6fb',
    card:   '#ffffff',
    border: '#dde4f0',
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const cmdCard = (value, label, color, sub, onclick) => {
    const c = color || C.blue;
    const clickAttr = onclick ? ` onclick="${onclick.replace(/"/g,'&quot;')}" style="cursor:pointer"` : '';
    return `<div class="cmd-kpi-card"${clickAttr}>
      <div class="cmd-kpi-top" style="border-top:3px solid ${c}">
        <div class="cmd-kpi-val" style="color:${c}">${value ?? 0}</div>
        <div class="cmd-kpi-label">${esc(label)}</div>
        ${sub ? `<div class="cmd-kpi-sub">${sub}</div>` : ''}
        ${onclick ? `<div class="cmd-kpi-action">View Details →</div>` : ''}
      </div>
    </div>`;
  };
  // cmdSection optionally accepts zoomKey — adds Presentation View button to header
  const cmdSection = (title, content, style='', zoomKey='') => {
    const zoomBtn = zoomKey
      ? `<button class="cmd-zoom-btn" data-zoom="${zoomKey}" title="Presentation View"
           aria-label="Presentation View" style="background:none;border:1px solid #c8d6ee;border-radius:4px;
           cursor:pointer;padding:3px 7px;font-size:15px;color:#667;flex-shrink:0;line-height:1;margin-left:8px">⛶</button>`
      : '';
    return `<div class="cmd-section" style="${style}">
      <div class="cmd-section-hdr" style="display:flex;align-items:center;justify-content:space-between">
        <span>${title}</span>${zoomBtn}
      </div>
      <div class="cmd-section-body">${content}</div>
    </div>`;
  };
  const progBar = (val, max, color) => {
    const pct = max > 0 ? Math.min(100, Math.round(val / max * 100)) : 0;
    return `<div style="background:#e8edf5;border-radius:3px;height:8px;overflow:hidden;margin-top:3px">
      <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;transition:width .3s"></div>
    </div>`;
  };

  // ── Inject scoped styles once ─────────────────────────────────────────────
  if (!document.getElementById('cmd-styles')) {
    const style = document.createElement('style');
    style.id = 'cmd-styles';
    style.textContent = `
      .cmd-section { background:#fff; border:1px solid #dde4f0; border-radius:8px; margin-bottom:14px; overflow:hidden; }
      .cmd-section-hdr { font-size:12px; font-weight:700; color:#0f2d5e; text-transform:uppercase; letter-spacing:.6px;
        padding:9px 16px; border-bottom:1px solid #eef1f8; background:#f8fafd; }
      .cmd-section-body { padding:14px 16px; }
      .cmd-kpi-row { display:flex; flex-wrap:wrap; gap:10px; }
      .cmd-kpi-card { flex:1; min-width:110px; }
      .cmd-kpi-top { border-radius:6px; padding:10px 12px; background:#fff; border:1px solid #eef1f8; }
      /* Portfolio Health — 7-card responsive grid */
      .cmd-port-grid { display:grid; grid-template-columns:repeat(7, minmax(0,1fr)); gap:10px; }
      .cmd-port-grid .cmd-kpi-card { flex:none; min-width:0; }
      @media (max-width:980px)  { .cmd-port-grid { grid-template-columns:repeat(4, minmax(0,1fr)); } }
      @media (max-width:600px)  { .cmd-port-grid { grid-template-columns:repeat(2, minmax(0,1fr)); } }
      .cmd-kpi-val { font-size:1.45rem; font-weight:700; line-height:1.1; }
      .cmd-kpi-label { font-size:11px; color:#556; margin-top:2px; line-height:1.3; }
      .cmd-kpi-sub { font-size:10.5px; color:#888; margin-top:1px; }
      .cmd-kpi-action { font-size:10px; color:#2563ad; margin-top:5px; font-weight:600; }
      .cmd-kpi-card[onclick]:hover .cmd-kpi-top { background:#f0f7ff; border-color:#b3c9ef; }
      .cmd-tabs-bar { display:flex; gap:2px; border-bottom:2px solid #dde4f0; margin-bottom:12px; flex-wrap:wrap; }
      .cmd-tab { padding:6px 14px; font-size:12px; font-weight:600; color:#667; cursor:pointer; border-radius:4px 4px 0 0; border:1px solid transparent; border-bottom:none; }
      .cmd-tab:hover { color:#2563ad; background:#f0f7ff; }
      .cmd-tab.active { color:#2563ad; background:#fff; border-color:#dde4f0; margin-bottom:-2px; }
      .cmd-tab-panel { display:none; } .cmd-tab-panel.active { display:block; }
      .cmd-attn-row td { padding:7px 10px; font-size:13px; vertical-align:middle; }
      .cmd-attn-row:hover td { background:#f8fafd; }
      .cmd-badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; }
      .cmd-zoom-btn:hover { background:#f0f7ff !important; border-color:#2563ad !important; color:#2563ad !important; }
    `;
    document.head.appendChild(style);
  }

  // ── Section 1 — Portfolio Health (7-card single row) ─────────────────────
  const portStatusRow = `<div class="cmd-port-grid">
    ${cmdCard(pf.total,       'Total Contracts',    C.blue,   (pf.total_units||0)+' units',     "_showOpDrilldown('total')")}
    ${cmdCard(pf.active,      'Active Maintenance', C.green,  (pf.active_units||0)+' units',    "_showOpDrilldown('active')")}
    ${cmdCard(pf.hold,        'On Hold',            C.amber,  null,                              "_showOpDrilldown('hold')")}
    ${cmdCard(pf.cancelled,   'Cancelled',          C.gray,   null,                              "_showOpDrilldown('cancelled')")}
    ${cmdCard(pf.expiring_30, 'Expiring ≤30 Days',  C.red,    null,                             "_showOpDrilldown('expiring_30')")}
    ${cmdCard(pf.expired,     'Expired',            C.red,    null,                              "_showOpDrilldown('expired')")}
    ${cmdCard(pf.renewed,     'Renewed (Active)',   C.green,  (pf.renewed_units||0)+' units',   "_showOpDrilldown('renewed')")}
  </div>`;

  // ── Section 2 — 12 Month Visit Trend (full-width, Service Status removed) ─
  const ms = d.monthly_service || [];
  const msLabels    = ms.map(r => MONTH_ABBR[r.month-1] + " '" + String(r.year).slice(2));
  const msScheduled = ms.map(r => r.scheduled);
  const msCompleted = ms.map(r => r.completed);
  const msPartial   = ms.map(r => r.partial);

  // Period-scoped unit stats (retained for stat bar and Requires Attention data)
  const ss = d.service_status || {};
  const ssScheduled  = ss.scheduled_units || 0;
  const ssCompleted  = ss.completed_units || 0;
  const ssPending    = ss.pending_units   || 0;
  const ssHold       = ss.hold_units      || 0;
  const ssPartial    = ss.partial_units   || 0;
  const ssPostponed  = ss.postponed_units || 0;
  const ssMissed     = ss.missed_units    || 0;
  // Completion % comes from the backend (Completed / Due — same definition as Monthly Calendar)
  const ssCompPct    = ss.completion_pct != null ? Math.round(ss.completion_pct) : (ssScheduled > 0 ? Math.round(ssCompleted / ssScheduled * 100) : 0);
  const ssRemaining  = ssScheduled - ssCompleted;

  const svcStatRow = `
    <div style="padding:10px 12px;background:#f8fafd;border-radius:6px;border:1px solid #eef1f8;margin-bottom:12px">
      <div style="font-size:11px;color:#556;font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px">
        ${monthMode==='all' ? `Full Year ${yr}` : `${MONTH_NAMES[(mo||1)-1]} ${yr}`} — Scheduled Services (Units)
      </div>
      <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:13px">
        <div><span style="color:#556;font-size:11px">Scheduled</span><br><b style="font-size:1.1em;color:${C.blue}">${ssScheduled}</b></div>
        <div><span style="color:#556;font-size:11px">Completed</span><br><b style="font-size:1.1em;color:${C.green}">${ssCompleted}</b></div>
        <div><span style="color:#556;font-size:11px">Remaining</span><br><b style="font-size:1.1em;color:${C.amber}">${ssRemaining}</b></div>
        <div><span style="color:#556;font-size:11px">Completion Rate</span><br>
          <b style="font-size:1.1em;color:${ssCompPct>=80?C.green:ssCompPct>=50?C.amber:C.red}">${ssCompPct}%</b>
        </div>
      </div>
      ${ssScheduled > 0 ? `<div style="background:#e8edf5;border-radius:4px;height:6px;margin-top:8px;overflow:hidden">
        <div style="height:100%;width:${ssCompPct}%;background:${ssCompPct>=80?C.green:ssCompPct>=50?C.amber:C.red};border-radius:4px;transition:width .4s"></div>
      </div>` : ''}
    </div>`;
  const svcChartTitle = monthMode === 'all'
    ? `12 Month Visit Trend — ${yr}`
    : `12-Month Visit Trend (ending ${MONTH_NAMES[(mo||1)-1]} ${yr})`;
  // Full-width: taller canvas
  const svcHtml = svcStatRow + `<canvas id="mdash-svc-chart" height="130"></canvas>`;

  // ── Section 3 — Financial Health ──────────────────────────────────────────
  const missingDateCount = fin.payments_missing_date || 0;
  const receivedPeriodLabel = monthMode === 'all' ? `AMC Collected — ${yr}` : `AMC Collected — ${periodLabel}`;
  const payFilterNote = fin.pay_status_filter
    ? `<div style="background:#fff3cd;border:1px solid #f0c040;border-radius:4px;padding:6px 10px;font-size:11px;margin-bottom:10px;color:#856404">
         <strong>Note:</strong> Payment Status filter <strong>"${esc(fin.pay_status_filter)}"</strong> is active. Portfolio totals show full portfolio (all statuses). Receivables table is filtered.
       </div>` : '';
  const missingBanner = missingDateCount > 0
    ? `<div style="background:#fff3cd;border:1px solid #f0c040;border-radius:4px;padding:7px 12px;font-size:12px;margin-bottom:10px;color:#856404">
         ⚠️ <strong>${missingDateCount} AMC payment(s) — Payment Date Missing</strong> — ${_fmtAED(fin.payments_missing_amount)} not assigned to any month in AMC Collections until the date is entered.
         <a href="#" onclick="_showFinDrilldown('missing_payment_date');return false" style="color:#856404;font-weight:600;text-decoration:underline;margin-left:6px">View records →</a>
       </div>` : '';
  const finRow = `${payFilterNote}${missingBanner}<div class="cmd-kpi-row">
    ${cmdCard(_fmtAED(fin.total_amc_value),  'AMC Portfolio',         C.blue,  'Approved renewals',             "_showFinDrilldown('portfolio')")}
    ${cmdCard(_fmtAED(fin.total_received),   'Received on Current AMCs', C.green, (fin.received_count||0)+' renewals · portfolio position', "_showFinDrilldown('received_all')")}
    ${cmdCard(_fmtAED(fin.received_period),  receivedPeriodLabel,     C.teal,  (fin.received_period_count||0)+' payments · by payment date',"_showFinDrilldown('received_period')")}
    ${cmdCard(_fmtAED(fin.outstanding_due != null ? fin.outstanding_due : fin.total_receivable), 'Total Outstanding AMC Due', C.red,
        `${(fin.payment_status_breakdown && fin.payment_status_breakdown.Partial.count) || 0} partial · ${(fin.payment_status_breakdown && fin.payment_status_breakdown.Unpaid.count) || 0} unpaid`,
        "_showFinDrilldown('outstanding')")}
    ${(() => { const b = fin.payment_status_breakdown || { Paid:{count:0,units:0}, Partial:{count:0,units:0}, Unpaid:{count:0,units:0} };
        return cmdCard(`<span style="font-size:14px;line-height:1.5">${b.Paid.count} Paid · ${b.Partial.count} Partial · ${b.Unpaid.count} Unpaid</span>`,
          'Current AMC Payment Status', C.blue, `${b.Paid.units} / ${b.Partial.units} / ${b.Unpaid.units} units`, "_showFinDrilldown('outstanding')"); })()}
    ${missingDateCount>0 ? cmdCard(missingDateCount,'Payment Date Missing',C.amber,_fmtAED(fin.payments_missing_amount)+' not in any month',"_showFinDrilldown('missing_payment_date')") : ''}
  </div>`;

  // ── Section 4 — AMC Collections (full-width) ─────────────────────────────
  const mc_raw    = fin.monthly_collection || [];
  const mc_by_mo  = {};
  mc_raw.forEach(r => { mc_by_mo[r.mo] = r; });
  const mc        = Array.from({length:12}, (_, i) => ({
    mo: i+1, collected: mc_by_mo[i+1]?.collected || 0, c: mc_by_mo[i+1]?.c || 0
  }));
  const mcLabels  = mc.map(r => MONTH_ABBR[r.mo-1]);
  const mcValues  = mc.map(r => r.collected);
  const mcColors  = mc.map(r => (monthMode==='month' && r.mo===mo) ? '#1e8449' : '#2563adaa');
  const mcBorders = mc.map(r => (monthMode==='month' && r.mo===mo) ? '#1e8449' : '#2563ad');
  const colIgn    = (fin.collections_filters_ignored || []);
  const colNote   = (monthMode==='all'
    ? `AMC payments received by month — ${yr} · total <strong>${_fmtAED(fin.collections_total_year || 0)}</strong> (${fin.collections_count_year || 0} payments)`
    : `AMC payments Jan–Dec ${yr} — <strong>${MONTH_NAMES[(mo||1)-1]}</strong> highlighted · year total <strong>${_fmtAED(fin.collections_total_year || 0)}</strong>`)
    + ` <span style="color:#99a">— valid ledger payments by actual Payment Date; same calculation as Reports → AMC Payments. Click a bar for its payments.</span>`
    + (colIgn.length ? `<br><span style="color:#b7791f">${esc(colIgn.join(' / '))} filter does not apply to collections — historical receipts are always included.</span>` : '');
  const collHtml  = `<div style="font-size:11px;color:#667;margin-bottom:6px">${colNote}</div>
    <canvas id="mdash-col-chart" height="110"></canvas>`;

  // ── Section 5 — Renewal Performance (full-width) ─────────────────────────
  const renTrendUnitMap = {};
  const renTrendCntMap  = {};
  const renTrendValMap  = {};
  (ren.trend||[]).forEach(r => {
    renTrendUnitMap[r.mo] = r.u || 0;
    renTrendCntMap[r.mo]  = (r.p != null ? r.p : r.c) || 0;
    renTrendValMap[r.mo]  = r.val || 0;
  });
  const renTrendData    = Array.from({length:12}, (_, i) => renTrendUnitMap[i+1]||0);
  const renTrendCounts  = Array.from({length:12}, (_, i) => renTrendCntMap[i+1]||0);
  const renTrendValues  = Array.from({length:12}, (_, i) => renTrendValMap[i+1]||0);
  const renCards = `<div style="font-size:11px;color:#556;margin-bottom:8px">
    Period: <strong>${esc(periodLabel)}</strong> &nbsp;·&nbsp; Portfolio: ${ren.total_portfolio||0} total / ${ren.approved_portfolio||0} approved / ${ren.approved_units||0} active units
  </div>
  <div class="cmd-kpi-row" style="margin-bottom:14px">
    ${cmdCard(ren.approved_projects_period ?? ren.approved, `Renewal Projects`,      C.blue,  'completed in period')}
    ${cmdCard(ren.approved_units_period, `Renewed Units`,         C.green, 'in period')}
    ${cmdCard(ren.pending,               `Pending`,               C.amber)}
    ${cmdCard(ren.cancelled,             `Cancelled / Rejected`,  C.red)}
  </div>
  <div style="font-size:11px;color:#667;margin-bottom:6px">AMC Renewed Units by Initial Payment Month — ${yr} <span style="color:#aaa;font-weight:400">(click bar to view details)</span></div>
  <div style="font-size:10px;color:#aaa;margin-top:-4px;margin-bottom:6px">Completed renewals (Approved + Active + payment received), each counted once by its first payment date — same calculation as Reports → AMC Portfolio &amp; Renewal.</div>
  <canvas id="mdash-ren-chart" height="110" style="cursor:pointer"></canvas>`;

  // ── Section 6 — Requires Attention (data only; moved to Detail Tables tab) ─
  const attnRows = [
    { priority:'Critical', badge:'#c0392b', issue:'Expired AMC Without Renewal',    count:pf.expired||0,           amount:null,                         action:"_showOpDrilldown('expired')" },
    { priority:'Critical', badge:'#c0392b', issue:'Outstanding Payments',            count:fin.unpaid_count||0,     amount:_fmtAED(fin.total_receivable), action:"_showFinDrilldown('outstanding')" },
    pf.expiring_30 ? { priority:'High',    badge:'#e74c3c', issue:'Expiring in ≤30 Days',                count:pf.expiring_30,  amount:null,  action:"_showOpDrilldown('expiring_30')" } : null,
    pf.expiring_60 ? { priority:'High',    badge:'#e67e22', issue:'Expiring in 31–60 Days',              count:pf.expiring_60,  amount:null,  action:"_showOpDrilldown('expiring_60')" } : null,
    ssMissed  > 0  ? { priority:'High',    badge:'#c0392b', issue:`Missed Units — ${esc(monthMode==='all'?`Full Year ${yr}`:periodLabel)}`,    count:ssMissed,        amount:null,  action:"_showSvcStatusDetail('missed')" } : null,
    ssHold    > 0  ? { priority:'Medium',  badge:'#d97706', issue:`On-Hold Units — ${esc(monthMode==='all'?`Full Year ${yr}`:periodLabel)}`,   count:ssHold,          amount:null,  action:"_showSvcStatusDetail('hold')" } : null,
    ssPostponed>0  ? { priority:'Medium',  badge:'#c05621', issue:`Postponed Units — ${esc(monthMode==='all'?`Full Year ${yr}`:periodLabel)}`, count:ssPostponed,     amount:null,  action:"_showSvcStatusDetail('postponed')" } : null,
    ssPending  > 0 ? { priority:'Medium',  badge:'#6b7280', issue:`Pending Units — ${esc(monthMode==='all'?`Full Year ${yr}`:periodLabel)}`,   count:ssPending,       amount:null,  action:"_showSvcStatusDetail('pending')" } : null,
    missingDateCount>0 ? { priority:'Medium',badge:'#c05621', issue:'Missing Payment Dates',             count:missingDateCount, amount:_fmtAED(fin.payments_missing_amount), action:"_showFinDrilldown('missing_payment_date')" } : null,
    cb.open > 0     ? { priority:'Medium', badge:'#c0392b',  issue:'Open Callback / Emergency',          count:cb.open||0,       amount:null,  action:null } : null,
  ].filter(Boolean);

  const attnHtml = attnRows.length === 0
    ? `<div style="color:#1e8449;font-size:13px;padding:12px 0">✓ No critical items require attention.</div>`
    : `<table style="width:100%;border-collapse:collapse">
        <thead><tr style="border-bottom:2px solid #eef1f8">
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#667;text-transform:uppercase;letter-spacing:.5px;font-weight:700">Priority</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#667;text-transform:uppercase;letter-spacing:.5px;font-weight:700">Issue</th>
          <th style="padding:8px 10px;text-align:center;font-size:11px;color:#667;text-transform:uppercase;letter-spacing:.5px;font-weight:700">Count</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#667;text-transform:uppercase;letter-spacing:.5px;font-weight:700">Amount</th>
          <th style="padding:8px 10px;font-size:11px;color:#667;text-transform:uppercase;letter-spacing:.5px;font-weight:700"></th>
        </tr></thead>
        <tbody>${attnRows.map(r=>`
          <tr class="cmd-attn-row" style="border-bottom:1px solid #f0f2f6">
            <td><span class="cmd-badge" style="background:${r.badge}1a;color:${r.badge};border:1px solid ${r.badge}44">${r.priority}</span></td>
            <td style="font-weight:500;color:#1a2a3a">${esc(r.issue)}</td>
            <td style="text-align:center;font-weight:700;color:#1a2a3a">${r.count || '—'}</td>
            <td style="text-align:right;font-weight:600;color:#c0392b">${r.amount || '—'}</td>
            <td>${r.action ? `<a href="#" onclick="${r.action.replace(/"/g,'&quot;')};return false" style="font-size:11px;color:#2563ad;font-weight:600">View →</a>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;

  // ── Section 7 — Tabbed Detail Tables (Requires Attention tab added) ───────
  const allExpiring = [
    ...(d.expiry_analysis?.d30||[]).map(r=>({...r,_days:'≤30'})),
    ...(d.expiry_analysis?.d60||[]).map(r=>({...r,_days:'31–60'})),
    ...(d.expiry_analysis?.d90||[]).map(r=>({...r,_days:'61–90'})),
  ];
  const expiringTab = allExpiring.length
    ? `<div class="table-wrap"><table class="data-table" style="font-size:0.82em">
        <thead><tr><th>Contract Ref</th><th>Client</th><th>Emirate</th><th>Type</th><th>AMC End</th><th>Days</th><th>Units</th><th>Renewal Status</th></tr></thead>
        <tbody>${allExpiring.map(r=>`<tr>
          <td style="font-family:monospace">${esc(r.contract_ref||'-')}</td>
          <td>${esc(r.client_name||'-')}</td>
          <td>${esc(r.emirate||'-')}</td>
          <td>${esc(r.maintenance_type||'-')}</td>
          <td>${fmtDate(r.end_date)}</td>
          <td><span class="cmd-badge" style="background:#e74c3c1a;color:#c0392b">${r._days}</span></td>
          <td style="text-align:center">${r.total_elevator_units||0}</td>
          <td>${esc(r.renewal_status||'—')}</td>
        </tr>`).join('')}</tbody>
      </table></div>`
    : '<div class="empty-state">No contracts expiring within 90 days.</div>';

  const receivables = d.receivables || [];
  const outstandingTab = receivables.length
    ? `<div class="table-wrap"><table class="data-table" style="font-size:0.82em">
        <thead><tr><th>Client</th><th>Renewals</th><th>AMC Value</th><th>Received</th><th>Balance</th></tr></thead>
        <tbody>${receivables.map(r=>`<tr>
          <td>${esc(r.client_name||'-')}</td>
          <td>${r.renewals||0}</td>
          <td style="text-align:right">${_fmtAED(r.amc_value)}</td>
          <td style="text-align:right;color:#1e8449;font-weight:600">${_fmtAED(r.paid)}</td>
          <td style="text-align:right;color:#c0392b;font-weight:600">${_fmtAED(r.balance)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div style="text-align:right;margin-top:8px">
        <a href="#" onclick="_showFinDrilldown('outstanding');return false" style="font-size:12px;color:#2563ad;font-weight:600">View all outstanding → </a>
      </div>`
    : '<div class="empty-state">No outstanding payments.</div>';

  const svcPerfTab = ms.length
    ? `<div class="table-wrap"><table class="data-table" style="font-size:0.83em">
        <thead><tr><th>Period</th><th style="text-align:center">Scheduled</th><th style="text-align:center">Completed</th><th style="text-align:center">Partial</th><th style="text-align:center">Completion %</th></tr></thead>
        <tbody>${ms.map(r=>{
          const pct = r.scheduled>0?Math.round(r.completed/r.scheduled*100):0;
          const isSelected = monthMode==='month' && r.month===mo && r.year===yr;
          return `<tr style="${isSelected?'background:#f0f7ff;font-weight:600':''}">
            <td>${MONTH_NAMES[r.month-1]} ${r.year}${isSelected?' ◀':''}</td>
            <td style="text-align:center">${r.scheduled}</td>
            <td style="text-align:center;color:#1e8449;font-weight:600">${r.completed}</td>
            <td style="text-align:center;color:#2563ad">${r.partial}</td>
            <td style="text-align:center;color:${pct>=80?'#1e8449':pct>=50?'#d97706':'#c0392b'};font-weight:600">${pct}%</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`
    : '<div class="empty-state">No service data for this period.</div>';

  const emirateTab = `<div class="table-wrap"><table class="data-table" style="font-size:0.83em">
    <thead><tr><th>Emirate</th><th>Contracts</th><th>Units</th></tr></thead>
    <tbody>${(d.emirate_summary||[]).map(e=>`<tr>
      <td>${esc(e.emirate||'Unknown')}</td>
      <td>${e.contracts||0}</td>
      <td>${e.units||0}</td>
    </tr>`).join('')||'<tr><td colspan="3" class="empty-state">No data</td></tr>'}</tbody>
  </table></div>
  <div style="margin-top:12px">${(d.emirate_summary||[]).map(e=>{
    const mx = Math.max(...(d.emirate_summary||[]).map(x=>x.contracts),1);
    return `<div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px">
        <span><b>${esc(e.emirate||'Unknown')}</b></span>
        <span style="color:#556">${e.contracts} contracts · ${e.units||0} units</span>
      </div>${progBar(e.contracts,mx,C.blue)}</div>`;
  }).join('')}</div>`;

  const cbTab = cb.recent?.length
    ? `<div class="table-wrap"><table class="data-table" style="font-size:0.82em">
        <thead><tr><th>CB Ref</th><th>Contract</th><th>Client</th><th>Priority</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>${cb.recent.map(r=>`<tr>
          <td style="font-family:monospace">${esc(r.callback_ref||'-')}</td>
          <td>${esc(r.contract_ref||'-')}</td>
          <td>${esc(r.client_name||'-')}</td>
          <td>${_mdashBadge(r.priority||'-', r.priority==='High'?C.red:r.priority==='Medium'?C.amber:C.gray)}</td>
          <td>${_mdashBadge(r.callback_status||'-', r.callback_status==='Open'?C.red:r.callback_status==='Resolved'?C.green:C.amber)}</td>
          <td>${fmtDate(r.complaint_datetime)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div style="display:flex;gap:12px;margin-top:10px;flex-wrap:wrap">
        ${[
          ['Total',cb.total||0,C.blue],['Open',cb.open||0,C.red],
          ['In Progress',cb.in_progress||0,C.amber],['Resolved',cb.resolved||0,C.green],
          ['High Priority Open',cb.high_priority||0,C.red],
        ].map(([l,v,c])=>`<div style="font-size:12px;color:#556">${l}: <strong style="color:${c}">${v}</strong></div>`).join('')}
      </div>`
    : '<div class="empty-state">No callback / emergency records.</div>';

  // "Requires Attention" tab sits immediately next to Callbacks
  const attnCount = attnRows.length;
  const tabsHtml = `
    <div class="cmd-tabs-bar">
      <div class="cmd-tab active" data-cmdtab="expiring">Expiring AMC (${allExpiring.length})</div>
      <div class="cmd-tab" data-cmdtab="outstanding">Outstanding Payments (${receivables.length})</div>
      <div class="cmd-tab" data-cmdtab="svcperf">Service Performance</div>
      <div class="cmd-tab" data-cmdtab="emirate">By Emirate</div>
      <div class="cmd-tab" data-cmdtab="callbacks">Callbacks (${cb.total||0})</div>
      <div class="cmd-tab" data-cmdtab="attn" style="${attnCount>0?'color:#c0392b':''}">${attnCount>0?'⚠ ':''}Requires Attention (${attnCount})</div>
    </div>
    <div class="cmd-tab-panel active" id="cmdtab-expiring">${expiringTab}</div>
    <div class="cmd-tab-panel" id="cmdtab-outstanding">${outstandingTab}</div>
    <div class="cmd-tab-panel" id="cmdtab-svcperf">${svcPerfTab}</div>
    <div class="cmd-tab-panel" id="cmdtab-emirate">${emirateTab}</div>
    <div class="cmd-tab-panel" id="cmdtab-callbacks">${cbTab}</div>
    <div class="cmd-tab-panel" id="cmdtab-attn">${attnHtml}</div>`;

  // ── Assemble all sections — clean layout without Service Status or standalone Requires Attention ─
  body.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:14px;flex-wrap:wrap">
      <h2 style="margin:0;font-size:1.15rem;color:${C.navy};font-weight:700">Maintenance Command Center</h2>
      <div style="font-size:12px;background:#eaf0fb;border:1px solid #c2d4ef;border-radius:4px;padding:4px 12px;color:${C.blue}">
        📅 <strong>${esc(periodLabel)}</strong>
        ${monthMode==='month' ? ' — period-specific metrics apply below' : ' — full-year view'}
      </div>
    </div>

    ${cmdSection('Portfolio Health <span style="font-size:10px;font-weight:400;color:#667;text-transform:none;letter-spacing:0">— Current snapshot (not period-filtered)</span>', portStatusRow)}

    ${cmdSection('Financial Health <span style="font-size:10px;font-weight:400;color:#667;text-transform:none;letter-spacing:0">— Portfolio totals (all payment statuses)</span>', finRow)}

    ${cmdSection(svcChartTitle, svcHtml, '', 'svc')}

    ${cmdSection(`AMC Collections — ${yr}`, collHtml, '', 'col')}

    ${cmdSection('Renewal Performance', renCards, '', 'ren')}

    ${cmdSection('Detail Tables', tabsHtml)}
  `;

  // ── Wire detail-table tabs ────────────────────────────────────────────────
  body.querySelectorAll('.cmd-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      body.querySelectorAll('.cmd-tab').forEach(t => t.classList.remove('active'));
      body.querySelectorAll('.cmd-tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById('cmdtab-' + tab.dataset.cmdtab);
      if (panel) panel.classList.add('active');
    });
  });

  // ── Chart option factory ──────────────────────────────────────────────────
  const chartOpts = (isPresentation=false) => {
    const fs = isPresentation ? 13 : 10;
    return {
      responsive: true,
      maintainAspectRatio: !isPresentation,
      plugins: {
        legend: { position: 'top', labels: { boxWidth: isPresentation?14:10, font: { size: fs+1 } } },
        tooltip: { callbacks: {
          label: (ctx) => {
            const v = ctx.parsed?.y ?? ctx.parsed;
            return ` ${ctx.dataset.label}: ${typeof v === 'number' && ctx.chart?.canvas?.id?.includes('col') ? 'AED ' + v.toLocaleString() : v}`;
          }
        }}
      },
      scales: {
        y: { beginAtZero: true, grid: { color: '#eef1f855' }, ticks: { font: { size: fs } } },
        x: { grid: { display: false }, ticks: { font: { size: fs } } }
      }
    };
  };

  // ── Draw charts ───────────────────────────────────────────────────────────
  if (window.Chart) {
    // Shared renewal tooltip + click opts
    const renTooltipPlugin = (opts) => ({
      ...opts,
      plugins: {
        ...opts.plugins,
        tooltip: { callbacks: {
          title: (items) => `${MONTH_ABBR[items[0].dataIndex]} ${yr}`,
          label: (item) => {
            const i = item.dataIndex;
            if (!renTrendData[i]) return 'No renewals received';
            return [`Units: ${renTrendData[i]}`, `Projects: ${renTrendCounts[i]}`, `AMC Value: AED ${renTrendValues[i].toLocaleString()}`];
          }
        }}
      },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const moClicked = elements[0].index + 1;
        if (!renTrendData[moClicked-1]) return;
        _showRenewalMonthDetail(yr, moClicked);
      }
    });

    // Store chart data/configs for presentation re-draw
    _mdashChartCfgs = {
      svc: {
        type: 'bar',
        data: {
          labels: msLabels,
          datasets: [
            { label: 'Scheduled', data: msScheduled, backgroundColor: '#2563ad44', borderColor: '#2563ad', borderWidth: 1.5 },
            { label: 'Completed', data: msCompleted, backgroundColor: '#1e844988', borderColor: '#1e8449', borderWidth: 1.5 },
            { label: 'Partial',   data: msPartial,   backgroundColor: '#d9770644', borderColor: '#d97706', borderWidth: 1.5 },
          ]
        },
      },
      col: {
        type: 'bar',
        data: {
          labels: mcLabels,
          datasets: [{ label: `Collected ${yr} (AED)`, data: mcValues, backgroundColor: mcColors, borderColor: mcBorders, borderWidth: 1.5 }]
        },
      },
      ren: {
        type: 'bar',
        data: {
          labels: MONTH_ABBR.slice(),
          datasets: [{
            label: `Renewed Units ${yr}`,
            data: renTrendData,
            backgroundColor: renTrendData.map(v => v > 0 ? '#1e844988' : '#e0e0e040'),
            borderColor: renTrendData.map(v => v > 0 ? '#1e8449' : '#ccc'),
            borderWidth: 1.5
          }]
        },
      },
    };

    const svcCtx = document.getElementById('mdash-svc-chart')?.getContext('2d');
    if (svcCtx && ms.length) {
      _mdashCharts.svc = new Chart(svcCtx, { type: 'bar', data: _mdashChartCfgs.svc.data, options: chartOpts() });
    }

    const renCtx = document.getElementById('mdash-ren-chart')?.getContext('2d');
    if (renCtx) {
      _mdashCharts.ren = new Chart(renCtx, { type: 'bar', data: _mdashChartCfgs.ren.data, options: renTooltipPlugin(chartOpts()) });
    }

    const colCtx = document.getElementById('mdash-col-chart')?.getContext('2d');
    if (colCtx) {
      const colOpts = chartOpts();
      colOpts.onClick = (evt, els) => { if (els && els.length) _showFinDrilldown('received_period', els[0].index + 1); };
      _mdashCharts.col = new Chart(colCtx, { type: 'bar', data: _mdashChartCfgs.col.data, options: colOpts });
    }
  }

  // ── Wire Presentation View buttons ────────────────────────────────────────
  const presTitles = {
    svc: svcChartTitle,
    col: `AMC Collections — ${yr}`,
    ren: `Renewal Performance — ${esc(periodLabel)}`,
  };
  body.querySelectorAll('.cmd-zoom-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.zoom;
      const title = presTitles[key] || key;
      _mdashOpenPresentation(title, (container) => {
        // For svc: show the stat bar above the chart
        if (key === 'svc') {
          const statDiv = document.createElement('div');
          statDiv.style.marginBottom = '12px';
          statDiv.innerHTML = svcStatRow;
          container.appendChild(statDiv);
        }
        // For ren: show KPI cards above chart
        if (key === 'ren') {
          const infoDiv = document.createElement('div');
          infoDiv.innerHTML = `<div style="font-size:11px;color:#556;margin-bottom:8px">
            Period: <strong>${esc(periodLabel)}</strong> &nbsp;·&nbsp; Portfolio: ${ren.total_portfolio||0} total / ${ren.approved_portfolio||0} approved / ${ren.approved_units||0} active units
          </div>
          <div class="cmd-kpi-row" style="margin-bottom:16px">
            ${cmdCard(ren.approved_projects_period ?? ren.approved, 'Renewal Projects',    C.blue,  'completed in period')}
            ${cmdCard(ren.approved_units_period, 'Renewed Units',       C.green, 'in period')}
            ${cmdCard(ren.pending,               'Pending',             C.amber)}
            ${cmdCard(ren.cancelled,             'Cancelled / Rejected',C.red)}
          </div>
          <div style="font-size:11px;color:#667;margin-bottom:6px">AMC Renewed Units by Initial Payment Month — ${yr}
            <span style="color:#aaa;font-weight:400"> (click bar to view details)</span></div>`;
          container.appendChild(infoDiv);
        }
        // For col: add note
        if (key === 'col') {
          const noteDiv = document.createElement('div');
          noteDiv.style.cssText = 'font-size:12px;color:#667;margin-bottom:10px';
          noteDiv.innerHTML = colNote;
          container.appendChild(noteDiv);
        }

        // Canvas — fills remaining flex space
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'flex:1;min-height:0;width:100%;';
        container.appendChild(canvas);

        // Re-draw chart at presentation dimensions after layout paint
        requestAnimationFrame(() => {
          const cfg = _mdashChartCfgs[key];
          if (!cfg || !window.Chart) return;
          const presOpts = chartOpts(true);
          if (key === 'ren') {
            // Wire click handler for renewals in presentation mode
            presOpts.onClick = (evt, elements) => {
              if (!elements.length) return;
              const moClicked = elements[0].index + 1;
              if (!renTrendData[moClicked-1]) return;
              _showRenewalMonthDetail(yr, moClicked);
            };
            presOpts.plugins.tooltip = {
              callbacks: {
                title: (items) => `${MONTH_ABBR[items[0].dataIndex]} ${yr}`,
                label: (item) => {
                  const i = item.dataIndex;
                  if (!renTrendData[i]) return 'No renewals received';
                  return [`Units: ${renTrendData[i]}`, `Projects: ${renTrendCounts[i]}`, `AMC Value: AED ${renTrendValues[i].toLocaleString()}`];
                }
              }
            };
          }
          new Chart(canvas.getContext('2d'), { type: cfg.type, data: cfg.data, options: presOpts });
        });
      });
    });
  });
}


// ─── Monthly Calendar Tab ─────────────────────────────────────────────────────
const MAINT_CAL_STATUS_COLORS = {
  Completed:          { bg:'#1e844922', border:'#1e8449', text:'#1e8449' },
  'Partially Completed': { bg:'#f9e79f55', border:'#d4ac0d', text:'#9a7d0a' },
  Scheduled:          { bg:'#2980b922', border:'#2980b9', text:'#2980b9' },
  Pending:            { bg:'#55555522', border:'#555555', text:'#555' },
  Postponed:          { bg:'#f0a50022', border:'#f0a500', text:'#b7750b' },
  Hold:               { bg:'#e67e2222', border:'#e67e22', text:'#e67e22' },
  Missed:             { bg:'#c0392b22', border:'#c0392b', text:'#c0392b' },
  Cancelled:          { bg:'#95a5a622', border:'#95a5a6', text:'#95a5a6' },
};

function calEntryStatusStyle(status) {
  return MAINT_CAL_STATUS_COLORS[status] || { bg:'#55555522', border:'#555', text:'#555' };
}

async function renderMaintCalendarTab(root) {
  const curYear = new Date().getFullYear();
  const yearOpts = [];
  for (let y = curYear - 1; y <= curYear + 1; y++) yearOpts.push(y);
  const emirates = await API.get('/api/maintenance-contracts/meta/emirates').catch(()=>({ rows:[] }));
  const cf = MaintContractsState.calFilters || {};
  root.innerHTML = `
    <div class="toolbar" style="flex-wrap:wrap;gap:6px;margin-bottom:8px">
      <label>Year:</label>
      <select id="mcal-year">${yearOpts.map(y=>`<option ${y===MaintContractsState.calYear?'selected':''}>${y}</option>`).join('')}</select>
      <label style="margin-left:8px">Month:</label>
      <select id="mcal-month">${MONTH_NAMES.map((n,i)=>`<option value="${i+1}" ${(i+1)===MaintContractsState.calMonth?'selected':''}>${n}</option>`).join('')}</select>
      <input type="text" id="mcal-ref"    placeholder="Contract Ref." style="width:120px" value="${esc(cf.contract_ref||'')}">
      <input type="text" id="mcal-client" placeholder="Client"        style="width:120px" value="${esc(cf.client||'')}">
      <select id="mcal-emirate"><option value="">All Emirates</option>${(emirates.rows||[]).map(e=>`<option ${cf.emirate===e?'selected':''}>${esc(e)}</option>`).join('')}</select>
      <select id="mcal-type"><option value="">All Types</option>${MAINT_TYPE_OPTS.map(t=>`<option ${cf.maintenance_type===t?'selected':''}>${esc(t)}</option>`).join('')}</select>
      <button class="btn btn-sm" id="mcal-apply">Apply</button>
      <button class="btn btn-sm btn-secondary" id="mcal-print" style="margin-left:auto">🖨 Print</button>
    </div>
    <div id="mcal-summary" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"></div>
    <div id="cal-grid" style="margin-bottom:12px"><div style="color:#99aabb;padding:20px;text-align:center">Loading calendar...</div></div>
    <div style="margin-bottom:12px;font-size:12px;color:#667">
      <strong>Legend: </strong>
      ${Object.entries(MAINT_CAL_STATUS_COLORS).map(([s,c])=>`<span style="display:inline-flex;align-items:center;margin-right:10px"><span style="width:10px;height:10px;border-radius:2px;background:${c.bg};border:1px solid ${c.border};display:inline-block;margin-right:4px"></span>${esc(s)}</span>`).join('')}
    </div>
    <div id="mcal-unscheduled"></div>
  `;
  document.getElementById('mcal-year').addEventListener('change', e => {
    MaintContractsState.calYear = Number(e.target.value);
    loadMaintCalendar();
  });
  document.getElementById('mcal-month').addEventListener('change', e => {
    MaintContractsState.calMonth = Number(e.target.value);
    loadMaintCalendar();
  });
  document.getElementById('mcal-apply').addEventListener('click', () => {
    MaintContractsState.calFilters = {
      contract_ref:     document.getElementById('mcal-ref').value.trim(),
      client:           document.getElementById('mcal-client').value.trim(),
      emirate:          document.getElementById('mcal-emirate').value,
      maintenance_type: document.getElementById('mcal-type').value,
    };
    loadMaintCalendar();
  });
  document.getElementById('mcal-print').addEventListener('click', () => {
    const year = MaintContractsState.calYear;
    const month = MaintContractsState.calMonth;
    const mName = MONTH_NAMES ? MONTH_NAMES[month - 1] : month;
    const cf = MaintContractsState.calFilters || {};
    // Capture both the summary cards and the calendar grid
    const summaryEl = document.getElementById('mcal-summary');
    const gridEl = document.getElementById('cal-grid');
    let contentHtml = '';
    if (summaryEl) contentHtml += summaryEl.outerHTML;
    if (gridEl) contentHtml += gridEl.outerHTML;
    shPrint({
      title: `Monthly Maintenance Calendar — ${mName} ${year}`,
      contentHtml,
      landscape: true,
      filters: {
        'Contract Ref.': cf.contract_ref || '',
        Client: cf.client || '',
        Emirate: cf.emirate || '',
        'Maintenance Type': cf.maintenance_type || '',
      },
    });
  });
  await loadMaintCalendar();
}

async function loadMaintCalendar() {
  const params = new URLSearchParams({ year: MaintContractsState.calYear, month: MaintContractsState.calMonth });
  Object.entries(MaintContractsState.calFilters || {}).forEach(([k,v]) => { if (v) params.set(k, v); });
  const data = await API.get('/api/maintenance-contracts/calendar?' + params.toString()).catch(e => ({ error: e.message }));
  if (data.error) {
    const g = document.getElementById('cal-grid');
    if (g) g.innerHTML = `<div style="color:#c0392b;padding:20px">Error loading calendar: ${esc(data.error)}</div>`;
    return;
  }
  MaintContractsState._calData = data;
  renderCalendarSummary(data);
  renderCalendarGrid(data);
  renderCalendarUnscheduled(data);
}

function renderCalendarSummary(data) {
  const el = document.getElementById('mcal-summary');
  if (!el) return;
  const s = data.summary || {};
  const year = data.year || MaintContractsState.calYear;
  const monthName = (MONTH_NAMES && data.month) ? MONTH_NAMES[(data.month||1)-1] : (data.month||'');
  const pct = s.completion_pct != null ? s.completion_pct.toFixed(1) + '%' : '0%';
  const totalAMC = s.total_amc_units != null ? s.total_amc_units : (s.total_scheduled_units || 0);
  // Card builder — onclick opens drill-down
  const card = (val, label, color, sub, onclick) => {
    const c = color || '#2563ad';
    const clickStyle = onclick ? 'cursor:pointer;' : '';
    const clickAttr  = onclick ? ` onclick="${onclick.replace(/"/g,'&quot;')}"` : '';
    return `<div class="kpi-card" style="flex:1;min-width:90px;padding:10px 14px;border-top:3px solid ${c};${clickStyle}"${clickAttr}>
      <div class="num" style="color:${c};font-size:22px">${val}</div>
      <div class="label" style="font-size:11px">${esc(label)}</div>
      ${sub ? `<div style="font-size:10px;color:#888;margin-top:2px">${esc(sub)}</div>` : ''}
    </div>`;
  };
  // New card order: Total AMC Units first, Partial Units removed
  el.innerHTML = [
    card(totalAMC,             `Total AMC Units — ${monthName} ${year}`, '#2563ad', (s.recovery_units ? `Due for Service This Month (incl. ${s.recovery_units} recovery)` : 'Due for Service This Month'), '_openAmcDrilldown()'),
    card(s.total_scheduled_units||0, 'Scheduled Units',  '#4a90d9', '', ''),
    card(s.completed_units||0,       'Completed Units',  '#1e8449', '', ''),
    card(s.postponed_units||0,       'Postponed Units',  '#f0a500', '', ''),
    card(s.hold_units||0,            'Hold Units',       '#e67e22', '', ''),
    card(s.missed_units||0,          'Unserviced/Missed','#c0392b', '', ''),
    card(pct,                        'Completion %',     '#2563ad', `of ${totalAMC} due units`, ''),
  ].join('');
}

function _openAmcDrilldown() {
  const data = MaintContractsState._calData;
  if (!data) return;
  const year = data.year || MaintContractsState.calYear;
  const monthName = (MONTH_NAMES && data.month) ? MONTH_NAMES[(data.month||1)-1] : (data.month||'');
  const all = data.allDueContracts || [];
  const total = (data.summary||{}).total_amc_units || all.reduce((s,c)=>s+(c.total_elevator_units||0),0);
  const statusBadge = st => {
    const colors = {
      Completed:'#1e8449', 'Partially Completed':'#9a7d0a', Pending:'#2563ad',
      Scheduled:'#2563ad', Postponed:'#f0a500', Hold:'#e67e22', Missed:'#c0392b', 'Not Logged':'#888'
    };
    const c = colors[st] || '#555';
    return `<span style="display:inline-block;padding:1px 7px;border-radius:10px;font-size:11px;background:${c}22;color:${c};border:1px solid ${c}88">${esc(st)}</span>`;
  };
  const rows = all.map(c => `<tr>
    <td>${esc(c.contract_ref||'-')}</td>
    <td>${esc(c.client_name||'-')}</td>
    <td>${esc(c.emirate||'-')}</td>
    <td>${esc(c.maintenance_type||'-')}</td>
    <td>${esc(c.maintenance_period||'-')}</td>
    <td style="text-align:center">${c.total_elevator_units||0}</td>
    <td style="text-align:center">${c.units_logged||0}</td>
    <td style="text-align:center">${statusBadge(c.visit_status||'Not Logged')}</td>
  </tr>`).join('');
  openModal(`
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <div>
        <h3 style="margin:0;font-size:15px">Total AMC Units — ${esc(monthName)} ${year}</h3>
        <div style="font-size:12px;color:#667;margin-top:2px">All elevator units due for service this month</div>
      </div>
      <div style="margin-left:auto;font-size:24px;font-weight:700;color:#2563ad">${total}</div>
    </div>
    <div class="table-wrap" style="max-height:60vh;overflow-y:auto">
      <table class="data-table" style="font-size:12px">
        <thead><tr>
          <th>Contract Ref.</th><th>Client</th><th>Emirate</th><th>Type</th>
          <th>Schedule</th><th style="text-align:center">Total Units</th>
          <th style="text-align:center">Logged</th><th>Visit Status</th>
        </tr></thead>
        <tbody>${rows||'<tr><td colspan="8" style="text-align:center;color:#888;padding:20px">No data</td></tr>'}</tbody>
      </table>
    </div>
    <div style="margin-top:12px;text-align:right">
      <button class="btn btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `);
}

function renderCalendarGrid(data) {
  const calEl = document.getElementById('cal-grid');
  if (!calEl) return;
  MaintContractsState._calEntries = [];
  const { year, month, days = {}, today } = data;
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  const monthLabel = (MONTH_NAMES[month - 1] || '') + ' ' + year;
  let html = `<h3 style="margin:0 0 8px;font-size:15px;color:#334">${esc(monthLabel)}</h3>`;
  html += `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:#dee2e6;border:1px solid #dee2e6;border-radius:6px;overflow:hidden">`;
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => {
    html += `<div style="background:#f5f7fa;text-align:center;font-weight:600;font-size:12px;padding:6px 2px;color:#445566">${d}</div>`;
  });
  for (let cell = 0; cell < totalCells; cell++) {
    const dayNum = cell - firstDay + 1;
    const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
    const dateStr = inMonth
      ? `${year}-${String(month).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`
      : '';
    const isToday = dateStr && dateStr === today;
    const dayData = days[dateStr];
    const hasEntries = dayData && dayData.entries && dayData.entries.length > 0;
    const bg = inMonth ? '#fff' : '#f8f9fa';
    const todayStyle = isToday ? 'outline:2px solid #2563ad;outline-offset:-2px;' : '';
    html += `<div class="${hasEntries ? 'cal-day-cell' : ''}" data-cal-date="${esc(dateStr)}" style="background:${bg};min-height:80px;padding:4px;position:relative;${todayStyle}${hasEntries ? 'cursor:pointer;' : ''}">`;
    if (inMonth) {
      html += `<div style="font-size:12px;font-weight:${isToday?700:400};color:${isToday?'#2563ad':'#334'};margin-bottom:2px">${dayNum}</div>`;
      if (dayData) {
        html += `<div style="font-size:10px;color:#aab;margin-bottom:3px">${dayData.comp_units}/${dayData.sched_units}u</div>`;
        for (const entry of dayData.entries) {
          const idx = MaintContractsState._calEntries.length;
          MaintContractsState._calEntries.push(entry);
          const chipSched = entry.units_scheduled || entry.total_elevator_units || 0;
          const chipServ  = entry.units_serviced || 0;
          const chipStyle = calEntryStatusStyle(entry.maintenance_status);
          const chipUnitTxt = chipSched > 0 ? ` ${chipServ}/${chipSched}u` : '';
          html += `<div class="cal-chip" data-cal-idx="${idx}" style="background:${chipStyle.bg};border:1px solid ${chipStyle.border};color:${chipStyle.text};border-radius:3px;padding:2px 4px;margin-bottom:2px;font-size:11px;cursor:pointer;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;line-height:1.4" title="${esc((entry.client_name||'')+' – '+(entry.maintenance_status||'')+' '+chipServ+'/'+chipSched+'u')}">${esc(entry.contract_ref||'')}${chipUnitTxt}</div>`;
        }
      }
    }
    html += `</div>`;
  }
  html += `</div>`;
  calEl.innerHTML = html;
  calEl.querySelectorAll('.cal-chip').forEach(chip => {
    chip.addEventListener('click', e => {
      e.stopPropagation();
      const entry = MaintContractsState._calEntries[+chip.dataset.calIdx];
      if (entry) openCalendarEntryModal(entry);
    });
  });
  calEl.querySelectorAll('.cal-day-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const dateStr = cell.dataset.calDate;
      if (!dateStr) return;
      const dayData = data.days[dateStr];
      if (!dayData || !dayData.entries.length) return;
      if (dayData.entries.length === 1) openCalendarEntryModal(dayData.entries[0]);
      else openDayModal(dateStr, dayData.entries, data);
    });
  });
}

function renderCalendarUnscheduled(data) {
  const el = document.getElementById('mcal-unscheduled');
  if (!el) return;
  const us = data.unscheduled || [];
  const s = data.summary || {};
  const unitCount = s.unscheduled_units != null ? s.unscheduled_units : us.reduce((t,c)=>t+(c.unscheduled_units||c.total_elevator_units||0),0);
  if (!us.length) { el.innerHTML = ''; return; }
  const monthName = (MONTH_NAMES && data.month) ? MONTH_NAMES[(data.month||1)-1] : '';
  const rows = us.map(c => `<tr>
    <td>${esc(c.contract_ref||'-')}</td>
    <td>${esc(c.maintenance_id||'-')}</td>
    <td>${esc(c.client_name||'-')}</td>
    <td>${esc(c.emirate||'-')}</td>
    <td style="text-align:center">${c.total_elevator_units||0}</td>
    <td style="text-align:center">${c.units_logged||0}</td>
    <td style="text-align:center;font-weight:600;color:#c0392b">${c.unscheduled_units!=null?c.unscheduled_units:(c.total_elevator_units||0)}</td>
    <td>${esc(c.maintenance_period||c.maintenance_type||'-')}</td>
  </tr>`).join('');
  el.innerHTML = `<div class="section-card" style="margin-top:4px">
    <h3 style="margin:0 0 8px;font-size:14px;color:#c0392b;cursor:pointer" onclick="_openUnscheduledDrilldown()">
      ⚠ Unscheduled Units (${unitCount}) — No visit logged for ${esc(monthName)} ${data.year||''}
      <span style="font-size:11px;font-weight:400;color:#c0392b88;margin-left:6px">Click to view ›</span>
    </h3>
    <div class="table-wrap"><table class="data-table" style="font-size:12px">
      <thead><tr>
        <th>Contract Ref.</th><th>Maint. ID</th><th>Client</th><th>Emirate</th>
        <th style="text-align:center">Total Units</th>
        <th style="text-align:center">Logged</th>
        <th style="text-align:center">Unscheduled</th>
        <th>Schedule</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

function _openUnscheduledDrilldown() {
  const data = MaintContractsState._calData;
  if (!data) return;
  const year = data.year || MaintContractsState.calYear;
  const monthName = (MONTH_NAMES && data.month) ? MONTH_NAMES[(data.month||1)-1] : (data.month||'');
  const us = data.unscheduled || [];
  const s = data.summary || {};
  const unitCount = s.unscheduled_units != null ? s.unscheduled_units : us.reduce((t,c)=>t+(c.unscheduled_units||c.total_elevator_units||0),0);
  const rows = us.map(c => `<tr>
    <td>${esc(c.contract_ref||'-')}</td>
    <td>${esc(c.client_name||'-')}</td>
    <td>${esc(c.emirate||'-')}</td>
    <td>${esc(c.maintenance_type||'-')}</td>
    <td>${esc(c.maintenance_period||'-')}</td>
    <td style="text-align:center">${c.total_elevator_units||0}</td>
    <td style="text-align:center">${c.units_logged||0}</td>
    <td style="text-align:center;font-weight:600;color:#c0392b">${c.unscheduled_units!=null?c.unscheduled_units:(c.total_elevator_units||0)}</td>
  </tr>`).join('');
  openModal(`
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <div>
        <h3 style="margin:0;font-size:15px;color:#c0392b">Unscheduled Units — ${esc(monthName)} ${year}</h3>
        <div style="font-size:12px;color:#667;margin-top:2px">Due for service but no visit record logged yet</div>
      </div>
      <div style="margin-left:auto;font-size:24px;font-weight:700;color:#c0392b">${unitCount}</div>
    </div>
    <div class="table-wrap" style="max-height:60vh;overflow-y:auto">
      <table class="data-table" style="font-size:12px">
        <thead><tr>
          <th>Contract Ref.</th><th>Client</th><th>Emirate</th><th>Type</th>
          <th>Schedule</th>
          <th style="text-align:center">Total Units</th>
          <th style="text-align:center">Logged</th>
          <th style="text-align:center">Unscheduled</th>
        </tr></thead>
        <tbody>${rows||'<tr><td colspan="8" style="text-align:center;color:#888;padding:20px">All units scheduled</td></tr>'}</tbody>
      </table>
    </div>
    <div style="margin-top:12px;text-align:right">
      <button class="btn btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `);
}

function openDayModal(dateStr, entries, calData) {
  const localFmt = d => d ? d.split('-').reverse().join('/') : '-';
  let rows = entries.map(entry => {
    const idx = MaintContractsState._calEntries.indexOf(entry);
    const s = calEntryStatusStyle(entry.maintenance_status);
    return `<tr class="clickable" data-day-idx="${idx}" style="cursor:pointer">
      <td>${esc(entry.contract_ref||'-')}</td>
      <td>${esc(entry.client_name||'-')}</td>
      <td><span class="badge" style="background:${s.bg};color:${s.text};border:1px solid ${s.border}">${esc(entry.maintenance_status||'-')}</span></td>
      <td>${entry.units_serviced||0}/${entry.units_scheduled||entry.total_elevator_units||0}u</td>
    </tr>`;
  }).join('');
  openModal(`
    <h3 style="margin:0 0 12px">Visits on ${esc(localFmt(dateStr))} <span class="badge">${entries.length}</span></h3>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Contract Ref.</th><th>Client</th><th>Status</th><th>Units</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div style="margin-top:12px;text-align:right">
      <button class="btn btn-secondary" id="day-modal-close">Close</button>
    </div>
  `);
  document.getElementById('day-modal-close').addEventListener('click', closeModal);
  document.querySelectorAll('[data-day-idx]').forEach(row => {
    row.addEventListener('click', () => {
      closeModal();
      const entry = MaintContractsState._calEntries[+row.dataset.dayIdx];
      if (entry) openCalendarEntryModal(entry);
    });
  });
}

function openCalendarEntryModal(entry) {
  const localFmt = d => d ? d.split('-').reverse().join('/') : '-';
  const canAct = !['Completed','Cancelled','Missed'].includes(entry.maintenance_status);
  const s = calEntryStatusStyle(entry.maintenance_status);
  openModal(`
    <h3 style="margin:0 0 10px;font-size:15px">${esc(entry.contract_ref||'')} — ${esc(entry.client_name||'')}</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px">
      <tr><td style="padding:3px 8px 3px 0;color:#667;width:140px">Status</td>
          <td><span class="badge" style="background:${s.bg};color:${s.text};border:1px solid ${s.border}">${esc(entry.maintenance_status||'-')}</span></td></tr>
      <tr><td style="padding:3px 8px 3px 0;color:#667">Emirate</td><td>${esc(entry.emirate||'-')}</td></tr>
      <tr><td style="padding:3px 8px 3px 0;color:#667">Type</td><td>${esc(entry.maintenance_type||'-')}</td></tr>
      <tr><td style="padding:3px 8px 3px 0;color:#667">Visit Type</td><td>${esc(entry.visit_type||'-')}</td></tr>
      <tr><td style="padding:3px 8px 3px 0;color:#667">Scheduled Date</td><td>${localFmt(entry.scheduled_date)}</td></tr>
      ${entry.completion_date?`<tr><td style="padding:3px 8px 3px 0;color:#667">Actual Completion Date</td><td style="font-weight:600;color:#1a5c30">${localFmt(entry.completion_date)}</td></tr>`:''}
      ${entry.postponed_date?`<tr><td style="padding:3px 8px 3px 0;color:#667">Postponed To</td><td>${localFmt(entry.postponed_date)}</td></tr>`:''}
      ${entry.hold_date?`<tr><td style="padding:3px 8px 3px 0;color:#667">Hold Date</td><td>${localFmt(entry.hold_date)}</td></tr>`:''}
      <tr><td style="padding:3px 8px 3px 0;color:#667">Units Scheduled</td><td>${entry.units_scheduled||entry.total_elevator_units||0}</td></tr>
      <tr><td style="padding:3px 8px 3px 0;color:#667">Units Serviced</td><td>${entry.units_serviced||0} / ${entry.units_scheduled||entry.total_elevator_units||0}</td></tr>
      ${entry.remarks?`<tr><td style="padding:3px 8px 3px 0;color:#667">Remarks</td><td>${esc(entry.remarks)}</td></tr>`:''}
    </table>
    <div id="cal-entry-action-area" style="margin-bottom:10px"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${canAct?`<button class="btn btn-sm" id="cal-complete-btn" style="background:#1e8449;color:#fff;border-color:#1e8449">✓ Mark Complete</button>
        <button class="btn btn-sm" id="cal-postpone-btn" style="background:#b7950b;color:#fff;border-color:#b7950b">⟲ Postpone</button>
        <button class="btn btn-sm" id="cal-hold-btn" style="background:#e67e22;color:#fff;border-color:#e67e22">⏸ Hold</button>`:''}
      <button class="btn btn-sm btn-secondary" id="cal-entry-close" style="margin-left:auto">Close</button>
    </div>
  `);
  document.getElementById('cal-entry-close').addEventListener('click', closeModal);
  if (canAct) {
    document.getElementById('cal-complete-btn').addEventListener('click', () => showCalCompleteForm(entry));
    document.getElementById('cal-postpone-btn').addEventListener('click', () => showCalPostponeForm(entry));
    document.getElementById('cal-hold-btn').addEventListener('click', () => showCalHoldForm(entry));
  }
}

function showCalCompleteForm(entry) {
  const area = document.getElementById('cal-entry-action-area');
  if (!area) return;
  area.innerHTML = `
    <div style="border:1px solid #1e844966;border-radius:6px;padding:12px;background:#1e844911">
      <h4 style="margin:0 0 8px;color:#1e8449;font-size:13px">Mark Visit Complete</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div><label style="font-size:12px;color:#667;display:block;margin-bottom:3px">Completion Date *</label>
          <input type="date" id="cal-comp-date" style="width:100%" value="${new Date().toISOString().slice(0,10)}"></div>
        <div><label style="font-size:12px;color:#667;display:block;margin-bottom:3px">Units Serviced</label>
          <input type="number" id="cal-comp-units" style="width:100%" min="0" value="${entry.units_serviced||entry.total_elevator_units||0}"></div>
      </div>
      <div style="margin-bottom:8px"><label style="font-size:12px;color:#667;display:block;margin-bottom:3px">Remarks</label>
        <input type="text" id="cal-comp-remarks" style="width:100%;box-sizing:border-box" placeholder="Optional notes" value="${esc(entry.remarks||'')}"></div>
      <button class="btn btn-sm" id="cal-comp-save" style="background:#1e8449;color:#fff;border-color:#1e8449">Save</button>
      <button class="btn btn-sm btn-secondary" id="cal-comp-cancel" style="margin-left:8px">Cancel</button>
    </div>`;
  area.querySelector('#cal-comp-cancel').addEventListener('click', () => { area.innerHTML = ''; });
  area.querySelector('#cal-comp-save').addEventListener('click', async () => {
    const compDate = area.querySelector('#cal-comp-date').value;
    const units = +area.querySelector('#cal-comp-units').value;
    const remarks = area.querySelector('#cal-comp-remarks').value.trim();
    if (!compDate) { toast('Completion date is required', 'warn'); return; }
    const btn = area.querySelector('#cal-comp-save');
    btn.disabled = true; btn.textContent = 'Saving...';
    const result = await API.patch(`/api/maintenance-contracts/${entry.contract_id}/visits/${entry.visit_id}`, {
      maintenance_status: 'Completed', completion_date: compDate,
      units_serviced: units, service_completed: 1,
      remarks: remarks || entry.remarks || '',
    }).catch(e => ({ error: e.message }));
    if (result && result.error) { toast('Error: ' + result.error, 'error'); btn.disabled=false; btn.textContent='Save'; return; }
    closeModal();
    await loadMaintCalendar();
  });
}

function showCalPostponeForm(entry) {
  const area = document.getElementById('cal-entry-action-area');
  if (!area) return;
  area.innerHTML = `
    <div style="border:1px solid #b7950b66;border-radius:6px;padding:12px;background:#b7950b11">
      <h4 style="margin:0 0 8px;color:#b7950b;font-size:13px">Postpone Visit</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div><label style="font-size:12px;color:#667;display:block;margin-bottom:3px">New Date *</label>
          <input type="date" id="cal-post-date" style="width:100%"></div>
        <div><label style="font-size:12px;color:#667;display:block;margin-bottom:3px">Reason</label>
          <input type="text" id="cal-post-reason" style="width:100%" placeholder="Postponement reason" value="${esc(entry.postponement_reason||'')}"></div>
      </div>
      <button class="btn btn-sm" id="cal-post-save" style="background:#b7950b;color:#fff;border-color:#b7950b">Save</button>
      <button class="btn btn-sm btn-secondary" id="cal-post-cancel" style="margin-left:8px">Cancel</button>
    </div>`;
  area.querySelector('#cal-post-cancel').addEventListener('click', () => { area.innerHTML = ''; });
  area.querySelector('#cal-post-save').addEventListener('click', async () => {
    const newDate = area.querySelector('#cal-post-date').value;
    const reason  = area.querySelector('#cal-post-reason').value.trim();
    if (!newDate) { toast('New date is required', 'warn'); return; }
    const btn = area.querySelector('#cal-post-save');
    btn.disabled = true; btn.textContent = 'Saving...';
    const result = await API.patch(`/api/maintenance-contracts/${entry.contract_id}/visits/${entry.visit_id}`, {
      maintenance_status: 'Postponed', postponed_date: newDate,
      postponement_reason: reason,
      original_scheduled_date: entry.original_scheduled_date || entry.scheduled_date,
    }).catch(e => ({ error: e.message }));
    if (result && result.error) { toast('Error: ' + result.error, 'error'); btn.disabled=false; btn.textContent='Save'; return; }
    closeModal();
    await loadMaintCalendar();
  });
}

function showCalHoldForm(entry) {
  const area = document.getElementById('cal-entry-action-area');
  if (!area) return;
  area.innerHTML = `
    <div style="border:1px solid #e67e2266;border-radius:6px;padding:12px;background:#e67e2211">
      <h4 style="margin:0 0 8px;color:#e67e22;font-size:13px">Put Visit On Hold</h4>
      <div style="margin-bottom:8px"><label style="font-size:12px;color:#667;display:block;margin-bottom:3px">Hold Reason *</label>
        <input type="text" id="cal-hold-reason" style="width:100%;box-sizing:border-box" placeholder="Reason for hold" value="${esc(entry.hold_reason||'')}"></div>
      <div style="margin-bottom:8px"><label style="font-size:12px;color:#667;display:block;margin-bottom:3px">Expected Release Date</label>
        <input type="date" id="cal-hold-release" style="width:100%" value="${entry.expected_release_date||''}"></div>
      <button class="btn btn-sm" id="cal-hold-save" style="background:#e67e22;color:#fff;border-color:#e67e22">Save</button>
      <button class="btn btn-sm btn-secondary" id="cal-hold-cancel" style="margin-left:8px">Cancel</button>
    </div>`;
  area.querySelector('#cal-hold-cancel').addEventListener('click', () => { area.innerHTML = ''; });
  area.querySelector('#cal-hold-save').addEventListener('click', async () => {
    const reason  = area.querySelector('#cal-hold-reason').value.trim();
    const release = area.querySelector('#cal-hold-release').value;
    if (!reason) { toast('Hold reason is required', 'warn'); return; }
    const btn = area.querySelector('#cal-hold-save');
    btn.disabled = true; btn.textContent = 'Saving...';
    const result = await API.patch(`/api/maintenance-contracts/${entry.contract_id}/visits/${entry.visit_id}`, {
      maintenance_status: 'Hold', hold_reason: reason,
      hold_date: new Date().toISOString().slice(0, 10),
      expected_release_date: release || null,
    }).catch(e => ({ error: e.message }));
    if (result && result.error) { toast('Error: ' + result.error, 'error'); btn.disabled=false; btn.textContent='Save'; return; }
    closeModal();
    await loadMaintCalendar();
  });
}

// ─── Records Tab ─────────────────────────────────────────────────────────────
function monthAbbrevList(months) {
  if (!months||!months.length) return '-';
  if (months.length===12) return 'Every Month';
  return months.map(m=>MONTH_ABBR[m-1]).join(', ');
}

// Operational renewal options — excludes Cancelled (those live in the Cancelled AMC tab)
const MAINT_RENEWAL_OPERATIONAL = MAINT_RENEWAL_OPTS.filter(s => s !== 'Cancelled');

async function renderMaintRecordsTab(root) {
  MaintContractsState.filters = {};
  MaintContractsState.page = 1;
  if (!MaintContractsState.sort || MaintContractsState.sort === 'end_date') MaintContractsState.sort = 'contract_ref';
  if (!MaintContractsState.dir  || MaintContractsState.dir  === 'desc')     MaintContractsState.dir  = 'asc';
  const emirates = await API.get('/api/maintenance-contracts/meta/emirates').catch(()=>({ rows:[] }));
  const s = MaintContractsState;
  root.innerHTML = `
    <div class="toolbar">
      <input type="text" id="mf-search" placeholder="Search Contract Ref., Client/Company...">
      <select id="mf-emirate"><option value="">All Emirates</option>${emirates.rows.map(e=>`<option>${esc(e)}</option>`).join('')}</select>
      <select id="mf-renewal">
        <option value="">All Active Operational</option>
        ${MAINT_RENEWAL_OPERATIONAL.map(s=>`<option>${esc(s)}</option>`).join('')}
      </select>
      <select id="mf-currentstatus"><option value="">All Current Status</option>${MAINT_CURRENT_STATUS_OPTS.map(st=>`<option>${esc(st)}</option>`).join('')}</select>
      <select id="mf-month"><option value="">All Months</option>${MONTH_NAMES.map((n,i)=>`<option value="${i+1}">${n}</option>`).join('')}</select>
      <select id="mf-sort" title="Sort By">
        <option value="contract_ref"       ${s.sort==='contract_ref'?'selected':''}>Sort: Contract Ref.</option>
        <option value="client_name"        ${s.sort==='client_name'?'selected':''}>Sort: Client Name</option>
        <option value="emirate"            ${s.sort==='emirate'?'selected':''}>Sort: Emirate</option>
        <option value="maintenance_type"   ${s.sort==='maintenance_type'?'selected':''}>Sort: Type</option>
        <option value="start_date"         ${s.sort==='start_date'?'selected':''}>Sort: Start Date</option>
        <option value="end_date"           ${s.sort==='end_date'?'selected':''}>Sort: End Date</option>
        <option value="last_service_date"   ${s.sort==='last_service_date'?'selected':''}>Sort: Last Service</option>
        <option value="total_elevator_units" ${s.sort==='total_elevator_units'?'selected':''}>Sort: Elevator Units</option>
        <option value="renewal_status"     ${s.sort==='renewal_status'?'selected':''}>Sort: Renewal Status</option>
        <option value="current_status"     ${s.sort==='current_status'?'selected':''}>Sort: Current Status</option>
        <option value="last_updated"       ${s.sort==='last_updated'?'selected':''}>Sort: Last Updated</option>
      </select>
      <select id="mf-dir" title="Order">
        <option value="asc"  ${s.dir==='asc'?'selected':''}>Asc</option>
        <option value="desc" ${s.dir==='desc'?'selected':''}>Desc</option>
      </select>
      <div class="spacer"></div>
      <button class="btn secondary" id="mf-print">&#128438; Print</button>
      <button class="btn" id="mf-add">+ New Maintenance Record</button>
    </div>
    <div class="table-wrap"><table class="data-table maint-records-table">
      <thead><tr>
        <th class="mcol-ref">Contract Ref.</th><th class="mcol-client">Client/Company</th><th class="mcol-emirate">Emirate</th><th class="mcol-type">Type</th>
        <th class="mcol-start">Start</th><th class="mcol-end">End</th><th class="mcol-last">Last Service</th><th class="mcol-sched">Schedule</th>
        <th class="mcol-units">Units</th><th class="mcol-renewal">Renewal Status</th><th class="mcol-status">Current Status</th>
      </tr></thead>
      <tbody id="maint-tbody"><tr><td colspan="11">Loading...</td></tr></tbody>
    </table></div>
    <div class="pagination" id="maint-pagination"></div>
  `;
  document.getElementById('mf-search').addEventListener('input', debounce(()=>{ MaintContractsState.filters.search=document.getElementById('mf-search').value; MaintContractsState.page=1; loadMaintList(); },350));
  document.getElementById('mf-emirate').addEventListener('change', e=>{ MaintContractsState.filters.emirate=e.target.value; MaintContractsState.page=1; loadMaintList(); });
  document.getElementById('mf-renewal').addEventListener('change', e=>{ MaintContractsState.filters.renewal_status=e.target.value; MaintContractsState.page=1; loadMaintList(); });
  document.getElementById('mf-currentstatus').addEventListener('change', e=>{ MaintContractsState.filters.current_status=e.target.value; MaintContractsState.page=1; loadMaintList(); });
  document.getElementById('mf-month').addEventListener('change', e=>{ MaintContractsState.filters.month=e.target.value; MaintContractsState.page=1; loadMaintList(); });
  document.getElementById('mf-sort').addEventListener('change', e=>{ MaintContractsState.sort=e.target.value; MaintContractsState.page=1; loadMaintList(); });
  document.getElementById('mf-dir').addEventListener('change', e=>{ MaintContractsState.dir=e.target.value; MaintContractsState.page=1; loadMaintList(); });
  document.getElementById('mf-print').addEventListener('click', printMaintRecords);
  document.getElementById('mf-add').addEventListener('click', ()=>openMaintModal(null));
  await loadMaintList();
}

async function loadMaintList() {
  const params = new URLSearchParams({ page:MaintContractsState.page, pageSize:50, sort:MaintContractsState.sort||'contract_ref', dir:MaintContractsState.dir||'asc', mode:'operational' });
  Object.entries(MaintContractsState.filters).forEach(([k,v])=>{ if(v) params.set(k,v); });
  const data = await API.get('/api/maintenance-contracts/?'+params.toString());
  const tbody = document.getElementById('maint-tbody');
  if (!data.rows.length) { tbody.innerHTML='<tr><td colspan="11" class="empty-state">No maintenance records found</td></tr>'; }
  else {
    tbody.innerHTML = data.rows.map(m=>{
      const rowStyle = m.renewal_status==='Hold' ? ' style="background:#fff8f0;outline:2px solid #e67e22;outline-offset:-2px;" title="Hold — Service on Hold"' : '';
      const expiredBadge = _expiredPendingBadge(m.renewal_status, m.end_date);
      const clientTitle = m.client_name ? ` title="${esc(m.client_name)}"` : '';
      return `<tr${rowStyle}>
        <td class="clickable" data-id="${m.id}">${esc(m.contract_ref||'Pending')}</td>
        <td class="mcol-client"${clientTitle}>${esc(m.client_name||'-')}</td><td>${esc(m.emirate||'-')}</td>
        <td>${esc(m.maintenance_type||'-')}</td>
        <td>${fmtDate(m.start_date)}</td><td>${fmtDate(m.end_date)}</td>
        <td>${fmtDate(m.last_service_date)}</td>
        <td>${esc(monthAbbrevList(m.schedule_months))}</td>
        <td>${m.total_elevator_units||'-'}</td>
        <td>${badge(m.renewal_status)}${expiredBadge ? ' '+expiredBadge : ''}</td><td>${badge(m.current_status)}</td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('.clickable').forEach(el=>el.addEventListener('click',()=>openMaintModal(el.dataset.id)));
  }
  const totalPages = Math.max(1, Math.ceil(data.total/data.pageSize));
  const pag = document.getElementById('maint-pagination');
  pag.innerHTML = `
    <button class="btn small secondary" ${MaintContractsState.page<=1?'disabled':''} id="mpg-prev">Prev</button>
    <span>Page ${data.page} of ${totalPages} — ${data.total} total</span>
    <button class="btn small secondary" ${MaintContractsState.page>=totalPages?'disabled':''} id="mpg-next">Next</button>
  `;
  const prevBtn=document.getElementById('mpg-prev'),nextBtn=document.getElementById('mpg-next');
  if (prevBtn) prevBtn.addEventListener('click',()=>{ MaintContractsState.page--; loadMaintList(); });
  if (nextBtn) nextBtn.addEventListener('click',()=>{ MaintContractsState.page++; loadMaintList(); });
}

// ── Print report (Maintenance Projects Status Report) ─────────────────────────
async function printMaintRecords() {
  const btn = document.getElementById('mf-print');
  if (btn) { btn.textContent = 'Preparing…'; btn.disabled = true; }
  try {
    const params = new URLSearchParams({
      sort: MaintContractsState.sort || 'contract_ref',
      dir:  MaintContractsState.dir  || 'asc',
      mode: 'operational',
    });
    Object.entries(MaintContractsState.filters).forEach(([k, v]) => { if (v) params.set(k, v); });

    const data = await API.get('/api/maintenance-contracts/print?' + params.toString());
    if (!data || !data.rows) throw new Error('No data returned from server');
    const { rows, summary } = data;

    // ── Active filter labels for the report header ──
    const filterLabels = {};
    const f = MaintContractsState.filters;
    if (f.search)         filterLabels['Search']         = f.search;
    if (f.emirate)        filterLabels['Emirate']        = f.emirate;
    if (f.renewal_status) filterLabels['Renewal Status'] = f.renewal_status;
    if (f.current_status) filterLabels['Current Status'] = f.current_status;
    if (f.month)          filterLabels['Month']          = MONTH_NAMES[Number(f.month) - 1] || f.month;

    // ── Summary KPI cards ──
    const summaryHtml = `
      <div class="summary-row" style="margin-bottom:10px;flex-wrap:wrap;gap:6px;">
        <div class="kpi-card"><div class="num">${summary.totalContracts}</div><div class="label">Total Contracts</div></div>
        <div class="kpi-card"><div class="num">${summary.totalElevatorUnits}</div><div class="label">Elevator Units</div></div>
        <div class="kpi-card"><div class="num">${summary.activeAMC}</div><div class="label">Active AMC</div></div>
        <div class="kpi-card"><div class="num">${summary.holdAMC}</div><div class="label">Hold AMC</div></div>
        <div class="kpi-card"><div class="num">${summary.expiredAMC}</div><div class="label">Expired / Cancelled</div></div>
        <div class="kpi-card"><div class="num">${summary.renewalPending}</div><div class="label">Renewal Pending</div></div>
        <div class="kpi-card"><div class="num">${summary.paymentPending}</div><div class="label">Payment Pending</div></div>
        <div class="kpi-card"><div class="num">${summary.scheduledThisMonth}</div><div class="label">Scheduled (${summary.reportMonth})</div></div>
        <div class="kpi-card"><div class="num">${summary.completedThisMonth}</div><div class="label">Completed (${summary.reportMonth})</div></div>
        <div class="kpi-card"><div class="num">${summary.overdueThisMonth}</div><div class="label">Overdue (${summary.reportMonth})</div></div>
      </div>`;

    // ── Print-only table columns (Current Status, Technician, Remarks excluded) ──
    const headers = [
      'Contract Ref.','Client / Company','Emirate','Maintenance Type',
      'AMC Start','AMC End','Last Service','Frequency / Schedule',
      'Elev. Units','Renewal Status','Payment Status','Activation Status',
      'Latest Visit Date','Latest Visit Status',
    ];

    const tbodyHtml = rows.length ? rows.map(r => {
      const schedStr  = r.maintenance_period || '';
      const monthStr  = r.schedule_months && r.schedule_months.length
        ? '(' + r.schedule_months.map(m => MONTH_ABBR[m - 1] || m).join(', ') + ')'
        : '';
      const visitDate = r.latest_visit_completed || r.latest_visit_scheduled || '';
      return `<tr>
        <td>${esc(r.contract_ref || 'Pending')}</td>
        <td>${esc(r.client_name || '—')}</td>
        <td>${esc(r.emirate || '—')}</td>
        <td>${esc(r.maintenance_type || '—')}</td>
        <td>${fmtDate(r.start_date)}</td>
        <td>${fmtDate(r.end_date)}</td>
        <td>${fmtDate(r.last_service_date)}</td>
        <td>${esc(schedStr)}${monthStr ? ' ' + monthStr : ''}</td>
        <td style="text-align:center">${r.total_elevator_units != null ? r.total_elevator_units : '—'}</td>
        <td>${esc(r.renewal_status || '—')}</td>
        <td>${esc(r.amc_payment_status || '—')}</td>
        <td>${esc(r.amc_activation_status || '—')}</td>
        <td>${visitDate ? fmtDate(visitDate) : '—'}</td>
        <td>${esc(r.latest_visit_status || '—')}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="${headers.length}" style="text-align:center;padding:20px;color:#888">No maintenance records match the selected filters</td></tr>`;

    const tableHtml = `
      <table>
        <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${tbodyHtml}</tbody>
      </table>`;

    const contentHtml = summaryHtml + tableHtml;

    shPrint({
      title:       'Maintenance Projects Status Report',
      contentHtml,
      filters:     filterLabels,
      landscape:   true,
    });

  } catch (e) {
    console.error('[printMaintRecords]', e);
    alert('Unable to generate the Maintenance report. Please refresh and try again.');
  } finally {
    if (btn) { btn.textContent = 'Print'; btn.disabled = false; }
  }
}


// Renders the read-only generated schedule panel inside the edit modal.
// schedule = [{schedule_year, month, schedule_date}] from backend, sorted.
function renderSchedulePanel(schedule, period) {
  if (!schedule || !schedule.length) {
    if (period && period !== 'Custom') {
      return `<div class="meta" style="padding:10px;background:#fff8e1;border:1px solid #ffe082;border-radius:6px;">
        No schedule generated yet. Click <strong>Auto-Generate Schedule</strong> above to create it from the contract dates.
      </div>`;
    }
    return `<div class="meta" style="padding:10px;background:#f5f5f5;border-radius:6px;">
      No schedule configured.${period === 'Custom' ? ' Custom periods require manual schedule setup.' : ''}
    </div>`;
  }
  const byYear = {};
  for (const s of schedule) {
    if (!byYear[s.schedule_year]) byYear[s.schedule_year] = [];
    byYear[s.schedule_year].push(s);
  }
  const yearBlocks = Object.keys(byYear).sort().map(yr => {
    const slots = byYear[yr];
    const chips = slots.map(s => {
      const mName = MONTH_ABBR[s.month-1] || `M${s.month}`;
      const dateHint = s.schedule_date ? ` <span style="font-size:10px;color:#888">${s.schedule_date.slice(5)}</span>` : '';
      const isManual = s.schedule_source === 'manual';
      const bg = isManual ? '#fff3e0' : '#e8f4fd';
      const col = isManual ? '#b35c00' : '#1a6fa8';
      const manualBadge = isManual ? ` <span title="Manually added" style="font-size:9px;background:#f39c12;color:#fff;border-radius:3px;padding:0 3px;margin-left:2px;">M</span>` : '';
      return `<span style="display:inline-flex;align-items:center;gap:2px;padding:3px 8px;margin:2px;background:${bg};border-radius:12px;font-size:12px;font-weight:500;color:${col};">${mName}${dateHint}${manualBadge}</span>`;
    }).join('');
    return `<div style="margin-bottom:8px;"><span style="font-size:12px;font-weight:600;color:#555;margin-right:6px;">${yr}</span><span style="display:inline-flex;flex-wrap:wrap;">${chips}</span></div>`;
  });
  return `<div id="sched-panel-body" style="max-height:160px;overflow-y:auto;padding:8px;background:#f9fafb;border:1px solid #e0e0e0;border-radius:6px;">${yearBlocks.join('')}</div>`;
}

function renderContractLinkPanel(m) {
  const lc = m ? m.linked_contract : null;
  if (lc) {
    return `
      <div style="padding:16px;background:#f0faf0;border:1px solid #27ae60;border-radius:8px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <span style="font-size:20px">🟢</span>
          <strong style="font-size:14px">Linked Contract</strong>
        </div>
        <div class="form-grid">
          <div class="form-field"><label>Contract Ref.</label><div style="padding:8px;background:var(--bg);border-radius:4px;font-size:13px">${esc(lc.contract_ref||'-')}</div></div>
          <div class="form-field"><label>Client / Company</label><div style="padding:8px;background:var(--bg);border-radius:4px;font-size:13px">${esc(lc.client_name||'-')}</div></div>
          <div class="form-field"><label>Emirate</label><div style="padding:8px;background:var(--bg);border-radius:4px;font-size:13px">${esc(lc.emirate||'-')}</div></div>
          <div class="form-field"><label>Elevator Units</label><div style="padding:8px;background:var(--bg);border-radius:4px;font-size:13px">${lc.elevator_units||1}</div></div>
          <div class="form-field"><label>Delivery Status</label><div style="padding:8px;background:var(--bg);border-radius:4px;font-size:13px">${esc(lc.delivery_status||'-')}</div></div>
          <div class="form-field"><label>Approval Date</label><div style="padding:8px;background:var(--bg);border-radius:4px;font-size:13px">${fmtDate(lc.approval_date)}</div></div>
          <div class="form-field"><label>Linked By</label><div style="padding:8px;background:var(--bg);border-radius:4px;font-size:13px">${esc(lc.maintenance_linked_by||'-')}</div></div>
          <div class="form-field"><label>Linked On</label><div style="padding:8px;background:var(--bg);border-radius:4px;font-size:13px">${fmtDate(lc.maintenance_linked_at)}</div></div>
        </div>
        <div style="margin-top:12px">
          <button type="button" class="btn secondary" id="open-linked-contract-btn" data-contract-id="${lc.id}">Open Contract Record</button>
        </div>
      </div>`;
  } else {
    return `
      <div style="padding:16px;background:#fffdf0;border:1px solid #f39c12;border-radius:8px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:20px">🟡</span>
          <strong style="font-size:14px">No Contract Linked</strong>
        </div>
        <p style="font-size:13px;color:var(--text-mute);margin:0">
          This maintenance record has not been linked to a Contract. To link, open the contract record and use the Maintenance Link tab.
        </p>
      </div>`;
  }
}

async function openMaintModal(id) {
  if (!id) { renderMaintForm(null,[],[],[]); return; }
  const data = await API.get(`/api/maintenance-contracts/${id}`);
  // _schedule is included in the GET /:id response
  renderMaintForm(data.record, data.history, data.visitLog, data.visits||[], data.currentRenewal||null, data.paymentHistory||[], data.renewalHistory||[], data.voidedPayments||[], data.paymentPermissions||{});
}
// Global alias for cross-module navigation from Contracts module
window.openMaintenanceContractModal = openMaintModal;

// ══════════════════════════════════════════════════════════════════════════════
// AMC RENEWAL & PAYMENT DETAILS — manual payment ledger (2026-09-29)
// One Renewal Ref. = one ledger; every payment is a separate transaction.
// All figures come from the backend ledger service (db/amcPayments.js) — the same
// ledger Alerts → Renewal Status uses. The card re-renders in place after each save.
// ══════════════════════════════════════════════════════════════════════════════
const AmcFin = { mcId: null, record: null, currentId: null, viewId: null, perms: {}, ledger: null, renewalHistory: [], form: null, busy: false, reqId: null };
const _amcNewReqId = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `amc-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function renderAmcFinancialSection(currentRenewal, paymentHistory, renewalHistory, voided, perms, record) {
  AmcFin.mcId = record && record.id; AmcFin.record = record || {}; AmcFin.perms = perms || {};
  AmcFin.renewalHistory = renewalHistory || []; AmcFin.form = null; AmcFin.busy = false; AmcFin.reqId = _amcNewReqId();
  AmcFin.currentId = currentRenewal ? currentRenewal.id : null; AmcFin.viewId = AmcFin.currentId;
  AmcFin.ledger = currentRenewal ? {
    renewal: currentRenewal, transactions: paymentHistory || [], voided: voided || [],
    amc_value: parseFloat(currentRenewal.new_amc_value) || 0,
    total_received: parseFloat(currentRenewal.total_received) || 0,
    outstanding: Math.max(0, parseFloat(currentRenewal.balance) || 0),
    payment_status: currentRenewal.effective_payment_status || currentRenewal.payment_status || 'Unpaid',
    latest_payment_date: currentRenewal.latest_payment_date || null,
    operational_status: currentRenewal.operational_status || null,
  } : null;
  return `<div id="amc-fin-block" class="section-block" style="margin-top:20px;padding:14px 16px;background:#f0f7ff;border-radius:6px;border:1px solid #c2d8f5">${_amcFinInner()}</div>`;
}

function _amcFinRerender() { const el = document.getElementById('amc-fin-block'); if (el) { el.innerHTML = _amcFinInner(); } }
const _amcCur = r => (r && r.currency_code) || 'AED';
const _amcStatusChip = ps => {
  const c = ps === 'Paid' ? ['#e8f6ee', '#1e7e45'] : ps === 'Partial' ? ['#fff4e0', '#b76a00'] : ['#fdecea', '#b03a2e'];
  return `<span style="display:inline-block;padding:1px 9px;border-radius:10px;font-size:12px;font-weight:700;background:${c[0]};color:${c[1]}">${esc(ps)}</span>`;
};

function _amcFinInner() {
  const L = AmcFin.ledger, p = AmcFin.perms, rec = AmcFin.record || {};
  const head = (btn) => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <h4 style="margin:0;color:#1a5fa8;font-size:13px;text-transform:uppercase;letter-spacing:.5px">AMC Renewal &amp; Payment Details</h4>
      <div style="margin-left:auto">${btn || ''}</div></div>`;
  // No renewal / payment record yet for this AMC
  if (!L) {
    const canSetup = p.can_add && rec.maintenance_type !== 'Free AMC' && rec.contract_ref && rec.start_date && rec.end_date;
    return head('')
      + `<div class="empty-state" style="padding:10px 0">No AMC renewal / payment record exists for this contract yet.${
          canSetup ? ` Record the first payment below — the payment record for the current AMC period (${fmtDate(rec.start_date)} – ${fmtDate(rec.end_date)}) is created with it.` : ''}</div>`
      + `<div id="amc-pay-form">${_amcFormHtml()}</div>`;
  }
  const r = L.renewal, cur = _amcCur(r);
  const viewingHistory = AmcFin.viewId && AmcFin.viewId !== AmcFin.currentId;
  const closed = ['Cancelled', 'Rejected'].includes(r.renewal_status);
  const addBtn = '';   // Add Payment is a permanent card below the summary (2026-09-29)
  const OPS = { 'Active': ['#e8f6ee','#1e7e45'], 'Hold': ['#ede9ff','#5b32c7'], 'Cancelled': ['#eef2f6','#66758a'] };
  const ops = L.operational_status || '—', opc = OPS[ops] || ['#fff4e0','#b76a00'];
  const opsChip = `<span title="Approved + Activation Active + any payment received = Active maintenance. Outstanding balance is tracked separately." style="display:inline-block;padding:1px 9px;border-radius:10px;font-size:12px;font-weight:700;background:${opc[0]};color:${opc[1]}">${esc(ops)}</span>`;
  const f = (label, val) => `<div><span style="color:#666;font-size:12px">${label}</span><br><b>${val}</b></div>`;
  const rows = (L.transactions || []).map(t => `<tr>
      <td style="white-space:nowrap">${t.payment_date ? fmtDate(t.payment_date) : '<span style="color:#e67e22">No date</span>'}</td>
      <td style="font-size:11px;color:#667">${esc(t.payment_ref || '—')}</td>
      <td style="text-align:right;white-space:nowrap">${fmtCurrency(parseFloat(t.amount) || 0, cur)}</td>
      <td>${esc(t.invoice_ref || '—')}</td>
      <td>${esc(t.entered_by || '—')}</td>
      <td>${esc(t.notes || '')}</td>
      ${p.can_edit ? `<td style="white-space:nowrap"><a href="#" onclick="event.preventDefault();_amcOpenForm('edit',${t.id})">Edit</a> · <a href="#" style="color:#b03a2e" onclick="event.preventDefault();_amcVoid(${t.id})">Void</a></td>` : ''}
    </tr>`).join('');
  const voided = (L.voided || []).map(v => `<tr style="color:#999;text-decoration:line-through">
      <td>${v.payment_date ? fmtDate(v.payment_date) : '—'}</td><td style="font-size:11px">${esc(v.payment_ref || '')}</td>
      <td style="text-align:right">${fmtCurrency(parseFloat(v.amount) || 0, cur)}</td>
      <td style="text-decoration:none">${esc(v.voided_by || '')} · ${fmtDate(v.voided_at)}</td><td style="text-decoration:none">${esc(v.void_reason || '')}</td>${p.can_edit ? '<td></td>' : ''}</tr>`).join('');
  const histRows = (AmcFin.renewalHistory || []).map(h => {
    const rps = h.effective_payment_status || h.payment_status || 'Unpaid';
    return `<tr${h.id === AmcFin.viewId ? ' style="background:#eef5ff"' : ''}>
      <td>${esc(h.renewal_ref || '—')}</td><td>${fmtDate(h.new_start_date)} – ${fmtDate(h.new_end_date)}</td>
      <td style="text-align:right">${fmtCurrency(parseFloat(h.new_amc_value) || 0, _amcCur(h))}</td>
      <td style="text-align:right">${fmtCurrency(parseFloat(h.total_received) || 0, _amcCur(h))}</td>
      <td>${_amcStatusChip(rps)}</td><td>${esc(h.renewal_status || '—')}</td>
      <td><a href="#" onclick="event.preventDefault();_amcView(${h.id})">View payments</a></td></tr>`;
  }).join('');

  return head(addBtn)
    + (viewingHistory ? `<div style="background:#fff8e1;border:1px solid #f0d58a;border-radius:6px;padding:6px 10px;font-size:12px;margin-bottom:10px">
         Viewing <b>historical</b> renewal ${esc(r.renewal_ref)} — its payments are kept separately from the current renewal.
         <a href="#" onclick="event.preventDefault();_amcView(${AmcFin.currentId})">Back to current renewal</a></div>` : '')
    + `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 20px;margin-bottom:12px">
      ${f('Renewal Ref.', esc(r.renewal_ref || '—'))}
      ${f('AMC Period', `${fmtDate(r.new_start_date) || '—'} – ${fmtDate(r.new_end_date) || '—'}`)}
      ${f('AMC Value', L.amc_value ? fmtCurrency(L.amc_value, cur) : '<span style="color:#e67e22">Not set</span>')}
      ${f('Payment Received', `<span style="color:#1e7e45">${fmtCurrency(L.total_received, cur)}</span>`)}
      ${f('Outstanding AMC Payment Due', `<span style="color:${L.outstanding > 0 ? '#b03a2e' : '#1e7e45'}">${fmtCurrency(L.outstanding, cur)}</span>`)}
      ${f('Latest Payment Date', L.latest_payment_date ? fmtDate(L.latest_payment_date) : '<span style="color:#888">No payment date</span>')}
      ${f('Payment Status', _amcStatusChip(L.payment_status))}
      ${f('Maintenance Operational Status', opsChip)}
      ${f('AMC Activation', esc(r.amc_activation_status || '—'))}
      ${f('Renewal Status', esc(r.renewal_status || '—'))}
      ${f('Invoice Ref.', esc(r.invoice_ref || '—'))}
    </div>
    <div id="amc-pay-form">${_amcFormHtml()}</div>
    <div style="margin-bottom:10px">
      <b style="font-size:13px">Payment History</b> <span style="font-size:11px;color:#778">(newest first · ${(L.transactions || []).length} transaction${(L.transactions || []).length === 1 ? '' : 's'})</span>
      <div class="table-wrap" style="margin-top:6px">
        <table class="data-table" style="font-size:13px">
          <thead><tr><th>Date</th><th>Payment Ref.</th><th style="text-align:right">Amount</th><th>Invoice Ref.</th><th>Entered By</th><th>Remarks</th>${p.can_edit ? '<th></th>' : ''}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${p.can_edit ? 7 : 6}" class="empty-state">No payment transactions recorded.</td></tr>`}</tbody>
          ${rows ? `<tfoot><tr style="font-weight:700;background:#f4f8fd"><td colspan="2">Total Received</td>
            <td style="text-align:right">${fmtCurrency(L.total_received, cur)}</td>
            <td colspan="${p.can_edit ? 4 : 3}">Outstanding AMC Payment Due: ${fmtCurrency(L.outstanding, cur)}</td></tr></tfoot>` : ''}
        </table>
      </div>
      ${voided ? `<details style="margin-top:6px"><summary style="cursor:pointer;font-size:12px;color:#777">Voided payments (${L.voided.length}) — excluded from totals, kept for audit</summary>
        <table class="data-table" style="font-size:12px;margin-top:4px"><thead><tr><th>Date</th><th>Payment Ref.</th><th>Amount</th><th>Voided</th><th>Reason</th>${p.can_edit ? '<th></th>' : ''}</tr></thead><tbody>${voided}</tbody></table></details>` : ''}
    </div>
    ${histRows ? `<details style="margin-top:10px"${viewingHistory ? ' open' : ''}><summary style="cursor:pointer;font-size:13px;font-weight:600;color:#555">Other Renewals (${AmcFin.renewalHistory.length}) — each with its own payment ledger</summary>
      <div class="table-wrap" style="margin-top:6px"><table class="data-table" style="font-size:13px">
        <thead><tr><th>Renewal Ref.</th><th>Period</th><th>AMC Value</th><th>Received</th><th>Payment</th><th>Status</th><th></th></tr></thead>
        <tbody>${histRows}</tbody></table></div></details>` : ''}`;
}

function _amcDefaultForm() {
  // Permanent Add Payment card: shown for every applicable maintenance project.
  const L = AmcFin.ledger, p = AmcFin.perms, rec = AmcFin.record || {};
  if (!p.can_add) return null;
  if (L) {
    if (['Cancelled', 'Rejected'].includes(L.renewal.renewal_status)) return null;
    if (AmcFin.viewId !== AmcFin.currentId) return null;   // never post to a historical year from here
    return { mode: 'add', permanent: true, requestId: AmcFin.reqId };
  }
  if (rec.maintenance_type !== 'Free AMC' && rec.contract_ref && rec.start_date && rec.end_date)
    return { mode: 'setup', permanent: true, requestId: AmcFin.reqId };
  return null;
}

function _amcFormHtml() {
  const F = AmcFin.form || _amcDefaultForm(); if (!F) return '';
  const L = AmcFin.ledger, rec = AmcFin.record || {};
  const r = L ? L.renewal : null, cur = _amcCur(r || rec);
  const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const t = F.mode === 'edit' ? (L.transactions || []).find(x => x.id === F.txnId) || {} : {};
  const inp = 'width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #c9d3e0;border-radius:4px;font-size:13px';
  const ctx = F.mode === 'setup'
    ? `<div style="font-size:12px;color:#445;margin-bottom:8px">Contract <b>${esc(rec.contract_ref || '')}</b> · AMC Period <b>${fmtDate(rec.start_date)} – ${fmtDate(rec.end_date)}</b><br>
         No payment record exists for this AMC period yet — enter the AMC value; the payment record is created together with this payment.</div>`
    : `<div style="font-size:12px;color:#445;margin-bottom:8px">Renewal <b>${esc(r.renewal_ref)}</b> · AMC Period <b>${fmtDate(r.new_start_date)} – ${fmtDate(r.new_end_date)}</b><br>
         AMC Value <b>${fmtCurrency(L.amc_value, cur)}</b> · Already Received <b>${fmtCurrency(L.total_received, cur)}</b> · Outstanding <b>${fmtCurrency(L.outstanding, cur)}</b></div>`;
  return `<div style="background:#fff;border:1px solid #c2d8f5;border-radius:6px;padding:12px;margin-bottom:12px">
    <div style="font-weight:700;font-size:12px;letter-spacing:.5px;text-transform:uppercase;color:#1a5fa8;margin-bottom:6px">${F.mode === 'edit' ? `Edit Payment ${esc(t.payment_ref || '')}` : 'Add Payment'}</div>
    ${ctx}
    <div style="display:grid;grid-template-columns:${F.mode === 'setup' ? 'repeat(3, 1fr)' : '1fr 1fr'};gap:10px;align-items:end">
      ${F.mode === 'setup' ? `<label style="font-size:12px;font-weight:600">AMC Value (${cur}) *<input id="amcf-value" type="number" min="0.01" step="0.01" placeholder="0.00" style="${inp}"></label>` : ''}
      <label style="font-size:12px;font-weight:600">Amount (${cur}) *
        <input id="amcf-amount" type="number" min="0.01" step="0.01" placeholder="0.00" value="${t.amount != null ? t.amount : ''}" style="${inp}"></label>
      <label style="font-size:12px;font-weight:600">Payment Date *
        <input id="amcf-date" type="date" max="${todayStr}" value="${esc(t.payment_date || todayStr)}" style="${inp}"></label>
      <label style="font-size:12px;font-weight:600">Invoice Ref.
        <input id="amcf-invoice" type="text" value="${esc(t.invoice_ref || '')}" placeholder="Invoice Ref." style="${inp}"></label>
      <label style="font-size:12px;font-weight:600;${F.mode === 'setup' ? 'grid-column:span 2' : ''}">Notes
        <input id="amcf-remarks" type="text" value="${esc(t.notes || '')}" placeholder="Notes / Remarks (optional)" style="${inp}"></label>
    </div>
    ${F.mode === 'edit' ? `<label style="display:block;font-size:12px;font-weight:600;margin-top:8px">Reason for change *
        <input id="amcf-reason" type="text" placeholder="Required for the audit trail" style="${inp}"></label>` : ''}
    <div id="amcf-err" style="color:#b03a2e;font-size:12px;margin-top:6px;min-height:14px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
      ${F.mode === 'add' && L && L.outstanding > 0 ? `<button type="button" class="btn small secondary" style="margin-right:auto" onclick="document.getElementById('amcf-amount').value='${L.outstanding.toFixed(2)}'">Pay Full Balance (${fmtCurrency(L.outstanding, cur)})</button>` : ''}
      ${F.mode === 'edit' ? `<button type="button" class="btn small secondary" onclick="_amcCloseForm()">Cancel</button>` : ''}
      <button type="button" class="btn small" id="amcf-save" onclick="_amcSave()">${F.mode === 'edit' ? 'Save Changes' : 'Add Payment'}</button>
    </div></div>`;
}

function _amcOpenForm(mode, txnId) {
  const rid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `amc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  AmcFin.form = { mode, txnId: txnId || null, requestId: rid };
  _amcFinRerender();
  const a = document.getElementById(mode === 'setup' ? 'amcf-value' : 'amcf-amount'); if (a) a.focus();
}
function _amcCloseForm() { AmcFin.form = null; _amcFinRerender(); }

function _amcApply(res) {
  // Backend returns the authoritative ledger for the renewal just changed.
  AmcFin.ledger = { renewal: res.renewal, transactions: res.transactions || [], voided: res.voided || [],
    amc_value: res.amc_value, total_received: res.total_received, outstanding: res.outstanding,
    payment_status: res.payment_status, latest_payment_date: res.latest_payment_date, operational_status: res.operational_status };
  if (!AmcFin.currentId) AmcFin.currentId = res.renewal.id;
  AmcFin.viewId = res.renewal.id;
  // keep the "Other Renewals" summary row in sync when viewing a historical renewal
  AmcFin.renewalHistory = (AmcFin.renewalHistory || []).map(h => h.id === res.renewal.id
    ? { ...h, total_received: res.total_received, effective_payment_status: res.payment_status } : h);
}

async function _amcSave() {
  if (AmcFin.busy) return;                       // double-click guard (server is also idempotent)
  const F = AmcFin.form || _amcDefaultForm(), err = document.getElementById('amcf-err'), btn = document.getElementById('amcf-save');
  if (!F) return;
  const invoice_ref = document.getElementById('amcf-invoice')?.value || '';
  const amount = document.getElementById('amcf-amount')?.value;
  const payment_date = document.getElementById('amcf-date')?.value;
  const remarks = document.getElementById('amcf-remarks')?.value || '';
  if (!(parseFloat(amount) > 0)) { err.textContent = 'Enter a payment amount greater than 0.'; return; }
  if (!payment_date) { err.textContent = 'Payment date is required.'; return; }
  AmcFin.busy = true; if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    let res;
    const base = `/api/maintenance-contracts/${AmcFin.mcId}/amc-payments`;
    if (F.mode === 'edit') {
      const reason = document.getElementById('amcf-reason')?.value || '';
      if (!reason.trim()) throw new Error('A reason for the change is required.');
      res = await API.patch(`${base}/${AmcFin.viewId}/${F.txnId}`, { amount, payment_date, remarks, invoice_ref, reason_for_change: reason });
    } else {
      const body = { amount, payment_date, remarks, invoice_ref, client_request_id: F.requestId };
      if (F.mode === 'setup') body.amc_value = document.getElementById('amcf-value')?.value;
      else body.renewal_id = AmcFin.viewId;
      res = await API.post(base, body);
    }
    _amcApply(res);
    AmcFin.form = null;
    AmcFin.reqId = _amcNewReqId();          // next payment gets a fresh idempotency key
    _amcFinRerender();
    toast(F.mode === 'edit' ? 'Payment updated' : `Payment recorded${res.payment_ref ? ' — ' + res.payment_ref : ''}`);
  } catch (e) {
    if (err) err.textContent = e.message || 'Unable to save payment';
    if (btn) { btn.disabled = false; btn.textContent = F.mode === 'edit' ? 'Save Changes' : 'Add Payment'; }
  } finally { AmcFin.busy = false; }
}

async function _amcVoid(txnId) {
  const t = (AmcFin.ledger.transactions || []).find(x => x.id === txnId) || {};
  const reason = prompt(`Void payment ${t.payment_ref || ''} of ${fmtCurrency(parseFloat(t.amount) || 0, _amcCur(AmcFin.ledger.renewal))} dated ${fmtDate(t.payment_date)}?\n\nThe entry is kept for audit but excluded from totals.\nEnter the reason:`);
  if (reason === null) return;
  if (!reason.trim()) { toast('A reason is required to void a payment', true); return; }
  try {
    const res = await API.post(`/api/maintenance-contracts/${AmcFin.mcId}/amc-payments/${AmcFin.viewId}/${txnId}/void`, { reason });
    _amcApply(res); _amcFinRerender(); toast('Payment voided');
  } catch (e) { toast(e.message || 'Unable to void payment', true); }
}

async function _amcView(renewalId) {
  try {
    const res = await API.get(`/api/maintenance-contracts/${AmcFin.mcId}/amc-payments/${renewalId}`);
    const cur = AmcFin.currentId;
    _amcApply(res); AmcFin.currentId = cur; AmcFin.form = null; _amcFinRerender();
  } catch (e) { toast(e.message || 'Unable to load renewal payments', true); }
}

function renderMaintForm(m, history, visitLog, visits, currentRenewal, paymentHistory, renewalHistory, voidedPayments, paymentPermissions) {
  m = m||{}; currentRenewal=currentRenewal||null; paymentHistory=paymentHistory||[]; renewalHistory=renewalHistory||[];
  const isNew=!m.id; const canDelete=APP.user.role==='admin';
  openModal(`
    <h2>${isNew?'New Maintenance Record':esc(m.contract_ref||m.client_name)}</h2>
    ${!isNew?`<div class="tabs">
      <div class="tab active" data-tab="details">Details</div>
      <div class="tab" data-tab="monthly">Monthly Visits</div>
      <div class="tab" data-tab="history">History (${history.length})</div>
      <div class="tab" data-tab="visits">Visit Log (${visitLog.length})</div>
      <div class="tab" data-tab="contract-link" title="Linked Contract">${m.linked_contract ? '🟢' : '🟡'} Contract</div>
    </div>`:''}
    <div id="tab-details">
      <form id="maint-form">
        <div class="form-grid">
          ${formField('Contract Ref.','contract_ref',m.contract_ref,{})}
          ${formField('Client/Company Name','client_name',m.client_name,{span2:true})}
          ${formField('Emirate','emirate',m.emirate,{})}
          ${formField('Maintenance Type','maintenance_type',m.maintenance_type,{select:MAINT_TYPE_OPTS})}
          <div class="form-field">
            <label>Maintenance Period</label>
            <select name="maintenance_period" id="maint-period-sel">
              <option value="">-- Select Period --</option>
              ${MAINT_PERIOD_OPTS.map(p=>`<option value="${esc(p)}" ${m.maintenance_period===p?'selected':''}>${esc(p)}</option>`).join('')}
            </select>
          </div>
          <div class="form-field" id="maint-period-custom" style="${m.maintenance_period==='Custom'?'':'display:none'}">
            <label>Custom Period (months)</label>
            <input type="number" name="maintenance_period_custom" min="1" max="24" value="${m.maintenance_period==='Custom'?(m.maintenance_period_custom||''):''}">
          </div>
          ${formField('Total Elevator Units','total_elevator_units',m.total_elevator_units,{type:'number'})}
          ${formField('Start Date','start_date',m.start_date?String(m.start_date).slice(0,10):'',{type:'date'})}
          ${formField('End Date','end_date',m.end_date?String(m.end_date).slice(0,10):'',{type:'date'})}
          ${formField('Renewal Status','renewal_status',m.renewal_status,{select:MAINT_RENEWAL_OPTS})}
          <div class="form-field">
            <label>Scheduling Method</label>
            <select name="scheduling_method">
              <option value="Automatic" ${m.scheduling_method!=='Manual'?'selected':''}>Automatic</option>
              <option value="Manual" ${m.scheduling_method==='Manual'?'selected':''}>Manual</option>
            </select>
          </div>
          <div class="form-field">
            <label>Calculate Next Service From</label>
            <select name="next_service_from">
              <option value="scheduled_date" ${m.next_service_from!=='completion_date'?'selected':''}>Scheduled Month</option>
              <option value="completion_date" ${m.next_service_from==='completion_date'?'selected':''}>Actual Completion Date</option>
            </select>
          </div>
          <div class="form-field">
            <label>Last Service <span style="font-size:11px;color:#888;font-weight:400">(auto-computed from visits)</span></label>
            <input type="text" value="${m.last_service_date ? fmtDate(m.last_service_date) : '—'}" readonly style="background:#f5f7fa;color:#555;cursor:not-allowed;border-color:#ddd">
          </div>
          ${formField('Remarks','remarks',m.remarks,{textarea:true,span2:true})}
          ${!isNew?formField('Note for this change (optional)','remarks_note','',{span2:true}):''}
        </div>
        <div class="form-field span2">
          <label>Monthly Schedule</label>
          <div style="padding:8px 12px;background:#f9fafb;border:1px solid #e0e4ea;border-radius:6px;font-size:13px;color:#555;display:flex;align-items:center;gap:10px">
            ${(()=>{
              const sched = m._schedule||[];
              const count = sched.length;
              const completed = sched.filter(s=>s.schedule_status==='Completed').length;
              return count
                ? `<span>${count} month(s) scheduled${completed?' · '+completed+' completed':''}</span>`
                : `<span style="color:#888">No months scheduled yet</span>`;
            })()}
            ${!isNew?`<button type="button" class="btn small secondary" id="go-to-monthly-tab" style="margin-left:auto;font-size:12px;padding:2px 10px">Manage Schedule →</button>`:''}
          </div>
        </div>
        ${!isNew?`<div class="meta">Current Status: ${badge(m.current_status)}</div>`:''}
        <div class="modal-actions">
          ${!isNew&&canDelete?`<button type="button" class="btn danger" id="delete-maint">Delete</button>`:''}
          <div class="spacer"></div>
          <button type="button" class="btn secondary" id="cancel-modal">Cancel</button>
          <button type="submit" class="btn">${isNew?'Create':'Save Changes'}</button>
        </div>
      </form>
    ${!isNew ? renderAmcFinancialSection(currentRenewal, paymentHistory, renewalHistory, voidedPayments, paymentPermissions, m) : ''}
    </div>
    ${!isNew?`
    <div id="tab-monthly" class="hidden">
      ${renderMonthlyVisitsTab({...m, _selectedYear: new Date().getFullYear()}, visits, (m._schedule||[]).filter(s=>s.schedule_year===new Date().getFullYear()))}
    </div>
    <div id="tab-history" class="hidden">
      <div class="history-list">
        ${history.length?history.map(h=>`
          <div class="history-item">
            <div><b>${esc(h.field_name)}</b>: ${esc(h.old_value??'-')} &rarr; ${esc(h.new_value??'-')}</div>
            <div class="meta">${fmtDate(h.changed_at)} by ${esc(h.changed_by)} ${h.remarks?'— '+esc(h.remarks):''}</div>
          </div>`).join(''):'<div class="empty-state">No history yet</div>'}
      </div>
    </div>
    <div id="tab-visits" class="hidden">
      <div class="history-list">
        ${visitLog.length?visitLog.map(v=>`
          <div class="history-item clickable" data-vlog="${v.id}">
            <b>${esc(v.month)}</b> ${badge(v.status)}
            <div class="meta">Visit: ${fmtDate(v.visit_date||v.scheduled_date)} ${v.remarks?'— '+esc(v.remarks):''}</div>
          </div>`).join(''):'<div class="empty-state">No visit log entries yet</div>'}
      </div>
    </div>
    <div id="tab-contract-link" class="hidden">
      ${renderContractLinkPanel(m)}
    </div>
    `:''}
  `);

  if (!isNew) {
    document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{
      document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      ['details','monthly','history','visits','contract-link'].forEach(name=>{
        const el=document.getElementById('tab-'+name);
        if(el) el.classList.toggle('hidden',name!==t.dataset.tab);
      });
    }));
    document.querySelectorAll('[data-vlog]').forEach(el=>el.addEventListener('click',()=>openVisitLogModal(visitLog.find(v=>String(v.id)===el.dataset.vlog),m)));
    // Wire up monthly schedule chip grid
    const _initYear = new Date().getFullYear();
    const _initSchedData = (m._schedule||[]).filter(s => s.schedule_year === _initYear);
    wireMonthlyVisitButtons({...m, _selectedYear: _initYear}, visits, _initSchedData);
    // Contract Link tab: wire "Open Contract" button
    const openContractBtn = document.getElementById('open-linked-contract-btn');
    if (openContractBtn) openContractBtn.addEventListener('click', () => {
      const cid = parseInt(openContractBtn.dataset.contractId);
      closeModal();
      const navEl = document.querySelector('[data-nav="contracts"]');
      if (navEl) navEl.click();
      if (cid) setTimeout(() => { if (window.openContractModal) openContractModal(cid); }, 350);
    });

    const delBtn=document.getElementById('delete-maint');
    if(delBtn) delBtn.addEventListener('click',async()=>{
      if(!await confirmDelete({title:'Delete Maintenance Record',message:'Delete this record?'})) return;
      await API.del(`/api/maintenance-contracts/${m.id}`);
      toast('Maintenance record deleted'); closeModal(); navigateTo('maintenance_contracts');
    });
  }

  // Period dropdown: show/hide custom field
  const periodSel = document.getElementById('maint-period-sel');
  const periodCustom = document.getElementById('maint-period-custom');
  if (periodSel) {
    periodSel.addEventListener('change', e => {
      if (periodCustom) periodCustom.style.display = e.target.value === 'Custom' ? '' : 'none';
    });
  }
  // "Manage Schedule →" button in Details tab: switch to Monthly Visits tab
  const goToMonthlyBtn = document.getElementById('go-to-monthly-tab');
  if (goToMonthlyBtn) {
    goToMonthlyBtn.addEventListener('click', () => {
      const monthlyTab = document.querySelector('.tab[data-tab="monthly"]');
      if (monthlyTab) monthlyTab.click();
    });
  }
  document.getElementById('cancel-modal').addEventListener('click',closeModal);
  document.getElementById('maint-form').addEventListener('submit',async(e)=>{
    e.preventDefault();
    const data=readForm(e.target);
    // schedule_months no longer sent from form — backend manages schedule via generateSchedule()
    delete data.schedule_months;

    // Handle Custom period: map numeric input into maintenance_period, then remove UI-only field
    if (data.maintenance_period === 'Custom' && data.maintenance_period_custom) {
      const cm = parseInt(data.maintenance_period_custom, 10);
      if (!isNaN(cm) && cm > 0) data.maintenance_period = String(cm);
    }
    delete data.maintenance_period_custom; // not a DB column — must strip before sending

    // Convert empty date strings to null so the backend receives NULL instead of ''
    ['start_date','end_date'].forEach(f => {
      if (data[f] === '' || data[f] === undefined) data[f] = null;
    });
    // last_service_date is auto-computed from visits — never send from form
    delete data.last_service_date;

    try {
      if(isNew){ await API.post('/api/maintenance-contracts',data); toast('Maintenance record created'); }
      else {
        const _r = await API.patch(`/api/maintenance-contracts/${m.id}`,data);
        const _sr = _r && _r.schedule_recalc;
        if (_sr && !_sr.skipped && (_sr.added.length || _sr.removed.length)) {
          const _f = l => l.map(x => `${MONTH_ABBR[x.month-1]} ${x.year}`).join(', ');
          toast(`Maintenance record updated — regular schedule realigned to the new period` +
            (_sr.added.length ? ` · added ${_f(_sr.added)}` : '') + (_sr.removed.length ? ` · removed ${_f(_sr.removed)}` : ''));
        } else toast('Maintenance record updated');
      }
      closeModal(); navigateTo('maintenance_contracts');
    } catch(err){ toast(err.message,true); }
  });
}

// ─── Monthly Visits Tab — chip-based manual schedule ──────────────────────────
// scheduleData = [{month, schedule_date, schedule_status, schedule_remarks}] for selYear
function renderMonthlyVisitsTab(mc, visits, scheduleData) {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const isContractHold = ['Hold','Cancelled','Renewed'].includes(mc.renewal_status);
  const selYear = mc._selectedYear || curYear;

  // visit map: month → visit (for selYear only)
  const visitMap = {};
  for (const v of visits) {
    if (Number(v.visit_year) === selYear) visitMap[Number(v.visit_month)] = v;
  }

  // schedule map: month → schedule row
  const schedMap = {};
  const src = scheduleData || (mc._schedule || []).filter(s => Number(s.schedule_year) === selYear);
  for (const s of src) schedMap[Number(s.month)] = s;

  const yearOpts = [];
  for (let y = curYear - 1; y <= curYear + 2; y++) yearOpts.push(y);

  // Status → chip colors
  const SC = {
    Completed:  { bg:'#d4edda', bd:'#28a745', tx:'#155724' },
    Scheduled:  { bg:'#cce5ff', bd:'#004085', tx:'#004085' },
    Missed:     { bg:'#f8d7da', bd:'#dc3545', tx:'#721c24' },
    Postponed:  { bg:'#fff3cd', bd:'#fd7e14', tx:'#856404' },
    Hold:       { bg:'#e2e3e5', bd:'#6c757d', tx:'#383d41' },
    Partial:    { bg:'#eef8f0', bd:'#28a745', tx:'#155724', dashed:true },
  };
  const DC = { bg:'#f8f9fa', bd:'#ced4da', tx:'#6c757d' };

  // Hold banner
  const holdBanner = isContractHold ? `
    <div style="background:#fff3cd;border:1px solid #e67e22;border-radius:6px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:10px">
      <span style="font-size:18px">⏸</span>
      <div>
        <strong style="color:#b45309">Maintenance Scheduling Suspended</strong>
        <span style="color:#7c5a17;font-size:12px;margin-left:8px">Contract is <b>${esc(mc.renewal_status)}</b> — no new visits will be scheduled until set back to Active Maintenance.</span>
      </div>
    </div>` : '';

  // Build one chip
  function makeChip(m) {
    const sched = schedMap[m];
    const visit = visitMap[m];
    const isScheduled = !!sched;

    let ds = null; // display status
    if (visit) {
      const vs = visit.maintenance_status;
      if (vs === 'Completed') ds = 'Completed';
      else if (vs === 'Partially Completed') ds = 'Partial';   // 2026-10-03: partial units ≠ Done
      else if (vs === 'Missed')    ds = 'Missed';
      else if (vs === 'Postponed') ds = 'Postponed';
      else if (vs === 'Hold')      ds = 'Hold';
      else ds = isScheduled ? (sched.schedule_status || 'Scheduled') : null;
    } else if (isScheduled) {
      ds = sched.schedule_status || 'Scheduled';
    }

    const c = ds ? (SC[ds] || DC) : DC;
    const isDue = selYear === curYear && m === curMonth;
    const pd = sched && sched.schedule_date ? `<div style="font-size:9px;margin-top:1px;opacity:.75">${sched.schedule_date.slice(5)}</div>` : '';
    const partTxt = ds === 'Partial' && visit ? `Partial ${Number(visit.units_serviced)||0}/${Number(visit.units_scheduled||visit.total_elevator_units)||'?'}` : ds;
    const sl = ds ? `<div style="font-size:9px;margin-top:1px;font-weight:400;opacity:.8">${ds === 'Completed' ? 'Done' : partTxt}</div>` : '';
    const dueShadow = isDue && !isScheduled ? 'box-shadow:0 0 0 2px #0d6efd;' : '';

    return `<div class="month-chip${isScheduled?' is-scheduled':''}" data-mc="${m}" data-yr="${selYear}"
      style="cursor:pointer;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;
             width:66px;height:54px;border-radius:8px;border:2px ${c.dashed ? 'dashed' : 'solid'} ${c.bd};
             background:${c.bg};color:${c.tx};font-size:13px;font-weight:600;
             margin:3px;user-select:none;${dueShadow}">
      <span>${MONTH_ABBR[m-1]}</span>${pd}${sl}
    </div>`;
  }

  const totalSched = Object.keys(schedMap).length;
  const completedCount = Object.values(visitMap).filter(v=>v.maintenance_status === 'Completed').length;
  const partialCount = Object.values(visitMap).filter(v=>v.maintenance_status === 'Partially Completed').length;

  return `${holdBanner}
    <div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <label style="font-weight:500;margin:0">Year:</label>
        <select id="mv-year">${yearOpts.map(y=>`<option ${y===selYear?'selected':''}>${y}</option>`).join('')}</select>
        <span style="font-size:12px;color:#888">${totalSched} scheduled${completedCount?' · '+completedCount+' completed':''}${partialCount?' · '+partialCount+' partial':''}</span>
        <div class="spacer"></div>
        ${!isContractHold?`<button type="button" class="btn small secondary" id="mv-apply-suggested" style="font-size:12px">Apply Suggested from Period</button>`:''}
      </div>
      <div style="margin-bottom:8px">
        <div style="display:flex;flex-wrap:wrap">${[1,2,3,4,5,6].map(makeChip).join('')}</div>
        <div style="display:flex;flex-wrap:wrap">${[7,8,9,10,11,12].map(makeChip).join('')}</div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;font-size:11px;color:#666;margin-bottom:10px">
        <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#28a745;margin-right:3px"></span>Completed</span>
        <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#eef8f0;border:1px dashed #28a745;margin-right:3px"></span>Partial (some units)</span>
        <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#cce5ff;border:1px solid #004085;margin-right:3px"></span>Scheduled</span>
        <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#f8d7da;border:1px solid #dc3545;margin-right:3px"></span>Missed</span>
        <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#fff3cd;border:1px solid #fd7e14;margin-right:3px"></span>Postponed</span>
        <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#f8f9fa;border:1px solid #ced4da;margin-right:3px"></span>Not Scheduled</span>
      </div>
      <div id="mv-chip-editor" style="display:none;margin-top:8px;padding:14px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:8px"></div>
    </div>`;
}

function calcAlertStatusFrontend(v) {
  if (!v) return '';
  if (['Completed','Partially Completed','Missed','Cancelled'].includes(v.maintenance_status)) return 'Closed';
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const vYear = v.visit_year;
  const vMonth = v.visit_month;
  if (!vYear || !vMonth) return 'Overdue';
  if (vYear < curYear || (vYear === curYear && vMonth < curMonth)) return 'Overdue';
  if (vYear === curYear && vMonth === curMonth) return 'Due This Month';
  return 'Scheduled';
}

// ── Refresh the Monthly tab for a given year ──────────────────────────────────
async function _refreshMonthlyTab(mc, year) {
  const data = await API.get(`/api/maintenance-contracts/${mc.id}/visits?year=${year}`);
  const tabEl = document.getElementById('tab-monthly');
  if (!tabEl) return;
  const schedData = data.schedule_month_data || [];
  const newMc = {...mc, _selectedYear: year};
  tabEl.innerHTML = renderMonthlyVisitsTab(newMc, data.visits || [], schedData);
  wireMonthlyVisitButtons(newMc, data.visits || [], schedData);
}

// ── Wire month chip grid + controls ───────────────────────────────────────────
function wireMonthlyVisitButtons(mc, visits, scheduleData) {
  const selYear = mc._selectedYear || new Date().getFullYear();

  // Build local maps for the chip editor
  const visitMap = {};
  for (const v of visits) if (Number(v.visit_year) === selYear) visitMap[Number(v.visit_month)] = v;
  const schedMap = {};
  for (const s of (scheduleData || [])) schedMap[Number(s.month)] = s;

  // Year selector
  const yrSel = document.getElementById('mv-year');
  if (yrSel) {
    yrSel.addEventListener('change', async e => {
      await _refreshMonthlyTab(mc, Number(e.target.value));
    });
  }

  // "Apply Suggested from Period" button
  const applySugBtn = document.getElementById('mv-apply-suggested');
  if (applySugBtn && mc.id) {
    applySugBtn.addEventListener('click', async () => {
      applySugBtn.disabled = true; applySugBtn.textContent = 'Checking…';
      try {
        // Preview first — the engine continues the ESTABLISHED cycle (anchored on the
        // latest completed regular month) and never touches manual / historical months.
        const pv = await API.post(`/api/maintenance-contracts/${mc.id}/auto-generate`, { preview: true });
        const f = l => l.map(x => `${MONTH_ABBR[x.month-1]} ${x.year}`).join(', ');
        if (!pv.added.length && !pv.removed.length) {
          toast(`Regular schedule is already correct (${mc.maintenance_period || 'period'}, cycle from ${pv.anchor && pv.anchor.label || '—'}).`);
          applySugBtn.disabled = false; applySugBtn.textContent = 'Apply Suggested from Period';
          return;
        }
        const msg = `Recalculate regular schedule — ${mc.maintenance_period}\n` +
          `Cycle anchored on ${pv.anchor && pv.anchor.label} (${pv.anchor && pv.anchor.source === 'completed_regular' ? 'latest completed regular service' : pv.anchor && pv.anchor.source})\n\n` +
          (pv.added.length ? `ADD regular months: ${f(pv.added)}\n` : '') +
          (pv.removed.length ? `REMOVE off-cycle auto months: ${f(pv.removed)}\n` : '') +
          (pv.review.length ? `Kept for review (have visit activity): ${f(pv.review)}\n` : '') +
          `\nManual, completed, missed, postponed and hold months are never changed. Continue?`;
        if (!window.confirm(msg)) { applySugBtn.disabled = false; applySugBtn.textContent = 'Apply Suggested from Period'; return; }
        applySugBtn.textContent = 'Applying…';
        const result = await API.post(`/api/maintenance-contracts/${mc.id}/auto-generate`, {});
        toast(`Regular schedule updated: ${result.added.length} added, ${result.removed.length} removed`);
        await _refreshMonthlyTab(mc, selYear);
      } catch(e) {
        if (e.data && e.data.hold) toast(e.message || 'Scheduling suspended.', 'warn');
        else toast(e.message || 'Failed to apply suggested schedule', true);
        applySugBtn.disabled = false; applySugBtn.textContent = 'Apply Suggested from Period';
      }
    });
  }

  // Month chip clicks
  document.querySelectorAll('.month-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const m = Number(chip.dataset.mc);
      const yr = Number(chip.dataset.yr);
      _openMonthChipEditor(mc, yr, m, schedMap[m] || null, visitMap[m] || null);
    });
  });
}

// ── Month chip editor panel ────────────────────────────────────────────────────
function _openMonthChipEditor(mc, year, month, sched, visit) {
  const editor = document.getElementById('mv-chip-editor');
  if (!editor) return;

  const isScheduled = !!sched;
  const isContractHold = ['Hold','Cancelled','Renewed'].includes(mc.renewal_status);
  // 2026-10-03: only a FULLY completed visit locks the month; Partial can be completed for the remaining units
  const isCompleted = (sched && sched.schedule_status === 'Completed') || (visit && visit.maintenance_status === 'Completed');
  const isPartial = !isCompleted && visit && visit.maintenance_status === 'Partially Completed';
  const currentStatus = sched ? (isPartial ? 'Completed' : (sched.schedule_status || 'Scheduled')) : null;
  const plannedDate = sched ? (sched.schedule_date || '') : '';
  const remarks = sched ? (sched.schedule_remarks || '') : '';
  const STATUSES = ['Scheduled','Completed','Missed','Postponed','Hold'];
  const uSched = Number((visit && (visit.units_scheduled || visit.total_elevator_units)) || mc.total_elevator_units) || 1;
  const uDone = Math.max(0, Number(visit && visit.units_serviced) || 0);
  const uLeft = Math.max(0, uSched - uDone);
  const now_ = new Date();
  const todayIso = `${now_.getFullYear()}-${String(now_.getMonth()+1).padStart(2,'0')}-${String(now_.getDate()).padStart(2,'0')}`;
  const priorActual = visit && visit.completion_date ? String(visit.completion_date).slice(0,10) : '';
  const completeReqId = 'mc-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);   // one id per editor → double-click safe

  // Highlight active chip
  document.querySelectorAll('.month-chip').forEach(c => c.style.outline = 'none');
  const activeChip = document.querySelector(`.month-chip[data-mc="${month}"]`);
  if (activeChip) activeChip.style.outline = '2px solid #0d6efd';

  const closeBtn = `<button type="button" id="mv-chip-close" style="background:none;border:none;cursor:pointer;font-size:18px;color:#999;line-height:1" title="Close">✕</button>`;
  const header = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><strong style="font-size:14px">${MONTH_NAMES[month-1]} ${year}</strong>${closeBtn}</div>`;

  if (!isScheduled) {
    editor.innerHTML = `${header}
      <p style="font-size:13px;color:#666;margin:0 0 10px">This month is not currently scheduled for maintenance.</p>
      ${!isContractHold ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <div><label style="font-size:11px;color:#888;display:block;margin-bottom:2px">Planned Date <span style="color:#bbb">(optional)</span></label>
          <input type="date" id="mv-chip-pd" style="padding:4px 8px;font-size:13px;border:1px solid #ced4da;border-radius:4px"></div>
        <div style="flex:1;min-width:140px"><label style="font-size:11px;color:#888;display:block;margin-bottom:2px">Remarks <span style="color:#bbb">(optional)</span></label>
          <input type="text" id="mv-chip-rem" placeholder="Notes…" style="padding:4px 8px;font-size:13px;border:1px solid #ced4da;border-radius:4px;width:100%"></div>
      </div>
      <button type="button" class="btn small" id="mv-add-month">+ Schedule This Month</button>
      ` : `<div style="color:#888;font-size:13px">Contract is ${mc.renewal_status} — scheduling suspended.</div>`}`;
  } else {
    editor.innerHTML = `${header}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <div><label style="font-size:11px;color:#888;display:block;margin-bottom:2px">Month Status</label>
          <select id="mv-chip-status" ${isCompleted?'disabled':''} style="padding:4px 8px;font-size:13px;border:1px solid #ced4da;border-radius:4px">
            ${isCompleted ? `<option value="Completed" selected>Completed</option>` :
              STATUSES.map(s=>`<option value="${s}"${currentStatus===s?' selected':''}>${s}</option>`).join('')}
          </select></div>
        <div><label style="font-size:11px;color:#888;display:block;margin-bottom:2px">Planned Date <span style="color:#bbb">(optional)</span></label>
          <input type="date" id="mv-chip-pd" value="${esc(plannedDate)}" ${isCompleted?'disabled':''} style="padding:4px 8px;font-size:13px;border:1px solid #ced4da;border-radius:4px"></div>
        <div style="flex:1;min-width:140px"><label style="font-size:11px;color:#888;display:block;margin-bottom:2px">Remarks</label>
          <input type="text" id="mv-chip-rem" value="${esc(remarks)}" placeholder="e.g. Client requested reschedule" style="padding:4px 8px;font-size:13px;border:1px solid #ced4da;border-radius:4px;width:100%"></div>
      </div>
      ${!isCompleted ? `<div id="mv-complete-fields" style="display:${currentStatus==='Completed'?'flex':'none'};gap:8px;flex-wrap:wrap;align-items:flex-end;margin:-2px 0 10px;padding:8px 10px;background:#eef8f0;border:1px solid #b7dfc2;border-radius:6px">
        <div><label style="font-size:11px;color:#155724;display:block;margin-bottom:2px">Actual Completion Date <span style="color:#c0392b">*</span></label>
          <input type="date" id="mv-chip-cd" value="${esc(isPartial ? '' : priorActual)}" max="${todayIso}" style="padding:4px 8px;font-size:13px;border:1px solid #ced4da;border-radius:4px"></div>
        ${uSched > 1 ? `<div><label style="font-size:11px;color:#155724;display:block;margin-bottom:2px">Units Serviced now <span style="color:#c0392b">*</span></label>
          <input type="number" id="mv-chip-units" min="1" max="${uLeft}" step="1" value="${uLeft === 1 ? 1 : ''}" style="padding:4px 8px;font-size:13px;border:1px solid #ced4da;border-radius:4px;width:80px">
          <span style="font-size:11px;color:#555;margin-left:4px">${uDone} of ${uSched} done · ${uLeft} remaining</span></div>` : ''}
        <div style="font-size:11px;color:#3d6b4a;flex-basis:100%">${uSched > 1
          ? 'Month becomes <b>Completed</b> only when all units are serviced; otherwise it is saved as <b>Partial</b>.'
          : 'Saves a completed service visit (Visit Log, History and Last Service update automatically).'} Remarks are stored with the service.</div>
      </div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn small secondary" id="mv-open-visit">Manage Visit</button>
        ${!isCompleted&&!isContractHold?`<button type="button" class="btn small" id="mv-save-chip">Save</button>`:''}
        ${!isCompleted && !isPartial?`<button type="button" class="btn small danger" id="mv-remove-month">Remove</button>`:''}
      </div>`;
  }

  editor.style.display = 'block';

  // Close
  document.getElementById('mv-chip-close').addEventListener('click', () => {
    editor.style.display = 'none';
    document.querySelectorAll('.month-chip').forEach(c => c.style.outline = 'none');
  });

  // Add month
  const addBtn = document.getElementById('mv-add-month');
  if (addBtn) addBtn.addEventListener('click', async () => {
    addBtn.disabled = true;
    try {
      const pd = document.getElementById('mv-chip-pd')?.value || null;
      const rem = document.getElementById('mv-chip-rem')?.value || null;
      await API.post(`/api/maintenance-contracts/${mc.id}/schedule-months`, { year, month, planned_date: pd||null, remarks: rem||null });
      toast(`${MONTH_NAMES[month-1]} ${year} scheduled`);
      await _refreshMonthlyTab(mc, year);
    } catch(e) { toast(e.message, true); addBtn.disabled = false; }
  });

  // Show/hide completion fields when the status changes
  const stSel = document.getElementById('mv-chip-status');
  const cf = document.getElementById('mv-complete-fields');
  if (stSel && cf) stSel.addEventListener('change', () => { cf.style.display = stSel.value === 'Completed' ? 'flex' : 'none'; });

  // Save
  const saveBtn = document.getElementById('mv-save-chip');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    if (saveBtn.disabled) return;
    const stNow = document.getElementById('mv-chip-status')?.value;
    if (stNow === 'Completed') {
      const cd = document.getElementById('mv-chip-cd')?.value || '';
      const unitsEl = document.getElementById('mv-chip-units');
      const rem = (document.getElementById('mv-chip-rem')?.value || '').trim();
      if (!cd) { toast('Enter the Actual Completion Date.', true); return; }
      if (cd > todayIso) { toast('Actual Completion Date cannot be in the future.', true); return; }
      if (unitsEl && !unitsEl.value) { toast(`Enter Units Serviced (${uLeft} remaining).`, true); return; }
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try {
        const r = await API.post(`/api/maintenance-contracts/${mc.id}/schedule-months/${year}/${month}/complete`, {
          completion_date: cd, units_serviced: unitsEl ? Number(unitsEl.value) : undefined, remarks: rem || null, client_request_id: completeReqId });
        toast(r.message || (r.already_completed ? `${MONTH_NAMES[month-1]} ${year} is already Completed.` : `${MONTH_NAMES[month-1]} ${year} maintenance marked as Completed.`));
        // Refresh the whole record (tiles, History, Visit Log, Last Service) from the database
        const data = await API.get(`/api/maintenance-contracts/${mc.id}`);
        renderMaintForm(data.record, data.history, data.visitLog, data.visits||[], data.currentRenewal||null, data.paymentHistory||[], data.renewalHistory||[], data.voidedPayments||[], data.paymentPermissions||{});
        const mt = document.querySelector('.tab[data-tab="monthly"]'); if (mt) mt.click();
        if (year !== new Date().getFullYear()) await _refreshMonthlyTab({ ...data.record }, year);
        try { if (typeof loadMaintList === 'function' && document.getElementById('maint-tbody')) loadMaintList().catch(() => {}); } catch(_) {}
      } catch(e) {
        // keep the previous authoritative state — the tile is not changed
        toast('Unable to save maintenance completion. ' + ((e.data && e.data.error) || e.message || ''), true);
        saveBtn.disabled = false; saveBtn.textContent = 'Save';
      }
      return;
    }
    saveBtn.disabled = true;
    try {
      const st = document.getElementById('mv-chip-status')?.value;
      const pd = document.getElementById('mv-chip-pd')?.value || null;
      const rem = document.getElementById('mv-chip-rem')?.value;
      await API.patch(`/api/maintenance-contracts/${mc.id}/schedule-months/${year}/${month}`, { schedule_status: st, planned_date: pd||null, remarks: rem||null });
      toast('Schedule updated');
      await _refreshMonthlyTab(mc, year);
    } catch(e) { toast(e.message, true); saveBtn.disabled = false; }
  });

  // Remove
  const removeBtn = document.getElementById('mv-remove-month');
  if (removeBtn) removeBtn.addEventListener('click', async () => {
    if (!confirm(`Remove ${MONTH_NAMES[month-1]} ${year} from the schedule?`)) return;
    removeBtn.disabled = true;
    try {
      await API.del(`/api/maintenance-contracts/${mc.id}/schedule-months/${year}/${month}`);
      toast(`${MONTH_NAMES[month-1]} ${year} removed from schedule`);
      await _refreshMonthlyTab(mc, year);
    } catch(e) { toast(e.message, true); removeBtn.disabled = false; }
  });

  // Manage Visit
  const visitBtn = document.getElementById('mv-open-visit');
  if (visitBtn) visitBtn.addEventListener('click', () => {
    openMonthlyVisitModal(mc, year, month, visit);
  });
}

async function openMonthlyVisitModal(mc, year, month, visit, _opts) {
  _opts = _opts || {};
  // Ensure visit row exists
  if (!visit) {
    const resp = await API.post(`/api/maintenance-contracts/${mc.id}/visits/ensure`, { year, month });
    visit = resp.visit;
  }

  // Fetch sub_visits for this visit
  let subVisits = [];
  try {
    const svResp = await API.get(`/api/maintenance-contracts/${mc.id}/visits/${visit.id}/sub-visits`);
    subVisits = svResp.sub_visits || [];
  } catch(_) {}

  const status = visit.maintenance_status || 'Pending';
  const unitsScheduledVal = visit.units_scheduled || visit.total_elevator_units || mc.total_elevator_units || '';
  const unitsServiced = visit.units_serviced || 0;
  const unitsScheduled = Number(unitsScheduledVal) || 0;
  const remainingUnits = Math.max(0, unitsScheduled - unitsServiced);
  const isPartiallyComplete = status === 'Partially Completed' && remainingUnits > 0;
  const currentUser = (window.APP && APP.user && (APP.user.username || APP.user.name)) || '';

  // Helper: is a section visible for the given status?
  const secVisible = (s, val) => s === val;

  // ── Build sub_visits history HTML ─────────────────────────────────────────
  const subVisitsHtml = subVisits.length ? `
    <div class="form-field span2" style="margin-top:4px">
      <label style="font-weight:600;color:#374151">📋 Service History (${subVisits.length} event${subVisits.length!==1?'s':''})</label>
      <div style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#f3f4f6">
            <th style="padding:6px 8px;text-align:left;font-weight:600;color:#374151">#</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;color:#374151">Date</th>
            <th style="padding:6px 8px;text-align:center;font-weight:600;color:#374151">Units</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;color:#374151">Work Performed</th>
            <th style="padding:6px 8px;text-align:left;font-weight:600;color:#374151">By</th>
          </tr></thead>
          <tbody>
            ${subVisits.map((sv,i) => `<tr style="${i%2===1?'background:#f9fafb':''}">
              <td style="padding:5px 8px;color:#6b7280">${sv.sub_visit_seq}</td>
              <td style="padding:5px 8px">${sv.actual_date||'—'}</td>
              <td style="padding:5px 8px;text-align:center;font-weight:600">${sv.units_serviced}</td>
              <td style="padding:5px 8px;color:#374151">${esc(sv.work_performed||'—')}</td>
              <td style="padding:5px 8px;color:#6b7280">${esc(sv.created_by||'—')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '';

  // ── Cumulative progress bar (for multi-unit visits) ───────────────────────
  const progressHtml = unitsScheduled > 1 ? (() => {
    const pct = unitsScheduled > 0 ? Math.min(100, Math.round(unitsServiced/unitsScheduled*100)) : 0;
    const barColor = unitsServiced >= unitsScheduled ? '#16a34a' : unitsServiced > 0 ? '#d97706' : '#9ca3af';
    return `<div style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;gap:14px">
      <div style="flex:1">
        <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:4px">Unit Progress: ${unitsServiced} of ${unitsScheduled} units serviced</div>
        <div style="height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${barColor};border-radius:4px;transition:width 0.3s"></div>
        </div>
      </div>
      <div style="font-size:18px;font-weight:700;color:${barColor}">${pct}%</div>
    </div>`;
  })() : '';

  // ── "Service Remaining Unit" section (for Partially Completed only) ───────
  const serviceRemainingHtml = isPartiallyComplete ? `
    <div class="form-field span2" id="mv-sec-remaining" style="margin-top:4px">
      <div style="border:2px solid #2563eb;border-radius:8px;padding:14px;background:#eff6ff">
        <div style="font-weight:700;color:#1d4ed8;margin-bottom:10px;font-size:13px">🔧 SERVICE REMAINING UNIT${remainingUnits>1?'S':''} (${remainingUnits} unit${remainingUnits!==1?'s':''} remaining)</div>
        <div class="form-grid" style="padding:0">
          <div class="form-field">
            <label>Service Date *</label>
            <input type="date" id="mv-remaining-date" value="${new Date().toISOString().slice(0,10)}">
          </div>
          <div class="form-field">
            <label>Units Being Serviced Now *</label>
            <input type="number" id="mv-remaining-units" min="1" max="${remainingUnits}" value="${remainingUnits}">
          </div>
          <div class="form-field span2">
            <label>Work Performed</label>
            <textarea id="mv-remaining-work" rows="2"></textarea>
          </div>
          <div class="form-field span2">
            <label>Findings / Remarks</label>
            <input type="text" id="mv-remaining-remarks">
          </div>
        </div>
        <div style="margin-top:12px">
          <button type="button" class="btn" id="mv-save-remaining" style="background:#1d4ed8">✅ Save Service Event</button>
          <span style="margin-left:10px;font-size:12px;color:#6b7280">This will add to the existing ${unitsServiced} units already serviced</span>
        </div>
      </div>
    </div>` : '';

  openModal(`
    <h2 style="margin-bottom:4px">${esc(mc.contract_ref||mc.client_name)} — ${MONTH_NAMES[month-1]} ${year}</h2>
    <div style="display:flex;gap:10px;margin-bottom:8px;align-items:center;flex-wrap:wrap">
      ${statusBadge(status)} ${alertBadge(visit.alert_status||'')}
    </div>
    ${progressHtml}
    <form id="mv-form" data-visit-id="${visit.id}" data-contract-id="${mc.id}">
      <div class="form-grid">

        <!-- Always-visible base fields -->
        <div class="form-field">
          <label>Visit Ref. (auto)</label>
          <input type="text" value="${esc(visit.visit_ref||'(assigned on save)')}" readonly style="background:#f5f5f5;color:#888">
        </div>
        <div class="form-field">
          <label>Lift / Elevator No.</label>
          <input type="text" name="lift_no" value="${esc(visit.lift_no||'')}">
        </div>
        <div class="form-field">
          <label>Visit Type</label>
          <select name="visit_type">
            <option value="">-- Select --</option>
            ${MAINT_VISIT_TYPE_OPTS.map(t=>`<option value="${esc(t)}" ${visit.visit_type===t?'selected':''}>${esc(t)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label>Scheduled Month</label>
          <input type="text" value="${MONTH_NAMES[month-1]} ${year}" readonly style="background:#f5f5f5;color:#555;font-weight:600">
        </div>
        <div class="form-field">
          <label>Maintenance Status *</label>
          <select name="maintenance_status" id="mv-status-sel">
            ${MAINT_VISIT_STATUS_OPTS.map(s=>`<option ${status===s?'selected':''}>${esc(s)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label>Scheduling Method</label>
          <select name="scheduling_method">
            <option value="Automatic" ${visit.scheduling_method!=='Manual'?'selected':''}>Automatic</option>
            <option value="Manual" ${visit.scheduling_method==='Manual'?'selected':''}>Manual</option>
          </select>
        </div>

        <!-- Unit fields (always visible) -->
        <div class="form-field">
          <label>Total Elevator Units</label>
          <input type="number" name="total_elevator_units" id="mv-total-units" min="0" value="${esc(visit.total_elevator_units||mc.total_elevator_units||'')}">
        </div>
        <div class="form-field">
          <label>Units Scheduled</label>
          <input type="number" name="units_scheduled" id="mv-units-scheduled" min="0" value="${esc(unitsScheduledVal)}">
        </div>

        <!-- ── SCHEDULED section (blue) ── -->
        <div class="form-field span2 mv-sec" id="mv-sec-scheduled" style="${status==='Scheduled'?'':'display:none'}">
          <div style="border:1px solid #93c5fd;border-radius:6px;padding:12px;background:#eff6ff">
            <div style="font-weight:600;color:#1d4ed8;margin-bottom:10px;font-size:13px">📅 SCHEDULED</div>
            <div class="form-grid" style="padding:0">
              <div class="form-field">
                <label>Scheduled Date * <small style="color:#888">(must be within ${MONTH_NAMES[month-1]} ${year})</small></label>
                <input type="date" name="scheduled_date" id="mv-scheduled-date" value="${visit.scheduled_date?String(visit.scheduled_date).slice(0,10):''}">
              </div>
            </div>
          </div>
        </div>

        <!-- ── COMPLETED section (green) ── -->
        <div class="form-field span2 mv-sec" id="mv-sec-completion" style="${status==='Completed'?'':'display:none'}">
          <div style="border:1px solid #6ee7b7;border-radius:6px;padding:12px;background:#f0fdf4">
            <div style="font-weight:600;color:#15803d;margin-bottom:10px;font-size:13px">✅ COMPLETED</div>
            <div class="form-grid" style="padding:0">
              <div class="form-field span2">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                  <input type="checkbox" id="mv-completed-cb" ${visit.service_completed?'checked':''} style="width:18px;height:18px">
                  <span style="font-weight:600">Service Completed</span>
                </label>
              </div>
              <div class="form-field">
                <label>Actual Completion Date *</label>
                <input type="date" name="completion_date" id="mv-completion-date" value="${visit.completion_date?String(visit.completion_date).slice(0,10):''}">
              </div>
              <div class="form-field">
                <label>Units Serviced (auto-fills from Units Scheduled)</label>
                <input type="number" name="units_serviced" id="mv-units-serviced" min="0" value="${visit.units_serviced!=null?esc(visit.units_serviced):''}">
              </div>
              <div class="form-field">
                <label>Units Not Serviced (auto)</label>
                <input type="number" id="mv-units-not-serviced" readonly value="${visit.units_not_serviced!=null?esc(visit.units_not_serviced):''}" style="background:#f5f5f5">
              </div>
              <div class="form-field">
                <label>Checklist Completed</label>
                <select name="checklist_completed">
                  <option value="0" ${!visit.checklist_completed?'selected':''}>No</option>
                  <option value="1" ${visit.checklist_completed?'selected':''}>Yes</option>
                </select>
              </div>
              <div class="form-field span2">
                <label>Work Performed</label>
                <textarea name="work_performed" rows="2">${esc(visit.work_performed||'')}</textarea>
              </div>
              <div class="form-field span2">
                <label>Spare Parts Used</label>
                <textarea name="spare_parts_used" rows="2">${esc(visit.spare_parts_used||'')}</textarea>
              </div>
            </div>
          </div>
        </div>

        <!-- ── PARTIALLY COMPLETED section (yellow) ── -->
        <div class="form-field span2 mv-sec" id="mv-sec-partial" style="${status==='Partially Completed'?'':'display:none'}">
          <div style="border:1px solid #fde68a;border-radius:6px;padding:12px;background:#fffbeb">
            <div style="font-weight:600;color:#b45309;margin-bottom:10px;font-size:13px">⚠️ PARTIALLY COMPLETED</div>
            <div class="form-grid" style="padding:0">
              <div class="form-field">
                <label>Actual Completion Date *</label>
                <input type="date" name="completion_date" id="mv-completion-date-partial" value="${visit.completion_date?String(visit.completion_date).slice(0,10):''}">
              </div>
              <div class="form-field">
                <label>Units Serviced *</label>
                <input type="number" name="units_serviced" id="mv-units-serviced-partial" min="0" value="${visit.units_serviced!=null?esc(visit.units_serviced):''}">
              </div>
              <div class="form-field">
                <label>Units Not Serviced (auto)</label>
                <input type="number" id="mv-units-not-serviced-partial" readonly value="${visit.units_not_serviced!=null?esc(visit.units_not_serviced):''}" style="background:#f5f5f5">
              </div>
              <div class="form-field span2">
                <label>Reason for Partial Completion *</label>
                <textarea name="_reason_partial" id="mv-reason-partial" rows="2">${esc(visit.status_reason||'')}</textarea>
              </div>
              <div class="form-field span2">
                <label>Reason for Unserviced Units</label>
                <input type="text" name="unserviced_reason" value="${esc(visit.unserviced_reason||'')}">
              </div>
            </div>
          </div>
        </div>

        <!-- ── HOLD section (purple/orange) ── -->
        <div class="form-field span2 mv-sec" id="mv-sec-hold" style="${status==='Hold'?'':'display:none'}">
          <div style="border:1px solid #e67e22;border-radius:6px;padding:12px;background:#fff8f0">
            <div style="font-weight:600;color:#c05600;margin-bottom:10px;font-size:13px">⏸ ON HOLD</div>
            <div class="form-grid" style="padding:0">
              <div class="form-field span2">
                <label>Reason for Hold *</label>
                <textarea name="_reason_hold" id="mv-reason-hold" rows="2">${esc(visit.hold_reason||visit.status_reason||'')}</textarea>
              </div>
              <div class="form-field">
                <label>Hold Date</label>
                <input type="date" name="hold_date" value="${visit.hold_date?String(visit.hold_date).slice(0,10):''}">
              </div>
              <div class="form-field">
                <label>Expected Release Date</label>
                <input type="date" name="expected_release_date" value="${visit.expected_release_date?String(visit.expected_release_date).slice(0,10):''}">
              </div>
            </div>
          </div>
        </div>

        <!-- ── POSTPONED section (amber) ── -->
        <div class="form-field span2 mv-sec" id="mv-sec-postponed" style="${status==='Postponed'?'':'display:none'}">
          <div style="border:1px dashed #f0a500;border-radius:6px;padding:12px;background:#fffcf0">
            <div style="font-weight:600;color:#b45309;margin-bottom:10px;font-size:13px">⏭ POSTPONED</div>
            <div class="form-grid" style="padding:0">
              <div class="form-field">
                <label>Original Scheduled Date (read-only)</label>
                <input type="date" name="original_scheduled_date" value="${visit.original_scheduled_date?String(visit.original_scheduled_date).slice(0,10):''}" readonly style="background:#f5f5f5">
              </div>
              <div class="form-field">
                <label>Revised Scheduled Date *</label>
                <input type="date" name="postponed_date" value="${visit.postponed_date?String(visit.postponed_date).slice(0,10):''}">
              </div>
              <div class="form-field span2">
                <label>Reason for Postponement *</label>
                <textarea name="_reason_postponed" id="mv-reason-postponed" rows="2">${esc(visit.postponement_reason||visit.status_reason||'')}</textarea>
              </div>
            </div>
          </div>
        </div>

        <!-- ── MISSED section (red) ── -->
        <div class="form-field span2 mv-sec" id="mv-sec-missed" style="${status==='Missed'?'':'display:none'}">
          <div style="border:1px solid #fca5a5;border-radius:6px;padding:12px;background:#fff5f5">
            <div style="font-weight:600;color:#b91c1c;margin-bottom:10px;font-size:13px">❌ MISSED</div>
            <div class="form-grid" style="padding:0">
              <div class="form-field span2">
                <label>Reason for Missed Visit *</label>
                <textarea name="_reason_missed" id="mv-reason-missed" rows="2">${esc(visit.status_reason||'')}</textarea>
              </div>
            </div>
          </div>
        </div>

        <!-- ── CANCELLED section (gray) ── -->
        <div class="form-field span2 mv-sec" id="mv-sec-cancelled" style="${status==='Cancelled'?'':'display:none'}">
          <div style="border:1px solid #d1d5db;border-radius:6px;padding:12px;background:#f9fafb">
            <div style="font-weight:600;color:#374151;margin-bottom:6px;font-size:13px">🚫 CANCELLED (Visit Only)</div>
            <p style="font-size:12px;color:#6b7280;margin:0 0 10px">This cancels this visit record only. The AMC contract remains active.</p>
            <div class="form-grid" style="padding:0">
              <div class="form-field span2">
                <label>Reason for Cancellation *</label>
                <textarea name="_reason_cancelled" id="mv-reason-cancelled" rows="2">${esc(visit.status_reason||'')}</textarea>
              </div>
              <div class="form-field">
                <label>Cancellation Date *</label>
                <input type="date" name="cancellation_date" value="${visit.cancellation_date?String(visit.cancellation_date).slice(0,10):new Date().toISOString().slice(0,10)}">
              </div>
              <div class="form-field">
                <label>Cancelled By (auto)</label>
                <input type="text" name="cancelled_by" value="${esc(visit.cancelled_by||currentUser)}" readonly style="background:#f5f5f5;color:#555">
              </div>
            </div>
          </div>
        </div>

        <!-- Audit reason (always visible) -->
        ${formField('Reason for Change (audit log)','reason','',{span2:true})}

        ${serviceRemainingHtml}
        ${subVisitsHtml}
      </div>
      <div class="modal-actions">
        <div class="spacer"></div>
        <button type="button" class="btn secondary" id="cancel-modal">Cancel</button>
        <button type="submit" class="btn">Save Visit</button>
      </div>
    </form>
  `);

  // ── Section toggling ─────────────────────────────────────────────────────
  const statusSel = document.getElementById('mv-status-sel');
  const mvSecIds = ['mv-sec-scheduled','mv-sec-completion','mv-sec-partial','mv-sec-hold','mv-sec-postponed','mv-sec-missed','mv-sec-cancelled'];
  const mvSecMap = {
    'Scheduled':           ['mv-sec-scheduled'],
    'Completed':           ['mv-sec-completion'],
    'Partially Completed': ['mv-sec-partial'],
    'Hold':                ['mv-sec-hold'],
    'Postponed':           ['mv-sec-postponed'],
    'Missed':              ['mv-sec-missed'],
    'Cancelled':           ['mv-sec-cancelled'],
    'Pending':             []
  };

  const toggleVisitSections = (val) => {
    const show = mvSecMap[val] || [];
    mvSecIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = show.includes(id) ? '' : 'none';
    });
    // Auto-fill Completed defaults
    if (val === 'Completed') {
      const cbEl = document.getElementById('mv-completed-cb');
      if (cbEl) cbEl.checked = true;
      const svcEl = document.getElementById('mv-units-serviced');
      const schedEl = document.getElementById('mv-units-scheduled');
      if (svcEl && schedEl && !svcEl.value && schedEl.value) svcEl.value = schedEl.value;
      recalcMvUnits();
    }
  };
  statusSel.addEventListener('change', e => toggleVisitSections(e.target.value));

  // ── Unit recalc (for Completed section) ─────────────────────────────────
  const mvTotalFld = document.getElementById('mv-total-units');
  const mvSchedFld = document.getElementById('mv-units-scheduled');
  const mvServicedFld = document.getElementById('mv-units-serviced');
  const mvNotServicedFld = document.getElementById('mv-units-not-serviced');
  const mvServicedPartialFld = document.getElementById('mv-units-serviced-partial');
  const mvNotServicedPartialFld = document.getElementById('mv-units-not-serviced-partial');

  const recalcMvUnits = () => {
    const sched = parseInt(mvSchedFld ? mvSchedFld.value : 0) || 0;
    // Completed
    if (mvServicedFld && mvNotServicedFld) {
      const s = parseInt(mvServicedFld.value) || 0;
      mvNotServicedFld.value = sched > 0 ? Math.max(0, sched - s) : '';
    }
    // Partial
    if (mvServicedPartialFld && mvNotServicedPartialFld) {
      const sp = parseInt(mvServicedPartialFld.value) || 0;
      mvNotServicedPartialFld.value = sched > 0 ? Math.max(0, sched - sp) : '';
    }
  };
  if (mvTotalFld) mvTotalFld.addEventListener('input', () => {
    if (mvSchedFld && !mvSchedFld.value) mvSchedFld.value = mvTotalFld.value;
    recalcMvUnits();
  });
  if (mvSchedFld) mvSchedFld.addEventListener('input', recalcMvUnits);
  if (mvServicedFld) mvServicedFld.addEventListener('input', recalcMvUnits);
  if (mvServicedPartialFld) mvServicedPartialFld.addEventListener('input', recalcMvUnits);

  // ── "Service Remaining Unit" save handler ─────────────────────────────────
  const saveRemainingBtn = document.getElementById('mv-save-remaining');
  if (saveRemainingBtn) {
    saveRemainingBtn.addEventListener('click', async () => {
      const dateEl  = document.getElementById('mv-remaining-date');
      const unitsEl = document.getElementById('mv-remaining-units');
      const workEl  = document.getElementById('mv-remaining-work');
      const remEl   = document.getElementById('mv-remaining-remarks');

      const addDate  = dateEl ? dateEl.value : '';
      const addUnits = unitsEl ? parseInt(unitsEl.value, 10) : 0;
      const addWork  = workEl ? workEl.value : '';
      const addRem   = remEl ? remEl.value : '';

      if (!addDate) { toast('Service Date is required', true); return; }
      if (!addUnits || addUnits < 1) { toast('Units being serviced must be at least 1', true); return; }

      saveRemainingBtn.disabled = true;
      saveRemainingBtn.textContent = 'Saving…';
      try {
        const resp = await API.patch(`/api/maintenance-contracts/${mc.id}/visits/${visit.id}`, {
          add_units_serviced: addUnits,
          completion_date: addDate,
          maintenance_status: 'Completed', // backend will auto-derive to Partial if needed
          work_performed: addWork || undefined,
          remarks: addRem || undefined
        });
        const updatedVisit = resp.visit;
        const newStatus = updatedVisit.maintenance_status;
        const adjNote = updatedVisit._status_adjusted ? ` (Status: ${updatedVisit.maintenance_status})` : '';
        toast(`Service event saved${adjNote}`);
        closeModal();
        // Refresh the parent view
        const data = await API.get(`/api/maintenance-contracts/${mc.id}`);
        renderMaintForm(data.record, data.history, data.visitLog, data.visits||[], data.currentRenewal||null, data.paymentHistory||[], data.renewalHistory||[], data.voidedPayments||[], data.paymentPermissions||{});
      } catch(err) {
        const msg = (err.data && err.data.error) ? err.data.error : err.message;
        toast(msg, true);
        saveRemainingBtn.disabled = false;
        saveRemainingBtn.textContent = '✅ Save Service Event';
      }
    });
  }

  document.getElementById('cancel-modal').addEventListener('click', closeModal);

  // ── Form submit ──────────────────────────────────────────────────────────
  document.getElementById('mv-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = readForm(e.target);
    const curStatus = fd.maintenance_status;

    // Consolidate section-specific reason fields into status_reason
    if (curStatus === 'Partially Completed') fd.status_reason = (document.getElementById('mv-reason-partial')||{}).value || null;
    else if (curStatus === 'Hold') {
      fd.status_reason = (document.getElementById('mv-reason-hold')||{}).value || null;
      fd.hold_reason   = fd.status_reason; // keep legacy field in sync
    }
    else if (curStatus === 'Postponed') {
      fd.status_reason = (document.getElementById('mv-reason-postponed')||{}).value || null;
      fd.postponement_reason = fd.status_reason;
    }
    else if (curStatus === 'Missed')     fd.status_reason = (document.getElementById('mv-reason-missed')||{}).value || null;
    else if (curStatus === 'Cancelled')  fd.status_reason = (document.getElementById('mv-reason-cancelled')||{}).value || null;
    // Clean up section-specific names so they're not sent to backend
    delete fd._reason_partial; delete fd._reason_hold; delete fd._reason_postponed;
    delete fd._reason_missed;  delete fd._reason_cancelled;

    // Completed checkbox (only inside Completed section; other statuses → 0)
    const cbEl = document.getElementById('mv-completed-cb');
    fd.service_completed = (curStatus === 'Completed' && cbEl && cbEl.checked) ? 1 : 0;

    // Pick correct completion_date and units_serviced based on visible section
    // For Completed: explicitly read by element ID to avoid FormData picking up the
    // duplicate name="completion_date" from the Partially Completed section
    if (curStatus === 'Completed') {
      const cd = document.getElementById('mv-completion-date');
      if (cd) fd.completion_date = cd.value || null;
    }
    if (curStatus === 'Partially Completed') {
      const cdp = document.getElementById('mv-completion-date-partial');
      if (cdp) fd.completion_date = cdp.value || null;
      const usp = document.getElementById('mv-units-serviced-partial');
      if (usp) fd.units_serviced = usp.value || null;
    }

    // ── Frontend validation matching backend switch ────────────────────────
    const validErrs = [];
    if (!curStatus) validErrs.push('Visit Status is required');
    switch (curStatus) {
      case 'Scheduled':
        if (!fd.scheduled_date) validErrs.push('Scheduled Date is required');
        break;
      case 'Completed':
        if (!fd.completion_date) validErrs.push('Actual Completion Date is required');
        break;
      case 'Partially Completed':
        if (!fd.completion_date) validErrs.push('Actual Completion Date is required');
        if (!fd.status_reason) validErrs.push('Reason is required for Partially Completed');
        break;
      case 'Hold':
        if (!fd.status_reason) validErrs.push('Reason is required for Hold');
        break;
      case 'Postponed':
        if (!fd.postponed_date) validErrs.push('Revised Scheduled Date is required');
        if (!fd.status_reason) validErrs.push('Reason is required for Postponed');
        break;
      case 'Missed':
        if (!fd.status_reason) validErrs.push('Reason is required for Missed');
        break;
      case 'Cancelled':
        if (!fd.status_reason) validErrs.push('Reason is required for Cancelled');
        if (!fd.cancellation_date) validErrs.push('Cancellation Date is required');
        break;
    }
    const svcSched = parseInt(fd.units_scheduled, 10);
    const svcSvcd  = parseInt(fd.units_serviced, 10);
    if (!isNaN(svcSched) && !isNaN(svcSvcd) && svcSvcd > svcSched) {
      validErrs.push(`Units Serviced (${svcSvcd}) cannot exceed Units Scheduled (${svcSched})`);
    }
    if (validErrs.length) { toast(validErrs[0], true); return; }

    try {
      const saveResp = await API.patch(`/api/maintenance-contracts/${mc.id}/visits/${visit.id}`, fd);
      // Notify if backend auto-adjusted status (e.g. Completed → Partially Completed due to units)
      const adjNote = (saveResp && saveResp.visit && saveResp.visit._status_adjusted)
        ? ` — Note: ${saveResp.visit._status_adjusted_reason}` : '';
      toast('Visit saved' + adjNote); closeModal();
      const data = await API.get(`/api/maintenance-contracts/${mc.id}`);
      renderMaintForm(data.record, data.history, data.visitLog, data.visits||[], data.currentRenewal||null, data.paymentHistory||[], data.renewalHistory||[], data.voidedPayments||[], data.paymentPermissions||{});
    } catch(err) {
      const msg = (err.data && err.data.error) ? err.data.error : err.message;
      toast(msg, true);
    }
  });
}

function openVisitLogModal(vlog, mc) {
  if (!vlog) return;
  openModal(`
    <h2>${esc(mc.contract_ref||mc.client_name)} — Visit Log ${esc(vlog.month)}</h2>
    <form id="vlog-form" data-id="${vlog.id}">
      <div class="form-grid">
        ${formField('Visit Date','visit_date',vlog.visit_date?String(vlog.visit_date).slice(0,10):'',{type:'date'})}
        ${formField('Completion Date','completion_date',vlog.completion_date?String(vlog.completion_date).slice(0,10):'',{type:'date'})}
        ${formField('Work Performed','work_performed',vlog.work_performed,{textarea:true,span2:true})}
        ${formField('Findings','findings',vlog.findings,{textarea:true,span2:true})}
        ${formField('Parts Replaced','parts_replaced',vlog.parts_replaced,{})}
        ${formField('Pending Issues','pending_issues',vlog.pending_issues,{})}
        ${formField('Remarks','remarks',vlog.remarks,{textarea:true,span2:true})}
      </div>
      <div class="modal-actions">
        <div class="spacer"></div>
        <button type="button" class="btn secondary" id="cancel-modal">Cancel</button>
        <button type="submit" class="btn">Save</button>
      </div>
    </form>
  `);
  document.getElementById('cancel-modal').addEventListener('click', closeModal);
  document.getElementById('vlog-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = readForm(e.target);
    try {
      await API.patch(`/api/maintenance-contracts/visit-log/${vlog.id}`, fd);
      toast('Visit log updated'); closeModal();
    } catch(err) { toast(err.message, true); }
  });
}

// ─── Period → month interval helper (frontend mirror of backend periodToMonths) ──
function autoGenerateMaintMonths(period, startDateStr) {
  const map = {
    'Every Month': 1, 'Every 2 Months': 2, 'Every 3 Months': 3,
    'Every 4 Months': 4, 'Every 6 Months': 6, 'Quarterly': 3,
    'Half Yearly': 6, 'Yearly': 12,
  };
  const interval = map[period];
  if (!interval) return null; // Custom or unknown — can't auto-generate
  let startMonth = 1;
  if (startDateStr) {
    const d = new Date(startDateStr);
    if (!isNaN(d.getTime())) startMonth = d.getMonth() + 1;
  }
  const months = [];
  for (let m = startMonth; m <= 12; m += interval) months.push(m);
  return months;
}

// ─── Monthly Schedule Tab ─────────────────────────────────────────────────────
function monthOptions(selected) {
  return MONTH_NAMES.map((n,i)=>`<option value="${i+1}" ${i+1===selected?'selected':''}>${n} Maintenance</option>`).join('');
}

async function renderMaintScheduleTab(root) {
  const s = MaintContractsState.schedule;
  const yearOpts = [];
  for (let y=new Date().getFullYear()-1; y<=new Date().getFullYear()+2; y++) yearOpts.push(y);

  root.innerHTML = `
    <div class="toolbar">
      <select id="msched-month">${monthOptions(s.month)}</select>
      <select id="msched-year">${yearOpts.map(y=>`<option ${y===s.year?'selected':''}>${y}</option>`).join('')}</select>
      <div class="spacer"></div>
      <a class="btn secondary" id="msched-xlsx" target="_blank">Export Excel</a>
      <a class="btn secondary" id="msched-pdf" target="_blank">Export PDF</a>
    </div>
    <div class="meta">Shows all clients assigned to this month. Visit status comes from the per-month visit records.</div>
    <div class="table-wrap"><table class="data-table maint-schedule-table">
      <thead><tr>
        <th class="scol-ref">Contract Ref.</th><th class="scol-client">Client/Company</th><th class="scol-emirate">Emirate</th>
        <th class="scol-mstart">Maint. Start</th><th class="scol-mend">Maint. End</th><th class="scol-month">Scheduled Month</th>
        <th class="scol-status">Status</th><th class="scol-alert">Alert</th><th class="scol-compdate">Completion Date</th><th class="scol-remarks">Remarks</th>
      </tr></thead>
      <tbody id="msched-tbody"><tr><td colspan="10">Loading...</td></tr></tbody>
    </table></div>
    <div class="meta" id="msched-total"></div>
  `;
  document.getElementById('msched-month').addEventListener('change',e=>{ s.month=Number(e.target.value); loadMaintSchedule(); });
  document.getElementById('msched-year').addEventListener('change',e=>{ s.year=Number(e.target.value); loadMaintSchedule(); });
  // Technician filter removed per user request (data preserved in DB, not displayed in this view)
  await loadMaintSchedule();
}

async function loadMaintSchedule() {
  const s = MaintContractsState.schedule;
  const params = new URLSearchParams({ year:s.year, month:s.month });
  // Technician filter removed from UI; s.team param no longer sent
  const ep = params.toString();
  document.getElementById('msched-xlsx').href='/api/maintenance-contracts/schedule.xlsx?'+ep;
  document.getElementById('msched-pdf').href='/api/maintenance-contracts/schedule.pdf?'+ep;
  const data = await API.get('/api/maintenance-contracts/schedule?'+ep);
  const tbody = document.getElementById('msched-tbody');
  if (!data.rows.length) { tbody.innerHTML='<tr><td colspan="10" class="empty-state">No clients assigned to this month</td></tr>'; }
  else {
    tbody.innerHTML = data.rows.map(r => {
      let lateBadge = '';
      if (r.completion_date) {
        const cd = new Date(r.completion_date);
        const parts = (r.month||'').split('-').map(Number);
        if (parts.length === 2 && (cd.getFullYear() > parts[0] || (cd.getFullYear() === parts[0] && cd.getMonth()+1 > parts[1]))) {
          lateBadge = '<span style="background:#e74c3c;color:#fff;font-size:11px;padding:1px 5px;border-radius:3px;margin-left:4px">Late</span>';
        }
      }
      const expBadge = _expiredPendingBadge(r.renewal_status, r.maintenance_end_date);
      const sClientTitle = r.client_name ? ` title="${esc(r.client_name)}"` : '';
      return `<tr>
        <td>${esc(r.contract_ref)}${expBadge ? ' '+expBadge : ''}</td><td class="scol-client"${sClientTitle}>${esc(r.client_name||'-')}</td><td>${esc(r.emirate||'-')}</td>
        <td>${fmtDate(r.maintenance_start_date)}</td><td>${fmtDate(r.maintenance_end_date)}</td>
        <td>${fmtSchedMonth(r.month)}</td>
        <td>${statusBadge(r.service_status)}</td>
        <td>${alertBadge(r.alert_status)}</td>
        <td>${r.completion_date?fmtDate(r.completion_date)+lateBadge:'-'}</td>
        <td>${esc(r.remarks||'-')}</td>
      </tr>`;
    }).join('');
  }
  document.getElementById('msched-total').textContent=`${data.total} client${data.total===1?'':'s'} scheduled for ${data.monthName} ${s.year}`;
}

// ─── Call Back / Emergency Tab ────────────────────────────────────────────────
// Data source: alert_callbacks table (single source of truth, shared with Monthly CB Summary).
// API: /api/alerts/callbacks (existing backend, unchanged).
// Contract lookup: /api/maintenance-contracts/contract-lookup (new endpoint).

const MCB_CB_STATUS_OPTS = ['Open','Assigned','Attended','Completed','Pending Parts','Client Hold','Cancelled'];
const MCB_PRIORITY_OPTS  = ['Normal','Urgent','Emergency'];

async function renderMaintCallbacksTab(root) {
  const st = MaintContractsState;
  if (!st.cbFilters) st.cbFilters = { sort_by: 'complaint_datetime', sort_dir: 'desc' };
  if (!st.cbPage)    st.cbPage = 1;
  const f = st.cbFilters;
  const canWrite  = APP.user && APP.user.role !== 'viewer';
  const canDelete = APP.user && APP.user.role === 'admin';

  root.innerHTML = `
    <div class="toolbar" style="flex-wrap:wrap;gap:6px;">
      ${canWrite ? `<button class="btn" id="mcb-add">+ Log Call Back</button>` : ''}
      <input type="text" id="mcb-search" placeholder="Search CB Ref., Contract Ref., Client, Technician…" style="flex:1;min-width:180px;">
      <select id="mcb-status-filter">
        <option value="">All Statuses</option>
        ${MCB_CB_STATUS_OPTS.map(s=>`<option>${s}</option>`).join('')}
      </select>
      <select id="mcb-priority-filter">
        <option value="">All Priorities</option>
        ${MCB_PRIORITY_OPTS.map(s=>`<option>${s}</option>`).join('')}
      </select>
      <select id="mcb-sort-by">
        <option value="complaint_datetime"  ${f.sort_by==='complaint_datetime'?'selected':''}>Sort: Complaint Date</option>
        <option value="callback_ref"        ${f.sort_by==='callback_ref'?'selected':''}>Sort: CB Ref.</option>
        <option value="contract_ref"        ${f.sort_by==='contract_ref'?'selected':''}>Sort: Contract Ref.</option>
        <option value="priority"            ${f.sort_by==='priority'?'selected':''}>Sort: Priority</option>
        <option value="callback_status"     ${f.sort_by==='callback_status'?'selected':''}>Sort: Status</option>
        <option value="assigned_technician" ${f.sort_by==='assigned_technician'?'selected':''}>Sort: Technician</option>
      </select>
      <button class="btn secondary" id="mcb-sort-dir">${f.sort_dir==='asc'?'&#8593; ASC':'&#8595; DESC'}</button>
      <button class="btn secondary" id="mcb-print">&#128438; Print</button>
      <button class="btn secondary" id="mcb-export">&#8681; Export CSV</button>
    </div>
    <div class="table-wrap"><table class="data-table" id="mcb-table">
      <thead><tr>
        <th>CB Ref.</th><th>Contract Ref.</th><th>Linked</th><th>Client / Company Name</th>
        <th>Location</th><th>Lift / Unit No.</th>
        <th>Complaint Date &amp; Time</th><th>Complaint Type</th><th>Priority</th>
        <th>Technician</th><th>Attended</th><th>Completed</th><th>Status</th><th></th>
      </tr></thead>
      <tbody id="mcb-tbody"><tr><td colspan="14">Loading…</td></tr></tbody>
    </table></div>
    <div class="pagination" id="mcb-pagination"></div>
  `;

  const ITEMS_PER_PAGE = 25;

  const mcbLoad = async () => {
    const params = new URLSearchParams();
    const s   = (document.getElementById('mcb-search')||{}).value || '';
    const st2 = (document.getElementById('mcb-status-filter')||{}).value || '';
    const pr  = (document.getElementById('mcb-priority-filter')||{}).value || '';
    if (s)   params.set('search', s);
    if (st2) params.set('callback_status', st2);
    if (pr)  params.set('priority', pr);
    params.set('sort_by',  f.sort_by  || 'complaint_datetime');
    params.set('sort_dir', f.sort_dir || 'desc');
    let data;
    try { data = await API.get('/api/alerts/callbacks?' + params); }
    catch(e) {
      const tbody = document.getElementById('mcb-tbody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="14" class="empty-state" style="color:#c0392b">Error loading callbacks: ${esc(e.message)}</td></tr>`;
      return;
    }
    const tbody      = document.getElementById('mcb-tbody');
    const pagination = document.getElementById('mcb-pagination');
    if (!tbody) return;
    const allRows    = data.rows || [];
    const totalPages = Math.max(1, Math.ceil(allRows.length / ITEMS_PER_PAGE));
    if (MaintContractsState.cbPage > totalPages) MaintContractsState.cbPage = 1;
    const pageRows   = allRows.slice((MaintContractsState.cbPage - 1) * ITEMS_PER_PAGE, MaintContractsState.cbPage * ITEMS_PER_PAGE);

    if (!allRows.length) {
      tbody.innerHTML = `<tr><td colspan="14" class="empty-state">No call back records found.${canWrite ? ' Use "+ Log Call Back" to create one.' : ''}</td></tr>`;
      if (pagination) pagination.innerHTML = '';
      return;
    }

    tbody.innerHTML = pageRows.map(r => `
      <tr data-id="${r.id}" style="cursor:pointer;" class="${r.priority==='Emergency'?'row-needs-review':''}">
        <td style="font-family:monospace;font-size:0.85em;white-space:nowrap;">${esc(r.callback_ref||'-')}</td>
        <td>${esc(r.contract_ref||'-')}</td>
        <td>${linkedBadge(r.linked_contract_status)}</td>
        <td>${esc(r.client_name||'-')}</td>
        <td>${esc(r.location||'-')}</td>
        <td>${esc(r.lift_unit_no||'-')}</td>
        <td style="white-space:nowrap;">${r.complaint_datetime ? fmtDate(r.complaint_datetime) : '-'}</td>
        <td>${esc(r.complaint_type||'-')}</td>
        <td>${priorityBadge(r.priority)}</td>
        <td><span title="${esc(r.assigned_technician||'')}" style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;">${esc(r.assigned_technician||'-')}</span></td>
        <td style="white-space:nowrap;">${r.attended_datetime   ? fmtDate(r.attended_datetime)   : '-'}</td>
        <td style="white-space:nowrap;">${r.completion_datetime ? fmtDate(r.completion_datetime) : '-'}</td>
        <td>${callbackBadge(r.callback_status)}</td>
        <td><button class="btn small secondary" data-cb-edit="${r.id}">${canWrite ? 'Edit' : 'View'}</button></td>
      </tr>`).join('');

    tbody.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      openMaintCallbackModal(tr.dataset.id, mcbLoad);
    }));
    tbody.querySelectorAll('[data-cb-edit]').forEach(btn =>
      btn.addEventListener('click', () => openMaintCallbackModal(btn.dataset.cbEdit, mcbLoad))
    );

    // Pagination
    if (pagination) {
      if (totalPages <= 1) { pagination.innerHTML = `<span class="meta">${allRows.length} record${allRows.length===1?'':'s'}</span>`; return; }
      let pages = '';
      const cur = MaintContractsState.cbPage;
      for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || Math.abs(p - cur) <= 2) {
          pages += `<button class="btn small ${p===cur?'':'secondary'}" data-cbpage="${p}">${p}</button>`;
        } else if (Math.abs(p - cur) === 3) {
          pages += `<span style="padding:0 4px;">…</span>`;
        }
      }
      pagination.innerHTML = `<span class="meta">Page ${cur} of ${totalPages} &nbsp;·&nbsp; ${allRows.length} record${allRows.length===1?'':'s'}</span> ${pages}`;
      pagination.querySelectorAll('[data-cbpage]').forEach(btn => btn.addEventListener('click', () => {
        MaintContractsState.cbPage = Number(btn.dataset.cbpage);
        mcbLoad();
      }));
    }
  };

  // Print
  document.getElementById('mcb-print').addEventListener('click', () => {
    const tbl = document.getElementById('mcb-table');
    if (!tbl) return;
    shPrint({
      title: 'Call Back / Emergency Records',
      contentEl: tbl,
      filters: {
        Search:   (document.getElementById('mcb-search')||{}).value   || '',
        Status:   (document.getElementById('mcb-status-filter')||{}).value   || '',
        Priority: (document.getElementById('mcb-priority-filter')||{}).value || '',
      }
    });
  });

  // Export CSV
  document.getElementById('mcb-export').addEventListener('click', () => {
    const tbl = document.getElementById('mcb-table');
    if (!tbl) return;
    const headers = [...tbl.querySelectorAll('thead th')].map(th => th.textContent).slice(0, -1);
    const lines   = [headers.join(',')];
    [...tbl.querySelectorAll('tbody tr')].forEach(row => {
      const cells = [...row.querySelectorAll('td')].slice(0, -1).map(td => '"' + td.textContent.trim().replace(/"/g, '""') + '"');
      if (cells.length) lines.push(cells.join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Callback_Records_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  });

  if (canWrite) document.getElementById('mcb-add').addEventListener('click', () => openMaintCallbackModal(null, mcbLoad));
  document.getElementById('mcb-search').addEventListener('input', debounce(() => { MaintContractsState.cbPage = 1; mcbLoad(); }, 350));
  document.getElementById('mcb-status-filter').addEventListener('change',   () => { MaintContractsState.cbPage = 1; mcbLoad(); });
  document.getElementById('mcb-priority-filter').addEventListener('change', () => { MaintContractsState.cbPage = 1; mcbLoad(); });
  document.getElementById('mcb-sort-by').addEventListener('change', e => {
    f.sort_by = e.target.value; MaintContractsState.cbPage = 1; mcbLoad();
  });
  document.getElementById('mcb-sort-dir').addEventListener('click', () => {
    f.sort_dir = f.sort_dir === 'asc' ? 'desc' : 'asc';
    const btn = document.getElementById('mcb-sort-dir');
    if (btn) btn.innerHTML = f.sort_dir === 'asc' ? '&#8593; ASC' : '&#8595; DESC';
    MaintContractsState.cbPage = 1;
    mcbLoad();
  });

  await mcbLoad();
}

// ── Contract / Client autocomplete (shared helper for CB modal) ───────────────
// Attaches a debounced dropdown to contractRefEl and/or clientNameEl.
// onSelect(row) is called with the chosen contract row so the caller can fill fields.
function _mcbSetupLookup(containerEl, onSelect) {
  if (!containerEl) return;

  const dropDiv = document.createElement('div');
  dropDiv.style.cssText = [
    'position:absolute', 'z-index:2000', 'background:#fff',
    'border:1px solid #d0d7de', 'border-radius:8px',
    'box-shadow:0 6px 20px rgba(0,0,0,0.14)', 'max-height:260px',
    'overflow-y:auto', 'min-width:100%', 'width:max-content',
    'max-width:480px', 'display:none', 'top:calc(100% + 4px)', 'left:0',
  ].join(';');
  containerEl.style.position = 'relative';
  containerEl.appendChild(dropDiv);

  let _lastQ  = '';
  let _rows   = [];
  let _focIdx = -1;

  function renderDrop(rows, focIdx) {
    _rows = rows; _focIdx = focIdx;
    if (!rows.length) {
      dropDiv.innerHTML = '<div style="padding:10px 14px;color:#888;font-size:0.88em;">No matching contract found</div>';
    } else {
      dropDiv.innerHTML = rows.map((r, i) => `
        <div data-idx="${i}" style="padding:9px 14px;cursor:pointer;border-bottom:1px solid #f0f0f0;font-size:0.87em;background:${i===focIdx?'#f0f7ff':'#fff'}">
          <span style="font-weight:700;color:#1a5a7a;">${esc(r.contract_ref||'?')}</span>
          <span style="color:#2c3e50;"> — ${esc(r.client_name||'-')}</span>
          ${r.project_description?`<span style="color:#7f8c8d;"> — ${esc(r.project_description)}</span>`:''}
          <br><span style="color:#95a5a6;font-size:0.88em;">${[r.emirate, r.total_elevator_units?r.total_elevator_units+' unit(s)':null].filter(Boolean).join(' · ')}</span>
        </div>`).join('');
      dropDiv.querySelectorAll('[data-idx]').forEach(el => {
        el.addEventListener('mouseover', () => {
          dropDiv.querySelectorAll('[data-idx]').forEach((d,i) => d.style.background = i===Number(el.dataset.idx)?'#f0f7ff':'#fff');
          _focIdx = Number(el.dataset.idx);
        });
        el.addEventListener('mousedown', e => { e.preventDefault(); onSelect(_rows[Number(el.dataset.idx)]); hideDrop(); });
      });
    }
    dropDiv.style.display = '';
  }

  function hideDrop() { dropDiv.style.display = 'none'; _focIdx = -1; }

  async function doSearch(q) {
    if (q === _lastQ) return;
    _lastQ = q;
    if (q.length < 2) { hideDrop(); return; }
    dropDiv.innerHTML = '<div style="padding:10px 14px;color:#888;font-size:0.88em;">Searching…</div>';
    dropDiv.style.display = '';
    try {
      const data = await API.get('/api/maintenance-contracts/contract-lookup?q=' + encodeURIComponent(q));
      if (_lastQ !== q) return; // stale response — discard
      renderDrop(data.rows || [], -1);
    } catch(_) { hideDrop(); }
  }

  const input = containerEl.querySelector('input');
  if (!input) return;
  const debouncedSearch = debounce(q => doSearch(q), 300);

  input.addEventListener('input',  () => debouncedSearch(input.value.trim()));
  input.addEventListener('focus',  () => { if (input.value.trim().length >= 2) debouncedSearch(input.value.trim()); });
  input.addEventListener('blur',   () => setTimeout(hideDrop, 200));
  input.addEventListener('keydown', e => {
    if (dropDiv.style.display === 'none') return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _focIdx = Math.min(_focIdx + 1, _rows.length - 1);
      renderDrop(_rows, _focIdx);
      dropDiv.querySelectorAll('[data-idx]')[_focIdx]?.scrollIntoView({ block:'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _focIdx = Math.max(_focIdx - 1, 0);
      renderDrop(_rows, _focIdx);
      dropDiv.querySelectorAll('[data-idx]')[_focIdx]?.scrollIntoView({ block:'nearest' });
    } else if (e.key === 'Enter' && _focIdx >= 0) {
      e.preventDefault();
      onSelect(_rows[_focIdx]); hideDrop();
    } else if (e.key === 'Escape') {
      hideDrop();
    }
  });
}

// ── Log / Edit Call Back modal ────────────────────────────────────────────────
async function openMaintCallbackModal(id, reloadFn) {
  const isEdit    = !!id;
  const canWrite  = APP.user && APP.user.role !== 'viewer';
  const canDelete = APP.user && APP.user.role === 'admin';
  let r = {};

  if (isEdit) {
    try {
      const data = await API.get(`/api/alerts/callbacks?sort_by=complaint_datetime&sort_dir=desc`);
      r = (data.rows || []).find(x => String(x.id) === String(id)) || {};
    } catch(e) { toast('Failed to load callback record: ' + e.message, true); return; }
  }

  const rdOnly  = canWrite ? '' : ' readonly';
  const disAttr = canWrite ? '' : ' disabled';
  const nowDT   = new Date().toISOString().slice(0, 16);
  const roNote  = canWrite ? '' :
    `<div class="meta" style="background:#fff8e7;padding:8px 12px;border-radius:6px;margin-bottom:12px;">
       &#128274; View Only — your role does not have write access to this record.
     </div>`;

  openModal(`
    <h2>${isEdit ? 'Call Back: ' + esc(r.callback_ref||'') : 'Log New Call Back'}</h2>
    ${isEdit
      ? `<div class="meta" style="margin-bottom:10px;font-family:monospace;font-size:1em;color:#1a5a7a;">${esc(r.callback_ref||'')}</div>`
      : '<div class="meta" style="margin-bottom:10px;">CB Ref. will be auto-generated on save.</div>'}
    ${roNote}
    <form id="mcb-form" autocomplete="off">
      <div class="form-grid">

        <div class="form-field" id="mcb-cref-wrap">
          <label>Contract Ref. *</label>
          <input type="text" name="contract_ref" id="mcb-contract-ref"
            value="${esc(r.contract_ref||'')}"
            placeholder="Type to search (e.g. SH-181)…"${rdOnly}>
        </div>

        <div class="form-field" id="mcb-cname-wrap">
          <label>Client / Company Name</label>
          <input type="text" name="client_name" id="mcb-client-name"
            value="${esc(r.client_name||'')}"
            placeholder="Type client name to search…"${rdOnly}>
        </div>

        <div class="form-field">
          <label>Location / Emirate</label>
          <input type="text" name="location" id="mcb-location" value="${esc(r.location||'')}"${rdOnly}>
        </div>
        <div class="form-field">
          <label>Lift / Unit No.</label>
          <input type="text" name="lift_unit_no" id="mcb-lift" value="${esc(r.lift_unit_no||'')}"${rdOnly}>
        </div>

        <div class="form-field">
          <label>Complaint Date &amp; Time *</label>
          <input type="datetime-local" name="complaint_datetime"
            value="${r.complaint_datetime ? r.complaint_datetime.slice(0,16) : nowDT}"${rdOnly}>
        </div>
        <div class="form-field">
          <label>Complaint Type</label>
          <input type="text" name="complaint_type"
            value="${esc(r.complaint_type||'')}"
            placeholder="e.g. Lift Not Working, Door Issue…"${rdOnly}>
        </div>

        <div class="form-field">
          <label>Priority</label>
          <select name="priority"${disAttr}>
            ${MCB_PRIORITY_OPTS.map(p=>`<option value="${p}" ${(r.priority||'Normal')===p?'selected':''}>${p}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label>Assigned Technician</label>
          <input type="text" name="assigned_technician"
            value="${esc(r.assigned_technician||'')}"
            placeholder="Technician name"${rdOnly}>
        </div>

        <div class="form-field">
          <label>Response Time</label>
          <input type="text" name="response_time"
            value="${esc(r.response_time||'')}"
            placeholder="e.g. 45 min, 2 hr"${rdOnly}>
        </div>
        <div class="form-field">
          <label>Attended Date &amp; Time</label>
          <input type="datetime-local" name="attended_datetime"
            value="${r.attended_datetime ? r.attended_datetime.slice(0,16) : ''}"${rdOnly}>
        </div>

        <div class="form-field">
          <label>Completion Date &amp; Time</label>
          <input type="datetime-local" name="completion_datetime"
            value="${r.completion_datetime ? r.completion_datetime.slice(0,16) : ''}"${rdOnly}>
        </div>
        <div class="form-field">
          <label>Call Back Status</label>
          <select name="callback_status"${disAttr}>
            ${MCB_CB_STATUS_OPTS.map(s=>`<option value="${s}" ${(r.callback_status||'Open')===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>

        <div class="form-field span2">
          <label>Issue Description</label>
          <textarea name="issue_description" rows="2"${rdOnly}>${esc(r.issue_description||'')}</textarea>
        </div>
        <div class="form-field span2">
          <label>Action Taken / Resolution</label>
          <textarea name="action_taken" rows="2"${rdOnly}>${esc(r.action_taken||'')}</textarea>
        </div>
        <div class="form-field span2">
          <label>Spare Parts Used</label>
          <textarea name="spare_parts_used" rows="2"${rdOnly}>${esc(r.spare_parts_used||'')}</textarea>
        </div>

        <div class="form-field">
          <label>Client Confirmation</label>
          <input type="text" name="client_confirmation"
            value="${esc(r.client_confirmation||'')}"${rdOnly}>
        </div>
        <div class="form-field span2">
          <label>Remarks</label>
          <textarea name="remarks" rows="2"${rdOnly}>${esc(r.remarks||'')}</textarea>
        </div>
      </div>

      <div class="modal-actions">
        ${isEdit && canDelete ? `<button type="button" class="btn danger" id="mcb-del-btn">Delete</button>` : ''}
        <div class="spacer"></div>
        <button type="button" class="btn secondary" id="mcb-cancel-btn">Cancel</button>
        ${canWrite ? `<button type="submit" class="btn" id="mcb-save-btn">${isEdit ? 'Save Changes' : 'Log Call Back'}</button>` : ''}
      </div>
    </form>
  `);

  document.getElementById('mcb-cancel-btn').addEventListener('click', closeModal);

  // ── Live contract / client lookup ──────────────────────────────────────────
  if (canWrite) {
    const crefWrap  = document.getElementById('mcb-cref-wrap');
    const cnameWrap = document.getElementById('mcb-cname-wrap');
    const locationEl = document.querySelector('#mcb-form [name="location"]');
    const liftEl     = document.getElementById('mcb-lift');

    const onContractSelect = row => {
      const crefEl  = document.getElementById('mcb-contract-ref');
      const cnameEl = document.getElementById('mcb-client-name');
      if (crefEl)  crefEl.value  = row.contract_ref  || '';
      if (cnameEl) cnameEl.value = row.client_name   || '';
      // Only fill location/lift if currently empty (don't overwrite user entries)
      if (locationEl && !locationEl.value) locationEl.value = row.emirate || '';
      if (liftEl     && !liftEl.value)     liftEl.value     = '';
    };

    _mcbSetupLookup(crefWrap,  onContractSelect);
    _mcbSetupLookup(cnameWrap, onContractSelect);
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  const delBtn = document.getElementById('mcb-del-btn');
  if (delBtn) {
    delBtn.addEventListener('click', () => {
      openModal(`
        <div style="text-align:center;padding:8px 0 16px;">
          <div style="font-size:28px;color:#c0392b;margin-bottom:12px;">&#9888;</div>
          <h2 style="margin:0 0 8px;">Delete Call Back Record</h2>
          <p style="color:#66758a;margin-bottom:20px;">This action cannot be undone.</p>
          <div style="background:#f8f9fa;border-radius:8px;padding:14px;max-width:320px;margin:0 auto 20px;text-align:left;">
            <div style="margin-bottom:8px;"><span style="color:#888;font-size:12px;">CB Ref.</span><br>
              <strong style="font-family:monospace;">${esc(r.callback_ref||'-')}</strong></div>
            <div><span style="color:#888;font-size:12px;">Client</span><br><span>${esc(r.client_name||'-')}</span></div>
          </div>
          <div class="modal-actions" style="justify-content:center;gap:12px;">
            <button class="btn secondary" id="mcb-delcancel">Cancel</button>
            <button class="btn danger"    id="mcb-delconfirm">Delete Record</button>
          </div>
        </div>
      `);
      document.getElementById('mcb-delcancel').addEventListener('click',  () => openMaintCallbackModal(id, reloadFn));
      document.getElementById('mcb-delconfirm').addEventListener('click', async () => {
        try {
          await API.del(`/api/alerts/callbacks/${id}`);
          closeModal();
          toast('Call back record deleted');
          if (reloadFn) reloadFn();
        } catch(e) {
          closeModal();
          toast('Delete failed: ' + e.message, true);
        }
      });
    });
  }

  // ── Save (double-submit guard) ─────────────────────────────────────────────
  if (canWrite) {
    const form = document.getElementById('mcb-form');
    let _saving = false;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (_saving) return;
      const contractRef = (document.getElementById('mcb-contract-ref')||{}).value || '';
      if (!contractRef.trim()) { toast('Contract Ref. is required', true); return; }
      _saving = true;
      const saveBtn = document.getElementById('mcb-save-btn');
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
      const body = readForm(form);
      try {
        if (isEdit) {
          await API.patch(`/api/alerts/callbacks/${id}`, body);
          toast('Call back updated');
        } else {
          await API.post('/api/alerts/callbacks', body);
          toast('Call back logged');
        }
        closeModal();
        if (reloadFn) reloadFn();
      } catch(err) {
        const msg = (err.data && err.data.error) ? err.data.error : err.message;
        toast('Save failed: ' + msg, true);
        _saving = false;
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = isEdit ? 'Save Changes' : 'Log Call Back'; }
      }
    });
  }
}

// ─── Cancelled AMC Tab ───────────────────────────────────────────────────────
// Shows maintenance_contracts WHERE renewal_status = 'Cancelled'.
// Read from the same table as Maintenance Records — no separate DB table.
// Admins/coordinators can Reactivate (sets renewal_status back to Active/Hold).

const MC_CANCELLED_SORT_OPTS = [
  { v:'contract_ref',    l:'Contract Ref.' },
  { v:'client_name',     l:'Client Name' },
  { v:'emirate',         l:'Emirate' },
  { v:'end_date',        l:'End Date' },
  { v:'start_date',      l:'Start Date' },
  { v:'cancelled_on',    l:'Cancelled On' },
  { v:'last_updated',    l:'Last Updated' },
  { v:'total_elevator_units', l:'Elevator Units' },
];

async function renderMaintCancelledTab(root) {
  const st = MaintContractsState;
  if (!st.cancelledFilters) st.cancelledFilters = {};
  if (!st.cancelledPage)    st.cancelledPage = 1;
  const canWrite  = APP.user && APP.user.role !== 'viewer';
  const isAdmin   = APP.user && (APP.user.role === 'admin');
  const emirates  = await API.get('/api/maintenance-contracts/meta/emirates').catch(()=>({ rows:[] }));
  const cf        = st.cancelledFilters;

  root.innerHTML = `
    <div style="background:#fff8e7;border-left:4px solid #d68910;padding:10px 16px;border-radius:6px;margin-bottom:14px;font-size:13px;color:#7a5900;">
      <strong>Cancelled AMC</strong> — These records are excluded from active schedules, visit counts, and dashboard totals.
      Historical visit data, schedules, and renewals are fully preserved.
      ${isAdmin ? 'Admins may <strong>Reactivate</strong> a project to restore it to Maintenance Records.' : ''}
    </div>
    <div class="toolbar" style="flex-wrap:wrap;gap:6px;">
      <input type="text" id="mc-search" placeholder="Search Contract Ref., Client…" style="flex:1;min-width:160px;"
        value="${esc(cf.search||'')}">
      <select id="mc-emirate">
        <option value="">All Emirates</option>
        ${emirates.rows.map(e=>`<option ${cf.emirate===e?'selected':''}>${esc(e)}</option>`).join('')}
      </select>
      <select id="mc-sort">
        ${MC_CANCELLED_SORT_OPTS.map(o=>`<option value="${o.v}" ${(cf.sort||'contract_ref')===o.v?'selected':''}>Sort: ${o.l}</option>`).join('')}
      </select>
      <select id="mc-dir">
        <option value="asc"  ${(cf.dir||'asc')==='asc'?'selected':''}>Asc</option>
        <option value="desc" ${(cf.dir||'asc')==='desc'?'selected':''}>Desc</option>
      </select>
      <button class="btn secondary" id="mc-print">&#128438; Print</button>
    </div>
    <div class="table-wrap">
      <table class="data-table" id="mc-cancelled-table">
        <thead><tr>
          <th style="white-space:nowrap">Contract Ref.</th><th style="min-width:220px">Client / Company</th><th>Emirate</th><th>Type</th>
          <th>Start</th><th>End</th><th>Elevator Units</th><th style="white-space:nowrap">Cancelled On</th>
          <th style="min-width:200px">Cancellation Reason / Remarks</th><th>Status</th><th data-no-print>Actions</th>
        </tr></thead>
        <tbody id="mc-cancelled-tbody"><tr><td colspan="11">Loading…</td></tr></tbody>
      </table>
    </div>
    <div class="pagination" id="mc-cancelled-pagination"></div>
  `;

  const ITEMS = 50;

  const mcCancelledLoad = async () => {
    const params = new URLSearchParams({
      page: st.cancelledPage,
      pageSize: ITEMS,
      mode: 'cancelled',
      sort: cf.sort || 'contract_ref',
      dir:  cf.dir  || 'asc',
    });
    if (cf.search)  params.set('search',  cf.search);
    if (cf.emirate) params.set('emirate', cf.emirate);
    let data;
    try { data = await API.get('/api/maintenance-contracts/?' + params); }
    catch(e) {
      const tbody = document.getElementById('mc-cancelled-tbody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="11" class="empty-state" style="color:#c0392b">Error: ${esc(e.message)}</td></tr>`;
      return;
    }
    const tbody      = document.getElementById('mc-cancelled-tbody');
    const pagination = document.getElementById('mc-cancelled-pagination');
    if (!tbody) return;
    const totalPages = Math.max(1, Math.ceil(data.total / ITEMS));
    if (st.cancelledPage > totalPages) st.cancelledPage = 1;

    if (!data.rows.length) {
      tbody.innerHTML = '<tr><td colspan="11" class="empty-state">No cancelled AMC records found.</td></tr>';
      if (pagination) pagination.innerHTML = '';
      return;
    }

    tbody.innerHTML = data.rows.map(m => `
      <tr data-id="${m.id}" style="cursor:pointer;">
        <td style="font-weight:600;color:#0f2a47;">${esc(m.contract_ref||'—')}</td>
        <td>${esc(m.client_name||'—')}</td>
        <td>${esc(m.emirate||'—')}</td>
        <td>${esc(m.maintenance_type||'—')}</td>
        <td style="white-space:nowrap;">${fmtDate(m.start_date)}</td>
        <td style="white-space:nowrap;">${fmtDate(m.end_date)}</td>
        <td>${m.total_elevator_units||'—'}</td>
        <td style="white-space:nowrap;">${m.cancelled_on ? fmtDate(m.cancelled_on) : '—'}</td>
        <td><div style="max-width:320px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal" title="${esc(m.cancellation_note||'')}">${esc(m.cancellation_note||'—')}</div></td>
        <td><span class="badge" style="background:#fde6e3;color:#c0392b;border:1px solid #f0b8b1;">Cancelled</span></td>
        <td data-no-print>
          <button class="btn small secondary" data-cancelled-view="${m.id}">View</button>
          ${isAdmin ? `<button class="btn small" style="background:#1f7a5c;color:#fff;margin-left:4px;" data-cancelled-reactivate="${m.id}" data-contract-ref="${esc(m.contract_ref||'')}">Reactivate</button>` : ''}
        </td>
      </tr>`).join('');

    // Row click → view details
    tbody.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      openMaintModal(tr.dataset.id);
    }));
    tbody.querySelectorAll('[data-cancelled-view]').forEach(btn =>
      btn.addEventListener('click', () => openMaintModal(btn.dataset.cancelledView))
    );
    // Reactivate
    tbody.querySelectorAll('[data-cancelled-reactivate]').forEach(btn => {
      btn.addEventListener('click', () => openReactivateModal(btn.dataset.cancelledReactivate, btn.dataset.contractRef, mcCancelledLoad));
    });

    // Pagination
    if (pagination) {
      const cur = st.cancelledPage;
      if (totalPages <= 1) {
        pagination.innerHTML = `<span class="meta">${data.total} record${data.total===1?'':'s'}</span>`;
        return;
      }
      let pages = '';
      for (let p = 1; p <= totalPages; p++) {
        if (p===1 || p===totalPages || Math.abs(p-cur)<=2) {
          pages += `<button class="btn small ${p===cur?'':'secondary'}" data-cpg="${p}">${p}</button>`;
        } else if (Math.abs(p-cur)===3) pages += '<span style="padding:0 4px">…</span>';
      }
      pagination.innerHTML = `<span class="meta">Page ${cur} of ${totalPages} &nbsp;·&nbsp; ${data.total} record${data.total===1?'':'s'}</span> ${pages}`;
      pagination.querySelectorAll('[data-cpg]').forEach(b => b.addEventListener('click', () => {
        st.cancelledPage = Number(b.dataset.cpg);
        mcCancelledLoad();
      }));
    }
  };

  // Print
  document.getElementById('mc-print').addEventListener('click', async () => {
    const tbl = document.getElementById('mc-cancelled-table');
    if (!tbl) return;
    shPrint({ title: 'Cancelled AMC', contentEl: tbl, filters: {
      Search: cf.search || '', Emirate: cf.emirate || ''
    }});
  });

  // Toolbar events
  document.getElementById('mc-search').addEventListener('input', debounce(e => {
    cf.search = e.target.value.trim(); st.cancelledPage = 1; mcCancelledLoad();
  }, 350));
  document.getElementById('mc-emirate').addEventListener('change', e => {
    cf.emirate = e.target.value; st.cancelledPage = 1; mcCancelledLoad();
  });
  document.getElementById('mc-sort').addEventListener('change', e => {
    cf.sort = e.target.value; st.cancelledPage = 1; mcCancelledLoad();
  });
  document.getElementById('mc-dir').addEventListener('change', e => {
    cf.dir = e.target.value; st.cancelledPage = 1; mcCancelledLoad();
  });

  await mcCancelledLoad();
}

// ── Reactivate Cancelled Project modal (admin only) ──────────────────────────
function openReactivateModal(id, contractRef, reloadFn) {
  openModal(`
    <h2>Reactivate Maintenance Project</h2>
    <div class="meta" style="margin-bottom:12px;">
      Contract: <strong style="font-family:monospace;">${esc(contractRef||id)}</strong>
    </div>
    <div class="meta" style="background:#e8f5ef;padding:10px 14px;border-radius:6px;margin-bottom:16px;font-size:13px;">
      Reactivating this project will move it back to <strong>Maintenance Records</strong>.
      All visit history and schedule data will be preserved.
    </div>
    <form id="reactivate-form">
      <div class="form-grid">
        <div class="form-field">
          <label>New Renewal Status *</label>
          <select name="renewal_status" required>
            <option value="Active Maintenance">Active Maintenance</option>
            <option value="Hold">Hold</option>
          </select>
        </div>
        <div class="form-field">
          <label>Reactivation Date</label>
          <input type="date" name="reactivation_date" value="${new Date().toISOString().slice(0,10)}">
        </div>
        <div class="form-field span2">
          <label>Reactivation Reason *</label>
          <textarea name="reactivation_reason" rows="2" required placeholder="Reason for reactivating this maintenance project…"></textarea>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn secondary" id="react-cancel">Cancel</button>
        <button type="submit" class="btn" id="react-save">Reactivate</button>
      </div>
    </form>
  `);
  document.getElementById('react-cancel').addEventListener('click', closeModal);
  const form = document.getElementById('reactivate-form');
  let _saving = false;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (_saving) return;
    const fd = readForm(form);
    if (!fd.reactivation_reason || !String(fd.reactivation_reason).trim()) {
      toast('Please enter a reactivation reason', true); return;
    }
    _saving = true;
    const saveBtn = document.getElementById('react-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    try {
      // keep the previous (cancellation) remarks — the reactivation note is added on top
      let prevRemarks = '';
      try { const cur = await API.get(`/api/maintenance-contracts/${id}`); prevRemarks = (cur.record && cur.record.remarks) || ''; } catch (_) {}
      const note = `[REACTIVATED ${fd.reactivation_date || ''}] ${fd.reactivation_reason}`.trim();
      const r = await API.patch(`/api/maintenance-contracts/${id}`, {
        renewal_status: fd.renewal_status,
        remarks: prevRemarks ? `${note}\n${prevRemarks}` : note,
        remarks_note: `Reactivated: ${fd.reactivation_reason}`.trim(),
      });
      const rs = r && r.reactivation_schedule;
      const schedMsg = rs && !rs.skipped && !rs.error ? ` — ${rs.added.length} future month(s) scheduled from the current Maintenance Period` : '';
      toast(`Project reactivated as "${fd.renewal_status}"${schedMsg}`);
      closeModal();
      if (reloadFn) reloadFn();
    } catch(err) {
      toast('Reactivation failed: ' + (err.message || 'Unknown error'), true);
      _saving = false;
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Reactivate'; }
    }
  });
}
