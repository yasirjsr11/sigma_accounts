// Factory / Suppliers module frontend — 2026-07-02 redesign.
// 2026-07-04: SL Fuji - New Orders (ins-quotes) list + forms: removed Order Conf. Ref., Shipping Status, Delivery Status columns.
// DB fields retained; data preserved. Only UI display changed. Other tabs unaffected.
// 2026-07-04: Shipping Costs (sea-costs) column renames: Factory Ref.→Shipping Ref., Client/Company Name→BL No. & ETD, BL No.→ETA (DD/MM/YYYY).
//
// Three main tabs, each backed by its own DB table:
//   SL FUJI - SEA COSTS  → factory_sea_costs
//   SL FUJI - OTJ COSTS  → factory_otj_quotes  (renamed from OTJ QUOTES per 2026-07-02 spec)
//   SL FUJI - INS QUOTES → factory_ins_quotes
//
// Each tab now has an "Add New" button that opens a sheet-specific entry form so users can
// manually create records in only that section — no cross-section misrouting possible.
// The New Projects sub-tab (Phase 6) has been removed from the UI per the 2026-07-02 redesign
// instruction ("Remove all existing sub-labels under these three main labels"). The underlying
// factory_new_projects table and API routes are kept for data integrity; the UI is removed.
//
// Sorting is independent per tab: any visible column, ASC or DESC, via the toolbar controls.
//
// Module-internal counters (Total SEA COSTS / Total OTJ COSTS / Total INS QUOTES plus 4 status
// counters) stay inside this module only — not added to Main Dashboard.
//
// 2026-06-30 (Phase 6, still active): SEA COSTS uses narrower Payment/Delivery status option lists;
// INS QUOTES shows contract-joined Client/Emirate/Description + inline Maintenance columns +
// Reviewed workflow; OTJ COSTS shows compacted Description with full-text tooltip.

const FactoryState = {
  sheet: 'ins-quotes',
  filters: { sort_by: 'updated_at', sort_dir: 'desc' },
  root: null
};

const FACTORY_DELIVERY_STATUS_OPTS = ['Order Confirmation', 'Production', 'Shipping', 'In Transit', 'Arrived', 'Delayed', 'Delivered'];
const INS_DELIVERY_STATUS_OPTS     = ['Production', 'Under Production', 'Ready', 'Hold', 'Shipping', 'On Shipping', 'Delivered', 'Cancel'];
const FACTORY_PAYMENT_STATUS_OPTS  = ['Paid', 'Partial', 'Pending', 'Unpaid'];
const SEA_DELIVERY_STATUS_OPTS     = ['Production', 'Shipping', 'Arrived', 'Delayed', 'Delivered'];
const SEA_PAYMENT_STATUS_OPTS      = ['Partial', 'Full Paid', 'Unpaid'];
const PRODUCTION_STATUS_OPTS       = ['Not Started', 'In Progress', 'Under Production', 'Completed', 'On Hold', 'Ready', 'Hold', 'Ready for Shipping'];
const SHIPPING_STATUS_OPTS         = ['Not Shipped', 'Ready for Shipping', 'Shipped', 'Shipping', 'On Shipping', 'In Transit', 'Delivered', 'Delayed'];
const DELIVERY_STATUS_OPTS         = ['Pending', 'On Track', 'Delayed', 'Delivered'];
const CURRENCY_OPTS                = ['USD', 'AED', 'EUR', 'GBP'];
// 2026-09-30 Shipping Details (Shipping Costs tab) — simplified logistics statuses.
// Shipping Status = physical transport stage; Delivery Status = overall delivery
// progress. Independent fields — neither sets the other, neither creates dates.
const SEA_SHIPPING_STATUS_OPTS     = ['Shipped', 'Delivered', 'Delayed'];
const SEA_DELIVERY_STATUS_NEW_OPTS = ['On Track', 'Delayed', 'Delivered'];
const SEA_STATUS_STYLE = {
  'Shipped':   'background:#e3f0fb;color:#1c5a96',
  'On Track':  'background:#e3f0fb;color:#1c5a96',
  'Delivered': 'background:#e8f5ef;color:#1f7a5c',
  'Delayed':   'background:#fde6e3;color:#c0392b',
};
function seaStatusBadge(v) {
  if (!v) return '<span style="color:#aaa;">—</span>';
  const st = SEA_STATUS_STYLE[v];
  return st ? `<span class="badge" style="${st}">${esc(v)}</span>`
            : `<span class="badge" style="background:#f1f3f5;color:#6c757d;" title="Legacy value — select a current status when editing">${esc(v)}</span>`;
}
const SHIPPING_MODE_OPTS           = ['Sea', 'Air', 'Courier', 'Local'];

const SHEET_LABELS = {
  'ins-quotes': 'New Orders',
  'otj-quotes': 'OTJ Orders',
  'sea-costs':  'Shipping Costs',
};

// Sort options must mirror routes/factory.js SORT_COLUMNS whitelist exactly.
const SORT_OPTIONS = {
  'sea-costs': [
    ['updated_at',            'Last Updated'],
    ['factory_ref',           'Shipping Ref.'],
    ['client_name',           'BL No. / Ref.'],
    ['etd',                   'ETD'],
    ['bl_no',                 'ETA'],
    ['amount',                'Shipping Cost (USD)'],
    ['clearance_cost',        'Clearance Cost (AED)'],
    ['payment_status',        'Payment Status'],
    ['shipping_status',       'Shipping Status'],
    ['delivery_status',       'Delivery Status'],
  ],
  'otj-quotes': [
    ['updated_at',             'Last Updated'],
    ['factory_ref',            'Factory Ref.'],
    ['client_name',            'Client / Company Name'],
    ['amount',                 'Amount'],
    ['payment_status',         'Payment Status'],
    ['production_status',      'Production Status'],
    ['shipping_status',        'Shipping Status'],
    ['delivery_status',        'Delivery Status'],
    ['factory_delivery_status','Factory / Delivery Status'],
    ['expected_delivery_date', 'Expected Delivery Date'],
    ['actual_delivery_date',   'Actual Delivery Date'],
  ],
  'ins-quotes': [
    ['updated_at',             'Last Updated'],
    ['factory_ref',            'Factory Ref.'],
    ['contract_ref',           'Contract Ref.'],
    ['supplier_name',          'Supplier / Factory Name'],
    ['amount',                 'Amount'],
    ['quantity',               'Quantity'],
    ['order_date',             'Order Date'],
    ['payment_status',         'Payment Status'],
    ['production_status',      'Production Status'],
    ['factory_delivery_status','Delivery / Production Status'],
    ['expected_delivery_date', 'Expected Delivery Date'],
    ['actual_delivery_date',   'Actual Delivery Date'],
  ],
};

function isInsQuotes()  { return FactoryState.sheet === 'ins-quotes'; }
function isSeaCosts()   { return FactoryState.sheet === 'sea-costs'; }
function isOtjQuotes()  { return FactoryState.sheet === 'otj-quotes'; }

function paymentStatusOptsFor(sheet) { return sheet === 'sea-costs' ? SEA_PAYMENT_STATUS_OPTS  : FACTORY_PAYMENT_STATUS_OPTS; }
function deliveryStatusOptsFor(sheet) {
  if (sheet === 'sea-costs')  return SEA_DELIVERY_STATUS_OPTS;
  if (sheet === 'ins-quotes') return INS_DELIVERY_STATUS_OPTS;
  return FACTORY_DELIVERY_STATUS_OPTS;
}

function resetFactoryFilters() {
  FactoryState.filters = { sort_by: 'updated_at', sort_dir: 'desc' };
}

// ---- Table head ----
function factoryTableHeadHtml() {
  if (isInsQuotes()) return `<tr>
    <th>Factory Ref.</th><th>Common Client / Group</th><th>Our Ref.</th>
    <th>Supplier / Factory</th>
    <th>Qty</th><th>Order Date</th>
    <th>Amount</th><th>Payment Status</th>
    <th>Total Paid</th><th>Balance</th><th>Production Status</th>
    <th>Factory / Del. Status</th>
    <th>Expected Delivery</th><th>Reviewed</th><th>Last Updated</th>
  </tr>`;
  if (isSeaCosts()) return `<tr>
    <th>Shipping Ref.</th><th>BL No. / Ref.</th><th>Description</th>
    <th title="Estimated Time of Departure">ETD</th><th title="Estimated Time of Arrival">ETA</th>
    <th>Shipping Cost (USD)</th><th>Clearance Cost (AED)</th>
    <th>Payment Status</th><th>Shipping Status</th><th>Delivery Status</th><th>Remarks</th><th>Last Updated</th>
  </tr>`;
  // otj-quotes
  return `<tr>
    <th>Factory Ref.</th><th>Client / Company Name</th><th>Description</th>
    <th>Factory / Delivery Status</th><th>Amount</th>
    <th>Payment Status</th><th>Remarks</th><th>Last Updated</th>
  </tr>`;
}

function factoryColSpan() {
  if (isInsQuotes()) return 15;
  if (isSeaCosts())  return 12;
  return 8; // otj-quotes
}

// ---- Table rows ----
function factoryTableRowHtml(r) {
  if (isInsQuotes()) {
    const linkBadge = r.contract_lookup_status === 'Linked'
      ? `<span class="badge" style="background:#d4edda;color:#155724;font-size:10px;margin-left:4px;">Linked</span>`
      : `<span class="badge" style="background:#fff3cd;color:#856404;font-size:10px;margin-left:4px;">Unmatched</span>`;
    const commonClientDisplay = r.common_client_name
      ? esc(r.common_client_name)
      : (r.contract_client_name ? `<span style="color:#888;font-style:italic;">${esc(r.contract_client_name)}</span>` : '<span style="color:#aaa;">—</span>');
    return `
    <tr data-id="${r.id}" style="cursor:pointer;">
      <td class="clickable">${esc(r.factory_ref || '-')}</td>
      <td>${commonClientDisplay}</td>
      <td style="font-size:0.78rem;color:#555;" title="${esc(r.linked_contract_refs || r.our_ref || r.contract_ref || '')}">${r.linked_contract_refs ? esc(r.linked_contract_refs) : r.our_ref ? esc(r.our_ref) : (r.contract_ref ? esc(r.contract_ref) : '<span style="color:#aaa;">—</span>')}</td>
      <td>${esc(r.supplier_name || '-')}</td>
      <td>${r.quantity != null ? (r.quantity === 0 ? '<span title="Cancelled / 0 units" style="color:#6c757d;font-style:italic;">0</span>' : r.quantity) : (r.needs_review ? '<span title="Needs review – set quantity" style="color:#856404;">⚠</span>' : '-')}</td>
      <td>${fmtDate(r.order_date)}</td>
      <td>USD ${fmtMoney(r.amount)}</td>
      <td>${badge(r.payment_status)}</td>
      <td>USD ${fmtMoney(r.total_paid)}</td>
      <td>USD ${fmtMoney(r.balance_payable)}</td>
      <td>${r.production_status ? badge(r.production_status) : '-'}</td>
      <td>${r.factory_delivery_status ? badge(r.factory_delivery_status) : '-'}</td>
      <td>${fmtDate(r.expected_delivery_date)}</td>
      <td>${r.reviewed_status === 'Reviewed' ? badge('Confirmed') : '-'}</td>
      <td>${fmtDate(r.updated_at)}</td>
    </tr>`;
  }
  if (isSeaCosts()) {
    const fullDesc = r.project_description || '';
    return `
    <tr data-id="${r.id}" style="cursor:pointer;">
      <td class="clickable">${esc(r.factory_ref || '-')}</td>
      <td class="desc-compact" title="${esc(r.client_name || '')}">${esc(r.client_name || '-')}</td>
      <td class="desc-compact" title="${esc(fullDesc)}">${esc(fullDesc || '-')}</td>
      <td>${r.etd ? fmtDateDMY(r.etd) : '-'}</td>
      <td>${r.bl_no ? fmtDateDMY(r.bl_no) : '-'}</td>
      <td>USD ${fmtMoney(r.amount)}</td>
      <td>AED ${fmtMoney(r.clearance_cost)}</td>
      <td>${badge(r.payment_status)}</td>
      <td>${seaStatusBadge(r.shipping_status)}</td>
      <td>${seaStatusBadge(r.delivery_status)}</td>
      <td class="desc-compact" title="${esc(r.remarks || '')}">${esc(r.remarks || '-')}</td>
      <td>${fmtDate(r.updated_at)}</td>
    </tr>`;
  }
  // otj-quotes
  const fullDesc = r.project_description || '';
  return `
    <tr data-id="${r.id}" style="cursor:pointer;">
      <td class="clickable">${esc(r.factory_ref || '-')}</td>
      <td>${esc(r.client_name || '-')}</td>
      <td class="desc-compact" title="${esc(fullDesc)}">${esc(fullDesc || '-')}</td>
      <td>${r.factory_delivery_status ? badge(r.factory_delivery_status) : '-'}</td>
      <td>USD ${fmtMoney(r.amount)}</td>
      <td>${badge(r.payment_status)}</td>
      <td class="desc-compact" title="${esc(r.remarks || '')}">${esc(r.remarks || '-')}</td>
      <td>${fmtDate(r.updated_at)}</td>
    </tr>`;
}

