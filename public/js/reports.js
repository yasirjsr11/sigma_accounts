// Reports Module — rebuilt 2026-07-30 (10-category card UI)
'use strict';

const ReportsState = { type: null, category: null, filters: {}, page: 1, pageSize: 25, data: null };

// ── Icon maps for Lucide icons (used in tabs and sidebar) ─────────────────────
const REPORT_ICON_MAP = {
  'monthly-management':'bar-chart-2','quotations-register':'clipboard-list','salesperson-performance':'award',
  'contracts-list':'file-text','monthly-sales':'trending-up','delivery-report':'truck','installation-completion':'hard-hat',
  'handover-report':'flag','project-status':'activity',
  'ins-quotes-units':'settings','sea-costs':'ship','factory-payments-register':'receipt',
  'monthly-maintenance':'calendar','service-register':'clipboard-check','amc-portfolio':'layers','amc-payments':'wallet',
  'callback-detail':'phone-call','payment-pending':'alert-circle','client-payment-entry':'receipt','monthly-cashflow':'activity',
  'maintenance-expiring':'alert-triangle','cancelled-contracts':'x-circle','maintenance-cancelled':'x-circle',
};
const CATEGORY_ICON_MAP = {
  management:'bar-chart-2',sales:'briefcase',contracts:'file-text',
  factory:'settings',maintenance:'wrench',callback:'phone',
  accounts:'dollar-sign',alerts:'bell',historical:'archive',
};

// ── Report Catalog (2026-09-30 consolidation) ─────────────────────────────────
// 22 authoritative reports — one per business question (was 34 catalog entries,
// several duplicated or overlapping). Category counts are derived from this list.
// Every report except Monthly Management uses the standard template:
// Filters → KPI summary → primary chart → secondary analysis → register → drill-down.
const REPORT_CATALOG = [
  { category: 'A. Management', icon: '📊', key: 'management', reports: [
    { type: 'monthly-management', label: 'Monthly Management Report', subtitle: 'Unit-based month-wise view — sales, renewals, orders, delivery, handover, maintenance + factory payment', icon: '📈', source: 'All Modules', sourceColor: '#6366f1' },
  ]},
  { category: 'B. Sales & Quotations', icon: '💼', key: 'sales', reports: [
    { type: 'quotations-register', label: 'Quotations & Status Analysis', subtitle: 'Quotation count, status, pipeline, decision conversion, salesperson activity and aging', icon: '📋', source: 'Quotations', sourceColor: '#0ea5e9' },
    { type: 'salesperson-performance', label: 'Salesperson Performance', subtitle: 'Quotations, approved contracts, sales units and target achievement per salesperson', icon: '🏆', source: 'Quotations + Contracts', sourceColor: '#0ea5e9' },
  ]},
  { category: 'C. Contracts', icon: '📄', key: 'contracts', reports: [
    { type: 'contracts-list', label: 'Contract Register', subtitle: 'Detailed contract portfolio and current project records', icon: '📑', source: 'Contracts', sourceColor: '#10b981' },
    { type: 'monthly-sales', label: 'Monthly Sales', subtitle: 'Confirmed contract units and projects by Approval Date', icon: '💹', source: 'Contracts', sourceColor: '#10b981' },
    { type: 'delivery-report', label: 'Delivery', subtitle: 'Delivered elevator units and projects by actual Delivery Date', icon: '🚚', source: 'Contracts', sourceColor: '#10b981' },
    { type: 'installation-completion', label: 'Installation Completion', subtitle: 'Mechanical and Electrical Completion units by completion date', icon: '🔧', source: 'Contracts', sourceColor: '#10b981' },
    { type: 'handover-report', label: 'Handover', subtitle: 'Elevator units handed over by actual Handover Date', icon: '🏁', source: 'Contracts', sourceColor: '#10b981' },
    { type: 'project-status', label: 'Project Status', subtitle: 'Current Active / Hold / Delay / Cancelled status by units', icon: '🚦', source: 'Contracts', sourceColor: '#10b981' },
  ]},
  { category: 'D. Factory, Shipping & Supplier', icon: '🏭', key: 'factory', reports: [
    { type: 'ins-quotes-units', label: 'Factory Orders & Production', subtitle: 'Factory ordered units by Order Date with production / delivery status', icon: '🔩', source: 'Factory', sourceColor: '#f59e0b' },
    { type: 'sea-costs', label: 'Shipping & Delivery', subtitle: 'Shipments by ETA / ETD — USD shipping and AED clearance costs, shipping and delivery status', icon: '🚢', source: 'Factory', sourceColor: '#f59e0b' },
    { type: 'factory-payments-register', label: 'Factory Payments', subtitle: 'Payments by Payment Date (per currency) and current outstanding payables', icon: '🧾', source: 'Factory Payments', sourceColor: '#f59e0b' },
  ]},
  { category: 'E. Maintenance', icon: '🔧', key: 'maintenance', reports: [
    { type: 'monthly-maintenance', label: 'Monthly Maintenance', subtitle: 'Due, scheduled and serviced elevator units — 12-month service trend', icon: '📆', source: 'Maintenance', sourceColor: '#8b5cf6' },
    { type: 'service-register', label: 'Monthly Service Register', subtitle: 'Technician monthly service list — AMC contracts, units, last service and scheduled dates (print-ready)', icon: '🗒', source: 'Maintenance', sourceColor: '#8b5cf6' },
    { type: 'amc-portfolio', label: 'AMC Portfolio & Renewal', subtitle: 'Current AMC portfolio by units and completed renewals (units / projects) by month', icon: '🔄', source: 'Maintenance', sourceColor: '#8b5cf6' },
    { type: 'amc-payments', label: 'AMC Payments & Outstanding', subtitle: 'Current AMC value, actual collections and outstanding balance (AMC payment ledger)', icon: '💳', source: 'Maintenance', sourceColor: '#8b5cf6' },
  ]},
  { category: 'F. Call Back & Emergency', icon: '📞', key: 'callback', reports: [
    { type: 'callback-detail', label: 'Call Back & Emergency Analysis', subtitle: 'Tickets by month, priority, complaint type and emirate — with register', icon: '📋', source: 'Alerts', sourceColor: '#ef4444' },
  ]},
  { category: 'G. Accounts & Payments', icon: '💰', key: 'accounts', reports: [
    { type: 'payment-pending', label: 'Client Receivables', subtitle: 'Contracts with an outstanding client balance', icon: '⚠️', source: 'Accounts', sourceColor: '#ec4899' },
    { type: 'client-payment-entry', label: 'Client Payment Transactions', subtitle: 'Every client receipt by payment date — monthly trend and register', icon: '🧾', source: 'Accounts', sourceColor: '#ec4899' },
    { type: 'monthly-cashflow', label: 'Monthly Cash Flow', subtitle: 'Client receipts vs factory payments by month — each in its own currency', icon: '📈', source: 'Accounts', sourceColor: '#ec4899' },
  ]},
  { category: 'H. Alerts, Expiry & Compliance', icon: '🔔', key: 'alerts', reports: [
    { type: 'maintenance-expiring', label: 'AMC Expiry & Renewal Analysis', subtitle: 'Units by current-period expiry month and renewal coverage (analysis; action queue is in Alerts)', icon: '⚠️', source: 'Maintenance', sourceColor: '#8b5cf6' },
  ]},
  { category: 'I. Historical & Cancelled Records', icon: '🗃', key: 'historical', reports: [
    { type: 'cancelled-contracts', label: 'Cancelled / Terminated Contracts', subtitle: 'Post-approval cancellations — units, value, retention and refunds', icon: '🚫', source: 'Contracts', sourceColor: '#10b981' },
    { type: 'maintenance-cancelled', label: 'Cancelled AMC Contracts', subtitle: 'Cancelled maintenance records with cancellation date and reason', icon: '🚫', source: 'Maintenance', sourceColor: '#8b5cf6' },
  ]},
];

// Flat list for lookup
const ALL_REPORTS = REPORT_CATALOG.flatMap(c => c.reports.map(r => ({ ...r, _category: c.category })));

// Only filters relevant to each report are shown; every filter drives the WHOLE report.
const FILTER_CONFIG = {
  'monthly-management':        ['year','month','salesperson','emirate'],
  'quotations-register':       ['year','month','salesperson','status','search','sort_by','sort_dir'],
  'salesperson-performance':   ['year','month','salesperson'],
  'contracts-list':            ['year','month','salesperson','emirate','project_status','search','sort_by','sort_dir'],
  'monthly-sales':             ['year','month','salesperson','emirate','project_status','search','sort_by','sort_dir'],
  'delivery-report':           ['year','month','salesperson','emirate','project_status','search','sort_by','sort_dir'],
  'installation-completion':   ['year','month','salesperson','emirate','project_status','search','sort_by','sort_dir'],
  'handover-report':           ['year','month','salesperson','emirate','search','sort_by','sort_dir'],
  'project-status':            ['year','salesperson','emirate','project_status','search','sort_by','sort_dir'],
  'ins-quotes-units':          ['year','month','emirate','supplier','factory_delivery_status','show_cancelled','search','sort_by','sort_dir'],
  'sea-costs':                 ['year','month','shipping_status','delivery_status','payment_status','search','sort_by','sort_dir'],
  'factory-payments-register': ['year','month','view_mode','factory_table','supplier','payment_type','search','sort_by','sort_dir'],
  'monthly-maintenance':       ['year','month','emirate','maintenance_type','maintenance_status','search'],
  'service-register':          ['year','month','emirate','maintenance_type','status','search','sort_by','sort_dir'],
  'amc-portfolio':             ['year','month','emirate','maintenance_type','renewal_status','payment_status','search','sort_by','sort_dir'],
  'amc-payments':              ['year','month','emirate','maintenance_type','payment_status','search','sort_by','sort_dir'],
  'callback-detail':           ['year','month','emirate','status','priority','complaint_type','search','sort_by','sort_dir'],
  'payment-pending':           ['year','month','salesperson','emirate','payment_status','search','sort_by','sort_dir'],
  'client-payment-entry':      ['year','month','view_mode','salesperson','emirate','payment_type','search','sort_by','sort_dir'],
  'monthly-cashflow':          ['year','month'],
  'maintenance-expiring':      ['year','month','emirate','maintenance_type','search','sort_by','sort_dir'],
  'cancelled-contracts':       ['year','month','salesperson','emirate','cancellation_type','refund_status','search','sort_by','sort_dir'],
  'maintenance-cancelled':     ['year','month','emirate','maintenance_type','search','sort_by','sort_dir'],
};

const REPORTS_SORT_OPTIONS = {
  'quotations-register':       [['quotation_date','Quotation Date'],['quote_ref','Quote Ref.'],['client_name','Client'],['salesperson','Salesperson'],['status','Status'],['age','Quotation Age']],
  'contracts-list':            [['approval_date','Approval Date'],['units','Units'],['contract_value','Contract Value'],['client_name','Client'],['emirate','Emirate'],['project_status','Project Status'],['handover_date','Handover Date']],
  'monthly-sales':             [['approval_date','Approval Date'],['units','Units'],['contract_value','Contract Value'],['contract_ref','Contract Ref.'],['client_name','Client'],['emirate','Emirate'],['salesperson','Salesperson']],
  'delivery-report':           [['delivery_date','Delivery Date'],['units','Units'],['contract_ref','Contract Ref.'],['client_name','Client'],['emirate','Emirate'],['salesperson','Salesperson']],
  'installation-completion':   [['mechanical_completion_date','Mechanical Completion'],['electrical_completion_date','Electrical Completion'],['units','Units'],['contract_ref','Contract Ref.'],['client_name','Client'],['emirate','Emirate']],
  'handover-report':           [['handover_date','Handover Date'],['units','Units'],['contract_ref','Contract Ref.'],['client_name','Client'],['emirate','Emirate'],['salesperson','Salesperson']],
  'project-status':            [['project_status','Project Status'],['approval_date','Approval Date'],['units','Units'],['contract_ref','Contract Ref.'],['client_name','Client'],['emirate','Emirate']],
  'ins-quotes-units':          [['order_date','Order Date'],['quantity','Quantity'],['factory_ref','Factory Ref.'],['amount','Amount'],['supplier_name','Supplier']],
  'sea-costs':                 [['eta','ETA'],['etd','ETD'],['shipping_cost','Shipping Cost'],['factory_ref','Shipping Ref.'],['payment_status','Payment Status']],
  'factory-payments-register': [['payment_date','Payment Date'],['paid_amount','Paid Amount'],['factory_ref','Factory Ref.'],['supplier_name','Supplier'],['balance_amount','Outstanding (payables view)']],
  'service-register':          [['scheduled_date','Scheduled Date'],['contract_ref','Contract Ref.'],['client_name','Client'],['emirate','Emirate'],['maintenance_type','Type'],['last_service_date','Last Service Date'],['status','Status']],
  'amc-portfolio':             [['end_date','Current End'],['days_to_expiry','Days to Expiry'],['units','Units'],['client_name','Client'],['emirate','Emirate'],['renewal_status','Portfolio Status']],
  'amc-payments':              [['balance','Outstanding'],['new_amc_value','AMC Value'],['latest_payment_date','Last Payment'],['contract_ref','Contract Ref.'],['client_name','Client']],
  'callback-detail':           [['complaint_datetime','Complaint Date'],['client_name','Client'],['priority','Priority'],['callback_status','Status']],
  'payment-pending':           [['balance_receivable','Balance Receivable'],['received_amount','Received Amount'],['contract_value','Contract Value'],['contract_ref','Contract Ref.'],['client_name','Client'],['last_payment_date','Last Payment Date']],
  'client-payment-entry':      [['payment_date','Payment Date'],['contract_ref','Contract Ref.'],['client_name','Client Name'],['received_amount','Received Amount'],['balance_receivable','Balance Receivable']],
  'maintenance-expiring':      [['end_date','Current AMC End'],['days_to_expiry','Days to Expiry'],['client_name','Client'],['emirate','Emirate']],
  'cancelled-contracts':       [['cancellation_date','Cancellation Date'],['contract_value','Contract Value'],['contract_ref','Contract Ref.'],['client_name','Client']],
  'maintenance-cancelled':     [['cancellation_date','Cancellation Date'],['client_name','Client'],['emirate','Emirate']],
};
const EMIRATE_OPTS = ['Abu Dhabi','Ajman','Al Ain','Dibba','Dubai','Fujairah','Khorfakkan','RAK','Ras Al Khaimah','Sharjah','UAQ'];

const REPORT_MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const SALESPERSONS = ['SY','MM','NM','SS','MGMT'];
const CURRENT_YEAR = String(new Date().getFullYear());

// ── Collapse state (all collapsed by default) ─────────────────────────────────
const _collapsed = {};
for (const cat of REPORT_CATALOG) _collapsed[cat.key] = true;

// ── Search state ──────────────────────────────────────────────────────────────
let _searchTerm = '';

