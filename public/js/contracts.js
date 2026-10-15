const ContractsState = { sub: 'list', page: 1, filters: {}, salespeople: [], emirates: [] };
const CANCELLATION_TYPE_OPTIONS = ['Cancelled', 'Terminated'];
const PAYMENT_RETENTION_OPTIONS = ['Payment Retained', 'Partially Refunded', 'Fully Refunded'];
const REFUND_STATUS_OPTIONS = ['No Refund', 'Partial Refund', 'Full Refund'];
const CONTRACT_EDITOR_ROLES = ['admin', 'accounts'];
const EMIRATE_OPTIONS = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'UAQ', 'RAK', 'Fujairah', 'Al Ain', 'Dibba'];
const DELIVERY_STATUS_OPTIONS = ['Hold', 'Active', 'Shipping', 'Delivered', 'Cancel'];
const MECH_ELEC_STATUS_OPTIONS = ['Hold', 'Completed'];
const MONTH_OPTIONS = [
  ['01', 'January'], ['02', 'February'], ['03', 'March'], ['04', 'April'], ['05', 'May'], ['06', 'June'],
  ['07', 'July'], ['08', 'August'], ['09', 'September'], ['10', 'October'], ['11', 'November'], ['12', 'December'],
];

function isContractEditor() {
  return APP.user && CONTRACT_EDITOR_ROLES.includes(APP.user.role);
}

// Project Status badge — colour-coded pill for the 4 project statuses.
function projectStatusBadge(status) {
  const map = { Active: '#27ae60', Hold: '#f39c12', Delay: '#e67e22', Cancelled: '#e74c3c' };
  const bg = map[status] || '#95a5a6';
  return `<span style="display:inline-block;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:600;background:${bg};color:#fff;white-space:nowrap">${esc(status || 'Active')}</span>`;
}

// Display: date (DD/MM/YYYY) if set, else legacy badge/status. Blank = dash.
function milestoneCell(dateVal, legacyStatus) {
  if (dateVal) return `<span style="font-size:12px;color:#2d3748">${fmtDate(dateVal)}</span>`;
  if (legacyStatus) return badge(legacyStatus);
  return '<span style="color:#ccc">—</span>';
}

// Form field for milestone date: shows legacy value badge + date picker for existing records,
// date picker only for new records.
function renderMilestoneField(label, fieldName, dateVal, legacyStatus, isNew, editable) {
  const dateInput = editable
    ? `<input type="date" name="${fieldName}" value="${dateVal ? String(dateVal).slice(0, 10) : ''}" style="width:100%;box-sizing:border-box;margin-top:4px">`
    : `<div style="padding:6px 0;font-size:13px;color:#2d3748">${dateVal ? fmtDate(dateVal) : '<span style="color:#ccc">—</span>'}</div>`;
  const legacyBadge = (!isNew && legacyStatus)
    ? `<div style="margin-bottom:4px;font-size:11px;color:#888">Existing value: ${badge(legacyStatus)}</div>`
    : '';
  return `<div class="form-field"><label>${esc(label)}</label>${legacyBadge}${dateInput}</div>`;
}

async function renderContracts(root) {
  ContractsState.salespeople = (await API.get('/api/contracts/meta/salespeople')).rows || [];
  root.innerHTML = `
    <div class="tabs" id="contracts-tabs">
      <div class="tab ${ContractsState.sub === 'list' ? 'active' : ''}" data-sub="list">Contracts List</div>
      <div class="tab ${ContractsState.sub === 'dashboard' ? 'active' : ''}" data-sub="dashboard">Dashboard</div>
      <div class="tab ${ContractsState.sub === 'targets' ? 'active' : ''}" data-sub="targets">Yearly Targets</div>
    </div>
    <div id="contracts-sub-root"></div>
  `;
  document.querySelectorAll('#contracts-tabs .tab').forEach(t => t.addEventListener('click', () => {
    ContractsState.sub = t.dataset.sub;
    renderContracts(root);
  }));
  const subRoot = document.getElementById('contracts-sub-root');
  if (ContractsState.sub === 'dashboard') return renderContractsDashboard(subRoot);
  if (ContractsState.sub === 'targets') return renderContractsTargets(subRoot);
  return renderContractsList(subRoot);
}

// ---------------- List ----------------
async function renderContractsList(root) {
  const SORT_OPTS = [
    ['approval_date', 'Approval Date'], ['handover_date', 'Handover Date'],
    ['contract_value', 'Contract Value'], ['contract_ref', 'Contract Ref.'], ['client_name', 'Client Name'],
    ['elevator_units', 'Elevator Units'], ['project_status', 'Project Status'],
    ['delivery_status', 'Delivery Status'],
    ['delivery_date', 'Delivery Date'], ['mechanical_completion_date', 'Mech. Completion Date'],
    ['electrical_completion_date', 'Elec. Completion Date'],
  ];
  const yearOpts = []; const thisYear = new Date().getFullYear();
  for (let y = thisYear; y >= thisYear - 8; y--) yearOpts.push(y);

  root.innerHTML = `
    <div class="toolbar">
      <input type="text" id="cf-search" placeholder="Search contract ref, quote ref, client...">
      <select id="cf-sales"><option value="">All Salespeople</option>${ContractsState.salespeople.map(s => `<option>${esc(s)}</option>`).join('')}</select>
      <select id="cf-emirate"><option value="">All Emirates</option>${EMIRATE_OPTIONS.map(e => `<option>${esc(e)}</option>`).join('')}</select>
      <select id="cf-year"><option value="">All Years</option>${yearOpts.map(y => `<option>${y}</option>`).join('')}</select>
      <select id="cf-month"><option value="">All Months</option>${MONTH_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <select id="cf-project-status"><option value="">All Project Statuses</option><option value="Active">Active</option><option value="Hold">On Hold</option><option value="Delay">Delayed</option><option value="Cancelled">Cancelled</option></select>
      <select id="cf-cancel"><option value="">All Cancellation Types</option><option value="show_cancelled">Cancelled / Terminated</option>${CANCELLATION_TYPE_OPTIONS.map(o => `<option value="${o}">${o} After Payment</option>`).join('')}</select>
      <input type="text" id="cf-factory-ref" placeholder="Factory Ref. filter..." style="width:140px">
      <select id="cf-sort">${SORT_OPTS.map(([v, l]) => `<option value="${v}">Sort: ${l}</option>`).join('')}</select>
      <select id="cf-dir"><option value="desc">Descending</option><option value="asc">Ascending</option></select>
      <div class="spacer"></div>
      <a id="cf-export-xlsx" class="btn secondary" href="/api/reports/contracts-list.xlsx" target="_blank">Export Excel</a>
      <a id="cf-export-pdf" class="btn secondary" href="/api/reports/contracts-list.pdf" target="_blank">Export PDF</a>
      <button type="button" class="btn secondary" id="cf-print" title="Print Contracts List">🖨 Print</button>
      ${isContractEditor() ? `<button class="btn" id="cf-add">+ New Contract</button>` : ''}
    </div>
    <div class="table-wrap"><table class="data-table contracts-table">
      <thead><tr>
        <th class="ccol-ref">Contract Ref.</th><th class="ccol-quote">Quotation Ref.</th><th class="ccol-client">Client / Company</th><th class="ccol-emirate">Emirate</th><th class="ccol-units" title="Elevator Units">Units</th><th class="ccol-date">Approval Date</th>
        <th class="ccol-sales">Sales By</th><th class="ccol-pstatus">Project Status</th><th class="ccol-status">Delivery Date</th><th class="ccol-status">Mech. Completion</th><th class="ccol-status">Elec. Completion</th><th class="ccol-handover">Handover Date</th>
        <th class="ccol-value">Contract Value</th><th class="ccol-factory">Factory Ref.</th><th class="ccol-maint" title="Maintenance Link">Maint.</th>
      </tr></thead>
      <tbody id="contracts-tbody"><tr><td colspan="15">Loading...</td></tr></tbody>
    </table></div>
    <div class="pagination" id="contracts-pagination"></div>
  `;
  document.getElementById('cf-search').addEventListener('input', debounce(() => { ContractsState.filters.search = document.getElementById('cf-search').value; ContractsState.page = 1; loadContractsList(); }, 350));
  document.getElementById('cf-sales').addEventListener('change', (e) => { ContractsState.filters.sales_by = e.target.value; ContractsState.page = 1; loadContractsList(); });
  document.getElementById('cf-emirate').addEventListener('change', (e) => { ContractsState.filters.emirate = e.target.value; ContractsState.page = 1; loadContractsList(); });
  document.getElementById('cf-year').addEventListener('change', (e) => { ContractsState.filters.year = e.target.value; ContractsState.page = 1; loadContractsList(); });
  document.getElementById('cf-month').addEventListener('change', (e) => { ContractsState.filters.monthNum = e.target.value; ContractsState.page = 1; loadContractsList(); });
  document.getElementById('cf-project-status').addEventListener('change', (e) => { ContractsState.filters.project_status = e.target.value; ContractsState.page = 1; loadContractsList(); });
  document.getElementById('cf-cancel').addEventListener('change', (e) => {
    const v = e.target.value;
    ContractsState.filters.cancellation_type = (v && v !== 'show_cancelled') ? v : '';
    ContractsState.filters.cancelled_only = v === 'show_cancelled' ? '1' : '';
    ContractsState.page = 1; loadContractsList();
  });
  document.getElementById('cf-sort').addEventListener('change', (e) => { ContractsState.filters.sort = e.target.value; loadContractsList(); });
  document.getElementById('cf-dir').addEventListener('change', (e) => { ContractsState.filters.dir = e.target.value; loadContractsList(); });
  document.getElementById('cf-factory-ref').addEventListener('input', debounce(() => { ContractsState.filters.factory_ref = document.getElementById('cf-factory-ref').value; ContractsState.page = 1; loadContractsList(); }, 350));
  const addBtn = document.getElementById('cf-add');
  if (addBtn) addBtn.addEventListener('click', () => openContractModal(null));
  document.getElementById('cf-print').addEventListener('click', printContractsList);
  await loadContractsList();
}