// ---- Main render ----
async function renderFactory(root) {
  FactoryState.root = root;
  const sheet  = FactoryState.sheet;
  const sortOpts = SORT_OPTIONS[sheet] || [];
  const payOpts  = paymentStatusOptsFor(sheet);
  const delOpts  = deliveryStatusOptsFor(sheet);

  root.innerHTML = `
    <div class="kpi-grid" id="factory-counters"></div>

    <div class="tabs">
      <div class="tab ${sheet === 'ins-quotes' ? 'active' : ''}" data-sheet="ins-quotes">New Orders</div>
      <div class="tab ${sheet === 'otj-quotes' ? 'active' : ''}" data-sheet="otj-quotes">OTJ Orders</div>
      <div class="tab ${sheet === 'sea-costs'  ? 'active' : ''}" data-sheet="sea-costs">Shipping Costs</div>
    </div>

    <div class="toolbar">
      <button type="button" class="btn" id="factory-add-new">+ Add New</button>
      <span id="fs-supplier-actions" style="display:contents"></span>
      <select id="fs-supplier" title="Supplier / Factory"><option value="">All Suppliers</option></select>
      <input type="text" id="fs-search" placeholder="${isSeaCosts() ? 'Search Shipping Ref., BL No. / Ref.…' : 'Search Factory Ref., Contract Ref., client…'}">
      <select id="fs-payment">
        <option value="">All Payment Status</option>
        ${payOpts.map(s => `<option>${s}</option>`).join('')}
      </select>
      ${!isSeaCosts() ? `<select id="fs-production">
        <option value="">All Production Status</option>
        ${PRODUCTION_STATUS_OPTS.map(s => `<option>${s}</option>`).join('')}
      </select>` : ''}
      ${isSeaCosts() ? `
      <select id="fs-delivery">
        <option value="">All Shipping Status</option>
        ${SEA_SHIPPING_STATUS_OPTS.map(s => `<option>${s}</option>`).join('')}
      </select>
      <select id="fs-sea-delivery">
        <option value="">All Delivery Status</option>
        ${SEA_DELIVERY_STATUS_NEW_OPTS.map(s => `<option>${s}</option>`).join('')}
      </select>` : `
      <select id="fs-delivery">
        <option value="">All Delivery Status</option>
        ${delOpts.map(s => `<option>${s}</option>`).join('')}
      </select>`}
      ${isInsQuotes() ? `<label class="filter-label"><input type="checkbox" id="fs-needs-review"> Needs Review only</label>` : ''}
      <select id="fs-sort-by">
        ${sortOpts.map(([val, label]) => `<option value="${val}" ${FactoryState.filters.sort_by === val ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
      <button type="button" class="btn secondary" id="fs-sort-dir">
        ${FactoryState.filters.sort_dir === 'asc' ? '&#8593; ASC' : '&#8595; DESC'}
      </button>
    </div>

    <div class="table-wrap"><table class="data-table">
      <thead>${factoryTableHeadHtml()}</thead>
      <tbody id="factory-sheet-tbody"><tr><td colspan="${factoryColSpan()}">Loading…</td></tr></tbody>
      <tfoot id="factory-sheet-tfoot"></tfoot>
    </table></div>
  `;

  // Tab switching
  document.querySelectorAll('.tab[data-sheet]').forEach(t => t.addEventListener('click', () => {
    FactoryState.sheet = t.dataset.sheet;
    resetFactoryFilters();
    renderFactory(root);
  }));

  // Add New
  document.getElementById('factory-add-new').addEventListener('click', () => openAddNewModal(FactoryState.sheet));
  // 2026-10-03: Supplier Master — filter + Add / Manage
  _loadSuppliers().then(() => {
    const sel = document.getElementById('fs-supplier'); if (!sel) return;
    sel.innerHTML = '<option value="">All Suppliers</option>' + FactorySup.list.filter(x => x.status === 'Active' || x.orders > 0 || String(x.id) === String(FactoryState.filters.supplier_id || '')).map(x =>
      `<option value="${x.id}" ${String(FactoryState.filters.supplier_id || '') === String(x.id) ? 'selected' : ''}>${esc(x.name)}${x.status !== 'Active' ? ' (Inactive)' : ''}</option>`).join('');
    const act = document.getElementById('fs-supplier-actions');
    if (act) {
      act.innerHTML = `${FactorySup.canManage ? '<button type="button" class="btn secondary" id="factory-add-supplier">+ Add Supplier</button>' : ''}
        <button type="button" class="btn secondary" id="factory-manage-suppliers">Manage Suppliers</button>`;
      const a = document.getElementById('factory-add-supplier');
      if (a) a.addEventListener('click', () => openSupplierForm(null, () => renderFactory(root)));
      document.getElementById('factory-manage-suppliers').addEventListener('click', () => openManageSuppliers(() => renderFactory(root)));
    }
  }).catch(() => {});
  document.getElementById('fs-supplier').addEventListener('change', e => {
    FactoryState.filters.supplier_id = e.target.value;
    loadFactorySheet();
  });

  // Search
  document.getElementById('fs-search').addEventListener('input', debounce(() => {
    FactoryState.filters.search = document.getElementById('fs-search').value;
    loadFactorySheet();
  }, 350));

  // Payment filter
  document.getElementById('fs-payment').addEventListener('change', e => {
    FactoryState.filters.payment_status = e.target.value;
    loadFactorySheet();
  });

  // Production Status filter (hidden for SEA COSTS)
  const prodEl = document.getElementById('fs-production');
  if (prodEl) prodEl.addEventListener('change', e => {
    FactoryState.filters.production_status = e.target.value;
    loadFactorySheet();
  });

  // Delivery / Shipping filter (conditional per tab)
  document.getElementById('fs-delivery').addEventListener('change', e => {
    if (isSeaCosts()) {
      FactoryState.filters.shipping_status = e.target.value;
      delete FactoryState.filters.factory_delivery_status;
    } else {
      FactoryState.filters.factory_delivery_status = e.target.value;
      delete FactoryState.filters.shipping_status;
    }
    loadFactorySheet();
  });

  // Delivery Status filter (Shipping Costs only)
  const seaDelEl = document.getElementById('fs-sea-delivery');
  if (seaDelEl) seaDelEl.addEventListener('change', e => {
    FactoryState.filters.delivery_status = e.target.value;
    loadFactorySheet();
  });

  // Needs Review (INS QUOTES only)
  const nrEl = document.getElementById('fs-needs-review');
  if (nrEl) nrEl.addEventListener('change', e => {
    FactoryState.filters.needs_review = e.target.checked ? '1' : '';
    loadFactorySheet();
  });

  // Sort field
  document.getElementById('fs-sort-by').addEventListener('change', e => {
    FactoryState.filters.sort_by = e.target.value;
    loadFactorySheet();
  });

  // Sort direction toggle
  document.getElementById('fs-sort-dir').addEventListener('click', () => {
    FactoryState.filters.sort_dir = FactoryState.filters.sort_dir === 'asc' ? 'desc' : 'asc';
    document.getElementById('fs-sort-dir').innerHTML =
      FactoryState.filters.sort_dir === 'asc' ? '&#8593; ASC' : '&#8595; DESC';
    loadFactorySheet();
  });

  await Promise.all([loadFactoryCounters(), loadFactorySheet()]);
}

// ---- Counters ----
async function loadFactoryCounters() {
  let d;
  try {
    d = await API.get('/api/factory/counters');
  } catch (err) {
    toast('Failed to load module counters: ' + err.message, true);
    return;
  }
  const nrCount = d.ins_quotes_needs_review || 0;

  // 6 unit-based KPI cards (SL Fuji New Orders only)
  const unitCards = [
    { label: 'Total Ordered Units',      val: d.total_ordered_units,      filter: {} },
    { label: 'Total Units – 2026',       val: d.total_ordered_units_2026, filter: {} },
    { label: 'Under Production',         val: d.units_under_production,   filter: { factory_delivery_status: 'Under Production' } },
    { label: 'Ready / Hold',             val: d.units_ready_hold,         filter: { factory_delivery_status: 'Ready' } },
    { label: 'In Sea Shipping',          val: d.units_sea_shipping,       filter: {} },
    { label: 'Units Delivered',          val: d.units_delivered,          filter: { factory_delivery_status: 'Delivered' } },
  ];

  document.getElementById('factory-counters').innerHTML = `
    ${unitCards.map((c, i) =>
      `<div class="kpi-card kpi-clickable" data-idx="${i}" style="cursor:pointer;" title="Click to drill into New Orders">
        <div class="num">${c.val !== undefined ? c.val : '-'}</div>
        <div class="label">${esc(c.label)}</div>
      </div>`
    ).join('')}
    ${nrCount > 0 ? `<div style="grid-column:1/-1;padding:6px 10px;background:#fff3cd;border-radius:6px;font-size:0.85rem;color:#856404;">
      &#9888; <b>${nrCount}</b> SL Fuji record${nrCount>1?'s':''} need quantity review.
      <a href="#" id="show-needs-review" style="margin-left:6px;color:#856404;font-weight:600;">View All &#8594;</a>
    </div>` : ''}
    <div style="grid-column:1/-1;font-size:0.82rem;color:#66758a;padding:2px 4px;">
      USD Totals &mdash; New Orders: <b>USD ${fmtMoney(d.total_ins_quotes)}</b> &nbsp;|&nbsp;
      OTJ Orders: <b>USD ${fmtMoney(d.total_otj_quotes)}</b> &nbsp;|&nbsp;
      Sea Costs: <b>USD ${fmtMoney(d.total_sea_costs)}</b>
      ${d.sea_shipping_status ? `&nbsp;|&nbsp; Shipments — ${['Shipped','Delayed','Delivered'].map(k =>
        `${seaStatusBadge(k)} <b>${d.sea_shipping_status[k] || 0}</b>`).join(' ')}${
        Object.entries(d.sea_shipping_status).filter(([k]) => !['Shipped','Delayed','Delivered'].includes(k)).map(([k, n]) =>
        ` <span style="color:#888;" title="Legacy / not set">${esc(k)}: ${n}</span>`).join('')}` : ''}
    </div>
  `;

  // KPI card drill-down click handlers
  document.querySelectorAll('.kpi-card.kpi-clickable').forEach(card => {
    card.addEventListener('click', () => {
      const c = unitCards[parseInt(card.dataset.idx)];
      FactoryState.sheet = 'ins-quotes';
      resetFactoryFilters();
      Object.assign(FactoryState.filters, c.filter);
      if (FactoryState.root) renderFactory(FactoryState.root);
    });
  });

  const nrLink = document.getElementById('show-needs-review');
  if (nrLink) {
    nrLink.addEventListener('click', e => {
      e.preventDefault();
      FactoryState.sheet = 'ins-quotes';
      resetFactoryFilters();
      FactoryState.filters.needs_review = '1';
      if (FactoryState.root) renderFactory(FactoryState.root);
    });
  }
}

// ---- Load sheet data ----
async function loadFactorySheet() {
  const sheet  = FactoryState.sheet;
  const params = new URLSearchParams();
  Object.entries(FactoryState.filters).forEach(([k, v]) => { if (v) params.set(k, v); });
  const tbody  = document.getElementById('factory-sheet-tbody');
  const tfoot  = document.getElementById('factory-sheet-tfoot');
  const colspan = factoryColSpan();
  let data;
  try {
    data = await API.get(`/api/factory/${sheet}?${params}`);
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="${colspan}" class="empty-state" style="color:#c0392b;">Failed to load records: ${esc(err.message)}</td></tr>`;
    if (tfoot) tfoot.innerHTML = '';
    toast('Failed to load records: ' + err.message, true);
    return;
  }

  if (!data.rows || !data.rows.length) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="empty-state">No records found</td></tr>`;
    tfoot.innerHTML = '';
    return;
  }

  tbody.innerHTML = data.rows.map(factoryTableRowHtml).join('');
  tbody.querySelectorAll('tr[data-id]').forEach(tr =>
    tr.addEventListener('click', () => openFactorySheetModal(tr.dataset.id))
  );

  const t     = data.totals || {};
  const count = data.total;

  if (isInsQuotes()) {
    tfoot.innerHTML = `<tr class="totals-row">
      <td colspan="7"><b>Totals (${count} record${count===1?'':'s'})</b></td>
      <td><b>USD ${fmtMoney(t.total_amount)}</b></td>
      <td></td>
      <td><b>USD ${fmtMoney(t.total_paid)}</b></td>
      <td>Balance: <b>USD ${fmtMoney(t.total_balance)}</b></td>
      <td colspan="5"></td>
    </tr>`;
  } else if (isSeaCosts()) {
    tfoot.innerHTML = `<tr class="totals-row">
      <td colspan="5"><b>Totals (${count} record${count===1?'':'s'})</b></td>
      <td><b>USD ${fmtMoney(t.total_amount)}</b></td>
      <td><b>AED ${fmtMoney(t.total_clearance)}</b></td>
      <td colspan="5">Total Paid: <b>USD ${fmtMoney(t.total_paid)}</b>
        <span style="color:#888;font-size:0.78rem;margin-left:6px;">USD and AED are shown separately — never added together</span></td>
    </tr>`;
  } else {
    // otj-quotes (8 col)
    tfoot.innerHTML = `<tr class="totals-row">
      <td colspan="4"><b>Totals (${count} record${count===1?'':'s'})</b></td>
      <td><b>USD ${fmtMoney(t.total_amount)}</b></td>
      <td colspan="3">Paid: <b>USD ${fmtMoney(t.total_paid)}</b> &nbsp;|&nbsp; Balance: <b>USD ${fmtMoney(t.total_balance)}</b></td>
    </tr>`;
  }
}

// ---- View / Edit existing record ----
async function openFactorySheetModal(id) {
  await _loadSuppliers().catch(() => {});
  const sheet      = FactoryState.sheet;
  const data       = await API.get(`/api/factory/${sheet}/${id}`);
  const r          = data.row;
  if (sheet === 'sea-costs') return openSeaShippingModal(id, r, data);
  const amountLabel = isSeaCosts() ? 'Shipping Cost (USD)' : 'Amount';
  const amountField = isSeaCosts() ? 'sea_cost' : (isOtjQuotes() ? 'other_job_cost' : 'factory_quote_amount');
  const amount      = isSeaCosts() ? r.sea_cost : (isOtjQuotes() ? r.other_job_cost : r.factory_quote_amount);
  const clientName  = isInsQuotes() ? r.contract_client_name  : r.client_name;
  const projectDesc = isInsQuotes() ? r.contract_project_description : r.project_description;
  const isLinked    = isInsQuotes() ? r.contract_lookup_status === 'Linked' : null;

  const insExtraFields = isInsQuotes() ? `
    ${r.common_client_name ? `<div class="form-field" style="grid-column:span 2;"><label>Common Client / Group</label><div style="font-size:1rem;font-weight:600;color:#2c3e50;">${esc(r.common_client_name)}</div></div>` : ''}
    ${r.our_ref ? `<div class="form-field" style="grid-column:span 2;"><label>Our Ref.</label><div style="font-size:0.88rem;color:#555;">${esc(r.our_ref)}</div></div>` : ''}
    <div class="form-field"><label>Contract Ref.</label><div>${esc(r.contract_ref || '-')} ${badge(r.contract_lookup_status)}</div></div>
    <div class="form-field"><label>Emirate</label><div>${esc(r.contract_emirate || '-')}</div></div>
    <div class="form-field"><label>Supplier / Factory</label><div>${esc(r.supplier_name || '-')}</div></div>
    <div class="form-field"><label>Quantity (Units)</label><div>${r.quantity != null ? (r.quantity === 0 ? '<span style="color:#6c757d;font-style:italic;">0 — Cancelled / Transferred</span>' : r.quantity) : '<span style="color:#856404;">⚠ Needs review</span>'}</div></div>
    <div class="form-field"><label>Order Date</label><div>${fmtDate(r.order_date)}</div></div>
    ${r.maintenance_status ? `<div class="form-field"><label>Maintenance Status</label><div>${badge(r.maintenance_status)}</div></div>` : ''}
    <div class="form-field" style="grid-column:span 2;"><label>Reviewed Status</label><div>
      ${r.reviewed_status === 'Reviewed'
        ? `${badge('Confirmed')} on ${fmtDate(r.reviewed_date)} by ${esc(r.reviewed_by || '-')}`
        : '<span class="badge" style="background:#eef2f6;color:#66758a;">Pending Review</span>'}
      ${r.review_note ? `<div class="meta" style="margin-top:4px;">${esc(r.review_note)}</div>` : ''}
    </div></div>` : '';

  openModal(`
    <h2>${esc(r.factory_ref || 'Record #' + id)}</h2>
    <div class="meta" style="margin-bottom:12px;">${esc(SHEET_LABELS[sheet])}</div>
    <div class="form-grid">
      <div class="form-field"><label>${isSeaCosts() ? 'BL No. &amp; ETD' : 'Client / Company Name'}</label><div>${esc(clientName || '-')}</div></div>
      ${!isInsQuotes() ? `<div class="form-field"><label>Description</label><div>${esc(projectDesc || '-')}</div></div>` : ''}
      ${insExtraFields}
      ${isSeaCosts() ? `<div class="form-field"><label>ETA</label><div>${fmtDateDMY(r.bl_no)}</div></div>` : ''}
      <div class="form-field"><label>${amountLabel}</label><div>USD ${fmtMoney(amount)}</div></div>
      ${isSeaCosts() ? `<div class="form-field"><label>Clearance Cost (AED)</label><div>AED ${fmtMoney(r.clearance_cost)}</div></div>` : ''}
      <div class="form-field"><label>Total Paid</label><div>USD ${fmtMoney(r.total_paid)}</div></div>
      <div class="form-field"><label>Balance Payable</label><div>USD ${fmtMoney(r.balance_payable)}</div></div>
    </div>
    <div id="factory-multi-links-section" style="margin:16px 0 0;border-top:1px solid #e8ecf0;padding-top:12px;"><div class="loading-state" style="font-size:0.85rem;color:#888;">Loading contract links…</div></div>
    <form id="factory-sheet-form">
      <div class="form-grid">
        ${_supplierFieldHtml(r.supplier_id, { current: r.supplier_name })}
        ${isSeaCosts() ? formField('ETA', 'bl_no', r.bl_no, { type: 'date' }) : ''}
        ${isOtjQuotes() ? formField('Contract Ref.', 'contract_ref', r.contract_ref) : ''}
        ${formField(amountLabel, amountField, amount, { type: 'number' })}
        ${isSeaCosts() ? formField('Clearance Cost (AED)', 'clearance_cost', r.clearance_cost, { type: 'number' }) : ''}
        ${formField('Total Paid', 'total_paid', r.total_paid, { type: 'number' })}
        ${formField('Payment Status', 'payment_status', r.payment_status, { select: paymentStatusOptsFor(sheet) })}
        ${!isSeaCosts() ? formField('Production Status', 'production_status', r.production_status, { select: ['', ...PRODUCTION_STATUS_OPTS] }) : ''}
        ${!isInsQuotes() ? formField('Shipping Status',   'shipping_status',   r.shipping_status,   { select: ['', ...SHIPPING_STATUS_OPTS] }) : ''}
        ${!isInsQuotes() ? formField('Delivery Status',   'delivery_status',   r.delivery_status,   { select: ['', ...DELIVERY_STATUS_OPTS] }) : ''}
        ${!isSeaCosts() ? formField('Factory / Delivery Status', 'factory_delivery_status', r.factory_delivery_status, { select: ['', ...deliveryStatusOptsFor(sheet)] }) : ''}
        ${formField('Expected Delivery Date', 'expected_delivery_date', r.expected_delivery_date, { type: 'date' })}
        ${formField('Actual Delivery Date',   'actual_delivery_date',   r.actual_delivery_date,   { type: 'date' })}
        ${isInsQuotes() ? formField('Quantity (Units)', 'quantity', r.quantity != null ? r.quantity : '', { type: 'number' }) : ''}
        ${isInsQuotes() ? `<div class="form-field"><label>Order Date <span style="font-size:0.72rem;font-weight:400;color:#888;">(Auto from Advance Payment)</span></label><div style="padding:6px 0;color:#2c3e50;">${r.advance_payment_date ? fmtDate(r.advance_payment_date) : '<span style="color:#aaa;">Set when Advance Payment Date is saved</span>'}</div></div>` : ''}
        ${isInsQuotes() ? formField('Reviewed Status', 'reviewed_status', r.reviewed_status, { select: ['Pending Review', 'Reviewed'] }) : ''}
        ${formField('Remarks', 'remarks', r.remarks, { textarea: true, span2: true })}
        ${isInsQuotes() ? formField('Review Note', 'review_note', r.review_note, { textarea: true, span2: true }) : ''}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn danger" id="factory-delete-btn">Delete</button>
        <div class="spacer"></div>
        <button type="button" class="btn secondary" id="factory-pay-history-btn">Payment History</button>
        <button type="button" class="btn secondary" id="cancel-modal">Cancel</button>
        <button type="submit" class="btn">Save Changes</button>
      </div>
    </form>
  `);

  document.getElementById('cancel-modal').addEventListener('click', closeModal);

  document.getElementById('factory-pay-history-btn').addEventListener('click', () => {
    const ftable = sheet.replace(/-/g, '_');
    openFactoryPaymentHistory(r.factory_ref || r.shipping_ref, ftable);
  });

  document.getElementById('factory-delete-btn').addEventListener('click', async () => {
    if (!await confirmDelete({ title: 'Delete Record', message: 'This record will be hidden from all views but kept in the database.' })) return;
    try {
      await API.del(`/api/factory/${sheet}/${id}`);
      toast('Record deleted');
      closeModal();
      loadFactorySheet();
    } catch (err) { toast(err.message, true); }
  });

  document.getElementById('factory-sheet-form').addEventListener('submit', async e => {
    e.preventDefault();
    const body = readForm(e.target);
    try {
      await API.patch(`/api/factory/${sheet}/${id}`, body);
      toast('Record updated');
      closeModal();
      await Promise.all([loadFactorySheet(), loadFactoryCounters()]);
    } catch (err) { toast(err.message, true); }
  });

  // Load multi-contract links section
  const _fcFactoryRef   = r.factory_ref || r.shipping_ref;
  const _fcFactoryTable = { 'sea-costs': 'factory_sea_costs', 'otj-quotes': 'factory_otj_quotes', 'ins-quotes': 'factory_ins_quotes' }[sheet];
  const _fcRecordId     = id;
  if (_fcFactoryRef && _fcFactoryTable) {
    _loadFactoryMultiLinks(_fcFactoryRef, _fcFactoryTable, _fcRecordId);
  }
}

// ── 2026-09-30: Shipping Details (Shipping Costs tab) — simplified logistics form ──
// Fields: ETD | ETA · Shipping Cost (USD) | Clearance Cost (AED) · Total Paid |
// Payment Status · Shipping Status | Delivery Status · Remarks.
// Expected / Actual Delivery Date are no longer shown here; any stored values are
// preserved untouched in the database. Only fields the user changed are PATCHed.
function _seaSelect(label, name, value, opts, title) {
  const legacy = value && !opts.includes(value);
  const o = [`<option value="">--</option>`]
    .concat(legacy ? [`<option value="${esc(value)}" selected>${esc(value)} (legacy — please select a current status)</option>`] : [])
    .concat(opts.map(v => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(v)}</option>`));
  return `<div class="form-field"><label ${title ? `title="${esc(title)}"` : ''}>${label}</label>
    <select name="${name}">${o.join('')}</select>
    ${legacy ? `<div style="font-size:0.72rem;color:#856404;margin-top:2px;">Stored value "${esc(value)}" is kept until you choose a new status.</div>` : ''}</div>`;
}
function _seaDate(label, full, name, value) {
  return `<div class="form-field"><label title="${esc(full)}">${label} <span style="font-weight:400;color:#888;font-size:0.75rem;">— ${esc(full)}</span>
      <span class="sea-dmy" data-for="${name}" style="float:right;font-weight:600;color:#2c3e50;font-size:0.78rem;">${value ? fmtDateDMY(value) : ''}</span></label>
    <input type="date" name="${name}" value="${esc(value || '')}"></div>`;
}
function _seaMoney(label, name, value, cur) {
  const v = value === null || value === undefined ? '' : value;
  return `<div class="form-field"><label>${label}</label>
    <div style="display:flex;align-items:center;gap:6px;"><span style="font-size:0.8rem;font-weight:600;color:#556;min-width:30px;">${cur}</span>
    <input type="number" step="0.01" min="0" name="${name}" value="${esc(v)}" style="flex:1;"></div></div>`;
}