// ── Favorites & Recently Viewed (localStorage) ────────────────────────────────
function _getFavorites() {
  try { return JSON.parse(localStorage.getItem('rpt_favorites') || '[]'); } catch { return []; }
}
function _toggleFavorite(type) {
  const favs = _getFavorites();
  const idx = favs.indexOf(type);
  if (idx >= 0) favs.splice(idx, 1); else favs.unshift(type);
  try { localStorage.setItem('rpt_favorites', JSON.stringify(favs.slice(0, 10))); } catch {}
}
function _getRecentlyViewed() {
  try { return JSON.parse(localStorage.getItem('rpt_recently_viewed') || '[]'); } catch { return []; }
}
function _addRecentlyViewed(type) {
  const list = _getRecentlyViewed().filter(t => t !== type);
  list.unshift(type);
  try { localStorage.setItem('rpt_recently_viewed', JSON.stringify(list.slice(0, 6))); } catch {}
}

// ── Home Dashboard ─────────────────────────────────────────────────────────────
async function renderHome(root) {
  const content = document.getElementById('rpt-report-area') || document.getElementById('rpt-content');
  if (!content) return;
  ReportsState.type = null;
  ReportsState.category = null;

  const now = new Date();
  const curYear = String(now.getFullYear());
  const curMonth = String(now.getMonth() + 1).padStart(2, '0');
  const curMonthLabel = REPORT_MONTH_LABELS[now.getMonth()];

  const recentTypes = _getRecentlyViewed();
  const favTypes = _getFavorites();
  const recentReports = recentTypes.map(t => ALL_REPORTS.find(r => r.type === t)).filter(Boolean);
  const favReports = favTypes.map(t => ALL_REPORTS.find(r => r.type === t)).filter(Boolean);

  const FREQ_TYPES = ['monthly-management','monthly-sales','handover-report','monthly-maintenance','payment-pending','ins-quotes-units'];
  const freqReports = FREQ_TYPES.map(t => ALL_REPORTS.find(r => r.type === t)).filter(Boolean);

  const quickCard = r => `
    <div class="rpt-quick-card" data-type="${r.type}"
      style="border:1px solid var(--border);border-radius:8px;padding:12px 10px;cursor:pointer;
      transition:box-shadow .15s,border-color .15s;background:#fff;position:relative">
      <div style="display:flex;align-items:flex-start;gap:7px">
        <span style="font-size:16px;flex-shrink:0;margin-top:1px">${r.icon || '📄'}</span>
        <div style="min-width:0">
          <div style="font-size:12px;font-weight:600;color:#223;line-height:1.3">${esc(r.label)}</div>
          <div style="font-size:10px;color:#889;margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(r.subtitle || '')}</div>
        </div>
      </div>
    </div>`;

  const catCard = cat => {
    const COLOR_MAP = { management:'#6366f1', sales:'#0ea5e9', contracts:'#10b981', factory:'#f59e0b',
      maintenance:'#8b5cf6', callback:'#ef4444', accounts:'#ec4899', alerts:'#f97316', historical:'#94a3b8' };
    const col = COLOR_MAP[cat.key] || '#6366f1';
    return `<div class="rpt-cat-card" data-catkey="${cat.key}"
      style="border:1px solid var(--border);border-radius:8px;padding:12px 14px;cursor:pointer;
      transition:box-shadow .15s,border-color .15s;background:#fff;display:flex;align-items:center;gap:10px;
      border-left:3px solid ${col}">
      <span style="font-size:18px">${cat.icon}</span>
      <div style="min-width:0;flex:1">
        <div style="font-size:12px;font-weight:600;color:#223">${esc(cat.category.replace(/^[A-Z]\. /, ''))}</div>
        <div style="font-size:11px;color:#889;margin-top:1px">${cat.reports.length} report${cat.reports.length !== 1 ? 's' : ''}</div>
      </div>
      <span style="color:#ccd;font-size:13px">›</span>
    </div>`;
  };

  let html = `<div style="display:flex;flex-direction:column;gap:14px">`;

  // Hero header
  html += `<div class="panel" style="padding:16px 20px;background:linear-gradient(135deg,#1e3a5f 0%,#2563ad 100%);color:#fff;border:none">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-size:17px;font-weight:700">📊 Reports &amp; Analytics</div>
        <div style="font-size:12px;opacity:.8;margin-top:3px">Management Intelligence Dashboard</div>
      </div>
      <div style="font-size:12px;opacity:.75">${curMonthLabel} ${curYear}</div>
    </div>
  </div>`;

  // Favourites
  if (favReports.length) {
    html += `<div class="panel" style="padding:14px 16px">
      <div style="font-size:10px;font-weight:700;color:#99aabb;letter-spacing:.5px;margin-bottom:10px">⭐ FAVOURITES</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">
        ${favReports.map(r => quickCard(r)).join('')}
      </div>
    </div>`;
  }

  // Recently Viewed
  if (recentReports.length) {
    html += `<div class="panel" style="padding:14px 16px">
      <div style="font-size:10px;font-weight:700;color:#99aabb;letter-spacing:.5px;margin-bottom:10px">🕑 RECENTLY VIEWED</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">
        ${recentReports.map(r => quickCard(r)).join('')}
      </div>
    </div>`;
  }

  // KPI panel (filled async)
  html += `<div class="panel" id="rpt-home-kpis" style="padding:14px 16px">
    <div style="font-size:10px;font-weight:700;color:#99aabb;letter-spacing:.5px;margin-bottom:10px">📈 CURRENT MONTH OVERVIEW — ${curMonthLabel} ${curYear}</div>
    <div style="text-align:center;padding:20px;color:#bbb;font-size:12px">Loading KPIs…</div>
  </div>`;

  // Frequently Used
  html += `<div class="panel" style="padding:14px 16px">
    <div style="font-size:10px;font-weight:700;color:#99aabb;letter-spacing:.5px;margin-bottom:10px">⚡ FREQUENTLY USED</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">
      ${freqReports.map(r => quickCard(r)).join('')}
    </div>
  </div>`;

  // Browse by Category
  const activeCats = REPORT_CATALOG.filter(c => c.reports.length > 0);
  html += `<div class="panel" style="padding:14px 16px">
    <div style="font-size:10px;font-weight:700;color:#99aabb;letter-spacing:.5px;margin-bottom:10px">📁 BROWSE BY CATEGORY</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px">
      ${activeCats.map(c => catCard(c)).join('')}
    </div>
  </div>`;

  html += `</div>`;
  content.innerHTML = html;

  // Wire quick-card clicks
  const rootEl = root || document.getElementById('view-root') || document.body;
  content.querySelectorAll('.rpt-quick-card[data-type]').forEach(el => {
    el.addEventListener('click', () => {
      const type = el.dataset.type;
      setDefaultFilters(type);
      ReportsState.page = 1;
      _addRecentlyViewed(type);
      selectReport(type);
    });
    el.addEventListener('mouseenter', () => { el.style.boxShadow = '0 2px 8px rgba(0,0,0,.1)'; el.style.borderColor = '#2563ad'; });
    el.addEventListener('mouseleave', () => { el.style.boxShadow = ''; el.style.borderColor = ''; });
  });

  // Wire category card clicks — open that category
  content.querySelectorAll('.rpt-cat-card[data-catkey]').forEach(el => {
    el.addEventListener('click', () => selectCategory(el.dataset.catkey, rootEl));
    el.addEventListener('mouseenter', () => { el.style.boxShadow = '0 2px 8px rgba(0,0,0,.1)'; });
    el.addEventListener('mouseleave', () => { el.style.boxShadow = ''; });
  });

  // Async KPI load
  _loadHomeKpis(curYear, curMonth, curMonthLabel, rootEl);
}

async function _loadHomeKpis(year, month, monthLabel, rootEl) {
  const kpiDiv = document.getElementById('rpt-home-kpis');
  if (!kpiDiv) return;
  try {
    const data = await API.get(`/api/reports/monthly-management/data?year=${year}&month=${month}&page_size=1`);
    const s = data.summary || {};
    // 2026-09-29: unit-based (Monthly Management Report is unit-based; Factory Payment is the only amount)
    const kpis = [
      { label: 'New Sales (Units)', value: s.new_sales_units ?? '—', icon: '📄', color: '#10b981' },
      { label: 'AMC Renewals (Units)', value: s.amc_renewal_units ?? '—', icon: '🔄', color: '#8b5cf6' },
      { label: 'Ordered (Units)', value: s.ordered_units ?? '—', icon: '🏭', color: '#0ea5e9' },
      { label: 'Handover (Units)', value: s.handover_units ?? '—', icon: '🏁', color: '#2563ad' },
      { label: 'Maintenance Completion', value: s.completion_pct != null ? s.completion_pct + '%' : '—', icon: '✅', color: (s.completion_pct >= 80 ? '#10b981' : s.completion_pct >= 50 ? '#f59e0b' : '#ef4444') },
      { label: 'Factory Payment', value: s.factory_payment ?? '—', icon: '💵', color: '#f59e0b' },
    ];
    let html = `<div style="font-size:10px;font-weight:700;color:#99aabb;letter-spacing:.5px;margin-bottom:10px">📈 CURRENT MONTH OVERVIEW — ${monthLabel} ${year}</div>`;
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">`;
    html += kpis.map(k => `<div style="border:1px solid var(--border);border-radius:8px;padding:12px;background:#fff;border-left:3px solid ${k.color}">
      <div style="font-size:18px;margin-bottom:4px">${k.icon}</div>
      <div style="font-size:14px;font-weight:700;color:#223">${esc(String(k.value))}</div>
      <div style="font-size:10px;color:#889;margin-top:2px">${esc(k.label)}</div>
    </div>`).join('');
    html += `</div>`;
    html += `<div style="margin-top:10px;text-align:right"><a href="#" id="rpt-home-mgmt-link" style="font-size:11px;color:#2563ad;text-decoration:none">View Full Monthly Management Report →</a></div>`;
    kpiDiv.innerHTML = html;
    document.getElementById('rpt-home-mgmt-link')?.addEventListener('click', e => {
      e.preventDefault();
      setDefaultFilters('monthly-management');
      ReportsState.filters.year = year;
      ReportsState.filters.month = month;
      ReportsState.page = 1;
      _addRecentlyViewed('monthly-management');
      selectReport('monthly-management');
    });
  } catch {
    kpiDiv.innerHTML = `<div style="font-size:10px;font-weight:700;color:#99aabb;letter-spacing:.5px;margin-bottom:6px">📈 CURRENT MONTH OVERVIEW</div><div style="font-size:12px;color:#bbb;padding:6px">KPI data unavailable</div>`;
  }
}

// ── renderReports — main entry point ─────────────────────────────────────────
function renderReports(root) {
  root.innerHTML = `
    <div style="display:flex;gap:0;align-items:flex-start">
      <aside id="rpt-sidebar" style="width:210px;flex-shrink:0;border-right:1px solid var(--border);background:#f8fafc;position:sticky;top:0;align-self:flex-start;max-height:calc(100vh - 52px);overflow-y:auto">
        ${buildSidebar()}
      </aside>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column">
        <div id="rpt-cat-tabs" style="position:sticky;top:0;z-index:20;background:#fff;border-bottom:1px solid var(--border);min-height:44px;display:flex;align-items:stretch"></div>
        <div id="rpt-report-area" style="flex:1;padding:12px 14px"></div>
      </div>
    </div>
  `;
  wireSidebar(root);
  renderHome(root);
}

function buildSidebar() {
  const homeActive = !ReportsState.type;
  let html = `<div style="padding:10px 8px">`;

  // Home
  html += `<div id="rpt-home-btn" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:6px;
    background:${homeActive ? '#edf2fe' : 'transparent'};border-left:3px solid ${homeActive ? '#2563ad' : 'transparent'};transition:background .1s">
    <i data-lucide="layout-dashboard" style="width:15px;height:15px;color:${homeActive ? '#2563ad' : '#667'}"></i>
    <span style="font-size:12px;font-weight:${homeActive ? '700' : '500'};color:${homeActive ? '#1e3a8a' : '#334'}">Dashboard Home</span>
  </div>`;

  html += `<div style="border-top:1px solid var(--border);margin:4px 0 8px"></div>`;
  html += `<div style="font-size:9px;font-weight:700;color:#99aabb;letter-spacing:.6px;padding:2px 6px 6px;text-transform:uppercase">Report Categories</div>`;

  for (const cat of REPORT_CATALOG) {
    const hasActive = cat.key === ReportsState.category;
    const iconName = CATEGORY_ICON_MAP[cat.key] || 'folder';
    html += `<div class="rpt-cat-item" data-catkey="${cat.key}"
      style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:2px;
      background:${hasActive ? '#edf2fe' : 'transparent'};border-left:3px solid ${hasActive ? '#2563ad' : 'transparent'};
      transition:background .1s" title="${esc(cat.category)}">
      <i data-lucide="${iconName}" style="width:14px;height:14px;flex-shrink:0;color:${hasActive ? '#2563ad' : '#667'}"></i>
      <span style="font-size:14px;font-weight:${hasActive ? '700' : '600'};color:${hasActive ? '#1e3a8a' : '#334'};flex:1;line-height:1.3">${esc(cat.category.replace(/^[A-Z]\.\s*/, ''))}</span>
      ${cat.reports.length ? `<span style="font-size:10px;color:#aab;background:#f0f4f8;border-radius:8px;padding:1px 5px">${cat.reports.length}</span>` : ''}
    </div>`;
  }
  html += `</div>`;
  return html;
}

function wireSidebar(root) {
  const sidebar = document.getElementById('rpt-sidebar');
  if (!sidebar) return;
  if (window.lucide) window.lucide.createIcons();

  // Home button
  document.getElementById('rpt-home-btn')?.addEventListener('click', () => {
    ReportsState.type = null;
    ReportsState.category = null;
    const sb = document.getElementById('rpt-sidebar');
    if (sb) { sb.innerHTML = buildSidebar(); wireSidebar(root); }
    document.getElementById('rpt-cat-tabs').innerHTML = '';
    renderHome(root);
  });

  // Category item click
  sidebar.querySelectorAll('.rpt-cat-item').forEach(el => {
    el.addEventListener('click', () => selectCategory(el.dataset.catkey, root));
    el.addEventListener('mouseenter', () => { if (el.dataset.catkey !== ReportsState.category) el.style.background = '#f0f4f8'; });
    el.addEventListener('mouseleave', () => { if (el.dataset.catkey !== ReportsState.category) el.style.background = ''; });
  });
}

// ── Category selection ────────────────────────────────────────────────────────
function selectCategory(catKey, root) {
  ReportsState.category = catKey;
  const sb = document.getElementById('rpt-sidebar');
  if (sb) { sb.innerHTML = buildSidebar(); wireSidebar(root); }

  const cat = REPORT_CATALOG.find(c => c.key === catKey);
  if (!cat) return;

  // Render tab strip
  const tabsDiv = document.getElementById('rpt-cat-tabs');
  if (tabsDiv) { tabsDiv.innerHTML = buildCategoryTabs(catKey); wireCategoryTabs(root); }

  // If active report belongs to this category, don't reset
  const activeInCat = cat.reports.some(r => r.type === ReportsState.type);
  if (!activeInCat && cat.reports.length) {
    // Auto-open first report
    const first = cat.reports[0];
    setDefaultFilters(first.type);
    ReportsState.page = 1;
    _addRecentlyViewed(first.type);
    selectReport(first.type);
  }
}