// Single source for the list's filter/sort query string — used by BOTH the
// on-screen list and Print, so the printed result can never diverge from the list.
function buildContractsListParams(page, pageSize) {
  const params = new URLSearchParams({ page, pageSize });
  const f = ContractsState.filters;
  Object.entries(f).forEach(([k, v]) => { if (v && k !== 'monthNum') params.set(k, v); });
  // Month-wise filter only makes sense combined with a year (approval_date is stored as YYYY-MM-DD)
  if (f.monthNum) params.set('month', `${f.year || new Date().getFullYear()}-${f.monthNum}`);
  return params;
}

// ── Print Contracts List (2026-09-29) ─────────────────────────────────────────
// Prints the COMPLETE filtered + sorted result set (all pages), fetched from the
// same authoritative /api/contracts endpoint (same permissions) — never the DOM.
// Read-only: performs GET requests only.
async function printContractsList() {
  const btn = document.getElementById('cf-print');
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
  try {
    const PAGE = 500;                         // backend maximum page size
    let page = 1, total = 0, rows = [];
    do {
      const d = await API.get('/api/contracts?' + buildContractsListParams(page, PAGE).toString());
      total = d.total; rows = rows.concat(d.rows || []); page++;
      if (!d.rows || !d.rows.length) break;
    } while (rows.length < total);
    if (rows.length !== total) throw new Error(`Print aborted: fetched ${rows.length} of ${total} contracts.`);

    const f = ContractsState.filters;
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const sortSel = document.getElementById('cf-sort');
    const sortLabel = sortSel && sortSel.selectedOptions[0] ? sortSel.selectedOptions[0].textContent.replace(/^Sort:\s*/, '') : 'Approval Date';
    const cancelSel = document.getElementById('cf-cancel');
    const cancelLabel = cancelSel && cancelSel.value ? cancelSel.selectedOptions[0].textContent : '';
    const filters = {
      'Search': f.search, 'Salesperson': f.sales_by, 'Emirate': f.emirate,
      'Year': f.year, 'Month': f.monthNum ? `${MONTHS[parseInt(f.monthNum, 10) - 1]} ${f.year || new Date().getFullYear()}` : '',
      'Project Status': f.project_status, 'Cancellation': cancelLabel, 'Factory Ref.': f.factory_ref,
    };
    const anyFilter = Object.values(filters).some(v => v && String(v).trim());
    filters['Sort'] = `${sortLabel} (${(f.dir || 'desc') === 'asc' ? 'Ascending' : 'Descending'})`;
    if (!anyFilter) filters['Scope'] = 'All Contracts';

    const dmy = v => v ? fmtDateDMY(v) : '—';
    const milestone = (dateVal, legacy) => dateVal ? fmtDateDMY(dateVal) : (legacy ? esc(legacy) : '—');
    const totalUnits = rows.reduce((s, c) => s + (parseInt(c.elevator_units, 10) || 1), 0);
    const totalValue = rows.reduce((s, c) => s + (Number(c.contract_value) || 0), 0);

    const body = rows.map((c, i) => `<tr${i % 2 ? ' class="sh-print-alt"' : ''}>
      <td>${esc(c.contract_ref || '—')}</td>
      <td>${esc(c.quote_ref || '—')}</td>
      <td class="ccp-client">${esc(c.client_name || '—')}</td>
      <td>${esc(c.emirate || '—')}</td>
      <td class="ccp-c">${c.elevator_units || 1}</td>
      <td class="ccp-d">${dmy(c.approval_date)}</td>
      <td class="ccp-c">${esc(c.sales_by || '—')}</td>
      <td class="ccp-c"><strong>${esc(c.project_status || 'Active')}</strong></td>
      <td class="ccp-d">${milestone(c.delivery_date, c.delivery_status)}</td>
      <td class="ccp-d">${milestone(c.mechanical_completion_date, c.mechanical_status)}</td>
      <td class="ccp-d">${milestone(c.electrical_completion_date, c.electrical_status)}</td>
      <td class="ccp-d">${dmy(c.handover_date)}</td>
      <td class="ccp-r">${c.contract_value != null && c.contract_value !== '' ? fmtCurrency(c.contract_value, 'AED') : '—'}</td>
      <td>${c.factory_ref_count > 0 ? esc(c.linked_factory_refs || '') : 'Not Linked'}</td>
      <td class="ccp-c">${c.has_maintenance_link ? 'Linked' : 'Not Linked'}</td>
    </tr>`).join('');

    const contentHtml = `
      <div class="ccp-summary">
        <span>Total Contracts: <strong>${total}</strong></span>
        <span>Total Elevator Units: <strong>${totalUnits}</strong></span>
        <span>Total Contract Value: <strong>${fmtCurrency(totalValue, 'AED')}</strong></span>
      </div>
      ${rows.length ? `<table class="sh-print-table ccp-table">
        <colgroup>
          <col style="width:7.2%"><col style="width:5.4%"><col style="width:15.5%"><col style="width:5.6%">
          <col style="width:3.4%"><col style="width:6.4%"><col style="width:4.2%"><col style="width:5.8%">
          <col style="width:6.6%"><col style="width:6.6%"><col style="width:6.6%"><col style="width:6.4%">
          <col style="width:8.2%"><col style="width:7%"><col style="width:5.1%">
        </colgroup>
        <thead><tr>
          <th>Contract Ref.</th><th>Quotation Ref.</th><th>Client / Company</th><th>Emirate</th>
          <th class="ccp-c">Units</th><th>Approval Date</th><th class="ccp-c">Sales By</th><th class="ccp-c">Project Status</th>
          <th>Delivery Date</th><th>Mech. Completion</th><th>Elec. Completion</th><th>Handover Date</th>
          <th class="ccp-r">Contract Value</th><th>Factory Ref.</th><th class="ccp-c">Maintenance</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="sh-print-record-count">${total} contract${total === 1 ? '' : 's'} · ${totalUnits} elevator unit${totalUnits === 1 ? '' : 's'}</div>`
      : '<div class="sh-print-empty">No contracts match the current filters.</div>'}`;

    shPrint({
      title: 'Contracts List Report',
      subtitle: `Report Date: ${fmtDateDMY(new Date().toISOString().slice(0, 10))}`,
      contentHtml, landscape: true, filters,
    });
  } catch (e) {
    toast(e.message || 'Unable to prepare the Contracts List print', true);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '🖨 Print'; }
  }
}