async function openSeaShippingModal(id, r, data) {
  const sheet = 'sea-costs';
  const ledger = (data && data.ledger) || { count: 0, total: 0 };
  const payOpts = paymentStatusOptsFor(sheet);
  const totalPaidField = ledger.count > 0
    ? `<div class="form-field"><label>Total Paid (USD)</label>
         <div style="padding:6px 0;font-weight:600;color:#2c3e50;">USD ${fmtMoney(r.total_paid)}</div>
         <div style="font-size:0.72rem;color:#6c757d;">From Accounts → Factory Payments (${ledger.count} payment${ledger.count === 1 ? '' : 's'}) — see Payment History</div></div>`
    : _seaMoney('Total Paid (USD)', 'total_paid', r.total_paid, 'USD');

  openModal(`
    <h2>${esc(r.factory_ref || 'Shipment #' + id)}</h2>
    <div class="meta" style="margin-bottom:10px;">Shipping Costs · Shipping &amp; Delivery Details</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px 18px;background:#f7f9fc;border:1px solid #e3e8ef;border-radius:6px;padding:8px 12px;font-size:0.84rem;">
      <div><span style="color:#778;">BL No. / Ref.</span><br><b>${esc(r.client_name || '—')}</b></div>
      <div><span style="color:#778;">Description</span><br>${esc(r.project_description || '—')}</div>
      ${r.supplier_name ? `<div><span style="color:#778;">Supplier</span><br>${esc(r.supplier_name)}</div>` : ''}
    </div>
    <div id="factory-multi-links-section" style="margin:14px 0 0;border-top:1px solid #e8ecf0;padding-top:12px;"><div class="loading-state" style="font-size:0.85rem;color:#888;">Loading contract links…</div></div>
    <form id="factory-sheet-form" style="margin-top:14px;border-top:1px solid #e8ecf0;padding-top:12px;">
      <div style="font-weight:700;color:#0f2d5e;font-size:0.9rem;margin-bottom:8px;letter-spacing:.02em;">SHIPPING &amp; DELIVERY DETAILS</div>
      <div class="form-grid sea-ship-grid">
        ${_seaDate('ETD', 'Estimated Time of Departure', 'etd', r.etd)}
        ${_seaDate('ETA', 'Estimated Time of Arrival', 'bl_no', r.bl_no)}
        <div id="sea-date-warn" class="span2" style="display:none;grid-column:1 / -1;font-size:0.8rem;color:#8a6d00;background:#fffaeb;border:1px solid #f3dea0;border-radius:5px;padding:5px 9px;">⚠ ETA is earlier than ETD. Please verify the shipment dates.</div>
        ${_seaMoney('Shipping Cost (USD)', 'sea_cost', r.sea_cost, 'USD')}
        ${_seaMoney('Clearance Cost (AED)', 'clearance_cost', r.clearance_cost, 'AED')}
        ${totalPaidField}
        ${_seaSelect('Payment Status', 'payment_status', r.payment_status, payOpts)}
        ${_seaSelect('Shipping Status', 'shipping_status', r.shipping_status, SEA_SHIPPING_STATUS_OPTS, 'Physical shipping / transport stage')}
        ${_seaSelect('Delivery Status', 'delivery_status', r.delivery_status, SEA_DELIVERY_STATUS_NEW_OPTS, 'Overall delivery-progress condition')}
        <div class="form-field span2" style="grid-column:1 / -1;"><label>Remarks</label>
          <textarea name="remarks" rows="3" placeholder="e.g. Vessel delayed, port congestion, container released, clearance pending…">${esc(r.remarks || '')}</textarea></div>
      </div>
      <div style="font-size:0.72rem;color:#8896a6;margin-top:4px;">Shipping Cost is in USD and Clearance Cost in AED — they are kept separate and never added together.</div>
      <div class="modal-actions">
        <button type="button" class="btn danger" id="factory-delete-btn">Delete</button>
        <div class="spacer"></div>
        <button type="button" class="btn secondary" id="factory-pay-history-btn">Payment History</button>
        <button type="button" class="btn secondary" id="cancel-modal">Cancel</button>
        <button type="submit" class="btn">Save Changes</button>
      </div>
    </form>
  `);

  const form = document.getElementById('factory-sheet-form');
  const warn = document.getElementById('sea-date-warn');
  const checkDates = () => {
    const etd = form.elements.etd.value, eta = form.elements.bl_no.value;
    warn.style.display = etd && eta && eta < etd ? 'block' : 'none';
    form.querySelectorAll('.sea-dmy').forEach(sp => { const v = form.elements[sp.dataset.for].value; sp.textContent = v ? fmtDateDMY(v) : ''; });
  };
  form.elements.etd.addEventListener('change', checkDates);
  form.elements.bl_no.addEventListener('change', checkDates);
  checkDates();

  document.getElementById('cancel-modal').addEventListener('click', closeModal);
  document.getElementById('factory-pay-history-btn').addEventListener('click', () => openFactoryPaymentHistory(r.factory_ref || r.shipping_ref, 'sea_costs'));
  document.getElementById('factory-delete-btn').addEventListener('click', async () => {
    if (!await confirmDelete({ title: 'Delete Record', message: 'This record will be hidden from all views but kept in the database.' })) return;
    try { await API.del(`/api/factory/${sheet}/${id}`); toast('Record deleted'); closeModal(); loadFactorySheet(); }
    catch (err) { toast(err.message, true); }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = readForm(form);
    // Controlled PATCH: send only fields the user actually changed.
    const norm = (k, v) => (v === '' || v === undefined || v === null) ? null
      : (['sea_cost', 'clearance_cost', 'total_paid'].includes(k) ? Number(v) : String(v));
    const body = {};
    for (const [k, v] of Object.entries(fd)) {
      if (norm(k, v) !== norm(k, r[k])) body[k] = v;
    }
    if (!Object.keys(body).length) { toast('No changes to save'); closeModal(); return; }
    try {
      const res = await API.patch(`/api/factory/${sheet}/${id}`, body);
      (res.warnings || []).forEach(w => toast(w, 'warn'));
      toast('Shipping details updated');
      closeModal();
      await Promise.all([loadFactorySheet(), loadFactoryCounters()]);
    } catch (err) { toast(err.message, true); }
  });

  if (r.factory_ref || r.shipping_ref) _loadFactoryMultiLinks(r.factory_ref || r.shipping_ref, 'factory_sea_costs', id);
}