// ── Category tab strip ────────────────────────────────────────────────────────
function buildCategoryTabs(catKey) {
  const cat = REPORT_CATALOG.find(c => c.key === catKey);
  if (!cat || !cat.reports.length) return '';

  const favTypes = _getFavorites();
  let html = `<div id="rpt-tab-scroll" style="display:flex;overflow-x:auto;flex:1;scrollbar-width:none;-ms-overflow-style:none">`;

  for (const r of cat.reports) {
    const active = r.type === ReportsState.type;
    const iconName = REPORT_ICON_MAP[r.type] || 'file';
    const isFav = favTypes.includes(r.type);
    html += `<div class="rpt-tab" data-type="${r.type}" title="${esc(r.subtitle||r.label)}"
      style="display:inline-flex;align-items:center;gap:6px;padding:0 14px;cursor:pointer;white-space:nowrap;
      border-bottom:3px solid ${active ? '#2563ad' : 'transparent'};
      color:${active ? '#1e3a8a' : '#445'};font-weight:${active ? '600' : '400'};font-size:12.5px;
      background:${active ? '#f0f5ff' : '#fff'};transition:all .12s;border-right:1px solid #f0f4f8;
      min-height:44px;flex-shrink:0">
      <i data-lucide="${iconName}" style="width:13px;height:13px;flex-shrink:0;color:${active ? '#2563ad' : '#889'}"></i>
      <span>${esc(r.label)}</span>
      <button class="rpt-tab-fav" data-favtype="${r.type}" title="${isFav ? 'Remove favourite' : 'Add to favourites'}"
        style="background:none;border:none;cursor:pointer;font-size:11px;padding:1px 2px;
        opacity:${isFav ? '1' : '0'};margin-left:2px;transition:opacity .15s;color:#f59e0b"
        onclick="event.stopPropagation()">★</button>
    </div>`;
  }

  html += `</div>`;

  // Category label on the right
  html += `<div style="display:flex;align-items:center;padding:0 12px;border-left:1px solid var(--border);background:#f8fafc;flex-shrink:0">
    <span style="font-size:10px;font-weight:700;color:#99aabb;letter-spacing:.4px;white-space:nowrap">${esc(cat.category)}</span>
  </div>`;

  return html;
}

function wireCategoryTabs(root) {
  const tabsDiv = document.getElementById('rpt-cat-tabs');
  if (!tabsDiv) return;
  if (window.lucide) window.lucide.createIcons();

  // Show star on hover
  tabsDiv.querySelectorAll('.rpt-tab').forEach(el => {
    const favBtn = el.querySelector('.rpt-tab-fav');
    el.addEventListener('mouseenter', () => { if (favBtn) favBtn.style.opacity = '1'; if (el.dataset.type !== ReportsState.type) el.style.background = '#f8fafc'; });
    el.addEventListener('mouseleave', () => { if (favBtn && !_getFavorites().includes(el.dataset.type)) favBtn.style.opacity = '0'; if (el.dataset.type !== ReportsState.type) el.style.background = '#fff'; });
    el.addEventListener('click', () => {
      const type = el.dataset.type;
      setDefaultFilters(type);
      ReportsState.page = 1;
      _addRecentlyViewed(type);
      selectReport(type);
      // Update tab active states without full rebuild
      tabsDiv.querySelectorAll('.rpt-tab').forEach(t => {
        const isActive = t.dataset.type === type;
        t.style.borderBottomColor = isActive ? '#2563ad' : 'transparent';
        t.style.color = isActive ? '#1e3a8a' : '#445';
        t.style.fontWeight = isActive ? '600' : '400';
        t.style.background = isActive ? '#f0f5ff' : '#fff';
        const ic = t.querySelector('i');
        if (ic) ic.style.color = isActive ? '#2563ad' : '#889';
      });
    });
  });

  // Favourite buttons in tabs
  tabsDiv.querySelectorAll('.rpt-tab-fav').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      _toggleFavorite(btn.dataset.favtype);
      const isFav = _getFavorites().includes(btn.dataset.favtype);
      btn.style.opacity = isFav ? '1' : '0';
      btn.title = isFav ? 'Remove favourite' : 'Add to favourites';
    });
  });

  // Scroll active tab into view
  const activeTab = tabsDiv.querySelector(`.rpt-tab[data-type="${ReportsState.type}"]`);
  if (activeTab) activeTab.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

// ── Sticky horizontal scrollbar ───────────────────────────────────────────────
// 2026-10-08: idempotent. Previously every report load (every filter change) attached a
// NEW ResizeObserver + two NEW scroll listeners to the same #rpt-table-wrap and never
// disconnected them, and syncSize wrote display/width on every observer tick (each
// write can resize the page → widths → observer again). Now: one observer + one pair of
// listeners per wrap element, rAF-throttled, DOM written only when a value changes,
// show/hide hysteresis, and scroll sync ignores sub-pixel differences (no ping-pong
// at 110 % / 125 % browser zoom).
let _rptStickyCur = null;
function initStickyScroll() {
  const wrap = document.getElementById('rpt-table-wrap');
  const bar  = document.getElementById('rpt-hscroll-bar');
  const inner = document.getElementById('rpt-hscroll-inner');
  if (!wrap || !bar || !inner) return;

  if (!document.getElementById('rpt-scroll-style')) {
    const s = document.createElement('style');
    s.id = 'rpt-scroll-style';
    s.textContent = '#rpt-table-wrap::-webkit-scrollbar{display:none}';
    document.head.appendChild(s);
  }

  // Already wired for this element → just re-measure once (content changed).
  if (wrap._rptSticky && wrap._rptSticky.bar === bar) { wrap._rptSticky.schedule(); return; }
  if (wrap._rptSticky) wrap._rptSticky.dispose();
  if (_rptStickyCur && _rptStickyCur.wrap !== wrap) _rptStickyCur.dispose();   // previous report's table (removed from DOM)

  let shown = bar.style.display !== 'none', lastW = -1, raf = 0;
  const syncSize = () => {
    raf = 0;
    if (!wrap.isConnected) { st.dispose(); return; }
    const sw = wrap.scrollWidth, cw = wrap.clientWidth;
    const want = shown ? sw > cw + 1 : sw > cw + 4;          // hysteresis: no flip-flop at the threshold
    if (want !== shown) { shown = want; bar.style.display = want ? '' : 'none'; }
    if (sw !== lastW) { lastW = sw; inner.style.width = sw + 'px'; }
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(syncSize); };
  let syncing = false;
  const onWrap = () => { if (syncing) return; if (Math.abs(bar.scrollLeft - wrap.scrollLeft) < 1) return; syncing = true; bar.scrollLeft = wrap.scrollLeft; syncing = false; };
  const onBar  = () => { if (syncing) return; if (Math.abs(wrap.scrollLeft - bar.scrollLeft) < 1) return; syncing = true; wrap.scrollLeft = bar.scrollLeft; syncing = false; };
  wrap.addEventListener('scroll', onWrap, { passive: true });
  bar.addEventListener('scroll', onBar, { passive: true });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  if (ro) ro.observe(wrap);
  const st = _rptStickyCur = wrap._rptSticky = { wrap, bar, schedule, dispose() {
    if (ro) ro.disconnect(); if (raf) cancelAnimationFrame(raf);
    wrap.removeEventListener('scroll', onWrap); bar.removeEventListener('scroll', onBar); wrap._rptSticky = null;
    if (_rptStickyCur === st) _rptStickyCur = null; } };
  schedule();
}

function setDefaultFilters(type) {
  // Snapshot / register-style reports open without a year; all trend reports open on the current year.
  const noYear = ['contracts-list','project-status','payment-pending'];
  ReportsState.filters = noYear.includes(type) ? {} : { year: CURRENT_YEAR };
  if (type === 'monthly-maintenance' || type === 'service-register') ReportsState.filters.month = String(new Date().getMonth() + 1).padStart(2, '0');
}