async function loadContractsList() {
  const params = buildContractsListParams(ContractsState.page, 50);
  const f = ContractsState.filters;
  const data = await API.get('/api/contracts?' + params.toString());
  // Sync export links with current sort + filters so Excel/PDF match screen
  const xlsxEl = document.getElementById('cf-export-xlsx');
  const pdfEl  = document.getElementById('cf-export-pdf');
  if (xlsxEl || pdfEl) {
    const ep = new URLSearchParams();
    if (f.search)   ep.set('search', f.search);
    if (f.sales_by) ep.set('salesperson', f.sales_by);
    if (f.emirate)  ep.set('emirate', f.emirate);
    if (f.year)     ep.set('year', f.year);
    if (f.sort)     ep.set('sort_by', f.sort);
    if (f.dir)      ep.set('sort_dir', f.dir);
    const qs = ep.toString() ? '?' + ep.toString() : '';
    if (xlsxEl) xlsxEl.href = '/api/reports/contracts-list.xlsx' + qs;
    if (pdfEl)  pdfEl.href  = '/api/reports/contracts-list.pdf'  + qs;
  }
  const tbody = document.getElementById('contracts-tbody');
  if (!data.rows.length) {
    tbody.innerHTML = '<tr><td colspan="15" class="empty-state">No contracts found</td></tr>';
  } else {
    tbody.innerHTML = data.rows.map(c => `
      <tr>
        <td class="clickable" data-id="${c.id}" title="${esc(c.contract_ref || '')}">${esc(c.contract_ref)}</td>
        <td title="${esc(c.quote_ref || '')}">${esc(c.quote_ref || '-')}</td>
        <td title="${esc(c.client_name || '')}">${esc(c.client_name || '-')}</td>
        <td>${esc(c.emirate || '-')}</td>
        <td style="text-align:center;font-weight:600">${c.elevator_units || 1}</td>
        <td>${fmtDate(c.approval_date)}</td>
        <td>${esc(c.sales_by || '-')}</td>
        <td style="text-align:center">${projectStatusBadge(c.project_status || 'Active')}</td>
        <td>${milestoneCell(c.delivery_date, c.delivery_status)}</td>
        <td>${milestoneCell(c.mechanical_completion_date, c.mechanical_status)}</td>
        <td>${milestoneCell(c.electrical_completion_date, c.electrical_status)}</td>
        <td>${fmtDate(c.handover_date)}</td>
        <td class="ccol-value" title="${esc(fmtCurrency(c.contract_value, 'AED'))}">${fmtCurrency(c.contract_value, 'AED')}</td>
        <td style="white-space:nowrap" title="${esc(c.linked_factory_refs || '')}">${
          c.factory_ref_count > 1
            ? `<button onclick="event.stopPropagation();openContractModal(${c.id},'factory')" title="${esc(c.linked_factory_refs || '')}" style="background:#e3f2fd;color:#1565c0;border:none;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;white-space:nowrap;font-weight:600">${esc(String(c.linked_factory_refs || '').split(', ')[0])} +${c.factory_ref_count - 1}</button>`
            : c.factory_ref_count === 1
              ? `<span style="background:#e8f5e9;color:#1b5e20;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;white-space:nowrap">${esc(c.linked_factory_refs)}</span>`
              : `<span style="color:#bbb;font-size:11px">Not Linked</span>`
        }</td>
        <td class="clickable maint-link-cell" data-id="${c.id}" title="${c.has_maintenance_link ? 'Linked to maintenance — click to manage' : 'Not linked — click to link'}" style="text-align:center;font-size:16px">${c.has_maintenance_link ? '🟢' : '🟡'}</td>
      </tr>`).join('');
    tbody.querySelectorAll('.clickable:not(.maint-link-cell)').forEach(el => el.addEventListener('click', () => openContractModal(el.dataset.id)));
    tbody.querySelectorAll('.maint-link-cell').forEach(el => el.addEventListener('click', () => openContractModal(el.dataset.id, 'maintenance')));
  }
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const pag = document.getElementById('contracts-pagination');
  pag.innerHTML = `
    <button class="btn small secondary" ${ContractsState.page <= 1 ? 'disabled' : ''} id="cpg-prev">Prev</button>
    <span>Page ${data.page} of ${totalPages} — ${data.total} total</span>
    <button class="btn small secondary" ${ContractsState.page >= totalPages ? 'disabled' : ''} id="cpg-next">Next</button>
  `;
  const prevBtn = document.getElementById('cpg-prev'), nextBtn = document.getElementById('cpg-next');
  if (prevBtn) prevBtn.addEventListener('click', () => { ContractsState.page--; loadContractsList(); });
  if (nextBtn) nextBtn.addEventListener('click', () => { ContractsState.page++; loadContractsList(); });
}

async function openContractModal(id, initialTab) {
  if (!id) { renderContractForm(null, [], 'details'); return; }
  const data = await API.get(`/api/contracts/${id}`);
  renderContractForm(data.contract, data.history, initialTab || 'details');
}

function buildStatusConditionalsInline(status, c, editable) {
  c = c || {};
  if (status === 'Hold') {
    return `<div class="form-grid" style="margin-bottom:4px">
      ${formField('Reason for Hold', 'hold_reason', c.hold_reason || '', { disabled: !editable })}
      ${formField('Hold Remarks', 'hold_remarks', c.hold_remarks || '', { disabled: !editable })}
    </div>`;
  }
  if (status === 'Delay') {
    return `<div class="form-grid" style="margin-bottom:4px">
      ${formField('Reason for Delay', 'delay_reason', c.delay_reason || '', { disabled: !editable })}
      ${formField('Delay Remarks', 'delay_remarks', c.delay_remarks || '', { disabled: !editable })}
    </div>`;
  }
  if (status === 'Cancelled') {
    return `<div class="form-grid" style="margin-bottom:4px">
      ${formField('Cancellation Type', 'cancellation_type', c.cancellation_type || '', { select: CANCELLATION_TYPE_OPTIONS, disabled: !editable })}
      ${formField('Cancellation Date', 'cancellation_date', c.cancellation_date ? String(c.cancellation_date).slice(0,10) : '', { type: 'date', disabled: !editable })}
      ${formField('Payment Retention Status', 'payment_retention_status', c.payment_retention_status || '', { select: PAYMENT_RETENTION_OPTIONS, disabled: !editable })}
      ${formField('Refund Status', 'refund_status', c.refund_status || '', { select: REFUND_STATUS_OPTIONS, disabled: !editable })}
      ${formField('Cancellation Remarks', 'cancellation_remarks', c.cancellation_remarks || '', { textarea: true, span2: true, disabled: !editable })}
    </div>`;
  }
  return ''; // Active: no extra fields
}