// ── 2026-09-16: Factory Order Master + Lines — full spec implementation ──────
// _loadFactoryMultiLinks renders the "Linked Sales Contracts" section inside the
// factory detail modal. Implements the 33-point spec:
//   • Per-line Sales Value (from contracts) and Factory Value
//   • Factory Invoice Ref per line
//   • Totals section (contracts, units, sales by currency, factory USD total)
//   • Unit allocation validation (allocated ≤ contract elevator_units)
//   • Contract search typeahead (not manual text input)
//   • Commercial mode awareness (Combined / Separate invoice)
async function _loadFactoryMultiLinks(factoryRef, factoryTable, recordId) {
  const section = document.getElementById('factory-multi-links-section');
  if (!section) return;
  try {
    const [d, qtyData] = await Promise.all([
      API.get(`/api/factory/multi-links?factory_ref=${encodeURIComponent(factoryRef)}&factory_table=${encodeURIComponent(factoryTable)}`),
      API.get(`/api/factory/multi-links/qty-check?factory_ref=${encodeURIComponent(factoryRef)}&factory_table=${encodeURIComponent(factoryTable)}`).catch(() => ({ factory_qty: null, linked_qty: 0, factory_value_total: 0, factory_commercial_mode: 'Separate' })),
    ]);
    const rows            = d.rows || [];
    const salesByCurrency = d.salesByCurrency || {};
    const totalFactoryVal = d.totalFactoryValue || 0;
    const totalAllocated  = d.totalAllocated || 0;
    const factoryQty      = qtyData.factory_qty;
    const linkedQty       = qtyData.linked_qty || 0;
    const commercialMode  = qtyData.factory_commercial_mode || 'Separate';
    const combinedInvRef  = qtyData.factory_combined_invoice_ref;

    // ── Quantity allocation status bar ───────────────────────────────────────
    let qtyBar = '';
    if (factoryTable === 'factory_ins_quotes' && factoryQty != null) {
      if (linkedQty === 0) {
        qtyBar = `<div style="font-size:0.78rem;color:#6c757d;background:#f8f9fa;border:1px solid #dee2e6;border-radius:4px;padding:4px 8px;margin-bottom:6px;">Factory Qty: <b>${factoryQty}</b> unit(s) — not yet allocated to contracts</div>`;
      } else if (linkedQty < factoryQty) {
        qtyBar = `<div style="font-size:0.78rem;color:#856404;background:#fff3cd;border-radius:4px;padding:4px 8px;margin-bottom:6px;">⚠ Partially allocated — ${linkedQty} / ${factoryQty} unit(s) linked</div>`;
      } else if (linkedQty === factoryQty) {
        qtyBar = `<div style="font-size:0.78rem;color:#155724;background:#d4edda;border-radius:4px;padding:4px 8px;margin-bottom:6px;">✓ Fully allocated — ${linkedQty} / ${factoryQty} unit(s)</div>`;
      } else {
        qtyBar = `<div style="font-size:0.78rem;color:#842029;background:#f8d7da;border-radius:4px;padding:4px 8px;margin-bottom:6px;">⚠ Over-allocated — ${linkedQty} linked vs ${factoryQty} factory unit(s). Review allocation.</div>`;
      }
    }

    // ── Commercial mode badge ────────────────────────────────────────────────
    const modeBadge = commercialMode === 'Combined'
      ? `<span style="font-size:0.72rem;background:#e3f2fd;color:#1565c0;border-radius:3px;padding:1px 6px;margin-left:8px;">Combined Invoice${combinedInvRef ? ': ' + esc(combinedInvRef) : ''}</span>`
      : `<span style="font-size:0.72rem;background:#f3f4f6;color:#6c757d;border-radius:3px;padding:1px 6px;margin-left:8px;">Separate Invoices</span>`;

    // ── Linked contracts table ───────────────────────────────────────────────
    const tableHtml = rows.length ? `
      <div style="overflow-x:auto;margin-bottom:10px;">
        <table class="data-table" style="font-size:0.79rem;">
          <thead><tr>
            <th>Contract Ref.</th>
            <th>Client</th>
            <th>Emirate</th>
            <th style="text-align:center;">Contract<br>Units</th>
            <th style="text-align:center;">Allocated<br>Units</th>
            <th>Sales Value</th>
            <th>Factory Invoice</th>
            <th>Factory Value</th>
            <th>Status</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${rows.map(lk => {
              const allocOk = lk.linked_quantity == null || lk.linked_quantity <= lk.contract_elevator_units;
              const allocCell = lk.linked_quantity != null
                ? `<span style="color:${allocOk ? 'inherit' : '#842029'};font-weight:${allocOk ? 'normal' : '600'}">${lk.linked_quantity}</span>${!allocOk ? ' ⚠' : ''}`
                : '<span style="color:#888">—</span>';
              const salesCell = lk.contract_sales_value != null
                ? `<span style="color:#155724;">${esc(lk.contract_currency || 'AED')} ${fmtMoney(lk.contract_sales_value)}</span>`
                : '<span style="color:#aaa">—</span>';
              const fvCell = lk.factory_value != null
                ? `<b>${esc(lk.factory_currency || 'USD')} ${fmtMoney(lk.factory_value)}</b>`
                : '<span style="color:#aaa">—</span>';
              return `<tr data-link-id="${lk.id}">
                <td><strong>${esc(lk.contract_ref)}</strong></td>
                <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(lk.contract_client||'')}">${esc(lk.contract_client || '—')}</td>
                <td>${esc(lk.contract_emirate || '—')}</td>
                <td style="text-align:center;">${lk.contract_elevator_units != null ? lk.contract_elevator_units : '—'}</td>
                <td style="text-align:center;">${allocCell}</td>
                <td>${salesCell}</td>
                <td style="font-family:monospace;font-size:0.77rem;">${esc(lk.factory_invoice_ref || '—')}</td>
                <td>${fvCell}</td>
                <td>${badge(lk.status || 'Active')}</td>
                <td><button type="button" class="btn danger fcl-remove-btn" data-id="${lk.id}" style="font-size:0.73rem;padding:2px 7px;">Remove</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>` : `<div class="empty-state" style="font-size:0.82rem;margin-bottom:8px;">No contracts linked yet. Use "+ Link Contract" to associate this factory order with one or more sales contracts.</div>`;

    // ── Totals footer ────────────────────────────────────────────────────────
    let totalsHtml = '';
    if (rows.length > 0) {
      const salesLines = Object.entries(salesByCurrency).map(([cur, val]) =>
        `${esc(cur)} ${fmtMoney(val)}`).join(' &nbsp;|&nbsp; ');
      totalsHtml = `
        <div style="border-top:2px solid #dee2e6;padding:8px 0 4px;margin-bottom:6px;font-size:0.8rem;display:flex;gap:24px;flex-wrap:wrap;">
          <span><b>Contracts:</b> ${rows.length}</span>
          <span><b>Allocated Units:</b> ${totalAllocated}</span>
          ${salesLines ? `<span><b>Sales Total:</b> ${salesLines}</span>` : ''}
          ${totalFactoryVal > 0 ? `<span style="color:#1565c0;"><b>Factory Total:</b> USD ${fmtMoney(totalFactoryVal)}</span>` : ''}
        </div>`;
    }

    section.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div style="display:flex;align-items:center;">
          <strong style="font-size:0.9rem;color:#2c3e50;">Linked Sales Contracts</strong>
          <span style="font-weight:400;color:#888;font-size:0.85rem;margin-left:6px;">(${rows.length})</span>
          ${modeBadge}
        </div>
        <button type="button" class="btn secondary" id="fcl-toggle-add-btn" style="font-size:0.78rem;padding:3px 10px;">+ Link Contract</button>
      </div>
      ${qtyBar}
      ${tableHtml}
      ${totalsHtml}
      <div id="fcl-add-form" style="display:none;background:#f8f9fa;border:1px solid #e2e6ea;border-radius:6px;padding:12px;margin-top:6px;">
        <div style="font-size:0.8rem;font-weight:600;color:#2c3e50;margin-bottom:8px;">Add Factory Order Line</div>
        <div style="margin-bottom:8px;position:relative;">
          <label style="font-size:0.8rem;display:block;margin-bottom:3px;">Sales Contract * <span style="font-weight:400;color:#888;font-size:0.75rem;">(search by ref, client, or description)</span></label>
          <input id="fcl-contract-search-input" class="form-input" placeholder="Type to search contracts…" autocomplete="off" style="font-size:0.82rem;">
          <input type="hidden" id="fcl-contract-ref-value">
          <div id="fcl-contract-search-results" style="display:none;position:absolute;left:0;right:0;background:#fff;border:1px solid #cdd5de;border-radius:4px;z-index:9999;max-height:200px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.12);top:calc(100% + 2px);"></div>
        </div>
        <div id="fcl-selected-contract-info" style="display:none;font-size:0.78rem;color:#155724;background:#d4edda;border-radius:4px;padding:4px 8px;margin-bottom:8px;"></div>
        <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr;gap:8px;">
          <div class="form-field"><label style="font-size:0.8rem;">Allocated Units</label><input name="fcl_quantity" type="number" class="form-input" min="0" placeholder="e.g. 1" style="font-size:0.82rem;"></div>
          <div class="form-field"><label style="font-size:0.8rem;">Factory Invoice Ref. <span style="color:#888;font-weight:400;">(PI-XXX)</span></label><input name="fcl_invoice_ref" class="form-input" placeholder="e.g. PI-888-A" style="font-size:0.82rem;"></div>
          <div class="form-field"><label style="font-size:0.8rem;">Factory Value</label>
            <div style="display:flex;gap:4px;">
              <select name="fcl_currency" class="form-input" style="width:80px;font-size:0.82rem;padding:6px 4px;flex-shrink:0;">
                <option value="USD" selected>USD</option>
                <option value="AED">AED</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
              <input name="fcl_factory_value" type="number" step="0.01" class="form-input" placeholder="0.00" style="font-size:0.82rem;">
            </div>
          </div>
          <div class="form-field"><label style="font-size:0.8rem;">Model / Lift Type</label><input name="fcl_type" class="form-input" style="font-size:0.82rem;"></div>
          <div class="form-field" style="grid-column:span 2;"><label style="font-size:0.8rem;">Remarks</label><input name="fcl_remarks" class="form-input" style="font-size:0.82rem;"></div>
        </div>
        <div style="text-align:right;margin-top:10px;">
          <button type="button" id="fcl-cancel-add" class="btn secondary" style="font-size:0.8rem;margin-right:6px;">Cancel</button>
          <button type="button" id="fcl-save-link-btn" class="btn" style="font-size:0.8rem;">Save Factory Line</button>
        </div>
      </div>`;

    // Toggle add form
    document.getElementById('fcl-toggle-add-btn').addEventListener('click', () => {
      const f = document.getElementById('fcl-add-form');
      const isHidden = f.style.display === 'none';
      f.style.display = isHidden ? 'block' : 'none';
      if (isHidden) {
        document.getElementById('fcl-contract-search-input').focus();
        document.getElementById('fcl-contract-ref-value').value = '';
        document.getElementById('fcl-selected-contract-info').style.display = 'none';
      }
    });
    document.getElementById('fcl-cancel-add').addEventListener('click', () => {
      document.getElementById('fcl-add-form').style.display = 'none';
    });

    // Contract search typeahead
    let _fclSearchTimer = null;
    const _searchInput   = document.getElementById('fcl-contract-search-input');
    const _searchResults = document.getElementById('fcl-contract-search-results');
    const _hiddenRef     = document.getElementById('fcl-contract-ref-value');
    const _selectedInfo  = document.getElementById('fcl-selected-contract-info');

    function _clearSelection() {
      _hiddenRef.value = '';
      _selectedInfo.style.display = 'none';
      _selectedInfo.innerHTML = '';
    }

    _searchInput.addEventListener('input', () => {
      _clearSelection();
      clearTimeout(_fclSearchTimer);
      const q = _searchInput.value.trim();
      if (!q) { _searchResults.style.display = 'none'; return; }
      _fclSearchTimer = setTimeout(async () => {
        try {
          const sr = await API.get(`/api/factory/contract-search?q=${encodeURIComponent(q)}`);
          const hits = sr.rows || [];
          if (!hits.length) {
            _searchResults.innerHTML = '<div style="padding:8px 12px;color:#888;font-size:0.8rem;">No contracts found</div>';
          } else {
            _searchResults.innerHTML = hits.map(h => `
              <div class="fcl-search-hit"
                data-ref="${esc(h.contract_ref)}" data-client="${esc(h.client_name||'')}"
                data-emirate="${esc(h.emirate||'')}" data-qty="${h.elevator_units||''}"
                style="padding:7px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;font-size:0.8rem;">
                <strong>${esc(h.contract_ref)}</strong>
                <span style="color:#555;margin-left:6px;">${esc(h.client_name||'')}</span>
                ${h.emirate ? `<span style="color:#888;margin-left:4px;">&middot; ${esc(h.emirate)}</span>` : ''}
                ${h.elevator_units ? `<span style="color:#777;margin-left:4px;">&middot; ${h.elevator_units} unit(s)</span>` : ''}
              </div>`).join('');
            _searchResults.querySelectorAll('.fcl-search-hit').forEach(el => {
              el.addEventListener('mouseenter', () => { el.style.background = '#f0f4ff'; });
              el.addEventListener('mouseleave', () => { el.style.background = ''; });
              el.addEventListener('click', () => {
                _hiddenRef.value = el.dataset.ref;
                _searchInput.value = el.dataset.ref;
                _searchResults.style.display = 'none';
                _selectedInfo.innerHTML = `✓ <strong>${esc(el.dataset.ref)}</strong> — ${esc(el.dataset.client)}${el.dataset.emirate ? ' · ' + esc(el.dataset.emirate) : ''}${el.dataset.qty ? ' · ' + el.dataset.qty + ' unit(s)' : ''}`;
                _selectedInfo.style.display = 'block';
                // Auto-fill allocated units to 1 if contract has 1 unit
                const qtyInput = section.querySelector('[name="fcl_quantity"]');
                if (qtyInput && !qtyInput.value && el.dataset.qty === '1') qtyInput.value = '1';
                section.querySelector('[name="fcl_invoice_ref"]').focus();
              });
            });
          }
          _searchResults.style.display = 'block';
        } catch(_) {}
      }, 220);
    });

    document.addEventListener('click', function _fclClickOutside(e) {
      if (!_searchResults.contains(e.target) && e.target !== _searchInput) {
        _searchResults.style.display = 'none';
        document.removeEventListener('click', _fclClickOutside);
      }
    });

    // Save factory order line
    document.getElementById('fcl-save-link-btn').addEventListener('click', async () => {
      const cref = _hiddenRef.value || _searchInput.value.trim();
      if (!cref) { toast('Search and select a contract first', true); return; }
      const payload = {
        factory_ref: factoryRef,
        factory_table: factoryTable,
        factory_record_id: recordId,
        contract_ref: cref,
        linked_quantity: section.querySelector('[name="fcl_quantity"]').value || null,
        factory_invoice_ref: section.querySelector('[name="fcl_invoice_ref"]').value.trim() || null,
        factory_value: section.querySelector('[name="fcl_factory_value"]').value || null,
        factory_currency: section.querySelector('[name="fcl_currency"]').value || 'USD',
        model_lift_type: section.querySelector('[name="fcl_type"]').value.trim() || null,
        remarks: section.querySelector('[name="fcl_remarks"]').value.trim() || null,
      };
      try {
        await API.post('/api/factory/multi-links', payload);
        toast(`Contract line added — ${cref} linked to ${factoryRef}`);
        _loadFactoryMultiLinks(factoryRef, factoryTable, recordId);
      } catch(err) {
        const msg = err.message || 'Failed to add link';
        toast(msg.includes('already linked') ? `⚠ ${msg}` : msg, true);
      }
    });

    // Remove link buttons
    section.querySelectorAll('.fcl-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this contract link from the factory order? The contract and factory record will not be deleted.')) return;
        try {
          await API.del(`/api/factory/multi-links/${btn.dataset.id}`);
          toast('Factory order line removed');
          _loadFactoryMultiLinks(factoryRef, factoryTable, recordId);
        } catch(err) { toast(err.message || 'Failed to remove', true); }
      });
    });
  } catch(err) {
    const section = document.getElementById('factory-multi-links-section');
    if (section) section.innerHTML = `<div class="error-state" style="font-size:0.82rem;">Could not load contract links: ${esc(err.message)}</div>`;
  }
}