function selectReport(type) {
  ReportsState.type = type;
  const meta = ALL_REPORTS.find(r => r.type === type);
  const label = meta?.label || type;
  const source = meta?.source || '';
  const sourceColor = meta?.sourceColor || '#6366f1';

  // Ensure category is set and tabs rendered
  const catEntry = REPORT_CATALOG.find(c => c.reports.some(r => r.type === type));
  if (catEntry && catEntry.key !== ReportsState.category) {
    ReportsState.category = catEntry.key;
    const sb = document.getElementById('rpt-sidebar');
    if (sb) { sb.innerHTML = buildSidebar(); wireSidebar(null); }
    const tabsDiv = document.getElementById('rpt-cat-tabs');
    if (tabsDiv) { tabsDiv.innerHTML = buildCategoryTabs(catEntry.key); wireCategoryTabs(null); }
  } else if (catEntry) {
    // Just refresh tab active states
    wireCategoryTabs(null);
  }

  const target = document.getElementById('rpt-report-area') || document.getElementById('rpt-content');
  if (!target) return;

  target.innerHTML = `
    <div class="panel">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <h2 style="margin:0;font-size:16px">${esc(label)}</h2>
            ${source ? `<span style="font-size:10px;font-weight:600;letter-spacing:.3px;padding:2px 7px;border-radius:4px;background:${sourceColor}18;color:${sourceColor}">${esc(source)}</span>` : ''}
          </div>
          ${meta?.subtitle ? `<div style="font-size:12px;color:#778;margin-top:2px">${esc(meta.subtitle)}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <label style="font-size:12px;color:#667;cursor:pointer;display:flex;align-items:center;gap:4px;white-space:nowrap">
            <input type="checkbox" id="rpt-export-current-page"> Current page only
          </label>
          <button class="btn small" id="rpt-xlsx">⬇ Excel</button>
          <button class="btn small" id="rpt-pdf">⬇ PDF</button>
          <button class="btn small secondary" id="rpt-print">🖨 Print</button>
        </div>
      </div>
      <div class="toolbar" style="flex-wrap:wrap;gap:6px;align-items:center" id="rpt-filters">
        ${buildFilterBar(type)}
      </div>
      <div id="rpt-std-top"></div>
      <div id="rpt-summary" style="margin:8px 0;display:flex;flex-wrap:wrap;gap:6px"></div>
      <div style="position:relative">
        <div id="rpt-table-wrap" style="overflow-x:scroll;margin-top:4px;scrollbar-width:none;-ms-overflow-style:none">
          <div style="text-align:center;padding:32px;color:#99aabb">Loading…</div>
        </div>
        <div id="rpt-hscroll-bar" style="position:sticky;bottom:0;overflow-x:scroll;overflow-y:hidden;
          background:#f0f4f8;border-top:1px solid #dde3ec;height:16px;display:none;z-index:5">
          <div id="rpt-hscroll-inner" style="height:1px;width:100%"></div>
        </div>
      </div>
      <div id="rpt-pagination" style="margin-top:10px"></div>
    </div>
  `;
  wireFilters(type);
  // The technician Service Register always prints / exports every matching record of the month
  if (type === 'service-register') { const cp = document.getElementById('rpt-export-current-page'); if (cp) { cp.checked = false; cp.closest('label').style.display = 'none'; } }
  document.getElementById('rpt-xlsx').addEventListener('click', () => exportReport('xlsx'));
  document.getElementById('rpt-pdf').addEventListener('click', () => exportReport('pdf'));
  document.getElementById('rpt-print').addEventListener('click', printReport);
  const pgDiv = document.getElementById('rpt-pagination');
  pgDiv.addEventListener('click', handlePaginationClick);
  pgDiv.addEventListener('keydown', handlePaginationKeydown);
  loadReport();
}

// ── Pagination handlers ───────────────────────────────────────────────────────
function handlePaginationClick(e) {
  const btn = e.target.closest('button[data-pgact]');
  if (!btn || btn.disabled) return;
  const act = btn.dataset.pgact;
  if (act === 'size') { ReportsState.pageSize = parseInt(btn.dataset.sz, 10); ReportsState.page = 1; loadReport(); return; }
  if (act === 'goto-go') { handleGotoPage(); return; }
  collectFilters();
  const total = ReportsState.data ? ReportsState.data.total : 0;
  const totalPages = Math.max(1, Math.ceil(total / ReportsState.pageSize));
  if      (act === 'first') ReportsState.page = 1;
  else if (act === 'prev')  ReportsState.page = Math.max(1, ReportsState.page - 1);
  else if (act === 'next')  ReportsState.page = Math.min(totalPages, ReportsState.page + 1);
  else if (act === 'last')  ReportsState.page = totalPages;
  loadReport();
}

function handlePaginationKeydown(e) {
  if (e.key !== 'Enter') return;
  if (e.target.closest('input[data-pgact="goto-input"]')) handleGotoPage();
}

function handleGotoPage() {
  const input = document.getElementById('rpt-goto-input');
  if (!input) return;
  const total = ReportsState.data ? ReportsState.data.total : 0;
  const totalPages = Math.max(1, Math.ceil(total / ReportsState.pageSize));
  const val = parseInt(input.value, 10);
  if (!val || val < 1 || val > totalPages) { input.style.outline = '2px solid #e53e3e'; input.focus(); setTimeout(() => { input.style.outline = ''; }, 1500); return; }
  collectFilters();
  ReportsState.page = val;
  input.value = '';
  loadReport();
}

// ── Filter bar ────────────────────────────────────────────────────────────────
function buildFilterBar(type) {
  const config = FILTER_CONFIG[type] || [];
  const f = ReportsState.filters;
  const yearOpts = ['2026','2025','2024','2023','2022','2021'].map(y => `<option value="${y}" ${f.year === y ? 'selected' : ''}>${y}</option>`).join('');
  const monthOpts = [['','All Months'],...REPORT_MONTH_LABELS.map((l,i) => [String(i+1).padStart(2,'0'),l])].map(([v,l]) => `<option value="${v}" ${f.month === v ? 'selected' : ''}>${l}</option>`).join('');
  const spOpts = SALESPERSONS.map(s => `<option value="${s}" ${f.salesperson===s?'selected':''}>${s}</option>`).join('');
  const sortFields = REPORTS_SORT_OPTIONS[type] || [];
  const sortOpts = sortFields.map(([v,l]) => `<option value="${v}" ${f.sort_by===v?'selected':''}>${l}</option>`).join('');

  const PARTS = {
    search:       `<input type="text" id="rf-search" placeholder="Search…" value="${esc(f.search||'')}" style="min-width:180px">`,
    year:         `<select id="rf-year"><option value="">All Years</option>${yearOpts}</select>`,
    month:        `<select id="rf-month">${monthOpts}</select>`,
    date_from:    `<label style="font-size:12px;color:#667">From<input type="date" id="rf-date_from" value="${esc(f.date_from||'')}" style="margin-left:4px"></label>`,
    date_to:      `<label style="font-size:12px;color:#667">To<input type="date" id="rf-date_to" value="${esc(f.date_to||'')}" style="margin-left:4px"></label>`,
    salesperson:  `<select id="rf-salesperson"><option value="">All Sales</option>${spOpts}</select>`,
    status: type === 'service-register'
      ? `<select id="rf-status"><option value="">All Statuses</option>${['Scheduled','Completed','Partial (Serviced)','Postponed','Hold','Missed'].map(v => `<option ${f.status===v?'selected':''}>${v}</option>`).join('')}</select>`
      : type === 'callback-detail'
      ? `<select id="rf-status"><option value="">All Statuses</option>${['Open','Attended','Completed'].map(v => `<option ${f.status===v?'selected':''}>${v}</option>`).join('')}</select>`
      : type === 'quotations-register'
      ? `<select id="rf-status"><option value="">All Statuses</option>${[['quoted','Quoted'],['follow_up','Follow Up'],['negotiation','Negotiation'],['approved','Approved'],['lost','Lost'],['tender','Tender']].map(([v,l]) => `<option value="${v}" ${String(f.status||'').toLowerCase().replace(/\s+/g,'_')===v?'selected':''}>${l}</option>`).join('')}</select>`
      : `<input type="text" id="rf-status" placeholder="Status…" value="${esc(f.status||'')}" style="min-width:110px">`,
    contract_ref: `<input type="text" id="rf-contract_ref" placeholder="Contract Ref…" value="${esc(f.contract_ref||'')}" style="min-width:120px">`,
    quote_ref:    `<input type="text" id="rf-quote_ref" placeholder="Quote Ref…" value="${esc(f.quote_ref||'')}" style="min-width:120px">`,
    factory_ref:  `<input type="text" id="rf-factory_ref" placeholder="Factory Ref…" value="${esc(f.factory_ref||'')}" style="min-width:120px">`,
    client:       `<input type="text" id="rf-client" placeholder="Client…" value="${esc(f.client||'')}" style="min-width:120px">`,
    emirate:      `<select id="rf-emirate"><option value="">All Emirates</option>${EMIRATE_OPTS.map(v => `<option ${f.emirate===v?'selected':''}>${v}</option>`).join('')}</select>`,
    project_status: `<select id="rf-project_status"><option value="">All Project Status</option>${['Active','Hold','Delay','Cancelled'].map(v => `<option ${f.project_status===v?'selected':''}>${v}</option>`).join('')}</select>`,
    supplier:     `<input type="text" id="rf-supplier" placeholder="Supplier…" value="${esc(f.supplier||'')}" style="min-width:120px">`,
    shipping_status: `<select id="rf-shipping_status"><option value="">All Shipping Status</option>${['Shipped','Delivered','Delayed'].map(v => `<option ${f.shipping_status===v?'selected':''}>${v}</option>`).join('')}</select>`,
    delivery_status: `<select id="rf-delivery_status"><option value="">All Delivery Status</option>${['On Track','Delayed','Delivered'].map(v => `<option ${f.delivery_status===v?'selected':''}>${v}</option>`).join('')}</select>`,
    factory_table: `<select id="rf-factory_table"><option value="">All Sources</option>${[['ins_quotes','New Orders'],['otj_quotes','OTJ Orders'],['sea_costs','Shipping']].map(([v,l]) => `<option value="${v}" ${f.factory_table===v?'selected':''}>${l}</option>`).join('')}</select>`,
    technician:   `<input type="text" id="rf-technician" placeholder="Technician…" value="${esc(f.technician||'')}" style="min-width:120px">`,
    days:         `<select id="rf-days"><option value="30" ${f.days==='30'?'selected':''}>Expiring in 30 days</option><option value="60" ${f.days==='60'?'selected':''}>Expiring in 60 days</option><option value="90" ${(!f.days||f.days==='90')?'selected':''}>Expiring in 90 days</option><option value="180" ${f.days==='180'?'selected':''}>Expiring in 180 days</option></select>`,
    renewal_status: type === 'amc-portfolio'
      ? `<select id="rf-renewal_status"><option value="">All Portfolio Status</option>${['Active','Expired','Hold','Cancelled'].map(v => `<option ${f.renewal_status===v?'selected':''}>${v}</option>`).join('')}</select>`
      : `<select id="rf-renewal_status"><option value="">All AMC Status</option><option value="Active Maintenance" ${f.renewal_status==='Active Maintenance'?'selected':''}>Active Maintenance</option><option value="Expired / Renewal Required" ${f.renewal_status==='Expired / Renewal Required'?'selected':''}>Expired / Renewal Required</option><option value="Hold" ${f.renewal_status==='Hold'?'selected':''}>Hold</option></select>`,
    maintenance_type: `<select id="rf-maintenance_type"><option value="">All Types</option>${['Free AMC','Paid Comprehensive','Non-Comprehensive','One-Time Service'].map(t=>`<option value="${t}" ${f.maintenance_type===t?'selected':''}>${t}</option>`).join('')}</select>`,
    maintenance_status: `<select id="rf-maintenance_status"><option value="">All Statuses</option><option value="Pending" ${f.maintenance_status==='Pending'?'selected':''}>Pending</option><option value="Scheduled" ${f.maintenance_status==='Scheduled'?'selected':''}>Scheduled</option><option value="Completed" ${f.maintenance_status==='Completed'?'selected':''}>Completed</option><option value="Partially Completed" ${f.maintenance_status==='Partially Completed'?'selected':''}>Partially Completed</option><option value="Postponed" ${f.maintenance_status==='Postponed'?'selected':''}>Postponed</option><option value="Hold" ${f.maintenance_status==='Hold'?'selected':''}>Hold</option><option value="Missed" ${f.maintenance_status==='Missed'?'selected':''}>Missed</option></select>`,
    alert_status: `<select id="rf-alert_status"><option value="">All Alerts</option><option value="Upcoming" ${f.alert_status==='Upcoming'?'selected':''}>Upcoming</option><option value="Due Today" ${f.alert_status==='Due Today'?'selected':''}>Due Today</option><option value="Overdue" ${f.alert_status==='Overdue'?'selected':''}>Overdue</option><option value="Closed" ${f.alert_status==='Closed'?'selected':''}>Closed</option></select>`,
    scheduling_method: `<select id="rf-scheduling_method"><option value="">All Methods</option><option value="Automatic" ${f.scheduling_method==='Automatic'?'selected':''}>Automatic</option><option value="Manual" ${f.scheduling_method==='Manual'?'selected':''}>Manual</option></select>`,
    cancellation_type: `<select id="rf-cancellation_type"><option value="">All Types</option><option value="Cancelled" ${f.cancellation_type==='Cancelled'?'selected':''}>Cancelled</option><option value="Terminated" ${f.cancellation_type==='Terminated'?'selected':''}>Terminated</option></select>`,
    refund_status: `<select id="rf-refund_status"><option value="">All Refund Status</option><option value="No Refund" ${f.refund_status==='No Refund'?'selected':''}>No Refund</option><option value="Partial Refund" ${f.refund_status==='Partial Refund'?'selected':''}>Partial Refund</option><option value="Full Refund" ${f.refund_status==='Full Refund'?'selected':''}>Full Refund</option></select>`,
    show_cancelled: `<select id="rf-show_cancelled"><option value="active" ${(!f.show_cancelled||f.show_cancelled==='active')?'selected':''}>Active Orders</option><option value="all" ${f.show_cancelled==='all'?'selected':''}>All Orders</option><option value="cancelled" ${f.show_cancelled==='cancelled'?'selected':''}>Cancelled Only</option></select>`,
    production_status: `<input type="text" id="rf-production_status" placeholder="Prod. Status…" value="${esc(f.production_status||'')}" style="min-width:110px">`,
    factory_delivery_status: `<select id="rf-factory_delivery_status"><option value="">All Factory Status</option>${['Production','Under Production','Ready','Hold','Shipping','On Shipping','Delivered'].map(v => `<option ${f.factory_delivery_status===v?'selected':''}>${v}</option>`).join('')}</select>`,
    needs_review: `<select id="rf-needs_review"><option value="">All</option><option value="1" ${f.needs_review==='1'?'selected':''}>Needs Review</option><option value="0" ${f.needs_review==='0'?'selected':''}>OK</option></select>`,
    payment_type: type === 'factory-payments-register'
      ? `<select id="rf-payment_type"><option value="">All Payment Types</option>${['Advance','Final','Final Payment','Full Payment','Shipping Payment'].map(v => `<option ${f.payment_type===v?'selected':''}>${v}</option>`).join('')}</select>`
      : `<select id="rf-payment_type"><option value="">All Payment Types</option>${['Full Payment','Partial Payment','Reconciliation Adjustment'].map(v => `<option ${f.payment_type===v?'selected':''}>${v}</option>`).join('')}</select>`,
    payment_mode:    `<input type="text" id="rf-payment_mode" placeholder="Payment Mode…" value="${esc(f.payment_mode||'')}" style="min-width:110px">`,
    payment_status: (type === 'amc-payments' || type === 'amc-portfolio')
      ? `<select id="rf-payment_status"><option value="">All Payment Status</option>${['Paid','Partial','Unpaid'].map(v => `<option ${f.payment_status===v?'selected':''}>${v}</option>`).join('')}</select>`
      : type === 'sea-costs'
      ? `<select id="rf-payment_status"><option value="">All Payment Status</option>${['Unpaid','Partial','Full Paid'].map(v => `<option ${f.payment_status===v?'selected':''}>${v}</option>`).join('')}</select>`
      : `<select id="rf-payment_status"><option value="">All Payment Status</option><option value="Unpaid" ${f.payment_status==='Unpaid'?'selected':''}>Unpaid</option><option value="Partial Paid" ${f.payment_status==='Partial Paid'?'selected':''}>Partial Paid</option><option value="Full Paid" ${f.payment_status==='Full Paid'?'selected':''}>Full Paid</option><option value="Overpaid" ${f.payment_status==='Overpaid'?'selected':''}>Overpaid</option></select>`,
    contract_status: `<select id="rf-contract_status"><option value="">All Contract Status</option><option value="Active" ${f.contract_status==='Active'?'selected':''}>Active</option><option value="Completed" ${f.contract_status==='Completed'?'selected':''}>Completed</option><option value="Cancelled" ${f.contract_status==='Cancelled'?'selected':''}>Cancelled</option><option value="Terminated" ${f.contract_status==='Terminated'?'selected':''}>Terminated</option></select>`,
    view_mode: type === 'factory-payments-register'
      ? `<select id="rf-view_mode"><option value="" ${f.view_mode!=='payables'?'selected':''}>📋 Payment Transactions</option><option value="payables" ${f.view_mode==='payables'?'selected':''}>📊 Outstanding Payables</option></select>`
      : `<select id="rf-view_mode"><option value="detail" ${f.view_mode!=='summary'?'selected':''}>📋 Detail View</option><option value="summary" ${f.view_mode==='summary'?'selected':''}>📊 Summary View</option></select>`,
    priority:        `<select id="rf-priority"><option value="">All Priorities</option><option value="Normal" ${f.priority==='Normal'?'selected':''}>Normal</option><option value="Urgent" ${f.priority==='Urgent'?'selected':''}>Urgent</option><option value="Emergency" ${f.priority==='Emergency'?'selected':''}>Emergency</option></select>`,
    complaint_type:  `<input type="text" id="rf-complaint_type" placeholder="Complaint Type…" value="${esc(f.complaint_type||'')}" style="min-width:130px">`,
    sort_by:  sortFields.length ? `<select id="rf-sort_by"><option value="">Sort By…</option>${sortOpts}</select>` : '',
    sort_dir: sortFields.length ? `<select id="rf-sort_dir"><option value="desc" ${f.sort_dir!=='asc'?'selected':''}>↓ Desc</option><option value="asc" ${f.sort_dir==='asc'?'selected':''}>↑ Asc</option></select>` : '',
    activation_status: `<select id="rf-activation_status"><option value="">All Activation Status</option><option value="Active" ${f.activation_status==='Active'?'selected':''}>Active</option><option value="Inactive" ${f.activation_status==='Inactive'?'selected':''}>Inactive</option></select>`,
    amc_payment_status: `<select id="rf-amc_payment_status"><option value="">All Payment Status</option><option value="Paid" ${f.amc_payment_status==='Paid'?'selected':''}>Paid</option><option value="Unpaid" ${f.amc_payment_status==='Unpaid'?'selected':''}>Unpaid</option></select>`,
    amc_renewal_status: `<select id="rf-amc_renewal_status"><option value="">All Renewal Status</option><option value="Approved" ${f.amc_renewal_status==='Approved'?'selected':''}>Approved</option><option value="Under Review" ${f.amc_renewal_status==='Under Review'?'selected':''}>Under Review</option><option value="Pending" ${f.amc_renewal_status==='Pending'?'selected':''}>Pending</option></select>`,
  };
  return config.map(k => PARTS[k] || '').filter(Boolean).join('') +
    `<button class="btn small secondary" id="rpt-reset" style="margin-left:auto">Clear Filters</button>`;
}

function wireFilters(type) {
  const config = FILTER_CONFIG[type] || [];
  const reload = () => { collectFilters(); ReportsState.page = 1; loadReport(); };
  const selectKeys = ['year','month','salesperson','sort_by','sort_dir','show_cancelled',
    'maintenance_status','alert_status','maintenance_type','scheduling_method',
    'needs_review','payment_type','payment_status','contract_status','view_mode',
    'priority','days','renewal_status','activation_status','amc_payment_status','amc_renewal_status',
    'emirate','project_status','shipping_status','delivery_status','factory_table','factory_delivery_status'];
  const textKeys = ['search','status','contract_ref','quote_ref','factory_ref','client',
    'cancellation_type','refund_status','technician',
    'production_status','payment_mode','complaint_type','supplier'];

  if (config.includes('search')) { const el = document.getElementById('rf-search'); if (el) el.addEventListener('input', debounce(reload, 400)); }
  selectKeys.forEach(k => {
    if (!config.includes(k)) return;
    const el = document.getElementById('rf-' + k);
    if (el) el.addEventListener('change', reload);
  });
  textKeys.filter(k => k !== 'search').forEach(k => {
    if (!config.includes(k)) return;
    const el = document.getElementById('rf-' + k);
    if (el) el.addEventListener('input', debounce(reload, 400));
  });
  ['date_from','date_to'].forEach(k => {
    if (!config.includes(k)) return;
    const el = document.getElementById('rf-' + k);
    if (el) el.addEventListener('change', reload);
  });
  const resetBtn = document.getElementById('rpt-reset');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    setDefaultFilters(type);
    ReportsState.page = 1;
    selectReport(type);
    const sb = document.getElementById('rpt-sidebar');
    if (sb) { sb.innerHTML = buildSidebar(); wireSidebar(document.getElementById('view-root') || document.body); }
  });
}

function collectFilters() {
  const keys = ['search','year','month','date_from','date_to','salesperson','status',
    'contract_ref','quote_ref','factory_ref','client','show_cancelled','sort_by','sort_dir',
    'emirate','maintenance_type','maintenance_status','alert_status','technician',
    'scheduling_method','cancellation_type','refund_status',
    'production_status','factory_delivery_status','needs_review',
    'payment_type','payment_mode','payment_status','contract_status','view_mode',
    'priority','complaint_type','days','renewal_status',
    'activation_status','amc_payment_status','amc_renewal_status',
    'project_status','supplier','shipping_status','delivery_status','factory_table'];
  keys.forEach(k => { const el = document.getElementById('rf-' + k); if (el) ReportsState.filters[k] = el.value || ''; });
}

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadReport() {
  const { type, filters, page, pageSize } = ReportsState;
  if (!type) return;
  const params = new URLSearchParams({ page, page_size: pageSize });
  Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
  const wrap = document.getElementById('rpt-table-wrap');
  if (wrap) wrap.innerHTML = '<div style="text-align:center;padding:24px;color:#99aabb">Loading…</div>';
  try {
    const data = await API.get(`/api/reports/${type}/data?${params}`);
    ReportsState.data = data;
    renderTable(data);
    // Standard reports show KPI cards instead of summary chips
    renderSummary(data.std || data.report_type === 'monthly-management' ? {} : (data.summary || {}));
    renderPagination(data);
  } catch (err) {
    // 2026-09-29: a genuine load failure is an application error, not a filter problem —
    // show the real reason and a Retry button. (Empty results render "No records found"
    // via renderTable, never this block.)
    const msg = err && err.message ? err.message : 'Unknown error';
    const friendly = /unknown report type|not found/i.test(msg)
      ? 'This report is not available. Please select a report from the list.'
      : `The report could not be generated (${msg}).`;
    const topE = document.getElementById('rpt-std-top'); if (topE) topE.innerHTML = '';
    console.error('[Reports] load failed', type, err);
    if (wrap) wrap.innerHTML = `<div class="empty-state" style="color:#c0392b;padding:24px">
      <div style="font-size:20px;margin-bottom:8px">⚠️</div>
      <div style="font-weight:600;margin-bottom:4px">Unable to Load Report</div>
      <div style="font-size:13px;color:#888;margin-bottom:10px">${esc(friendly)}</div>
      <button class="btn secondary" id="rpt-retry">Retry</button>
    </div>`;
    const rb = document.getElementById('rpt-retry');
    if (rb) rb.addEventListener('click', () => loadReport());
    const pg = document.getElementById('rpt-pagination');
    if (pg) pg.innerHTML = '';
  }
}

// ── Cell rendering ────────────────────────────────────────────────────────────
const MONEY_RE = /value|amount|cost|paid|balance|outstanding|receivable|collected|receipt|payment/i;
const DATE_RE = /date|updated|arrival|datetime/i;
const SKIP_DATE_RE = /days|status|units|%/i;

const MONTH_NAMES_CELL = ['','January','February','March','April','May','June','July','August','September','October','November','December'];

function cellHtml(val, colName) {
  if (val === null || val === undefined || val === '') return '<td>-</td>';
  const s = String(val);
  if (colName.toLowerCase().includes('status') || colName.toLowerCase().includes('flag')) return `<td>${badge(s)}</td>`;
  if (MONEY_RE.test(colName) && !isNaN(Number(val)) && !String(val).includes('%')) {
    const currCode = colName.includes('(USD)') ? 'USD' : colName.includes('(AED)') ? 'AED' : '';
    const fmt = currCode ? `${currCode} ${fmtMoney(val)}` : fmtMoney(val);
    return `<td style="text-align:right">${fmt}</td>`;
  }
  if (DATE_RE.test(colName) && !SKIP_DATE_RE.test(colName)) return `<td>${fmtDate(s)}</td>`;
  if (typeof val === 'number') {
    // Year columns: never apply thousands separator (2026, not 2,026)
    if (/^year$/i.test(colName.trim())) return `<td style="text-align:right">${s}</td>`;
    // Month columns: convert numeric month to full name
    if (/^month$/i.test(colName.trim()) && val >= 1 && val <= 12)
      return `<td>${MONTH_NAMES_CELL[val]}</td>`;
    return `<td style="text-align:right">${val.toLocaleString()}</td>`;
  }
  return `<td>${esc(s)}</td>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// STANDARD REPORT TEMPLATE (2026-09-30) — one visual system for every report
//   Header (title · description · Excel | PDF | Print)  → Filters
//   → Executive KPI cards → ONE primary chart (⛶ presentation, click = drill-down)
//   → exact month table → secondary breakdowns (click = filter the whole report)
//   → data-quality notes → detailed register (only the register is paginated)
// Every number comes from the backend's single filtered population (reports/std.js).
// ══════════════════════════════════════════════════════════════════════════════
let _stdChart = null, _stdData = null;
const STD_TONES = { green: '#1e8449', blue: '#2563ad', purple: '#7c3aed', amber: '#d97706', teal: '#0e7e6e', red: '#c0392b', '': '#475569' };
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function stdCell(v, col) {
  const c = String(col || '');
  // Scheduled Date with no planned date → blank cell (no placeholder)
  if ((v === null || v === undefined || v === '') && c === 'Scheduled Date') return '<td></td>';
  if (v === null || v === undefined || v === '') return '<td style="color:#b0b8c4">—</td>';
  const s = String(v);
  if (/^\(.+\)$/.test(s)) return `<td style="color:#98a2b3;white-space:nowrap" title="Legacy status text — no date recorded">${esc(s)}</td>`;
  if (ISO_DATE_RE.test(s) && s.length <= 19) return `<td style="white-space:nowrap">${fmtDateDMY(s.slice(0, 10))}${s.length > 10 ? ' ' + esc(s.slice(11, 16)) : ''}</td>`;
  if (/status|coverage/i.test(c) && !/date/i.test(c)) return `<td>${badge(s)}</td>`;
  if (typeof v === 'number') {
    if (MONEY_RE.test(c) && !/units|qty|payments|renewals|records|projects|days/i.test(c)) {
      const cur = c.includes('(USD)') ? 'USD ' : c.includes('(AED)') ? 'AED ' : '';
      return `<td style="text-align:right;white-space:nowrap">${cur}${fmtMoney(v)}</td>`;
    }
    return `<td style="text-align:right">${v.toLocaleString()}</td>`;
  }
  if (/client|description|project|remarks|issue|action|reason/i.test(c)) return `<td style="max-width:${c === 'Client' ? 320 : 240}px;min-width:${c === 'Client' ? 180 : 0}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s)}">${esc(s)}</td>`;
  return `<td>${esc(s)}</td>`;
}

function _stdKpiHtml(k) {
  const col = STD_TONES[k.tone] || STD_TONES[''];
  return `<div style="background:#fff;border:1px solid var(--color-border,#dde3ec);border-left:3px solid ${col};border-radius:8px;padding:9px 13px;min-width:0">
    <div style="font-size:10.5px;color:#667;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(k.label)}">${esc(k.label)}</div>
    <div style="font-size:20px;font-weight:700;color:${col};line-height:1.3;white-space:nowrap">${esc(k.display)}${k.unit ? ` <span style="font-size:11px;font-weight:600;color:#889">${esc(k.unit)}</span>` : ''}</div>
    ${k.sub ? `<div style="font-size:10.5px;color:#99a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(k.sub)}">${esc(k.sub)}</div>` : ''}</div>`;
}

function _stdChartConfig(d, big) {
  const ch = d.chart;
  const sel = ch.highlight;
  const hasY1 = ch.datasets.some(ds => ds.axis === 'y1');
  const fs = big ? 14 : 11;
  const datasets = ch.datasets.map(ds => {
    const base = { label: ds.label, data: ds.data, type: ds.type || 'bar', order: ds.type === 'line' ? 1 : 2 };
    if (ds.type === 'line') return { ...base, borderColor: ds.color, backgroundColor: ds.color, borderWidth: 2, pointRadius: 3, tension: .25, yAxisID: ch.horizontal ? undefined : (ds.axis || 'y') };
    const bg = ds.colors ? ds.colors : (sel != null && !ch.stacked ? ds.data.map((_, i) => i === sel ? ds.color : ds.color + '55') : ds.color);
    return { ...base, backgroundColor: bg, borderRadius: 3, maxBarThickness: 44, stack: ds.stack, ...(ch.horizontal ? {} : { yAxisID: ds.axis || 'y' }) };
  });
  const scales = ch.horizontal
    ? { x: { beginAtZero: true, stacked: !!ch.stacked, ticks: { precision: 0, font: { size: fs } }, title: { display: !!ch.y_title, text: ch.y_title } },
        y: { stacked: !!ch.stacked, ticks: { font: { size: fs } } } }
    : { x: { stacked: !!ch.stacked, ticks: { font: { size: fs } } },
        y: { beginAtZero: true, stacked: !!ch.stacked, ticks: { font: { size: fs } }, title: { display: !!ch.y_title, text: ch.y_title } },
        ...(hasY1 ? { y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { font: { size: fs } }, title: { display: !!ch.y1_title, text: ch.y1_title } } } : {}) };
  return {
    type: 'bar', data: { labels: ch.labels, datasets },
    options: { responsive: true, maintainAspectRatio: false, resizeDelay: 150, animation: { duration: big ? 0 : 400 },
      indexAxis: ch.horizontal ? 'y' : 'x',
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: fs } } },
        tooltip: { callbacks: { footer: () => ch.drill ? 'Click for details' : '' } } },
      scales,
      onClick: (evt, els) => { if (els && els.length) _stdDrill(els[0].index); } },
  };
}