function renderContractForm(c, history, initialTab) {
  c = c || {};
  initialTab = initialTab || 'details';
  const isNew = !c.id;
  const editable = isContractEditor();
  const canDelete = APP.user.role === 'admin';
  let _statusModified = false; // hoisted so submit handler can reference it

  openModal(`
    <h2>${isNew ? 'New Contract' : esc(c.contract_ref)}</h2>
    ${!isNew ? `<div class="tabs">
      <div class="tab ${initialTab==='details'?'active':''}" data-tab="details">Details</div>
      <div class="tab ${initialTab==='history'?'active':''}" data-tab="history">History (${history.length})</div>
      <div class="tab ${initialTab==='maintenance'?'active':''}" data-tab="maintenance">Maintenance Link</div>
      <div class="tab ${initialTab==='factory'?'active':''}" data-tab="factory">Factory Ref.</div>
    </div>` : ''}
    <div id="tab-details" ${!isNew && initialTab!=='details' ? 'class="hidden"' : ''}>
      <form id="contract-form">
        ${!isNew ? `
        <div style="background:var(--surface-2,#f8f9fa);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted,#8895a7)">Project Status</span>
            <div id="ps-badge-display">${projectStatusBadge(c.project_status || 'Active')}</div>
          </div>
          ${editable ? `
          <div style="margin-bottom:8px">
            <select id="ps-status-select" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font-size:13px;min-width:150px">
              <option value="Active" ${(c.project_status||'Active')==='Active'?'selected':''}>Active</option>
              <option value="Hold" ${c.project_status==='Hold'?'selected':''}>Hold</option>
              <option value="Delay" ${c.project_status==='Delay'?'selected':''}>Delay</option>
              <option value="Cancelled" ${c.project_status==='Cancelled'?'selected':''}>Cancelled</option>
            </select>
            <input type="hidden" id="ps-original-status" value="${esc(c.project_status||'Active')}">
          </div>` : ''}
          <div id="ps-conditional-fields">
            ${buildStatusConditionalsInline(c.project_status || 'Active', c, editable)}
          </div>
          <div style="display:flex;gap:20px;font-size:12px;color:var(--text-muted,#8895a7);margin-top:8px;flex-wrap:wrap">
            ${c.project_status_since ? `<span>Since: <strong style="color:var(--text)">${fmtDate(c.project_status_since)}</strong></span>` : ''}
            ${c.project_status_updated_at ? `<span>Updated: <strong style="color:var(--text)">${fmtDate(c.project_status_updated_at)}</strong></span>` : ''}
          </div>
        </div>` : ''}
        <div class="form-grid">
          ${formField('Contract Ref. (leave blank to auto-number)', 'contract_ref', c.contract_ref, { disabled: !isNew })}
          ${formField('Quotation Ref.', 'quote_ref', c.quote_ref, { disabled: !editable })}
          ${formField('Client / Company Name', 'client_name', c.client_name, { disabled: !editable, span2: true })}
          ${formField('Emirate', 'emirate', c.emirate, { select: EMIRATE_OPTIONS, disabled: !editable })}
          ${formField('Elevator Units', 'elevator_units', c.elevator_units || 1, { type: 'number', disabled: !editable })}
          ${formField('Approval Date', 'approval_date', c.approval_date ? String(c.approval_date).slice(0, 10) : '', { type: 'date', disabled: !editable })}
          ${formField('Sales By', 'sales_by', c.sales_by, { disabled: !editable })}
          ${formField('Contract Value', 'contract_value', c.contract_value, { type: 'number', disabled: !editable })}
          ${renderMilestoneField('Delivery Date', 'delivery_date', c.delivery_date, c.delivery_status, isNew, editable)}
          ${renderMilestoneField('Mech. Completion Date', 'mechanical_completion_date', c.mechanical_completion_date, c.mechanical_status, isNew, editable)}
          ${renderMilestoneField('Elec. Completion Date', 'electrical_completion_date', c.electrical_completion_date, c.electrical_status, isNew, editable)}
          ${formField('Handover Date', 'handover_date', c.handover_date ? String(c.handover_date).slice(0, 10) : '', { type: 'date', disabled: !editable })}
          ${formField('Remarks', 'remarks', c.remarks, { textarea: true, span2: true, disabled: !editable })}
        </div>
        <div class="form-grid" style="margin-top:4px">
          ${!isNew && editable ? formField('Note for this change (optional)', 'remarks_note', '', { span2: true }) : ''}
        </div>
        <div class="modal-actions">
          ${!isNew && canDelete ? `<button type="button" class="btn danger" id="delete-contract">Delete</button>` : ''}
          <div class="spacer"></div>
          <button type="button" class="btn secondary" id="cancel-modal">Cancel</button>
          ${editable ? `<button type="submit" class="btn">${isNew ? 'Create' : 'Save Changes'}</button>` : ''}
        </div>
      </form>
    </div>
    ${!isNew ? `
    <div id="tab-history" ${initialTab!=='history' ? 'class="hidden"' : ''}>
      <div class="history-list">
        ${history.length ? history.map(h => `
          <div class="history-item">
            <div><b>${esc(h.field_name)}</b>: ${esc(h.old_value ?? '-')} &rarr; ${esc(h.new_value ?? '-')}</div>
            <div class="meta">${fmtDate(h.changed_at)} by ${esc(h.changed_by)} ${h.remarks ? '— ' + esc(h.remarks) : ''}</div>
          </div>`).join('') : '<div class="empty-state">No history yet</div>'}
      </div>
    </div>
    <div id="tab-maintenance" ${initialTab!=='maintenance' ? 'class="hidden"' : ''}>
      ${renderMaintenanceLinkSection(c, editable)}
    </div>
    <div id="tab-factory" ${initialTab!=='factory' ? 'class="hidden"' : ''}>
      <div class="empty-state" style="color:#aaa">Loading factory links...</div>
    </div>` : ''}
  `);

  if (!isNew) {
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      ['details', 'history', 'maintenance', 'factory'].forEach(name => {
        document.getElementById('tab-' + name).classList.toggle('hidden', name !== t.dataset.tab);
      });
      if (t.dataset.tab === 'factory') loadFactoryLinkTab(c);
    }));
    if (initialTab === 'factory') loadFactoryLinkTab(c);

    // ── Project Status inline wiring ───────────────────────────────────────
    const _psSelect = document.getElementById('ps-status-select');
    if (_psSelect) {
      _psSelect.addEventListener('change', () => {
        _statusModified = true;
        const v = _psSelect.value;
        const badgeEl = document.getElementById('ps-badge-display');
        if (badgeEl) badgeEl.innerHTML = projectStatusBadge(v);
        const condEl = document.getElementById('ps-conditional-fields');
        if (condEl) condEl.innerHTML = buildStatusConditionalsInline(v, {}, true);
      });
    }
    // Mark modified if any status-conditional field changes
    document.getElementById('contract-form').addEventListener('input', (ev) => {
      const STATUS_FIELDS = ['hold_reason','hold_remarks','delay_reason','delay_remarks',
        'cancellation_type','cancellation_date','payment_retention_status','refund_status','cancellation_remarks'];
      if (STATUS_FIELDS.includes(ev.target.name)) _statusModified = true;
    });

    const delBtn = document.getElementById('delete-contract');
    if (delBtn) delBtn.addEventListener('click', async () => {
      // Step 1 — confirmation dialog
      const confirmed = await confirmDelete({
        title: 'Delete Contract',
        message: `Are you sure you want to delete contract ${esc(c.contract_ref)} — ${esc(c.client_name || '')}?`,
        confirmLabel: 'Delete',
      });
      if (!confirmed) return;

      // Step 2 — attempt delete; handle linked-record 409 or generic errors
      try {
        await API.del(`/api/contracts/${c.id}`);
        toast('Contract deleted');
        closeModal();
        renderContracts(document.getElementById('view-root'));
      } catch (err) {
        if (err.status === 409 && err.data && err.data.linkedRecords) {
          // Show linked-record warning
          const lr = err.data.linkedRecords;
          const isAdmin = APP.user.role === 'admin';
          const rows = lr.map(l => `<li><strong>${esc(l.module)}</strong> — ${l.count} record${l.count !== 1 ? 's' : ''}</li>`).join('');
          openModal(`
            <div style="padding:4px 0">
              <div style="font-size:28px;text-align:center;margin-bottom:8px">⚠️</div>
              <h2 style="margin:0 0 8px;font-size:16px;text-align:center">Cannot Delete — Linked Records Found</h2>
              <p style="color:#66758a;font-size:13px;margin:0 0 10px">
                Contract <strong>${esc(err.data.contractRef)}</strong> is linked to the following records and cannot be deleted directly.
                Please remove or unlink the related records first, or use the
                <strong>Contract Cancellation</strong> option to retain historical data.
              </p>
              <ul style="margin:0 0 14px;padding-left:18px;font-size:13px;color:#2d3748;line-height:1.8">${rows}</ul>
              <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
                <button class="btn secondary" id="lr-cancel">Cancel</button>
                ${isAdmin ? `<button class="btn danger" id="lr-force">Force Delete (Admin)</button>` : ''}
              </div>
              ${isAdmin ? `<p style="color:#e53e3e;font-size:11px;text-align:center;margin:10px 0 0">Force Delete will unlink all related records and permanently soft-delete this contract.</p>` : ''}
            </div>
          `);
          document.getElementById('lr-cancel').addEventListener('click', closeModal);
          if (isAdmin) {
            document.getElementById('lr-force').addEventListener('click', async () => {
              const forceConfirmed = await confirmDelete({
                title: 'Force Delete — Admin Action',
                message: `This will unlink ${lr.length} module${lr.length !== 1 ? 's' : ''} and permanently delete contract ${esc(c.contract_ref)}. Continue?`,
                confirmLabel: 'Force Delete',
              });
              if (!forceConfirmed) return;
              try {
                await API.del(`/api/contracts/${c.id}?force=1`);
                toast('Contract force-deleted. All linked references cleared.');
                closeModal();
                renderContracts(document.getElementById('view-root'));
              } catch (forceErr) {
                toast('Force delete failed: ' + forceErr.message, true);
              }
            });
          }
        } else {
          toast('Delete failed: ' + err.message, true);
        }
      }
    });
  }

  document.getElementById('cancel-modal').addEventListener('click', closeModal);

  // Maintenance link tab wiring
  if (!isNew) {
    const viewMcBtn = document.getElementById('view-mc-btn');
    if (viewMcBtn) viewMcBtn.addEventListener('click', () => {
      const mcId = parseInt(viewMcBtn.dataset.mcId);
      closeModal();
      const navEl = document.querySelector('[data-nav="maintenance_contracts"]');
      if (navEl) navEl.click();
      if (mcId) setTimeout(() => { if (window.openMaintenanceContractModal) openMaintenanceContractModal(mcId); }, 350);
    });
    const unlinkBtn = document.getElementById('unlink-mc-btn');
    if (unlinkBtn) unlinkBtn.addEventListener('click', async () => {
      if (!await confirmDelete({ title: 'Unlink Maintenance', message: 'Remove the maintenance link from this contract? The maintenance record itself will NOT be deleted.' })) return;
      try {
        await API.del(`/api/contracts/${c.id}/link-maintenance`);
        toast('Maintenance link removed');
        openContractModal(c.id, 'maintenance');
      } catch (err) { toast(err.message, true); }
    });
    const linkBtn = document.getElementById('link-mc-btn');
    if (linkBtn) linkBtn.addEventListener('click', () => openMaintenanceLinkModal(c));
  }

  document.getElementById('contract-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readForm(e.target);
    try {
      if (isNew) {
        await API.post('/api/contracts', data);
        toast('Contract created');
      } else {
        // If any project status fields changed, call the dedicated status endpoint first
        if (_statusModified) {
          const psSelect = document.getElementById('ps-status-select');
          const newStatus = psSelect ? psSelect.value : (c.project_status || 'Active');
          const statusBody = { new_status: newStatus };
          if (newStatus === 'Hold') {
            statusBody.hold_reason = (data.hold_reason || '').trim();
            statusBody.hold_remarks = (data.hold_remarks || '').trim();
            if (!statusBody.hold_reason) { toast('Hold reason is required', true); return; }
          } else if (newStatus === 'Delay') {
            statusBody.delay_reason = (data.delay_reason || '').trim();
            statusBody.delay_remarks = (data.delay_remarks || '').trim();
            if (!statusBody.delay_reason) { toast('Delay reason is required', true); return; }
          } else if (newStatus === 'Cancelled') {
            statusBody.cancellation_type = (data.cancellation_type || '').trim();
            statusBody.cancellation_date = (data.cancellation_date || '').trim();
            statusBody.payment_retention_status = (data.payment_retention_status || '').trim();
            statusBody.refund_status = (data.refund_status || '').trim();
            statusBody.cancellation_remarks = (data.cancellation_remarks || '').trim();
            if (!statusBody.cancellation_type) { toast('Cancellation type is required', true); return; }
            if (!statusBody.cancellation_date) { toast('Cancellation date is required', true); return; }
          }
          await API.post(`/api/contracts/${c.id}/project-status`, statusBody);
        }
        await API.patch(`/api/contracts/${c.id}`, data);
        toast('Contract updated');
      }
      closeModal();
      renderContracts(document.getElementById('view-root'));
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------------- Maintenance Link Helpers ----------------

function renderMaintenanceLinkSection(c, editable) {
  if (!c || !c.id) return '';
  editable = editable !== undefined ? editable : isContractEditor();
  const hasApproval = !!c.approval_date;
  if (c.has_maintenance_link) {
    return `
      <div style="padding:16px;background:#f0faf0;border:1px solid #27ae60;border-radius:8px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <span style="font-size:20px">🟢</span>
          <strong style="font-size:14px">Linked to Maintenance Record</strong>
        </div>
        <div class="form-grid">
          <div class="form-field"><label>MC Contract Ref.</label><div style="padding:8px;background:var(--bg);border-radius:4px;font-size:13px">${esc(c.mc_contract_ref || '-')}</div></div>
          <div class="form-field"><label>Renewal Status</label><div style="padding:8px;background:var(--bg);border-radius:4px;font-size:13px">${esc(c.mc_renewal_status || '-')}</div></div>
          <div class="form-field"><label>Linked By</label><div style="padding:8px;background:var(--bg);border-radius:4px;font-size:13px">${esc(c.maintenance_linked_by || '-')}</div></div>
          <div class="form-field"><label>Linked On</label><div style="padding:8px;background:var(--bg);border-radius:4px;font-size:13px">${fmtDate(c.maintenance_linked_at)}</div></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
          <button type="button" class="btn secondary" id="view-mc-btn" data-mc-id="${c.mc_id || c.linked_maintenance_id}">Open Maintenance Record</button>
          ${editable ? `<button type="button" class="btn danger" id="unlink-mc-btn">Unlink</button>` : ''}
        </div>
      </div>`;
  } else {
    return `
      <div style="padding:16px;background:#fffdf0;border:1px solid #f39c12;border-radius:8px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:20px">🟡</span>
          <strong style="font-size:14px">No Maintenance Record Linked</strong>
        </div>
        <p style="font-size:13px;color:var(--text-mute);margin:0 0 12px">
          ${!hasApproval ? 'An Approval Date is required before linking to a Maintenance Record.' : 'Link this contract to an existing or new Maintenance Record to track service visits.'}
        </p>
        ${(editable && hasApproval) ? `<button type="button" class="btn" id="link-mc-btn">🔗 Link to Maintenance</button>` : ''}
      </div>`;
  }
}

async function openMaintenanceLinkModal(contract) {
  openModal(`
    <h2>Link to Maintenance Record</h2>
    <p style="font-size:13px;color:var(--text-mute);margin-bottom:16px">Contract: <strong>${esc(contract.contract_ref)}</strong> — ${esc(contract.client_name || '')}</p>
    <div class="tabs" id="link-mc-tabs">
      <div class="tab active" data-link-tab="search">Search Existing</div>
      <div class="tab" data-link-tab="create">Create New</div>
    </div>
    <div id="link-tab-search">
      <div style="margin-bottom:12px">
        <input type="text" id="mc-search-input" placeholder="Search by contract ref or client name..." style="width:100%;box-sizing:border-box">
        <div id="mc-search-results" style="margin-top:8px;max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;display:none"></div>
      </div>
    </div>
    <div id="link-tab-create" class="hidden">
      <form id="new-mc-form" class="form-grid">
        ${formField('Start Date', 'start_date', '', { type: 'date' })}
        ${formField('End Date', 'end_date', '', { type: 'date' })}
        ${formField('Maintenance Type', 'maintenance_type', 'AMC', { select: ['AMC', 'AMC + Emergency', 'Comprehensive', 'Non-Comprehensive', 'Breakdown Only'] })}
        ${formField('Maintenance Period', 'maintenance_period', '', { select: ['Every Month','Every 2 Months','Every 3 Months','Every 4 Months','Every 6 Months','Quarterly','Half Yearly','Yearly'] })}
        ${formField('Remarks', 'remarks', '', { span2: true })}
        <div class="form-field span2">
          <p style="font-size:12px;color:var(--text-mute);margin:0 0 8px">Client, Emirate, and Elevator Units will be pre-filled from the contract.</p>
          <button type="submit" class="btn">Create & Link</button>
        </div>
      </form>
    </div>
    <div class="modal-actions" style="margin-top:12px">
      <button type="button" class="btn secondary" id="cancel-link-modal">Cancel</button>
    </div>
  `);

  document.getElementById('cancel-link-modal').addEventListener('click', () => openContractModal(contract.id, 'maintenance'));

  // Tab switching
  document.querySelectorAll('#link-mc-tabs .tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('#link-mc-tabs .tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('link-tab-search').classList.toggle('hidden', t.dataset.linkTab !== 'search');
    document.getElementById('link-tab-create').classList.toggle('hidden', t.dataset.linkTab !== 'create');
  }));

  // Search existing
  let searchTimer;
  const searchInput = document.getElementById('mc-search-input');
  const resultsDiv = document.getElementById('mc-search-results');
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) { resultsDiv.style.display = 'none'; return; }
    searchTimer = setTimeout(async () => {
      try {
        const data = await API.get('/api/maintenance-contracts/search?q=' + encodeURIComponent(q));
        if (!data.rows.length) {
          resultsDiv.innerHTML = '<div style="padding:12px;color:var(--text-mute);font-size:13px">No records found</div>';
        } else {
          resultsDiv.innerHTML = data.rows.map(mc => `
            <div class="mc-search-row" data-mc-id="${mc.id}" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px">
              <strong>${esc(mc.contract_ref || '-')}</strong> — ${esc(mc.client_name || '-')}
              <span style="float:right;color:var(--text-mute)">${esc(mc.renewal_status || '')}</span>
            </div>`).join('');
          resultsDiv.querySelectorAll('.mc-search-row').forEach(row => {
            row.addEventListener('mouseenter', () => row.style.background = 'var(--hover-bg,#f5f5f5)');
            row.addEventListener('mouseleave', () => row.style.background = '');
            row.addEventListener('click', async () => {
              try {
                await API.post(`/api/contracts/${contract.id}/link-maintenance/existing`, { maintenance_id: parseInt(row.dataset.mcId) });
                toast('Maintenance record linked');
                openContractModal(contract.id, 'maintenance');
              } catch (err) { toast(err.message, true); }
            });
          });
        }
        resultsDiv.style.display = 'block';
      } catch (err) { toast(err.message, true); }
    }, 350);
  });

  // Create new
  document.getElementById('new-mc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = readForm(e.target);
    if (!formData.start_date) return toast('Start Date is required', true);
    try {
      await API.post(`/api/contracts/${contract.id}/link-maintenance/new`, formData);
      toast('Maintenance record created and linked');
      openContractModal(contract.id, 'maintenance');
    } catch (err) { toast(err.message, true); }
  });
}