// ---- Factory Payment History modal ----
async function openFactoryPaymentHistory(factoryRef, factoryTable) {
  if (!factoryRef) { toast('No factory ref available', true); return; }
  openModal(`<h2>Payment History</h2><div class="meta" style="margin-bottom:8px;">${esc(factoryRef)}</div><div id="factory-pay-hist-body"><div class="loading-state">Loading...</div></div>`);
  try {
    const param = factoryTable === 'sea_costs' ? 'shipping_ref' : 'factory_ref';
    const d = await API.get(`/api/accounts/factory/history?${param}=${encodeURIComponent(factoryRef)}&factory_table=${encodeURIComponent(factoryTable)}`);
    const rows = d.rows || [];
    const body = document.getElementById('factory-pay-hist-body');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<div class="empty-state">No payments recorded yet.</div>';
      return;
    }
    const totalLabel = factoryTable === 'sea_costs' ? 'sea_costs' : factoryTable;
    body.innerHTML = `
      <div style="margin-bottom:10px;font-size:0.9rem;color:#555;">
        <b>${rows.length}</b> payment(s) &nbsp;|&nbsp; Total Paid: <b>USD ${fmtMoney(d.total_paid)}</b>
      </div>
      <div style="overflow-x:auto;">
      <table class="data-table" style="font-size:0.82rem;">
        <thead><tr>
          <th>Payment Ref.</th><th>Date</th><th>Amount (USD)</th>
          <th>Type</th><th>Mode</th><th>Status</th><th>Balance</th><th>Remarks</th>
        </tr></thead>
        <tbody>
          ${rows.map(p => `<tr>
            <td>${esc(p.payment_ref||'-')}</td>
            <td>${fmtDate(p.payment_date||p.entry_date)}</td>
            <td>USD ${fmtMoney(p.paid_amount)}</td>
            <td>${esc(p.payment_type||'-')}</td>
            <td>${esc(p.payment_mode||'-')}</td>
            <td>${p.payment_status ? badge(p.payment_status) : '-'}</td>
            <td>USD ${fmtMoney(p.balance_amount)}</td>
            <td class="desc-compact" title="${esc(p.remarks||'')}">${esc(p.remarks||'-')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>`;
  } catch(e) {
    const body = document.getElementById('factory-pay-hist-body');
    if (body) body.innerHTML = `<div class="error-state">Error: ${esc(e.message)}</div>`;
  }
}

// ── Add New Record: entry point ──────────────────────────────────────────────
// ins-quotes uses a dedicated multi-contract form; other sheets use the simple form.
async function openAddNewModal(sheet) {
  await _loadSuppliers().catch(() => {});
  if (sheet === 'ins-quotes') return _openInsQuotesAddModal();
  return _openSimpleAddModal(sheet);
}

// ── Add New: SL Fuji – New Orders (ins-quotes) ───────────────────────────────
// Multi-contract chip selector + per-line order lines table.
// Transaction-safe: creates factory master + all factory_contract_links in one request.
async function _openInsQuotesAddModal() {
  const payOpts = paymentStatusOptsFor('ins-quotes');
  const delOpts = deliveryStatusOptsFor('ins-quotes');

  openModal(`
    <h2>Add New Factory Order</h2>
    <div class="meta" style="margin-bottom:12px;">New Orders</div>
    <form id="add-new-factory-form">
      <div class="form-grid">
        ${formField('Factory Ref.', 'factory_ref', '')}
        <div class="form-field">
          <label>Our Ref. <span style="font-size:0.73rem;font-weight:400;color:#888;">(auto from linked contracts)</span></label>
          <input type="text" name="our_ref" class="form-input" placeholder="e.g. SH-259 / SH-260" style="background:#f8f9fa;">
        </div>
        <div class="form-field" style="grid-column:span 2;">
          <label>Common Client / Group Name
            <span style="font-size:0.73rem;font-weight:400;color:#888;margin-left:4px;">Auto-filled when linked contracts have the same client. Editable for factory-order identification only.</span>
          </label>
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="text" name="common_client_name" id="add-common-client" class="form-input" placeholder="e.g. Al Najam BC" style="flex:1;">
            <button type="button" id="add-common-client-reset" class="btn secondary" style="white-space:nowrap;font-size:0.78rem;padding:5px 10px;display:none;">↺ Auto-fill</button>
          </div>
        </div>
        ${_supplierFieldHtml(null, { required: true })}
      </div>

      <!-- ── Linked Sales Contracts ── -->
      <div style="border:1px solid #e2e6ea;border-radius:6px;padding:12px;margin:10px 0;">
        <div style="font-size:0.85rem;font-weight:600;color:#2c3e50;margin-bottom:8px;">
          Linked Sales Contracts
          <span style="font-size:0.75rem;font-weight:400;color:#888;margin-left:6px;">Each contract is verified individually</span>
        </div>

        <!-- Chips -->
        <div id="add-contract-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;min-height:30px;align-items:center;">
          <span style="color:#aaa;font-size:0.78rem;font-style:italic;">No contracts selected — search below</span>
        </div>

        <!-- Search -->
        <div style="position:relative;margin-bottom:6px;">
          <input id="add-contract-search" class="form-input" placeholder="Search by contract ref., client name, or project…" autocomplete="off" style="font-size:0.82rem;">
          <div id="add-contract-results" style="display:none;position:absolute;left:0;right:0;background:#fff;border:1px solid #cdd5de;border-radius:4px;z-index:9999;max-height:220px;overflow-y:auto;box-shadow:0 4px 14px rgba(0,0,0,0.13);top:calc(100% + 2px);"></div>
        </div>

        <!-- Verification summary -->
        <div id="add-verify-summary" style="display:none;font-size:0.78rem;margin-bottom:8px;"></div>

        <!-- Order lines table (shown when contracts selected) -->
        <div id="add-order-lines-wrap" style="display:none;margin-top:8px;">
          <div style="font-size:0.8rem;font-weight:600;color:#555;margin-bottom:4px;">Factory Order Lines <span style="font-weight:400;color:#888;">(enter per-contract factory details)</span></div>
          <div style="overflow-x:auto;">
            <table class="data-table" style="font-size:0.79rem;">
              <thead><tr>
                <th>Contract Ref.</th>
                <th>Client</th>
                <th style="text-align:center;">Contract<br>Units</th>
                <th style="text-align:center;">Allocated<br>Units *</th>
                <th>Factory Value</th>
                <th>Factory Invoice Ref.</th>
              </tr></thead>
              <tbody id="add-order-lines-body"></tbody>
            </table>
          </div>
          <div id="add-lines-totals" style="font-size:0.8rem;color:#555;margin-top:5px;border-top:1px solid #dee2e6;padding-top:5px;"></div>
        </div>
      </div>

      <!-- ── Financial & status fields ── -->
      <div class="form-grid">
        ${formField('Amount (USD)', 'factory_quote_amount', '', { type: 'number' })}
        ${formField('Currency', 'currency', 'USD', { select: CURRENCY_OPTS })}
        ${formField('Advance Payment', 'advance_payment', '', { type: 'number' })}
        ${formField('Total Paid', 'total_paid', '', { type: 'number' })}
        <div class="form-field"><label>Balance Payable</label><div id="add-balance-payable" style="font-weight:600;padding:6px 0;color:#2c3e50;">—</div></div>
        <div class="form-field">
          <label>Quantity (Units) <span id="add-qty-src-label" style="font-size:0.72rem;font-weight:400;color:#888;"></span></label>
          <input type="number" name="quantity" id="add-qty-input" class="form-input" min="0">
        </div>
        <div class="form-field"><label>Order Date <span style="font-size:0.72rem;font-weight:400;color:#888;">(Auto from Advance Payment)</span></label><div style="padding:6px 0;color:#aaa;font-style:italic;">Auto-filled from Advance Payment Date</div></div>
        ${formField('Payment Status', 'payment_status', 'Unpaid', { select: payOpts })}
        ${formField('Production Status', 'production_status', '', { select: ['', ...PRODUCTION_STATUS_OPTS] })}
        ${formField('Factory / Delivery Status', 'factory_delivery_status', '', { select: ['', ...delOpts] })}
        ${formField('Expected Delivery Date', 'expected_delivery_date', '', { type: 'date' })}
        ${formField('Remarks', 'remarks', '', { textarea: true, span2: true })}
      </div>

      <div class="modal-actions">
        <div class="spacer"></div>
        <button type="button" class="btn secondary" id="cancel-modal">Cancel</button>
        <button type="submit" class="btn">Save Factory Order</button>
      </div>
    </form>
  `);

  document.getElementById('cancel-modal').addEventListener('click', closeModal);

  // ── State: array of selected+configured contracts ──────────────────────────
  // Each entry: { contract_ref, client_name, emirate, elevator_units, linked_quantity, factory_value, factory_currency, factory_invoice_ref }
  const selected = [];
  // Track whether user manually edited the Common Client field — if so, don't overwrite on contract changes
  let _commonClientManualEdited = false;

  // ── Render chips ────────────────────────────────────────────────────────────
  function _renderChips() {
    const el = document.getElementById('add-contract-chips');
    if (!el) return;
    el.innerHTML = selected.length === 0
      ? '<span style="color:#aaa;font-size:0.78rem;font-style:italic;">No contracts selected — search below</span>'
      : selected.map((c, i) => `
          <span style="display:inline-flex;align-items:center;gap:4px;background:#e3f2fd;color:#1565c0;border-radius:14px;padding:3px 10px 3px 12px;font-size:0.79rem;font-weight:500;">
            ${esc(c.contract_ref)}
            <button type="button" class="add-chip-rm" data-i="${i}" style="background:none;border:none;cursor:pointer;color:#1565c0;font-size:0.88rem;line-height:1;padding:0 2px;" title="Remove">&times;</button>
          </span>`).join('');
    el.querySelectorAll('.add-chip-rm').forEach(btn => btn.addEventListener('click', () => {
      selected.splice(parseInt(btn.dataset.i), 1);
      _renderChips(); _renderLines(); _updateQtyOurRef(); _renderSummary();
    }));
  }

  // ── Render order lines table ────────────────────────────────────────────────
  function _renderLines() {
    const wrap = document.getElementById('add-order-lines-wrap');
    const tbody = document.getElementById('add-order-lines-body');
    const totals = document.getElementById('add-lines-totals');
    if (!wrap || !tbody) return;
    if (selected.length === 0) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';
    tbody.innerHTML = selected.map((c, i) => `<tr>
      <td><strong>${esc(c.contract_ref)}</strong></td>
      <td style="max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(c.client_name||'')}">${esc(c.client_name||'—')}</td>
      <td style="text-align:center;">${c.elevator_units != null ? c.elevator_units : '—'}</td>
      <td style="text-align:center;">
        <input type="number" min="0" max="${c.elevator_units||999}" value="${c.linked_quantity||1}" data-i="${i}"
          class="add-line-qty" style="width:55px;text-align:center;font-size:0.79rem;padding:3px 4px;border:1px solid #dee2e6;border-radius:3px;">
      </td>
      <td>
        <div style="display:flex;gap:3px;align-items:center;">
          <select data-i="${i}" class="add-line-cur" style="width:62px;font-size:0.78rem;padding:3px 2px;border:1px solid #dee2e6;border-radius:3px;">
            <option value="USD" ${(c.factory_currency||'USD')==='USD'?'selected':''}>USD</option>
            <option value="AED" ${c.factory_currency==='AED'?'selected':''}>AED</option>
            <option value="EUR" ${c.factory_currency==='EUR'?'selected':''}>EUR</option>
            <option value="GBP" ${c.factory_currency==='GBP'?'selected':''}>GBP</option>
          </select>
          <input type="number" step="0.01" min="0" data-i="${i}" class="add-line-fv"
            value="${c.factory_value != null ? c.factory_value : ''}" placeholder="0.00"
            style="width:88px;font-size:0.78rem;padding:3px 4px;border:1px solid #dee2e6;border-radius:3px;">
        </div>
      </td>
      <td>
        <input type="text" data-i="${i}" class="add-line-inv"
          value="${esc(c.factory_invoice_ref||'')}" placeholder="PI-XXX"
          style="width:90px;font-size:0.78rem;padding:3px 4px;border:1px solid #dee2e6;border-radius:3px;">
      </td>
    </tr>`).join('');

    tbody.querySelectorAll('.add-line-qty').forEach(el => el.addEventListener('input', () => {
      selected[+el.dataset.i].linked_quantity = parseInt(el.value) || 0;
      _updateQtyOurRef(); _renderLineTotals();
    }));
    tbody.querySelectorAll('.add-line-fv').forEach(el => el.addEventListener('input', () => {
      selected[+el.dataset.i].factory_value = parseFloat(el.value) || null;
      _renderLineTotals();
    }));
    tbody.querySelectorAll('.add-line-cur').forEach(el => el.addEventListener('change', () => {
      selected[+el.dataset.i].factory_currency = el.value;
      _renderLineTotals();
    }));
    tbody.querySelectorAll('.add-line-inv').forEach(el => el.addEventListener('input', () => {
      selected[+el.dataset.i].factory_invoice_ref = el.value.trim();
    }));
    _renderLineTotals();
  }

  function _renderLineTotals() {
    const el = document.getElementById('add-lines-totals');
    if (!el) return;
    const totalUnits = selected.reduce((s, c) => s + (parseInt(c.linked_quantity) || 0), 0);
    const byCur = {};
    selected.forEach(c => {
      if (c.factory_value) {
        const cur = c.factory_currency || 'USD';
        byCur[cur] = (byCur[cur] || 0) + (parseFloat(c.factory_value) || 0);
      }
    });
    const fvStr = Object.entries(byCur).map(([cur, v]) => `${cur} ${fmtMoney(v)}`).join(' &nbsp;|&nbsp; ');
    el.innerHTML = `<b>Contracts:</b> ${selected.length} &nbsp;|&nbsp; <b>Allocated Units:</b> ${totalUnits}${fvStr ? ` &nbsp;|&nbsp; <b>Factory Total:</b> ${fvStr}` : ''}`;
  }

  function _updateQtyOurRef() {
    const totalUnits = selected.reduce((s, c) => s + (parseInt(c.linked_quantity) || 0), 0);
    const qtyInput = document.getElementById('add-qty-input');
    const qtyLabel = document.getElementById('add-qty-src-label');
    if (qtyInput) {
      if (selected.length > 0) {
        qtyInput.value    = totalUnits;
        qtyInput.readOnly = true;
        qtyInput.style.background = '#f8f9fa';
        if (qtyLabel) qtyLabel.textContent = '(auto-calculated from linked contracts)';
      } else {
        qtyInput.readOnly = false;
        qtyInput.style.background = '';
        if (qtyLabel) qtyLabel.textContent = '';
      }
    }
    const ourRefInput = document.querySelector('[name="our_ref"]');
    if (ourRefInput && selected.length > 0) {
      ourRefInput.value = selected.map(c => c.contract_ref).join(' / ');
    }
    // ── Auto-populate Common Client / Group Name ─────────────────────────────
    _autoCommonClient();
  }

  // Derive common client from selected contracts and update the field (unless user manually edited it)
  function _autoCommonClient() {
    const ccInput   = document.getElementById('add-common-client');
    const ccReset   = document.getElementById('add-common-client-reset');
    if (!ccInput) return;
    // Compute derived value
    let derived = '';
    if (selected.length === 0) {
      derived = '';
    } else {
      const names = selected.map(c => (c.client_name || '').trim()).filter(Boolean);
      if (names.length === 0) {
        derived = '';
      } else {
        const uniqueNorm = [...new Set(names.map(n => n.toLowerCase()))];
        derived = uniqueNorm.length === 1 ? names[0] : 'Multiple Clients';
      }
    }
    if (!_commonClientManualEdited) {
      ccInput.value = derived;
    }
    // Show/hide Reset button when user has diverged from derived
    if (ccReset) {
      const hasDivergence = _commonClientManualEdited && derived && ccInput.value !== derived;
      ccReset.style.display = hasDivergence ? '' : 'none';
      ccReset.dataset.derived = derived;
    }
  }

  function _renderSummary() {
    const el = document.getElementById('add-verify-summary');
    if (!el) return;
    if (selected.length === 0) { el.style.display = 'none'; return; }
    const totalUnits = selected.reduce((s, c) => s + (parseInt(c.linked_quantity) || 1), 0);
    el.innerHTML = `<span style="background:#d4edda;color:#155724;border-radius:4px;padding:3px 10px;">✓ ${selected.length} Contract${selected.length !== 1 ? 's' : ''} Verified &nbsp;·&nbsp; ${totalUnits} Unit${totalUnits !== 1 ? 's' : ''} Linked</span>`;
    el.style.display = 'block';
  }

  // ── Contract search typeahead ────────────────────────────────────────────────
  let _srTimer = null;
  const _srInput = document.getElementById('add-contract-search');
  const _srDrop  = document.getElementById('add-contract-results');

  _srInput.addEventListener('input', () => {
    clearTimeout(_srTimer);
    const q = _srInput.value.trim();
    if (!q) { _srDrop.style.display = 'none'; return; }
    _srTimer = setTimeout(async () => {
      try {
        const sr = await API.get(`/api/factory/contract-search?q=${encodeURIComponent(q)}`);
        const hits = (sr.rows || []).filter(h => !selected.find(c => c.contract_ref === h.contract_ref));
        if (!hits.length) {
          _srDrop.innerHTML = '<div style="padding:8px 12px;color:#888;font-size:0.8rem;">No contracts found (or already added)</div>';
          _srDrop.style.display = 'block';
          return;
        }
        _srDrop.innerHTML = hits.map(h => `
          <div class="add-sr-hit"
            data-ref="${esc(h.contract_ref)}" data-client="${esc(h.client_name||'')}"
            data-emirate="${esc(h.emirate||'')}" data-units="${h.elevator_units||1}"
            style="padding:7px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;font-size:0.8rem;">
            <strong>${esc(h.contract_ref)}</strong>
            <span style="color:#555;margin-left:6px;">${esc(h.client_name||'')}</span>
            ${h.emirate ? `<span style="color:#888;margin-left:4px;">&middot; ${esc(h.emirate)}</span>` : ''}
            ${h.elevator_units ? `<span style="color:#777;margin-left:4px;">&middot; ${h.elevator_units} unit(s)</span>` : ''}
          </div>`).join('');
        _srDrop.querySelectorAll('.add-sr-hit').forEach(el => {
          el.addEventListener('mouseenter', () => { el.style.background = '#f0f4ff'; });
          el.addEventListener('mouseleave', () => { el.style.background = ''; });
          el.addEventListener('click', () => {
            selected.push({
              contract_ref:      el.dataset.ref,
              client_name:       el.dataset.client,
              emirate:           el.dataset.emirate,
              elevator_units:    parseInt(el.dataset.units) || 1,
              linked_quantity:   parseInt(el.dataset.units) || 1,
              factory_value:     null,
              factory_currency:  'USD',
              factory_invoice_ref: '',
            });
            _srInput.value = '';
            _srDrop.style.display = 'none';
            _renderChips();
            _renderLines();
            _updateQtyOurRef();
            _renderSummary();
          });
        });
        _srDrop.style.display = 'block';
      } catch(_) {}
    }, 220);
  });

  document.addEventListener('click', function _srOut(e) {
    if (!_srDrop.contains(e.target) && e.target !== _srInput) {
      _srDrop.style.display = 'none';
      document.removeEventListener('click', _srOut);
    }
  });

  // ── Common client manual-edit tracking & Reset button ───────────────────────
  const _ccInput = document.getElementById('add-common-client');
  const _ccReset = document.getElementById('add-common-client-reset');
  if (_ccInput) {
    _ccInput.addEventListener('input', () => {
      _commonClientManualEdited = true;
      _autoCommonClient(); // re-evaluate reset button visibility
    });
  }
  if (_ccReset) {
    _ccReset.addEventListener('click', () => {
      _commonClientManualEdited = false;
      _autoCommonClient();
    });
  }

  // ── Balance payable ─────────────────────────────────────────────────────────
  function _updateBal() {
    const amt  = parseFloat(document.querySelector('[name="factory_quote_amount"]')?.value) || 0;
    const paid = parseFloat(document.querySelector('[name="total_paid"]')?.value) || 0;
    const balDiv = document.getElementById('add-balance-payable');
    const pstEl  = document.querySelector('[name="payment_status"]');
    if (!balDiv) return;
    const bal = amt - paid;
    balDiv.textContent = 'USD ' + bal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    balDiv.style.color = bal < 0 ? '#c0392b' : '#2c3e50';
    if (pstEl) {
      const suggested = paid <= 0 ? 'Unpaid' : (paid >= amt ? 'Paid' : 'Partial');
      if (paymentStatusOptsFor('ins-quotes').includes(suggested)) pstEl.value = suggested;
    }
  }
  document.querySelector('[name="factory_quote_amount"]')?.addEventListener('input', _updateBal);
  document.querySelector('[name="total_paid"]')?.addEventListener('input', _updateBal);

  // ── Form submit ─────────────────────────────────────────────────────────────
  document.getElementById('add-new-factory-form').addEventListener('submit', async e => {
    e.preventDefault();
    const body = readForm(e.target);
    // Attach contract_links array for multi-contract mode
    if (selected.length > 0) {
      body.contract_links = selected.map(c => ({
        contract_ref:        c.contract_ref,
        linked_quantity:     c.linked_quantity ?? 1,
        factory_value:       c.factory_value   ?? null,
        factory_currency:    c.factory_currency || 'USD',
        factory_invoice_ref: c.factory_invoice_ref || null,
      }));
    }
    try {
      await API.post('/api/factory/ins-quotes', body);
      const linkMsg = selected.length > 0 ? ` — ${selected.length} contract${selected.length !== 1 ? 's' : ''} linked` : '';
      toast('Factory order saved' + linkMsg);
      closeModal();
      loadFactorySheet();
    } catch (err) {
      toast(err.message || 'Failed to save factory order', true);
    }
  });
}

// ── Add New: OTJ / SEA tabs (simple single-contract form) ────────────────────
async function _openSimpleAddModal(sheet) {
  const label           = SHEET_LABELS[sheet];
  const amountFieldName = sheet === 'sea-costs' ? 'sea_cost' : 'other_job_cost';
  const amountLabel     = sheet === 'sea-costs' ? 'Shipping Cost (USD)' : 'Amount';
  const payOpts         = paymentStatusOptsFor(sheet);
  const delOpts         = deliveryStatusOptsFor(sheet);

  openModal(`
    <h2>Add New Record</h2>
    <div class="meta" style="margin-bottom:12px;">${esc(label)}</div>
    <form id="add-new-factory-form">
      <div class="form-grid">
        ${formField(sheet === 'sea-costs' ? 'Shipping Ref.' : 'Factory Ref.', 'factory_ref', '')}
        ${formField('Our Ref.', 'our_ref', '')}
        ${formField(sheet === 'sea-costs' ? 'BL No. / Ref.' : 'Client / Company Name', 'client_name', '')}
        ${formField('Project Description', 'project_description', '', { textarea: true, span2: true })}
        ${_supplierFieldHtml(null, { required: sheet !== 'sea-costs' })}
        <div class="form-field" style="grid-column:span 2;">
          <label>Contract Ref.</label>
          <div style="display:flex;gap:6px;">
            <input type="text" name="contract_ref" placeholder="e.g. SH-2026-001" style="flex:1;" class="form-input">
            <button type="button" class="btn secondary" id="verify-contract-btn">Verify</button>
          </div>
          <div id="contract-verify-result" style="margin-top:4px;font-size:12px;"></div>
        </div>
        ${sheet === 'sea-costs' ? formField('ETD — Estimated Time of Departure', 'etd', '', { type: 'date' }) : ''}
        ${sheet === 'sea-costs' ? formField('ETA — Estimated Time of Arrival', 'bl_no', '', { type: 'date' }) : ''}
        ${formField(amountLabel, amountFieldName, '', { type: 'number' })}
        ${sheet === 'sea-costs' ? formField('Clearance Cost (AED)', 'clearance_cost', '', { type: 'number' }) : ''}
        ${sheet !== 'sea-costs' ? formField('Currency', 'currency', 'USD', { select: CURRENCY_OPTS }) : ''}
        ${sheet !== 'sea-costs' ? formField('Advance Payment', 'advance_payment', '', { type: 'number' }) : ''}
        ${formField(sheet === 'sea-costs' ? 'Total Paid (USD)' : 'Total Paid', 'total_paid', '', { type: 'number' })}
        ${sheet !== 'sea-costs' ? `<div class="form-field"><label>Balance Payable</label><div id="add-balance-payable" style="font-weight:600;padding:6px 0;color:#2c3e50;">—</div></div>` : ''}
        ${formField('Payment Status', 'payment_status', 'Unpaid', { select: payOpts })}
        ${sheet !== 'sea-costs' ? formField('Production Status', 'production_status', '', { select: ['', ...PRODUCTION_STATUS_OPTS] }) : ''}
        ${formField('Shipping Status',   'shipping_status',   '', { select: sheet === 'sea-costs' ? SEA_SHIPPING_STATUS_OPTS : ['', ...SHIPPING_STATUS_OPTS] })}
        ${formField('Delivery Status',   'delivery_status',   '', { select: sheet === 'sea-costs' ? SEA_DELIVERY_STATUS_NEW_OPTS : ['', ...DELIVERY_STATUS_OPTS] })}
        ${sheet !== 'sea-costs' ? formField('Factory / Delivery Status', 'factory_delivery_status', '', { select: ['', ...delOpts] }) : ''}
        ${sheet !== 'sea-costs' ? formField('Expected Delivery Date', 'expected_delivery_date', '', { type: 'date' }) : ''}
        ${formField('Remarks', 'remarks', '', { textarea: true, span2: true })}
      </div>
      <div class="modal-actions">
        <div class="spacer"></div>
        <button type="button" class="btn secondary" id="cancel-modal">Cancel</button>
        <button type="submit" class="btn">Save Record</button>
      </div>
    </form>
  `);

  document.getElementById('cancel-modal').addEventListener('click', closeModal);

  // Single contract verify
  document.getElementById('verify-contract-btn')?.addEventListener('click', async () => {
    const ref = document.querySelector('[name="contract_ref"]')?.value.trim();
    if (!ref) return;
    const result = document.getElementById('contract-verify-result');
    result.textContent = 'Checking…';
    try {
      const d = await API.get(`/api/factory/contract-lookup?contract_ref=${encodeURIComponent(ref)}`);
      result.innerHTML = d.found
        ? `<span style="color:#155724;">✓ Found — ${esc(d.contract?.client_name || '')}${d.contract?.emirate ? ', ' + esc(d.contract.emirate) : ''}</span>`
        : `<span style="color:#856404;">⚠ Contract Ref. not found in Contracts</span>`;
    } catch { result.textContent = 'Lookup failed'; }
  });

  // Balance payable
  function _updateBal() {
    const amtEl  = document.querySelector(`[name="${amountFieldName}"]`);
    const clrEl  = document.querySelector('[name="clearance_cost"]');
    const paidEl = document.querySelector('[name="total_paid"]');
    const balDiv = document.getElementById('add-balance-payable');
    const pstEl  = document.querySelector('[name="payment_status"]');
    if (!amtEl || !paidEl) return;
    const amt  = parseFloat(amtEl.value) || 0;
    const clr  = clrEl ? (parseFloat(clrEl.value) || 0) : 0;
    const paid = parseFloat(paidEl.value) || 0;
    const bal  = amt + (sheet === 'sea-costs' ? 0 : clr) - paid;   // never add USD shipping + AED clearance
    if (balDiv) {
      balDiv.textContent = 'USD ' + bal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      balDiv.style.color = bal < 0 ? '#c0392b' : '#2c3e50';
    }
    if (pstEl) {
      const suggested = paid <= 0 ? 'Unpaid' : (paid >= (sheet === 'sea-costs' ? amt : amt + clr) ? (sheet === 'sea-costs' ? 'Full Paid' : 'Paid') : 'Partial');
      if (paymentStatusOptsFor(sheet).includes(suggested)) pstEl.value = suggested;
    }
  }
  document.querySelector(`[name="${amountFieldName}"]`)?.addEventListener('input', _updateBal);
  document.querySelector('[name="clearance_cost"]')?.addEventListener('input', _updateBal);
  document.querySelector('[name="total_paid"]')?.addEventListener('input', _updateBal);

  document.getElementById('add-new-factory-form').addEventListener('submit', async e => {
    e.preventDefault();
    const body = readForm(e.target);
    if (sheet === 'sea-costs' && body.etd && body.bl_no && body.bl_no < body.etd)
      toast('ETA is earlier than ETD. Please verify the shipment dates.', 'warn');
    try {
      await API.post(`/api/factory/${sheet}`, body);
      toast('Record added to ' + label);
      closeModal();
      loadFactorySheet();
    } catch (err) { toast(err.message, true); }
  });
}


// ══════════════════════════════════════════════════════════════════════════════
// 2026-10-03: SUPPLIER MASTER (Factory & Suppliers)
//   • Supplier / Factory on orders is selected from the master (supplier_id) —
//     no free text, so "SL FUJI" / "SL Fuji" can never split again.
//   • + Add Supplier / Manage Suppliers (Admin) — duplicate names are refused
//     (case / space-insensitive). Used suppliers are deactivated, never deleted.
// ══════════════════════════════════════════════════════════════════════════════
const FactorySup = { list: [], canManage: false, meta: null, loaded: 0 };
async function _loadSuppliers(force) {
  if (!force && FactorySup.loaded && Date.now() - FactorySup.loaded < 30000) return FactorySup.list;
  const [d, meta] = await Promise.all([API.get('/api/suppliers'), FactorySup.meta ? Promise.resolve(FactorySup.meta) : API.get('/api/suppliers/meta')]);
  FactorySup.list = d.rows || []; FactorySup.canManage = !!d.can_manage; FactorySup.meta = meta; FactorySup.loaded = Date.now();
  return FactorySup.list;
}
function _supplierOptionsHtml(currentId) {
  const cur = currentId != null && currentId !== '' ? Number(currentId) : null;
  const opts = FactorySup.list.filter(x => x.status === 'Active' || x.id === cur)
    .map(x => `<option value="${x.id}" ${x.id === cur ? 'selected' : ''}>${esc(x.name)}${x.status !== 'Active' ? ' (Inactive)' : ''}</option>`);
  return `<option value="">-- Select Supplier --</option>${opts.join('')}${FactorySup.canManage ? '<option value="__new__">+ Add New Supplier…</option>' : ''}`;
}
/** Supplier / Factory select for factory forms (name="supplier_id"). */
function _supplierFieldHtml(currentId, opts) {
  opts = opts || {};
  const legacy = currentId == null && opts.current ? `<div style="font-size:0.72rem;color:#856404;margin-top:2px;">Stored as "${esc(opts.current)}" — select the supplier from the list.</div>` : '';
  return `<div class="form-field"><label>Supplier / Factory${opts.required ? ' *' : ''}</label>
    <select name="supplier_id" data-supplier-select="1" ${opts.required ? 'required' : ''}>${_supplierOptionsHtml(currentId)}</select>${legacy}</div>`;
}
// "+ Add New Supplier…" inside any supplier select: opens the supplier form ON TOP of the
// current order form (which stays intact) and selects the new supplier when saved.
document.addEventListener('change', e => {
  const sel = e.target;
  if (!sel || !sel.matches || !sel.matches('select[data-supplier-select]') || sel.value !== '__new__') return;
  sel.value = sel.dataset.prev || '';
  openSupplierForm(null, async sup => {
    await _loadSuppliers(true);
    document.querySelectorAll('select[data-supplier-select]').forEach(x => {
      const keep = x === sel ? sup.id : x.value; x.innerHTML = _supplierOptionsHtml(keep); x.value = String(keep || '');
    });
    sel.dataset.prev = String(sup.id);
  });
});
document.addEventListener('focusin', e => { if (e.target && e.target.matches && e.target.matches('select[data-supplier-select]')) e.target.dataset.prev = e.target.value; });

/** Supplier form in a stacked overlay (does not replace the open modal). */
function openSupplierForm(sup, onSaved) {
  const meta = FactorySup.meta || { types: ['Elevator Factory', 'Component Supplier', 'Shipping / Logistics', 'Other'], statuses: ['Active', 'Inactive'] };
  const s0 = sup || {};
  const ov = document.createElement('div');
  ov.id = 'supplier-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(16,42,67,.45);z-index:10050;display:flex;align-items:flex-start;justify-content:center;padding-top:6vh';
  const f = (label, name, val, attrs) => `<div class="form-field"><label>${label}</label><input name="${name}" value="${esc(val || '')}" ${attrs || ''}></div>`;
  const sel = (label, name, val, list) => `<div class="form-field"><label>${label}</label><select name="${name}">${list.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
  ov.innerHTML = `<div style="background:#fff;border-radius:10px;box-shadow:0 14px 38px rgba(15,44,78,.25);width:min(640px,94vw);max-height:88vh;overflow:auto;padding:18px 22px">
    <h3 style="margin:0 0 10px">${sup ? 'Edit Supplier' : 'Add Supplier'}</h3>
    <form id="supplier-form"><div class="form-grid">
      <div class="form-field" style="grid-column:span 2"><label>Supplier Name *</label><input name="name" required value="${esc(s0.name || '')}" autocomplete="off">
        <div id="sup-dup" style="font-size:12px;margin-top:3px"></div></div>
      ${f('Supplier Code', 'code', s0.code, 'maxlength="20" placeholder="e.g. SLF"')}
      ${sel('Supplier Type', 'supplier_type', s0.supplier_type || 'Elevator Factory', ['', ...meta.types])}
      ${f('Country', 'country', s0.country)}
      ${f('Contact Person', 'contact_person', s0.contact_person)}
      ${f('Telephone', 'telephone', s0.telephone)}
      ${f('Mobile', 'mobile', s0.mobile)}
      ${f('E-mail', 'email', s0.email, 'type="email"')}
      ${sel('Status *', 'status', s0.status || 'Active', meta.statuses)}
      <div class="form-field" style="grid-column:span 2"><label>Address</label><input name="address" value="${esc(s0.address || '')}"></div>
      <div class="form-field" style="grid-column:span 2"><label>Remarks</label><textarea name="remarks" rows="2">${esc(s0.remarks || '')}</textarea></div>
    </div>
    <div class="modal-actions"><div class="spacer"></div><button type="button" class="btn secondary" id="sup-cancel">Cancel</button><button type="submit" class="btn" id="sup-save">Save Supplier</button></div></form></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector('#sup-cancel').addEventListener('click', close);
  const nameEl = ov.querySelector('input[name=name]'), dupEl = ov.querySelector('#sup-dup');
  nameEl.focus();
  nameEl.addEventListener('input', debounce(async () => {
    const v = nameEl.value.trim(); if (!v) { dupEl.textContent = ''; return; }
    try {
      const r = await API.get('/api/suppliers/check?name=' + encodeURIComponent(v));
      dupEl.innerHTML = r.exists && (!sup || r.supplier.id !== sup.id)
        ? `<span style="color:#c0392b">Supplier already exists as <b>${esc(r.supplier.name)}</b>${r.supplier.status !== 'Active' ? ' (Inactive)' : ''}.</span>` : '';
    } catch (_) {}
  }, 300));
  ov.querySelector('#supplier-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = ov.querySelector('#sup-save'); if (btn.disabled) return; btn.disabled = true;
    const body = readForm(e.target);
    try {
      const r = sup ? await API.patch(`/api/suppliers/${sup.id}`, body) : await API.post('/api/suppliers', body);
      const saved = r.supplier;
      toast(sup ? `Supplier ${saved.name} updated` : `Supplier ${saved.name} added`);
      close(); FactorySup.loaded = 0;
      if (onSaved) onSaved(saved);
    } catch (err) { toast(err.message || 'Unable to save supplier', true); btn.disabled = false; }
  });
}

/** Supplier Master list (Edit / Deactivate / Activate; Delete only for never-used suppliers). */
let _msShowInactive = false;
async function openManageSuppliers(onChange) {
  await _loadSuppliers(true);
  const can = FactorySup.canManage, isAdmin = APP.user && APP.user.role === 'admin';
  const inactiveCount = FactorySup.list.filter(x => x.status !== 'Active').length;
  const rows = FactorySup.list.filter(x => _msShowInactive || x.status === 'Active');
  openModal(`<h2>Supplier Master</h2>
    <div class="meta" style="margin-bottom:10px">One record per supplier — orders and payments link to it by ID. Suppliers used on records are deactivated, never deleted.</div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      ${can ? '<button class="btn small" id="ms-add">+ Add Supplier</button>' : ''}
      <label style="font-size:12px;color:#556;display:flex;align-items:center;gap:4px;margin-left:auto">
        <input type="checkbox" id="ms-show-inactive" ${_msShowInactive ? 'checked' : ''}> Show inactive / archived${inactiveCount ? ` (${inactiveCount})` : ''}</label>
    </div>
    <div class="table-wrap"><table class="data-table" style="font-size:12.5px"><thead><tr>
      <th>Supplier Name</th><th>Code</th><th>Type</th><th>Country</th><th>Contact Person</th><th>Mobile</th><th>E-mail</th><th>Status</th>
      <th style="text-align:right">Orders</th><th style="text-align:right">Payments</th><th></th></tr></thead><tbody>
      ${rows.length ? rows.map(x => `<tr>
        <td style="font-weight:600">${esc(x.name)}</td><td>${esc(x.code || '')}</td><td>${esc(x.supplier_type || '')}</td><td>${esc(x.country || '')}</td>
        <td>${esc(x.contact_person || '')}</td><td>${esc(x.mobile || '')}</td><td>${esc(x.email || '')}</td>
        <td>${x.status === 'Active' ? '<span class="badge" style="background:#d1eddd;color:#1a6a35">Active</span>' : '<span class="badge" style="background:#eef2f6;color:#66758a">Inactive</span>'}</td>
        <td style="text-align:right">${x.orders}</td><td style="text-align:right">${x.payments}</td>
        <td style="white-space:nowrap">${can ? `<button class="btn small secondary" data-ms-edit="${x.id}">Edit</button>
          <button class="btn small secondary" data-ms-status="${x.id}">${x.status === 'Active' ? 'Deactivate' : 'Activate'}</button>
          ${isAdmin && !x.linked ? `<button class="btn small danger" data-ms-del="${x.id}">Delete</button>` : ''}` : ''}</td></tr>`).join('')
      : `<tr><td colspan="11" class="empty-state">${_msShowInactive ? 'No suppliers yet.' : 'No active suppliers.'}</td></tr>`}
    </tbody></table></div>
    <div class="modal-actions"><div class="spacer"></div><button class="btn secondary" id="ms-close">Close</button></div>`, { wide: true });
  const refresh = () => { FactorySup.loaded = 0; openManageSuppliers(onChange); if (onChange) onChange(); };
  document.getElementById('ms-close').addEventListener('click', () => { closeModal(); if (onChange) onChange(); });
  document.getElementById('ms-show-inactive').addEventListener('change', e => { _msShowInactive = e.target.checked; openManageSuppliers(onChange); });
  const add = document.getElementById('ms-add'); if (add) add.addEventListener('click', () => openSupplierForm(null, refresh));
  document.querySelectorAll('[data-ms-edit]').forEach(b => b.addEventListener('click', () =>
    openSupplierForm(rows.find(x => String(x.id) === b.dataset.msEdit), refresh)));
  document.querySelectorAll('[data-ms-status]').forEach(b => b.addEventListener('click', async () => {
    const x = rows.find(r => String(r.id) === b.dataset.msStatus);
    const to = x.status === 'Active' ? 'Inactive' : 'Active';
    if (to === 'Inactive' && !confirm(`Deactivate ${x.name}? It stays on its ${x.orders} historical order(s) but is hidden from new orders.`)) return;
    try { await API.patch(`/api/suppliers/${x.id}`, { status: to }); toast(`${x.name} ${to === 'Active' ? 'activated' : 'deactivated'}`); refresh(); }
    catch (err) { toast(err.message, true); }
  }));
  document.querySelectorAll('[data-ms-del]').forEach(b => b.addEventListener('click', async () => {
    const x = rows.find(r => String(r.id) === b.dataset.msDel);
    if (!confirm(`Delete supplier ${x.name}? (It is not used by any record.)`)) return;
    try { await API.del(`/api/suppliers/${x.id}`); toast('Supplier deleted'); refresh(); } catch (err) { toast(err.message, true); }
  }));
}