function renderStandardReport(data) {
  _stdData = data;
  const top = document.getElementById('rpt-std-top');
  const wrap = document.getElementById('rpt-table-wrap');
  if (!top || !wrap) return;
  const card = (inner, extra = '') => `<div style="border:1px solid var(--color-border,#dde3ec);border-radius:8px;padding:12px 14px;background:#fff;${extra}">${inner}</div>`;
  const h = (t, sub) => `<div style="font-weight:700;color:#0f2d5e;font-size:13.5px">${esc(t)}</div>${sub ? `<div style="font-size:11.5px;color:#778;margin-top:1px">${esc(sub)}</div>` : ''}`;
  let html = '';
  if (data.description) html += `<div style="font-size:12px;color:#445;background:#f4f7fb;border:1px solid #e3e9f2;border-radius:6px;padding:5px 10px;margin-bottom:10px">
      <b>Measures:</b> ${esc(data.description)}${data.metric ? ` · <b>Primary metric:</b> ${esc(data.metric)}` : ''}</div>`;
  if (data.kpis && data.kpis.length) html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:8px;margin-bottom:12px">${data.kpis.map(_stdKpiHtml).join('')}</div>`;
  if (data.chart) {
    const empty = !data.chart.datasets.some(ds => ds.data.some(v => Number(v) > 0));
    html += card(`<div style="display:flex;align-items:flex-start;gap:8px">${h(data.chart.title, data.chart.subtitle)}
        <button type="button" id="std-present" title="Presentation View" aria-label="Presentation View" style="margin-left:auto;background:#f4f7fb;border:1px solid #c8d6e5;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:14px;line-height:1">⛶</button></div>
      <div id="std-chart-box" style="${_stdChartBoxStyle(data.chart)}">
        ${empty ? '<div class="empty-state" style="padding-top:110px">No records found for the selected filters.</div>' : '<canvas id="std-chart"></canvas>'}</div>`, 'margin-bottom:12px');
  }
  if (data.month_table) {
    const mt = data.month_table;
    html += card(`${h(mt.title)}<div style="overflow-x:auto;margin-top:8px"><table class="data-table" style="font-size:12.5px">
      <thead><tr>${mt.columns.map((c, i) => `<th style="${i ? 'text-align:right' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${mt.rows.map((r, i) => `<tr data-mi="${i}" style="${mt.highlight === i ? 'background:#eef5ff;font-weight:600;' : ''}${mt.drill ? 'cursor:pointer' : ''}" ${mt.drill ? 'title="Click for details"' : ''}>${r.map((v, j) => `<td style="${j ? 'text-align:right' : ''}">${esc(String(v))}</td>`).join('')}</tr>`).join('')}</tbody>
      ${mt.total ? `<tfoot><tr style="font-weight:700;background:#f4f8fd">${mt.total.map((v, j) => `<td style="${j ? 'text-align:right' : ''}">${esc(String(v))}</td>`).join('')}</tr></tfoot>` : ''}
      </table></div>`, 'margin-bottom:12px');
  }
  if (data.breakdowns && data.breakdowns.length) {
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:12px;margin-bottom:12px">` +
      data.breakdowns.map((b, bi) => card(`${h(b.title, b.drill_param ? 'Click a row to filter the whole report' : '')}
        ${b.rows.length ? `<div style="overflow-x:auto;margin-top:8px"><table class="data-table" style="font-size:12.5px"><thead><tr>${b.columns.map((c, i) => `<th style="${i ? 'text-align:right' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${b.rows.map(r => `<tr ${b.drill_param && r[0] !== 'Total' && r[0] !== 'Not set' ? `class="std-bd-row" data-bi="${bi}" data-v="${esc(String(r[0]))}" style="cursor:pointer"` : ''}>${r.map((v, i) => `<td style="${i ? 'text-align:right' : ''}">${i === 0 && /status/i.test(b.columns[0]) ? badge(String(v)) : esc(String(v))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
          : '<div class="empty-state">No records found for the selected filters.</div>'}`)).join('') + `</div>`;
  }
  (data.notes || []).forEach((n, ni) => {
    html += `<div style="font-size:12px;color:#8a6d00;background:#fffaeb;border:1px solid #f3dea0;border-radius:6px;padding:6px 10px;margin-bottom:8px">⚠ ${esc(n.text)}
      ${n.rows && n.rows.length ? ` <a href="#" class="std-note-link" data-ni="${ni}">View records</a>` : ''}</div>`;
  });
  html += `<div style="display:flex;align-items:baseline;gap:8px;margin:6px 0 4px"><div style="font-weight:700;color:#0f2d5e;font-size:13.5px">${esc(data.register_title || 'Detailed Register')}</div>
    <div style="font-size:11.5px;color:#889">${(data.total || 0).toLocaleString()} record(s)</div></div>`;
  // 2026-10-08: keep the LIVE chart (canvas + Chart.js instance) when the same report is
  // re-rendered (filter change / page change) and update it in place, instead of
  // destroy → recreate → re-animate from zero on every load.
  const sig = data.chart ? _stdChartSig(data) : null;
  const keepBox = (_stdChart && sig && _stdChartSigLive === sig && _stdChart.canvas && _stdChart.canvas.isConnected)
    ? document.getElementById('std-chart-box') : null;
  if (keepBox) keepBox.remove();          // detach (instance stays alive) before the section is rebuilt
  top.innerHTML = html;

  // Register
  if (!data.rows || !data.rows.length) {
    wrap.innerHTML = `<div class="empty-state">${esc(data.empty_message || 'No records found for the selected filters.')}</div>`;
  } else {
    const th = 'white-space:nowrap;position:sticky;top:0;z-index:2;background:#f0f4f8;box-shadow:0 1px 0 #dde3ec';
    const histCol = ['payment-pending', 'client-payment-entry'].includes(data.report_type) && /contract ref/i.test(data.columns[data.report_type === 'payment-pending' ? 0 : 2] || '');
    const refIdx = data.report_type === 'payment-pending' ? 0 : 2;
    wrap.innerHTML = `<table class="data-table" id="rpt-table" style="min-width:100%;font-size:12.5px"><thead><tr>${data.columns.map(c => `<th style="${th}">${esc(c)}</th>`).join('')}${histCol ? `<th style="${th}">History</th>` : ''}</tr></thead>
      <tbody>${data.rows.map(r => `<tr>${r.map((v, i) => stdCell(v, data.columns[i])).join('')}${histCol ? `<td>${r[refIdx] ? `<button class="btn small secondary std-hist" data-ref="${esc(String(r[refIdx]))}" style="padding:2px 8px;font-size:11px">View</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table>`;
    wrap.querySelectorAll('.std-hist').forEach(b => b.addEventListener('click', () => showPaymentHistoryModal(b.dataset.ref)));
  }

  // Wiring
  top.querySelectorAll('tr[data-mi]').forEach(tr => { if (data.month_table && data.month_table.drill) tr.addEventListener('click', () => _stdDrill(Number(tr.dataset.mi))); });
  top.querySelectorAll('.std-bd-row').forEach(tr => tr.addEventListener('click', () => {
    const b = data.breakdowns[Number(tr.dataset.bi)];
    _stdApplyFilter(b.drill_param, tr.dataset.v);
  }));
  top.querySelectorAll('.std-note-link').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const n = data.notes[Number(a.dataset.ni)];
    openModal(`<h3 style="margin:0 0 6px">${esc(n.title || 'Data quality')}</h3><div style="font-size:12px;color:#556;margin-bottom:8px">${esc(n.text)}</div>
      <div style="max-height:60vh;overflow:auto"><table class="data-table" style="font-size:12.5px"><thead><tr>${n.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${n.rows.map(r => `<tr>${r.map((v, i) => stdCell(v, n.columns[i])).join('')}</tr>`).join('')}</tbody></table></div>
      <div style="text-align:right;margin-top:10px"><button class="btn secondary" onclick="closeModal()">Close</button></div>`, { wide: true });
  }));
  _stdMountChart(data, sig, keepBox);
  document.getElementById('std-present')?.addEventListener('click', () => {
    if (typeof _mdashOpenPresentation !== 'function' || !data.chart) return;
    _mdashOpenPresentation(`${data.title} — ${data.chart.title}`, bodyEl => {
      bodyEl.innerHTML = `<div style="font-size:13px;color:#556;margin-bottom:8px">${esc(data.chart.subtitle || '')}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin-bottom:10px">${(data.kpis || []).slice(0, 5).map(_stdKpiHtml).join('')}</div>
        <div style="position:relative;flex:1;min-height:0;min-width:0;width:100%;overflow:hidden"><canvas id="std-chart-big"></canvas></div>`;
      _stdDestroyBig();
      const c = document.getElementById('std-chart-big');
      if (c && window.Chart) _stdChartBig = new Chart(c.getContext('2d'), _stdChartConfig(data, true));
      return _stdDestroyBig;               // called once when Presentation View closes
    });
  });
}

// ── Standard chart lifecycle (2026-10-08) ─────────────────────────────────────
// ONE Chart.js instance for #std-chart. Created once per report/chart shape; data
// changes update it in place (chart.update('none')). The box has a fixed height,
// width:100% / min-width:0 / overflow:hidden and CSS containment, so the canvas can
// never feed its own size back into its container (no ResizeObserver loop), and
// Chart.js resize events are debounced (resizeDelay). A render-sequence token stops
// a late Chart.js script load from drawing on a canvas of an older render.
let _stdChartSigLive = null, _stdRenderSeq = 0, _stdChartBig = null;
const _stdChartStats = window.__shChartStats = window.__shChartStats || { created: 0, updated: 0, destroyed: 0 };
function _stdChartBoxStyle(ch) {
  const hgt = ch.horizontal ? Math.max(200, ch.labels.length * 38 + 60) : 300;
  return `position:relative;height:${hgt}px;width:100%;min-width:0;overflow:hidden;contain:layout size;margin-top:8px`;
}
function _stdChartSig(d) {
  const ch = d.chart;
  return [d.report_type, ch.horizontal ? 'h' : 'v', ch.stacked ? 's' : '', ch.labels.join('|'), ch.datasets.map(ds => `${ds.label}:${ds.type || 'bar'}:${ds.axis || ''}`).join('|')].join('§');
}
function _stdDestroyChart() {
  if (_stdChart) { try { _stdChart.destroy(); _stdChartStats.destroyed++; } catch (_) {} }
  _stdChart = null; _stdChartSigLive = null;
}
function _stdDestroyBig() { if (_stdChartBig) { try { _stdChartBig.destroy(); } catch (_) {} _stdChartBig = null; } }
function _stdMountChart(data, sig, keepBox) {
  const seq = ++_stdRenderSeq;
  const box = document.getElementById('std-chart-box');
  const canvas = document.getElementById('std-chart');
  if (!data.chart || !box || !canvas) { if (keepBox) keepBox.remove(); _stdDestroyChart(); return; }   // no chart / empty state
  if (keepBox && _stdChart) {
    box.replaceWith(keepBox);
    keepBox.setAttribute('style', _stdChartBoxStyle(data.chart));
    const cfg = _stdChartConfig(data, false);
    _stdChart.data.labels = cfg.data.labels;
    cfg.data.datasets.forEach((ds, i) => { if (_stdChart.data.datasets[i]) Object.assign(_stdChart.data.datasets[i], ds); });
    _stdChart.options = cfg.options;
    _stdChart.update('none');
    _stdChartStats.updated++;
    return;
  }
  _stdDestroyChart();
  const draw = () => {
    if (seq !== _stdRenderSeq) return;                         // a newer render owns the canvas
    const c = document.getElementById('std-chart');
    if (!c || !window.Chart) return;
    const existing = typeof Chart.getChart === 'function' ? Chart.getChart(c) : null;   // never two instances on one canvas
    if (existing) { try { existing.destroy(); } catch (_) {} }
    _stdChart = new Chart(c.getContext('2d'), _stdChartConfig(data, false));
    _stdChartSigLive = sig;
    _stdChartStats.created++;
  };
  (typeof _loadChartJs === 'function' ? _loadChartJs() : Promise.resolve()).then(draw).catch(() => {
    if (seq !== _stdRenderSeq) return;
    const c = document.getElementById('std-chart'); if (c) c.parentElement.innerHTML = '<div class="empty-state">Chart library could not be loaded — exact figures are in the tables below.</div>';
  });
}

// Breakdown / chart click on a dimension → filter the WHOLE report (KPIs, chart, register, exports).
function _stdApplyFilter(param, value) {
  if (!param) return;
  ReportsState.filters[param] = value;
  ReportsState.page = 1;
  const el = document.getElementById('rf-' + param);
  if (el) {
    if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === value)) el.insertAdjacentHTML('beforeend', `<option value="${esc(value)}">${esc(value)}</option>`);
    el.value = value;
  }
  toast(`Filtered by ${param.replace(/_/g, ' ')}: ${value}`);
  loadReport();
}

// Chart / month-table drill-down. Month drill opens the underlying records and
// shows whether they reconcile with the aggregate clicked.
async function _stdDrill(index) {
  const d = _stdData;
  if (!d || !d.chart || !d.chart.drill) return;
  if (d.chart.drill !== 'month') { _stdApplyFilter(d.chart.drill, d.chart.labels[index]); return; }
  const month = String(index + 1).padStart(2, '0');
  const bars = d.chart.datasets.filter(ds => (ds.type || 'bar') === 'bar');
  const agg = d.chart.reconcile === false ? null
    : typeof d.chart.reconcile === 'number' ? (Number(d.chart.datasets[d.chart.reconcile].data[index]) || 0)
    : bars.reduce((s, ds) => s + (Number(ds.data[index]) || 0), 0);
  const params = new URLSearchParams({ page: 1, page_size: 9999 });
  Object.entries(ReportsState.filters).forEach(([k, v]) => { if (v) params.set(k, v); });
  params.set('month', month);
  openModal(`<h3 style="margin:0 0 4px">${esc(d.chart.labels[index])} ${esc(d.year || '')} — details</h3><div id="std-drill-body"><div class="loading-state">Loading…</div></div>`, { wide: true });
  try {
    const r = await API.get(`/api/reports/${ReportsState.type}/data?${params}`);
    // 2026-10-07: reports whose month drill is a transaction list (AMC Payments) name the
    // breakdown to show instead of the register; reconciliation uses that list's total.
    const dt = d.chart.drill_table ? (r.breakdowns || []).find(b => b.key === d.chart.drill_table) : null;
    const tot = dt ? dt.total_value : r.scope_total;
    const ok = agg == null || tot == null ? null : Math.abs(Number(tot) - agg) < 0.01;
    const body = document.getElementById('std-drill-body');
    if (!body) return;
    if (dt) {
      body.innerHTML = `<div style="font-size:12.5px;margin:4px 0 8px;color:#334">${esc(dt.title)}</div>
        ${ok === null ? '' : `<div style="font-size:12px;margin-bottom:8px;color:${ok ? '#1e8449' : '#b03a2e'}">${ok ? '✓ These records reconcile with the chart value' : `⚠ Records total ${tot} vs chart ${agg} — please report`}</div>`}
        <div style="max-height:58vh;overflow:auto">${dt.rows.length > 1 ? `<table class="data-table" style="font-size:12.5px"><thead><tr>${dt.columns.map(c => `<th style="white-space:nowrap">${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${dt.rows.map(row => `<tr${row[0] === 'Total' ? ' style="font-weight:700;background:#f4f7fb"' : ''}>${row.map(v => `<td>${esc(String(v))}</td>`).join('')}</tr>`).join('')}</tbody></table>` : `<div class="empty-state">${esc(dt.empty_message || 'No records found for this month.')}</div>`}</div>
        <div style="text-align:right;margin-top:10px"><button class="btn secondary" onclick="closeModal()">Close</button></div>`;
      return;
    }
    body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin:6px 0 10px">${(r.kpis || []).slice(0, 4).map(_stdKpiHtml).join('')}</div>
      ${ok === null ? '' : `<div style="font-size:12px;margin-bottom:8px;color:${ok ? '#1e8449' : '#b03a2e'}">${ok ? '✓ These records reconcile with the chart value' : `⚠ Records total ${r.scope_total} vs chart ${agg} — please report`}</div>`}
      <div style="max-height:58vh;overflow:auto">${r.rows && r.rows.length ? `<table class="data-table" style="font-size:12.5px"><thead><tr>${r.columns.map(c => `<th style="white-space:nowrap">${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${r.rows.map(row => `<tr>${row.map((v, i) => stdCell(v, r.columns[i])).join('')}</tr>`).join('')}</tbody></table>` : '<div class="empty-state">No records found for the selected filters.</div>'}</div>
      <div style="text-align:right;margin-top:10px"><button class="btn secondary" onclick="closeModal()">Close</button></div>`;
  } catch (e) {
    const body = document.getElementById('std-drill-body');
    if (body) body.innerHTML = `<div class="empty-state" style="color:#c0392b">Unable to load report. ${esc(e.message || '')}</div>`;
  }
}

// Standard print body — same sections as the screen (chart printed as an image).
function buildStandardPrintHtml(d) {
  const kp = (d.kpis || []).map(k => `<td style="padding:4px 8px;border:1px solid #dde"><div style="font-size:7.5pt;color:#556">${esc(k.label)}</div><div style="font-size:11pt;font-weight:700">${esc(k.display)}${k.unit ? ' ' + esc(k.unit) : ''}</div></td>`);
  const rowsOf = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
  let html = d.description ? `<div style="font-size:8.5pt;color:#445;margin-bottom:6px">Measures: ${esc(d.description)}</div>` : '';
  if (kp.length) { const per = Math.ceil(kp.length / Math.ceil(kp.length / 5));   // balanced rows, e.g. 6 → 3+3, 7 → 4+3
    html += `<div style="margin-bottom:8px">${rowsOf(kp, per).map(r => `<table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:-1px"><tr>${r.join('')}</tr></table>`).join('')}</div>`; }
  const cv = document.getElementById('std-chart');
  if (d.chart && cv && cv.toDataURL) {
    try { html += `<div style="font-weight:700;margin:4px 0">${esc(d.chart.title)}</div><img src="${cv.toDataURL('image/png')}" style="width:100%;max-height:260px;object-fit:contain;margin-bottom:8px">`; } catch (_) {}
  }
  const tbl = (title, cols, rows, total) => `<div style="font-weight:700;margin:8px 0 3px">${esc(title)}</div><table class="sh-print-table" style="font-size:8pt"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(v => `<td>${esc(String(v))}</td>`).join('')}</tr>`).join('')}${total ? `<tr style="font-weight:700">${total.map(v => `<td>${esc(String(v))}</td>`).join('')}</tr>` : ''}</tbody></table>`;
  if (d.month_table) html += tbl(d.month_table.title, d.month_table.columns, d.month_table.rows, d.month_table.total);
  (d.breakdowns || []).forEach(b => { html += tbl(b.title, b.columns, b.rows); });
  (d.notes || []).forEach(n => { html += `<div style="font-size:8pt;color:#8a6d00;margin-top:6px">⚠ ${esc(n.text)}</div>`; });
  html += `<div style="font-weight:700;margin:10px 0 3px">${esc(d.register_title || 'Detailed Register')} (${(d.rows || []).length} records)</div>`;
  html += d.rows && d.rows.length
    ? `<table class="sh-print-table" style="font-size:7.5pt"><thead><tr>${d.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${d.rows.map((r, i) =>
        `<tr${i % 2 ? ' class="sh-print-alt"' : ''}>${r.map((v, j) => stdCell(v, d.columns[j]).replace(/max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap/, '')).join('')}</tr>`).join('')}</tbody></table>`
    : '<p class="sh-print-empty">No records found for the selected filters.</p>';
  return html;
}


// Client payment history (drill-down from Client Receivables / Transactions registers)
async function showPaymentHistoryModal(contractRef) {
  openModal(`
    <div style="max-width:820px;width:100%">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h3 style="margin:0;font-size:16px">Payment History — ${esc(contractRef)}</h3>
        <button class="btn small secondary" onclick="closeModal()" style="padding:4px 10px">✕ Close</button>
      </div>
      <div id="pp-hist-body"><div style="text-align:center;padding:20px;color:#99aabb">Loading…</div></div>
    </div>
  `);
  try {
    const data = await API.get('/api/accounts/client-payments?contract_ref=' + encodeURIComponent(contractRef) + '&page_size=999&sort=entry_date&dir=asc');
    const payments = data.rows || [];
    const histEl = document.getElementById('pp-hist-body');
    if (!histEl) return;
    if (!payments.length) { histEl.innerHTML = '<div class="empty-state">No payment records found for this contract.</div>'; return; }
    let bodyHtml = `<table class="data-table" style="width:100%;font-size:13px">
      <thead><tr><th>Payment Ref.</th><th>Payment Date</th><th style="text-align:right">Received (AED)</th><th>Type</th><th>Mode</th><th>Received By</th><th>Remarks</th></tr></thead><tbody>`;
    let total = 0;
    for (const p of payments) {
      const amt = parseFloat(p.received_amount) || 0;
      total += amt;
      bodyHtml += `<tr><td>${esc(p.payment_ref||'-')}</td><td>${esc(p.entry_date||'-')}</td><td style="text-align:right">AED ${fmtMoney(amt)}</td><td>${esc(p.payment_type||'-')}</td><td>${esc(p.payment_mode||'-')}</td><td>${esc(p.received_by||'-')}</td><td>${esc(p.remarks||'-')}</td></tr>`;
    }
    bodyHtml += `</tbody></table><div style="text-align:right;font-weight:700;padding:10px 0 0;font-size:14px;color:#223">Total Received: AED ${fmtMoney(total)} &nbsp;|&nbsp; ${payments.length} payment(s)</div>`;
    histEl.innerHTML = bodyHtml;
  } catch(e) {
    const histEl = document.getElementById('pp-hist-body');
    if (histEl) histEl.innerHTML = `<div class="empty-state" style="color:#c00">Error: ${esc(e.message)}</div>`;
  }
}

// Technician print sheet — only the 10 register columns, all rows of the selected month,
// month totals at the top, generous row height for manual marking, sign-off footer.
function buildServiceRegisterPrintHtml(d) {
  const s = d.summary || {};
  const today = new Date();
  const pd = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
  const W = { 'S. No.': '4%', 'Contract Ref.': '9%', 'Client': '22%', 'Emirate': '8%', 'Type': '10%', 'Period': '9%', 'Last Service Date': '9%', 'Scheduled Date': '9%', 'Status': '10%', 'Alert': '10%' };
  const cell = (v, c) => {
    const x = v == null || v === '' ? (c === 'Scheduled Date' ? '' : '—') : String(v);
    return `<td style="padding:7px 5px;vertical-align:top;${c === 'Client' ? 'white-space:normal;word-break:break-word' : 'white-space:nowrap'}">${
      ISO_DATE_RE.test(x) ? fmtDateDMY(x.slice(0, 10)) : esc(x)}</td>`;
  };
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:9.5pt"><tr>
      <td style="border:1px solid #cfd8e3;padding:6px 10px"><div style="font-size:8pt;color:#556">Month</div><b>${esc(d.title.replace(/^Monthly Service Register — /, ''))}</b></td>
      <td style="border:1px solid #cfd8e3;padding:6px 10px"><div style="font-size:8pt;color:#556">Total AMC Contracts</div><b style="font-size:13pt">${s.total_contracts || 0}</b></td>
      <td style="border:1px solid #cfd8e3;padding:6px 10px"><div style="font-size:8pt;color:#556">Total AMC Units</div><b style="font-size:13pt">${s.total_units || 0}</b></td>
      <td style="border:1px solid #cfd8e3;padding:6px 10px"><div style="font-size:8pt;color:#556">Printed Date</div><b>${pd}</b></td></tr></table>
    ${d.rows && d.rows.length ? `<table class="sh-print-table" style="font-size:8.8pt;table-layout:fixed;width:100%">
      <thead><tr>${d.columns.map(c => `<th style="width:${W[c] || 'auto'}">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${d.rows.map((r, i) => `<tr style="page-break-inside:avoid${i % 2 ? ';background:#f7f9fc' : ''}">${r.map((v, j) => cell(v, d.columns[j])).join('')}</tr>`).join('')}</tbody></table>`
      : '<p class="sh-print-empty">No maintenance services scheduled for the selected month.</p>'}
    <table style="width:100%;margin-top:22px;font-size:9.5pt;page-break-inside:avoid"><tr>
      ${['Technician Name', 'Date', 'Supervisor', 'Signature'].map(l => `<td style="padding:0 10px 0 0;width:25%">${l}:<div style="border-bottom:1px solid #333;height:22px"></div></td>`).join('')}
    </tr></table>`;
}

function renderTable(data) {
  const topEl = document.getElementById('rpt-std-top');
  if (data && data.std) { renderStandardReport(data); setTimeout(initStickyScroll, 0); return; }
  _stdDestroyChart(); _stdRenderSeq++;
  if (topEl) topEl.innerHTML = '';
  if (data && data.report_type === 'monthly-management') { renderManagementReport(data); setTimeout(initStickyScroll, 0); return; }
  const wrap = document.getElementById('rpt-table-wrap');
  if (!wrap) return;
  if (!data || !data.rows || !data.rows.length) {
    const emptyMsg = ReportsState.type === 'quotations-register' || ReportsState.type === 'quotation-status-summary'
      ? 'No quotation records found for the selected filters.' : 'No records found for the selected filters.';
    wrap.innerHTML = `<div class="empty-state">${emptyMsg}</div>`; initStickyScroll(); return;
  }
  const thStyle = 'white-space:nowrap;position:sticky;top:0;z-index:2;background:#f0f4f8;box-shadow:0 1px 0 #dde3ec';
  const thead = `<thead><tr>${data.columns.map(c => `<th style="${thStyle}">${esc(c)}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${data.rows.map(row => `<tr>${row.map((val, i) => cellHtml(val, data.columns[i])).join('')}</tr>`).join('')}</tbody>`;
  wrap.innerHTML = `<table class="data-table" id="rpt-table" style="min-width:100%">${thead}${tbody}</table>`;
  setTimeout(initStickyScroll, 0);
}

// ── Summary chips ─────────────────────────────────────────────────────────────
function renderSummary(summary) {
  const div = document.getElementById('rpt-summary');
  if (!div) return;
  if (!summary || !Object.keys(summary).length) { div.innerHTML = ''; return; }
  const FACTORY_RPT_TYPES = ['supplier-payment','sea-costs','otj-quotes','factory-payments-register'];
  const sumCurr = FACTORY_RPT_TYPES.includes(ReportsState.type) ? 'USD' : 'AED';
  div.innerHTML = Object.entries(summary).map(([k, v]) => {
    if (typeof v === 'object' && v !== null) return ''; // skip nested objects
    // Explicit currency suffix (_usd / _aed) wins over the report default — never mix currencies
    const curSfx = (k.match(/_(usd|aed)$/) || [])[1];
    const label = k.replace(/_(usd|aed)$/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + (curSfx ? ` (${curSfx.toUpperCase()})` : '');
    const isMoney = !!curSfx || /value|outstanding|paid|received|balance|total_paid|cashflow|flow|inflow|outflow|net/.test(k);
    const display = isMoney && typeof v === 'number' ? `${curSfx ? curSfx.toUpperCase() : sumCurr} ${fmtMoney(v)}` : (typeof v === 'number' ? v.toLocaleString() : esc(String(v)));
    return `<span style="background:#f0f4f8;border-radius:6px;padding:4px 10px;font-size:12px;color:#445566"><b style="color:#334455">${esc(label)}:</b> ${display}</span>`;
  }).filter(Boolean).join('');
}

// ── Pagination ────────────────────────────────────────────────────────────────
function renderPagination(data) {
  const pg = document.getElementById('rpt-pagination');
  if (!pg) return;
  const total = data ? data.total : 0;
  if (!total) { pg.innerHTML = ''; return; }
  const pageSize = ReportsState.pageSize;
  const currentPage = ReportsState.page;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, total);
  const nb = (act, label, disabled) => `<button data-pgact="${act}" class="btn small secondary" ${disabled ? 'disabled' : ''} style="padding:4px 10px;font-size:12px;white-space:nowrap">${label}</button>`;
  const sizeBtns = [25, 50, 100, 250].map(s => {
    const active = s === pageSize;
    return active ? `<span style="font-weight:700;color:var(--accent);font-size:13px;padding:0 3px">${s}</span>` : `<button data-pgact="size" data-sz="${s}" class="btn small secondary" style="padding:3px 8px;font-size:12px">${s}</button>`;
  }).join(`<span style="color:#ccd;padding:0 1px;font-size:12px">|</span>`);
  pg.innerHTML = `
    <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:8px">
      <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;row-gap:8px">
        ${nb('first','« First',currentPage<=1)} ${nb('prev','‹ Prev',currentPage<=1)}
        <span style="padding:0 10px;font-weight:600;font-size:13px;color:#334;white-space:nowrap">Page ${currentPage} of ${totalPages}</span>
        ${nb('next','Next ›',currentPage>=totalPages)} ${nb('last','Last »',currentPage>=totalPages)}
        <span style="margin-left:10px;font-size:12px;color:#667;white-space:nowrap">Go to page:</span>
        <input type="number" id="rpt-goto-input" data-pgact="goto-input" min="1" max="${totalPages}" placeholder="1–${totalPages}" style="width:64px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:13px;text-align:center">
        ${nb('goto-go','Go',false)}
        <span style="margin-left:10px;font-size:12px;color:#667;white-space:nowrap">Rows per page:</span>
        <div style="display:flex;align-items:center;gap:2px">${sizeBtns}</div>
      </div>
      <div style="font-size:13px;color:#667;margin-top:8px">Showing <b style="color:#334">${from.toLocaleString()}</b>–<b style="color:#334">${to.toLocaleString()}</b> of <b style="color:#334">${total.toLocaleString()}</b> records</div>
    </div>
  `;
}

// ── Export + Print ────────────────────────────────────────────────────────────
function exportReport(fmt) {
  const { type, filters, page, pageSize } = ReportsState;
  if (!type) return toast('Select a report first', true);
  const currentPageOnly = document.getElementById('rpt-export-current-page')?.checked;
  const params = currentPageOnly ? new URLSearchParams({ page, page_size: pageSize, current_page_only: '1' }) : new URLSearchParams({ page: 1, page_size: 9999 });
  Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
  window.open(`/api/reports/${type}.${fmt}?${params}`, '_blank');
}

// Reports with many wide columns print better in landscape
const LANDSCAPE_PRINT_TYPES = new Set(ALL_REPORTS.map(r => r.type));   // all reports print landscape

// Filter key → human label map used in print header
const PRINT_FILTER_LABELS = {
  year:'Year', month:'Month', salesperson:'Salesperson', emirate:'Emirate',
  status:'Status', contract_ref:'Contract Ref.', quote_ref:'Quote Ref.',
  factory_ref:'Factory Ref.', client:'Client',
  date_from:'Date From', date_to:'Date To', technician:'Technician',
  days:'Expiry (Days)', renewal_status:'Renewal Status',
  priority:'Priority', complaint_type:'Complaint Type',
  payment_status:'Payment Status', search:'Search',
  activation_status:'AMC Activation Status', amc_payment_status:'Payment Status', amc_renewal_status:'Renewal Status',
  project_status:'Project Status', maintenance_type:'Maintenance Type', supplier:'Supplier', shipping_status:'Shipping Status',
  delivery_status:'Delivery Status', factory_table:'Source', payment_type:'Payment Type', view_mode:'View',
  cancellation_type:'Cancellation Type', refund_status:'Refund Status', factory_delivery_status:'Factory Status',
};

async function printReport() {
  const { type, filters } = ReportsState;
  if (!type) return toast('Select a report first', true);

  const meta      = ALL_REPORTS.find(r => r.type === type);
  const landscape = LANDSCAPE_PRINT_TYPES.has(type);

  // Build human-readable filter display object
  const filterDisplay = {};
  Object.entries(PRINT_FILTER_LABELS).forEach(([k, label]) => {
    if (filters[k]) filterDisplay[label] = filters[k];
  });

  toast('Preparing print — fetching all records…');

  try {
    // Fetch ALL matching records, unless "Current page only" is ticked (2026-09-29)
    const curOnly = document.getElementById('rpt-export-current-page')?.checked;
    const params = curOnly
      ? new URLSearchParams({ page: ReportsState.page, page_size: ReportsState.pageSize })
      : new URLSearchParams({ page: 1, page_size: 9999 });
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    const data = await API.get(`/api/reports/${type}/data?${params}`);

    if (type === 'service-register') {
      shPrint({ title: 'Monthly Maintenance Service Register', subtitle: `Month: ${data.title.replace(/^Monthly Service Register — /, '')} · Prepared for: Maintenance Technician Team`,
        contentHtml: buildServiceRegisterPrintHtml(data), landscape: true, filters: filterDisplay });
      return;
    }
    if (data.std) {
      shPrint({ title: data.title || meta?.label || 'Report', subtitle: data.description || meta?.subtitle || '',
        contentHtml: buildStandardPrintHtml(data), landscape: true, filters: filterDisplay });
      return;
    }
    if (type === 'monthly-management') {
      shPrint({ title: data.title || 'Monthly Management Report',
        subtitle: 'Unit-based management report · Factory Payment is the only monetary metric',
        contentHtml: buildManagementPrintHtml(data), landscape: true, filters: filterDisplay });
      return;
    }
    const title    = data.title || meta?.label || 'Report';
    const subtitle = meta?.subtitle || '';
    const rows     = data.rows || data.data || [];
    const cols     = data.columns || [];

    // Build complete table from all fetched rows using the same cell formatter
    let contentHtml = '';
    if (!rows.length) {
      contentHtml = '<p class="sh-print-empty">No records found for the selected filters.</p>';
    } else if (!cols.length) {
      contentHtml = '<p class="sh-print-empty">Report data has no columns defined.</p>';
    } else {
      const thead = '<thead><tr>' + cols.map(c => `<th>${esc(c)}</th>`).join('') + '</tr></thead>';
      const tbody = '<tbody>' + rows.map((row, i) => {
        // rows may be arrays (toRows output) or objects
        const cells = Array.isArray(row)
          ? cols.map((col, ci) => cellHtml(row[ci] != null ? row[ci] : '', col))
          : cols.map(col => cellHtml(row[col] != null ? row[col] : '', col));
        return `<tr${i % 2 === 1 ? ' class="sh-print-alt"' : ''}>${cells.join('')}</tr>`;
      }).join('') + '</tbody>';
      contentHtml = `<table class="sh-print-table">${thead}${tbody}</table>`;
    }

    // Record count line (below table, above summary)
    contentHtml += `<div class="sh-print-record-count">Total Records Printed: <strong>${rows.length.toLocaleString()}</strong></div>`;

    // Summary section — flat key/value pairs only (skip nested objects)
    const summary = data.summary || {};
    const summaryEntries = Object.entries(summary)
      .filter(([, v]) => v != null && typeof v !== 'object' && String(v).trim() !== '');
    if (summaryEntries.length) {
      const sRows = summaryEntries.map(([k, v]) => {
        const label = k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        return `<tr><td>${esc(label)}</td><td><strong>${esc(String(v))}</strong></td></tr>`;
      }).join('');
      contentHtml += `<div class="sh-print-summary-section">
        <div class="sh-print-summary-title">Report Summary</div>
        <table class="sh-print-summary-table"><tbody>${sRows}</tbody></table>
      </div>`;
    }

    shPrint({ title, subtitle, contentHtml, filters: filterDisplay, landscape });
  } catch (err) {
    toast('Print failed: ' + err.message, true);
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// MONTHLY MANAGEMENT REPORT (unit-based) — 2026-09-29
// All figures are elevator UNITS from the backend (never rows.length); Factory
// Payment is the only monetary metric, shown per currency.
// ══════════════════════════════════════════════════════════════════════════════
const MGMT_COLS = [
  ['new_sales','New Sales', true], ['amc_renewals','AMC Renewals', true], ['ordered','Ordered', true],
  ['production','Production', false], ['shipping','Shipping', false], ['delivered','Delivered', true],
  ['mechanical','Mech. Completed', true], ['electrical','Elec. Completed', true], ['handover','Handover', true],
  ['cancelled','Cancelled', true], ['maint_due','Maint. Due', false], ['maint_completed','Maint. Completed', true],
  ['total_units_handled','Total Units Handled', false], ['factory_payment','Factory Payment', true],
];
const MGMT_DEFS = [
  ['New Sales', 'Elevator units in contracts approved in the month (Contracts → Approval Date).'],
  ['AMC Renewals', 'Units of AMC renewals approved/current in the month (Approval Date → Activation Date → Effective Start Date).'],
  ['Ordered', 'Units ordered from the factory in the month (Factory & Suppliers → Order Date × Qty).'],
  ['Production / Shipping', 'Not reported: only the current status is recorded, with no dated milestone. Past months are not reconstructed.'],
  ['Delivered', 'Units delivered to site in the month (Contracts → Delivery Date). Legacy "Delivered" text without a date is excluded.'],
  ['Mech. / Elec. Completed', 'Units with a Mechanical / Electrical Completion Date in the month. Legacy "Completed" text without a date is excluded.'],
  ['Handover', 'Units handed over in the month (Contracts → Handover Date).'],
  ['Cancelled', 'Units whose contract cancellation date falls in the month. Earlier sales stay in their original month.'],
  ['Maint. Due / Completed', 'Units due for service per the monthly maintenance schedule, and units actually serviced (the same figures as the Monthly Calendar).'],
  ['Total Units Handled', 'Unique elevator units with any qualifying activity in the month, counted once even if they appear in several stages. The annual figure is unique across the year.'],
  ['Factory Payment', 'Actual factory/supplier payments made in the month (Accounts → Factory Payments → Payment Date), per currency.'],
];
function _mgmtMoney(obj) {
  const e = Object.entries(obj || {});
  if (!e.length) return '—';
  return e.map(([c, v]) => `${c} ${fmtMoney(v)}`).join('<br>');
}
function _mgmtVal(m, key) {
  if (key === 'factory_payment') return _mgmtMoney(m.factory_payment);
  if (m[key] === null || m[key] === undefined) return '<span style="color:#aab" title="No dated milestone recorded">N/A</span>';
  return Number(m[key]).toLocaleString();
}

function renderManagementReport(data) {
  const wrap = document.getElementById('rpt-table-wrap');
  if (!wrap) return;
  const k = data.kpis || {};
  const isMonth = !!data.month;
  const cards = [
    ['New Sales', k.new_sales, 'units', '#10b981', 'new_sales'],
    ['AMC Renewals', k.amc_renewals, 'units', '#8b5cf6', 'amc_renewals'],
    ['Ordered', k.ordered, 'units', '#0ea5e9', 'ordered'],
    ['Delivered', k.delivered, 'units', '#2563ad', 'delivered'],
    ['Handover', k.handover, 'units', '#1e8449', 'handover'],
    ['Maintenance Completed', k.maint_completed, `of ${k.maint_due} due · ${k.maint_completion_pct}%`, '#9a7d0a', 'maint_completed'],
    ['Total Units Handled', k.total_units_handled, isMonth ? 'unique units' : 'unique units (year)', '#334155', null],
    ['Factory Payment', null, 'actual payments', '#c2410c', 'factory_payment'],
  ];
  const cardHtml = cards.map(([label, val, sub, color, metric]) => {
    const click = metric && isMonth ? ` onclick="_mgmtDrill('${metric}', ${data.month})" style="cursor:pointer;border-top:3px solid ${color}"` : ` style="border-top:3px solid ${color}"`;
    const v = label === 'Factory Payment' ? _mgmtMoney(k.factory_payment) : Number(val || 0).toLocaleString();
    return `<div class="kpi-card"${click}><div class="num" style="color:${color};font-size:${label==='Factory Payment'?'17':'22'}px">${v}</div>
      <div class="label">${esc(label)}</div><div style="font-size:10px;color:#889">${esc(sub)}</div></div>`;
  }).join('');

  const head = `<tr><th style="position:sticky;left:0;background:#f0f4f8;z-index:3">Month</th>${MGMT_COLS.map(([, l]) => `<th style="text-align:right;white-space:normal">${esc(l)}</th>`).join('')}</tr>`;
  const bodyRows = (data.monthly || []).map((m, i) => {
    const mo = isMonth ? data.month : i + 1;
    return `<tr><td style="position:sticky;left:0;background:#fff;font-weight:600;white-space:nowrap">${esc(m.month_label)}</td>${MGMT_COLS.map(([key, , drill]) => {
      const v = _mgmtVal(m, key);
      const clickable = drill && ((key === 'factory_payment' && m.factory_payment_count) || (key !== 'factory_payment' && m[key] > 0));
      return `<td style="text-align:right;white-space:nowrap">${clickable ? `<a href="#" onclick="event.preventDefault();_mgmtDrill('${key}', ${mo})" style="color:#2563ad;font-weight:600">${v}</a>` : v}</td>`;
    }).join('')}</tr>`;
  }).join('');
  const t = data.totals || {};
  const totalRow = !isMonth ? `<tr style="background:#eef3fa;font-weight:700"><td style="position:sticky;left:0;background:#eef3fa">ANNUAL TOTAL</td>${MGMT_COLS.map(([key]) =>
      `<td style="text-align:right;white-space:nowrap">${key === 'total_units_handled'
        ? `${Number(t.total_units_handled||0).toLocaleString()}<div style="font-size:10px;font-weight:400;color:#667" title="Sum of monthly unique counts: ${t.total_units_handled_sum_of_months}">unique in year</div>`
        : _mgmtVal(t, key)}</td>`).join('')}</tr>` : '';

  const dq = Object.entries(data.data_quality || {}).filter(([, v]) => v > 0)
    .map(([l, v]) => `<li>${esc(l)}: <b>${v}</b></li>`).join('');
  const snap = (data.current_status || []).map(r => `<span style="margin-right:14px">${esc(r.status)}: <b>${r.units}</b> units (${r.contracts})</span>`).join('');

  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px">${cardHtml}</div>
    <div style="font-size:11px;color:#667;margin:-6px 0 10px">All figures are <b>elevator units</b> except Factory Payment. ${isMonth ? 'Click a card or figure to see its supporting records.' : 'Click a figure to see that month\'s supporting records.'}</div>
    <div style="overflow-x:auto"><table class="data-table" id="rpt-table" style="min-width:100%"><thead>${head}</thead><tbody>${bodyRows}${totalRow}</tbody></table></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px;font-size:12px">
      <div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px">
        <div style="font-weight:700;margin-bottom:6px">Current Project Status (today — not a monthly milestone)</div>${snap || '—'}
      </div>
      <div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px">
        <div style="font-weight:700;margin-bottom:6px">Data Quality — milestones that cannot be assigned to a month</div>
        <ul style="margin:0;padding-left:18px">${dq || '<li>None</li>'}</ul>
      </div>
    </div>
    <details style="margin-top:12px;font-size:12px"><summary style="cursor:pointer;font-weight:600">Metric definitions &amp; data sources</summary>
      <table class="data-table" style="margin-top:8px">${MGMT_DEFS.map(([a, b]) => `<tr><td style="font-weight:600;white-space:nowrap;vertical-align:top">${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>
    </details>`;
}

async function _mgmtDrill(metric, month) {
  const f = ReportsState.filters;
  const params = new URLSearchParams({ year: f.year || new Date().getFullYear(), month, detail: metric });
  if (f.salesperson) params.set('salesperson', f.salesperson);
  if (f.emirate) params.set('emirate', f.emirate);
  let d;
  try { d = await API.get('/api/reports/monthly-management/data?' + params); }
  catch (e) { toast('Unable to load detail: ' + e.message, true); return; }
  const COLS = {
    new_sales: [['contract_ref','Contract Ref.'],['client_name','Client'],['approval_date','Approval Date'],['units','Units'],['sales_by','Salesperson'],['project_status','Project Status']],
    amc_renewals: [['contract_ref','Contract Ref.'],['renewal_ref','Renewal Ref.'],['client_name','Client'],['new_start_date','Period From'],['new_end_date','Period To'],['units','Units'],['renewal_status','Renewal Status'],['amc_activation_status','Activation'],['report_date','Reported Date'],['date_basis','Date Basis']],
    ordered: [['factory_ref','Factory Ref.'],['contract_ref','Contract Ref.'],['supplier_name','Supplier'],['order_date','Order Date'],['units','Qty'],['production_status','Production Status']],
    delivered: [['contract_ref','Contract Ref.'],['client_name','Client'],['units','Units'],['milestone_date','Delivery Date'],['emirate','Emirate']],
    mechanical: [['contract_ref','Contract Ref.'],['client_name','Client'],['units','Units'],['milestone_date','Mech. Completion Date'],['emirate','Emirate']],
    electrical: [['contract_ref','Contract Ref.'],['client_name','Client'],['units','Units'],['milestone_date','Elec. Completion Date'],['emirate','Emirate']],
    handover: [['contract_ref','Contract Ref.'],['client_name','Client'],['units','Units'],['milestone_date','Handover Date'],['emirate','Emirate']],
    cancelled: [['contract_ref','Contract Ref.'],['client_name','Client'],['units','Units'],['milestone_date','Cancellation Date'],['emirate','Emirate']],
    maint_completed: [['contract_ref','Contract Ref.'],['client_name','Client'],['visit_ref','Visit Ref.'],['completion_date','Completion Date'],['status','Status'],['units','Units Serviced']],
    factory_payment: [['payment_date','Payment Date'],['factory_ref','Factory Ref.'],['supplier_name','Supplier'],['payment_type','Payment Type'],['amount','Amount'],['currency','Currency'],['remarks','Remarks']],
  }[metric] || [];
  const isDate = k => /date/.test(k);
  const rows = (d.rows || []).map(r => `<tr>${COLS.map(([k]) => {
    let v = r[k];
    if (k === 'amount') v = fmtMoney(v);
    else if (isDate(k) && v) v = fmtDateDMY(v);
    return `<td style="${k==='units'||k==='amount'?'text-align:right':''}">${esc(v == null || v === '' ? '—' : String(v))}</td>`;
  }).join('')}</tr>`).join('');
  const label = (MGMT_COLS.find(c => c[0] === metric) || [, metric])[1];
  const totalLine = metric === 'factory_payment'
    ? `Total: <b>${Object.entries(d.amount_by_currency || {}).map(([c, v]) => `${c} ${fmtMoney(v)}`).join(' + ') || '0'}</b> across ${d.total} payment(s)`
    : `Total: <b>${d.units}</b> unit(s) across ${d.total} record(s) — reconciles with the report figure (${d.kpi_value})`;
  openModal(`<h3 style="margin:0 0 4px">${esc(label)} — ${esc(d.month_label)}</h3>
    <div style="font-size:12px;color:#556;margin-bottom:10px">${totalLine}</div>
    <div style="max-height:60vh;overflow:auto"><table class="data-table"><thead><tr>${COLS.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead>
    <tbody>${rows || `<tr><td colspan="${COLS.length}" class="empty-state">No records.</td></tr>`}</tbody></table></div>
    <div style="text-align:right;margin-top:10px"><button class="btn secondary" onclick="closeModal()">Close</button></div>`, { wide: true });
}

function buildManagementPrintHtml(data) {
  const k = data.kpis || {};
  const kp = [['New Sales', k.new_sales], ['AMC Renewals', k.amc_renewals], ['Ordered', k.ordered], ['Delivered', k.delivered],
    ['Handover', k.handover], ['Maint. Completed', `${k.maint_completed} / ${k.maint_due} due`], ['Total Units Handled', k.total_units_handled]]
    .map(([l, v]) => `<td><div style="font-size:8pt;color:#556">${l}</div><div style="font-size:12pt;font-weight:700">${v} <span style="font-size:7.5pt;font-weight:400">units</span></div></td>`).join('');
  const pay = Object.entries(k.factory_payment || {}).map(([c, v]) => `${c} ${fmtMoney(v)}`).join(' + ') || '—';
  const head = `<tr><th>Month</th>${MGMT_COLS.map(([, l]) => `<th style="text-align:right">${l}</th>`).join('')}</tr>`;
  const plain = (m, key) => key === 'factory_payment'
    ? (Object.entries(m.factory_payment || {}).map(([c, v]) => `${c} ${fmtMoney(v)}`).join(' + ') || '—')
    : (m[key] == null ? 'N/A' : m[key]);
  const body = (data.monthly || []).map(m => `<tr><td>${m.month_label}</td>${MGMT_COLS.map(([key]) => `<td style="text-align:right">${plain(m, key)}</td>`).join('')}</tr>`).join('');
  const t = data.totals || {};
  const tot = !data.month ? `<tr style="font-weight:700"><td>ANNUAL TOTAL</td>${MGMT_COLS.map(([key]) => `<td style="text-align:right">${key === 'total_units_handled' ? t.total_units_handled + ' (unique)' : plain(t, key)}</td>`).join('')}</tr>` : '';
  return `<table style="width:100%;margin-bottom:8px"><tr>${kp}<td><div style="font-size:8pt;color:#556">Factory Payment</div><div style="font-size:11pt;font-weight:700">${pay}</div></td></tr></table>
    <div style="font-size:8pt;color:#556;margin-bottom:4px">All figures are elevator units except Factory Payment. Production / Shipping: N/A — no dated milestone recorded.</div>
    <table style="font-size:8pt"><thead>${head}</thead><tbody>${body}${tot}</tbody></table>`;
}