// ---------------- Factory Ref. Tab ----------------

let _currentFactoryLinkContract = null;

async function loadFactoryLinkTab(c) {
  _currentFactoryLinkContract = c;
  const panel = document.getElementById('tab-factory');
  if (!panel) return;
  panel.innerHTML = '<div class="empty-state" style="color:#aaa;padding:32px">Loading factory links...</div>';
  try {
    const data = await API.get(`/api/contracts/${c.id}/factory-links`);
    renderFactoryLinkPanel(c, data);
  } catch (err) {
    panel.innerHTML = `<div class="empty-state" style="color:red;padding:32px">Failed to load: ${esc(err.message)}</div>`;
  }
}

function renderFactoryLinkPanel(c, data) {
  const panel = document.getElementById('tab-factory');
  const { links = [], fclRows = [], elevatorUnits = 0, linkStatus = 'Not Linked', contractRef = '', summary = {} } = data;

  const statusColor = {
    'Fully Linked': '#28a745', 'Partially Linked': '#ffc107',
    'Quantity Mismatch': '#dc3545', 'Linked (Cost Only)': '#17a2b8', 'Not Linked': '#6c757d'
  }[linkStatus] || '#6c757d';

  const sheetBadge = s => `<span class="badge" style="background:${s==='ins'?'#e3f2fd':s==='otj'?'#f3e5f5':'#e8f5e9'};color:#333;padding:2px 7px;border-radius:10px;font-size:11px">${s.toUpperCase()}</span>`;

  const kpiCard = (label, val, sub) => `
    <div style="background:var(--bg-card,#f8fafc);border:1px solid var(--border);border-radius:8px;padding:10px 14px;min-width:100px">
      <div style="font-size:11px;color:#888;margin-bottom:2px">${label}</div>
      <div style="font-size:16px;font-weight:700;color:#1a2436">${val}</div>
      ${sub ? `<div style="font-size:10px;color:#aaa;margin-top:2px">${sub}</div>` : ''}
    </div>`;

  const summaryHtml = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border)">
      ${kpiCard('Linked Records', summary.linkedCount||0, `INS:${summary.insCount||0} &nbsp;OTJ:${summary.otjCount||0} &nbsp;SEA:${summary.seaCount||0}`)}
      ${kpiCard('Total Order Value', 'USD&nbsp;'+fmtMoney(summary.totalValue||0), '')}
      ${kpiCard('Total Paid', 'USD&nbsp;'+fmtMoney(summary.totalPaid||0), '')}
      ${kpiCard('Outstanding', 'USD&nbsp;'+fmtMoney(summary.totalBalance||0), '')}
      ${kpiCard('Units Linked', summary.totalLinkedQty||0, `of ${elevatorUnits} contracted`)}
      <div style="background:var(--bg-card,#f8fafc);border:1px solid ${statusColor};border-radius:8px;padding:10px 14px;min-width:100px">
        <div style="font-size:11px;color:#888;margin-bottom:2px">Link Status</div>
        <div style="font-size:13px;font-weight:700;color:${statusColor}">${esc(linkStatus)}</div>
      </div>
    </div>`;

  const linkedRows = links.length ? links.map(r => `
    <tr>
      <td>${sheetBadge(r.sheet)}</td>
      <td><strong>${esc(r.factory_ref||'—')}</strong></td>
      <td>${esc(r.supplier_name||'—')}</td>
      <td>${badge(r.production_status||'—')}</td>
      <td>${badge(r.delivery_status||'—')}</td>
      <td style="white-space:nowrap">${fmtCurrency(r.amount, r.currency_code||'USD')}</td>
      <td style="white-space:nowrap">${r.total_paid!=null?fmtCurrency(r.total_paid, r.currency_code||'USD'):'—'}</td>
      <td style="white-space:nowrap">${r.balance_payable!=null?fmtCurrency(r.balance_payable, r.currency_code||'USD'):'—'}</td>
      <td>${badge(r.payment_status||'—')}</td>
      <td style="font-size:12px">${r.bl_no?esc(r.bl_no):'<span style="color:#ccc">—</span>'}</td>
      <td style="font-size:12px">${r.eta?fmtDate(r.eta):'<span style="color:#ccc">—</span>'}</td>
      <td>${isContractEditor()?`<button class="btn small danger" onclick="unlinkFactoryRecord(${c.id},'${esc(r.sheet)}',${r.id})">Unlink</button>`:''}</td>
    </tr>`).join('')
    : `<tr><td colspan="12" class="empty-state" style="padding:16px;text-align:center;color:#888">No factory records linked to this contract</td></tr>`;

  const sheetBg  = {factory_ins_quotes:'#e3f2fd',factory_otj_quotes:'#f3e5f5',factory_sea_costs:'#e8f5e9'};
  const sheetLbl = {factory_ins_quotes:'INS',factory_otj_quotes:'OTJ',factory_sea_costs:'SEA'};
  const fclHtml = fclRows.length ? `
    <div style="overflow-x:auto">
      <table class="data-table" style="font-size:12px">
        <thead><tr>
          <th>Sheet</th><th>Factory Ref.</th><th>Link Type</th><th>Qty</th>
          <th>Allocation (USD)</th><th>Status</th><th>Linked Date</th>
        </tr></thead>
        <tbody>
          ${fclRows.map(lk => `<tr>
            <td><span style="background:${sheetBg[lk.factory_table]||'#eee'};color:#333;padding:2px 7px;border-radius:10px;font-size:11px">${sheetLbl[lk.factory_table]||lk.factory_table}</span></td>
            <td><strong>${esc(lk.factory_ref)}</strong></td>
            <td>${esc(lk.link_type||lk.model_lift_type||'—')}</td>
            <td>${lk.linked_quantity!=null?lk.linked_quantity:'—'}</td>
            <td>${lk.allocation_amount!=null?fmtCurrency(lk.allocation_amount,'USD'):'—'}</td>
            <td>${badge(lk.status||'Active')}</td>
            <td style="font-size:11px;color:#888">${lk.linked_date||'—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p style="font-size:11px;color:#aaa;margin:6px 0 0">Manage these links from Factory &amp; Suppliers → factory record → Multi-Contract Links.</p>`
    : `<div style="font-size:12px;color:#888;padding:4px 0">No multi-contract links for <strong>${esc(contractRef||c.contract_ref||'')}</strong>.</div>`;

  panel.innerHTML = `
    <div style="padding:20px">
      ${summaryHtml}

      <div style="margin-bottom:24px">
        <h3 style="margin:0 0 10px;font-size:15px;font-weight:600">Linked Factory Orders</h3>
        <div style="overflow-x:auto">
          <table class="data-table" style="width:100%;font-size:12px">
            <thead><tr>
              <th>Sheet</th><th>Factory Ref.</th><th>Supplier</th>
              <th>Production</th><th>Delivery</th>
              <th>Order Value</th><th>Paid</th><th>Balance</th>
              <th>Payment</th><th>BL No.</th><th>ETA</th><th></th>
            </tr></thead>
            <tbody>${linkedRows}</tbody>
          </table>
        </div>
      </div>

      <div style="border-top:1px solid var(--border);padding-top:20px;margin-bottom:24px">
        <h3 style="margin:0 0 10px;font-size:15px;font-weight:600">Multi-Contract Links <span style="font-size:12px;font-weight:400;color:#888">(many-to-many)</span></h3>
        ${fclHtml}
      </div>

      <div style="border-top:1px solid var(--border);padding-top:20px;margin-bottom:24px">
        <h3 style="margin:0 0 10px;font-size:15px;font-weight:600">Search &amp; Link Factory Record</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
          <input id="fl-q" class="form-control" placeholder="Search Factory Ref, Supplier, Client..." style="flex:1;min-width:200px">
          <select id="fl-sheet" class="form-control" style="width:130px">
            <option value="all">All Sections</option>
            <option value="ins">INS Quotes</option>
            <option value="otj">OTJ Quotes</option>
            <option value="sea">SEA Costs</option>
          </select>
          <button class="btn small" id="fl-search-btn">Search</button>
        </div>
        <div id="fl-search-results" style="font-size:13px;color:#888;padding:4px 0">Enter a search term to find factory records.</div>
      </div>

      <div style="border-top:1px solid var(--border);padding-top:20px">
        <h3 style="margin:0 0 4px;font-size:15px;font-weight:600">Create Manual Factory Record</h3>
        <p style="margin:0 0 14px;font-size:12px;color:#888">Create a new factory record and automatically link it to <strong>${esc(contractRef||c.contract_ref||'')}</strong>.</p>
        <form id="fl-create-form" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px">
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Section <span style="color:red">*</span></label>
            <select name="sheet" class="form-control" required>
              <option value="ins">INS Quotes</option>
              <option value="otj">OTJ Quotes</option>
              <option value="sea">SEA Costs</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Factory Ref <span style="color:red">*</span></label>
            <input name="factory_ref" class="form-control" placeholder="e.g. FJ-5099" required>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Client Name</label>
            <input name="client_name" class="form-control" value="${esc(c.client_name||'')}">
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Supplier Name</label>
            <input name="supplier_name" class="form-control" placeholder="Supplier">
          </div>
          <div style="grid-column:span 2">
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Description</label>
            <input name="project_description" class="form-control" placeholder="Project description">
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Amount</label>
            <input name="amount" class="form-control" type="number" step="0.01" min="0" placeholder="0.00">
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Currency</label>
            <select name="currency_code" class="form-control">
              <option value="USD">USD</option>
              <option value="AED">AED</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Payment Status</label>
            <select name="payment_status" class="form-control">
              <option value="Unpaid">Unpaid</option>
              <option value="Partial Paid">Partial Paid</option>
              <option value="Full Paid">Full Paid</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Production Status</label>
            <select name="production_status" class="form-control">
              <option value="Pending">Pending</option>
              <option value="In Production">In Production</option>
              <option value="Ready">Ready</option>
              <option value="Shipped">Shipped</option>
              <option value="Delivered">Delivered</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Delivery Status</label>
            <select name="factory_delivery_status" class="form-control">
              <option value="">— Not Set —</option>
              <option value="Production">Production</option>
              <option value="Shipping">Shipping</option>
              <option value="Arrived">Arrived</option>
              <option value="Delayed">Delayed</option>
              <option value="Delivered">Delivered</option>
            </select>
          </div>
          <div style="grid-column:1/-1;display:flex;gap:10px;align-items:center;margin-top:4px">
            <button type="submit" class="btn small primary">Create &amp; Link</button>
            <span id="fl-create-msg" style="font-size:12px;color:#666"></span>
          </div>
        </form>
      </div>
    </div>`;

  const searchBtn = document.getElementById('fl-search-btn');
  const qInput = document.getElementById('fl-q');
  if (searchBtn) searchBtn.addEventListener('click', () => doFactorySearch(c));
  if (qInput) qInput.addEventListener('keydown', e => { if (e.key === 'Enter') doFactorySearch(c); });

  const createForm = document.getElementById('fl-create-form');
  if (createForm) {
    createForm.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(createForm);
      const body = { contractId: c.id };
      for (const [k, v] of fd.entries()) body[k] = v;
      const msgEl = document.getElementById('fl-create-msg');
      if (msgEl) msgEl.textContent = 'Saving...';
      try {
        await API.post('/api/factory/create-for-link', body);
        toast('Factory record created and linked');
        loadFactoryLinkTab(c);
      } catch (err) {
        if (msgEl) { msgEl.style.color = 'red'; msgEl.textContent = 'Error: ' + err.message; }
      }
    });
  }
}

async function doFactorySearch(c) {
  const q = (document.getElementById('fl-q')?.value || '').trim();
  const sheet = document.getElementById('fl-sheet')?.value || 'all';
  const resultsDiv = document.getElementById('fl-search-results');
  if (!resultsDiv) return;
  if (!q || q.length < 2) {
    resultsDiv.innerHTML = '<span style="color:#888">Enter at least 2 characters to search.</span>';
    return;
  }
  resultsDiv.innerHTML = '<span style="color:#888">Searching...</span>';
  try {
    const params = new URLSearchParams({ q, sheet });
    const data = await API.get('/api/factory/search-for-link?' + params.toString());
    const rows = data.rows || [];
    if (!rows.length) {
      resultsDiv.innerHTML = '<div style="color:#888;padding:10px 0">No factory records found. Try a different search term.</div>';
      return;
    }
    const currentContractRef = c.contract_ref || '';
    resultsDiv.innerHTML = `
      <div style="overflow-x:auto;margin-top:8px">
        <table class="data-table" style="width:100%;font-size:12px">
          <thead><tr>
            <th>Sheet</th><th>Factory Ref.</th><th>Supplier</th><th>Client</th>
            <th>Amount</th><th>Payment</th><th>Production</th><th>Linked To</th><th></th>
          </tr></thead>
          <tbody>
            ${rows.map(r => {
              const isThisContract = r.contract_ref && r.contract_ref === currentContractRef;
              const linkedElsewhere = r.contract_ref && !isThisContract;
              const rowBg = isThisContract ? 'background:#e8f5e9' : linkedElsewhere ? 'background:#fff3cd' : '';
              return `<tr style="${rowBg}">
                <td><span style="background:${r.sheet==='ins'?'#e3f2fd':r.sheet==='otj'?'#f3e5f5':'#e8f5e9'};color:#333;padding:2px 7px;border-radius:10px;font-size:11px">${r.sheet.toUpperCase()}</span></td>
                <td><strong>${esc(r.factory_ref||'—')}</strong></td>
                <td>${esc(r.supplier_name||'—')}</td>
                <td>${esc(r.client_name||'—')}</td>
                <td>${fmtCurrency(r.amount, r.currency_code||'USD')}</td>
                <td>${esc(r.payment_status||'—')}</td>
                <td>${esc(r.production_status||'—')}</td>
                <td>${isThisContract
                    ? '<span style="color:#28a745;font-size:11px;font-weight:600">✓ This contract</span>'
                    : linkedElsewhere
                    ? `<span style="color:#dc3545;font-size:11px">${esc(r.contract_ref)}</span>`
                    : '<span style="color:#999;font-size:11px">—</span>'}</td>
                <td>${isThisContract
                    ? '<span style="color:#28a745;font-size:11px">Linked</span>'
                    : linkedElsewhere
                    ? `<button class="btn small warning" style="font-size:11px" onclick="linkFactoryRecord(${c.id},'${esc(r.sheet)}',${r.id},true,'${esc(r.factory_ref)}','${esc(r.contract_ref||'')}')">Re-link</button>`
                    : `<button class="btn small" style="font-size:11px" onclick="linkFactoryRecord(${c.id},'${esc(r.sheet)}',${r.id},false,'${esc(r.factory_ref)}','')">Link</button>`}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    resultsDiv.innerHTML = `<span style="color:red">Search error: ${esc(err.message)}</span>`;
  }
}

async function linkFactoryRecord(contractId, sheet, factoryId, isRelink, factoryRef, currentContractRef) {
  if (isRelink) {
    const confirmed = await confirmDelete({
      title: 'Re-link Factory Record',
      message: `${factoryRef} is currently linked to ${currentContractRef}. Re-link it to this contract instead?`,
      confirmLabel: 'Re-link',
    });
    if (!confirmed) return;
  }
  try {
    const qs = isRelink ? '?force=1' : '';
    await API.post(`/api/contracts/${contractId}/factory-links${qs}`, { sheet, factoryId });
    toast(isRelink ? 'Re-linked successfully' : 'Factory record linked');
    loadFactoryLinkTab(_currentFactoryLinkContract);
  } catch (err) {
    toast('Link failed: ' + err.message, true);
  }
}

async function unlinkFactoryRecord(contractId, sheet, factoryId) {
  const confirmed = await confirmDelete({
    title: 'Unlink Factory Record',
    message: 'Remove this factory record from the contract? The factory record itself will not be deleted.',
    confirmLabel: 'Unlink',
  });
  if (!confirmed) return;
  try {
    await API.del(`/api/contracts/${contractId}/factory-links/${sheet}/${factoryId}`);
    toast('Factory record unlinked');
    loadFactoryLinkTab(_currentFactoryLinkContract);
  } catch (err) {
    toast('Unlink failed: ' + err.message, true);
  }
}

// ---------------- Dashboard ----------------
async function renderContractsDashboard(root) {
  const thisYear = new Date().getFullYear();
  root.innerHTML = `
    <div class="toolbar">
      <label style="font-size:12px;color:var(--text-mute);">Year:</label>
      <select id="cd-year"></select>
    </div>
    <div id="cd-content"><div class="empty-state">Loading...</div></div>
  `;
  const yearSel = document.getElementById('cd-year');
  for (let y = thisYear; y >= thisYear - 8; y--) yearSel.innerHTML += `<option value="${y}">${y}</option>`;
  yearSel.addEventListener('change', () => loadContractsDashboard(yearSel.value));
  await loadContractsDashboard(thisYear);
}

async function loadContractsDashboard(year) {
  const d = await API.get('/api/contracts/dashboard?year=' + year);
  const t = d.totals || {};
  document.getElementById('cd-content').innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="num">${t.total_contracts ?? 0}</div><div class="label">Total Contracts</div></div>
      <div class="kpi-card good"><div class="num">${fmtCurrency(t.total_contract_value, 'AED')}</div><div class="label">Total Contract Value</div></div>
    </div>

    <div class="panel">
      <h3>Salesperson Performance &amp; Target vs Achievement (${d.year})</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Salesperson</th><th>Total Contracts</th><th>Total Value (AED)</th>
            <th>Monthly Contracts</th><th>YTD Contracts</th>
            <th>Target Units (${d.year})</th><th>Remaining</th>
            <th>Monthly Achv. %</th><th>Yearly Achv. %</th>
          </tr></thead>
          <tbody>
            ${(d.salesperson_performance || []).map(r => `
              <tr>
                <td>${esc(r.salesperson)}</td>
                <td>${r.total_contracts}</td>
                <td>${fmtCurrency(r.total_contract_value, 'AED')}</td>
                <td>${r.monthly_contracts_achieved}</td>
                <td>${r.yearly_contracts_achieved}</td>
                <td>${r.yearly_target_units !== null ? r.yearly_target_units : '-'}</td>
                <td>${r.remaining_units !== null ? r.remaining_units : '-'}</td>
                <td>${r.monthly_achievement_pct !== null ? r.monthly_achievement_pct + '%' : '-'}</td>
                <td>${r.yearly_achievement_pct !== null ? r.yearly_achievement_pct + '%' : '-'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h3>Year-wise Summary</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Year</th><th>Contracts</th><th>Total Value</th></tr></thead>
          <tbody>
            ${(d.year_wise || []).map(r => `<tr><td>${esc(r.year)}</td><td>${r.total_contracts}</td><td>${fmtCurrency(r.total_value, 'AED')}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h3>Month-wise Summary (last 24 months)</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Month</th><th>Contracts</th><th>Total Value</th></tr></thead>
          <tbody>
            ${(d.month_wise || []).map(r => `<tr><td>${esc(r.month)}</td><td>${r.total_contracts}</td><td>${fmtCurrency(r.total_value, 'AED')}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ---------------- Yearly Individual Target Entry ----------------
async function renderContractsTargets(root) {
  const thisYear = new Date().getFullYear();
  root.innerHTML = `
    <div class="toolbar">
      <label style="font-size:12px;color:var(--text-mute);">Year:</label>
      <select id="ct-year"></select>
      <select id="ct-sp-filter"><option value="">All Salespersons</option></select>
      <div class="spacer"></div>
    </div>
    <div id="ct-content"><div class="empty-state">Loading...</div></div>
  `;
  const yearSel = document.getElementById('ct-year');
  for (let y = thisYear + 1; y >= thisYear - 8; y--) yearSel.innerHTML += `<option value="${y}">${y}</option>`;
  yearSel.value = thisYear;
  // Populate salesperson filter from existing salespeople list
  const spSel = document.getElementById('ct-sp-filter');
  (ContractsState.salespeople || []).forEach(sp => {
    const opt = document.createElement('option'); opt.value = sp; opt.textContent = sp;
    spSel.appendChild(opt);
  });
  yearSel.addEventListener('change', () => loadContractsTargets(yearSel.value, spSel.value));
  spSel.addEventListener('change', () => loadContractsTargets(yearSel.value, spSel.value));
  await loadContractsTargets(thisYear, '');
}

async function loadContractsTargets(year, salespersonFilter) {
  const params = new URLSearchParams({ year });
  if (salespersonFilter) params.set('salesperson', salespersonFilter);
  const data = await API.get('/api/contracts/targets?' + params.toString());
  const editable = isContractEditor();
  const container = document.getElementById('ct-content');
  const cols = editable ? 8 : 7;
  container.innerHTML = `
    <div class="panel">
      <h3>Salesperson Yearly Targets — ${year}</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Salesperson</th><th>Year</th><th>Target Units</th>
            <th>Achieved Units</th><th>Remaining Units</th><th>Achievement %</th>
            <th>Remarks</th>${editable ? '<th>Action</th>' : ''}
          </tr></thead>
          <tbody id="ct-tbody">
            ${data.rows.map(r => {
              const achieved = r.achieved_units != null ? r.achieved_units : '-';
              const remaining = r.remaining_units != null ? r.remaining_units : '-';
              const pct = r.achievement_pct != null ? r.achievement_pct + '%' : '-';
              return `
              <tr>
                <td>${esc(r.salesperson)}</td>
                <td>${r.year}</td>
                <td>${r.target_units}</td>
                <td>${achieved}</td>
                <td>${remaining}</td>
                <td>${pct}</td>
                <td>${esc(r.remarks || '-')}</td>
                ${editable ? `<td>
                  <button class="btn small secondary" data-edit-target="${r.id}"
                    data-sp="${esc(r.salesperson)}" data-units="${r.target_units}" data-remarks="${esc(r.remarks || '')}">Edit</button>
                  <button class="btn small danger" data-del-target="${r.id}">Delete</button>
                </td>` : ''}
              </tr>`;
            }).join('') || `<tr><td colspan="${cols}" class="empty-state">No targets set for ${year} yet</td></tr>`}
          </tbody>
        </table>
      </div>
      ${editable ? `
      <h3 style="margin-top:18px;">Add / Update Salesperson Target</h3>
      <form id="target-form" class="form-grid">
        ${formField('Salesperson Name / Code', 'salesperson', salespersonFilter || '')}
        ${formField('Year', 'year', year, { type: 'number' })}
        ${formField('Target Units', 'target_units', '', { type: 'number' })}
        ${formField('Remarks', 'remarks', '', { span2: true })}
        <div class="form-field span2"><button type="submit" class="btn">Save Target</button></div>
      </form>` : ''}
    </div>
  `;
  if (editable) {
    document.getElementById('target-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = readForm(e.target);
      try {
        await API.post('/api/contracts/targets', formData);
        toast('Target saved');
        loadContractsTargets(year, salespersonFilter);
      } catch (err) { toast(err.message, true); }
    });
    container.querySelectorAll('[data-edit-target]').forEach(btn => btn.addEventListener('click', () => {
      const form = document.getElementById('target-form');
      form.querySelector('[name=salesperson]').value = btn.dataset.sp;
      form.querySelector('[name=target_units]').value = btn.dataset.units;
      form.querySelector('[name=remarks]').value = btn.dataset.remarks;
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    container.querySelectorAll('[data-del-target]').forEach(btn => btn.addEventListener('click', async () => {
      if (!await confirmDelete({ title: 'Delete Target', message: 'Delete this sales target?' })) return;
      await API.del(`/api/contracts/targets/${btn.dataset.delTarget}`);
      toast('Target deleted');
      loadContractsTargets(year, salespersonFilter);
    }));
  }
}

