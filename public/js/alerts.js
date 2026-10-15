// Alerts & Reminders module — frontend. Rebuilt 2026-07-02.
//
// Tabs (Call Back / Emergency moved to Maintenance module 2026-07-23):
//   1. Expiring Contracts  — dynamic list from maintenance_projects with colour-coded alert levels
//   2. Renewal Status      — manual renewal tracking (amc_renewals)
//   3. Payment Status      — payment alert list (alert_payments)
//   4. Monthly CB Summary  — aggregate stats + technician/project/contract breakdowns
//
// Cancelled AMC moved to Maintenance module 2026-07-27.
// Legacy "Open Alerts" tab (engine-based) moved to a compact banner at the top of the module.

const AlertsState = {
  tab: 'expiring',   // expiring | renewals | summary
  filters: { sort_by: 'updated_at', sort_dir: 'desc' },
};

const RENEWAL_STATUS_OPTS     = ['Pending','Approved','Renewed','Not Renewed','Cancelled','Hold'];
const PAYMENT_STATUS_OPTS     = ['Unpaid','Partial','Paid','Overdue','Hold'];
const CALLBACK_STATUS_OPTS    = ['Open','Assigned','Attended','Completed','Pending Parts','Client Hold','Cancelled'];
const PRIORITY_OPTS           = ['Normal','Urgent','Emergency'];
// AMC Renewals (new amc_renewals table)
const AMC_RENEWAL_STATUS_OPTS = ['Pending','Under Review','Approved','Rejected','Not Renewed','Cancelled','Hold'];
const AMC_PAYMENT_STATUS_OPTS = ['Unpaid','Partial','Paid','Later','Overdue','Hold'];
const AMC_ACTIVATION_OPTS     = ['Active','Hold','Inactive'];

// Colour helpers for status badges
function alertLevelStyle(level) {
  if (level === 'expired')   return 'background:#f8d7da;color:#842029;';
  if (level === 'within-7')  return 'background:#fde6e3;color:#c0392b;';
  if (level === 'within-15') return 'background:#fdf2dc;color:#b7770d;';
  if (level === 'within-30') return 'background:#fff3cd;color:#856404;';
  return 'background:#d1eddd;color:#1a6a35;';
}
function alertLevelLabel(level, days) {
  if (level === 'expired')   return days < 0 ? `Expired ${Math.abs(days)}d ago` : 'Expired';
  if (level === 'within-7')  return `${days}d left`;
  if (level === 'within-15') return `${days}d left`;
  if (level === 'within-30') return `${days}d left`;
  return `${days}d left`;
}
function renewalBadge(s) {
  const c = { Pending:'#fdf2dc;color:#b7770d', Approved:'#d1eddd;color:#1a6a35',
               Renewed:'#d5e8f0;color:#1a5a7a', 'Not Renewed':'#f8d7da;color:#842029',
               Cancelled:'#eef2f6;color:#66758a', Hold:'#ede9ff;color:#5b32c7' };
  return `<span class="badge" style="background:${c[s]||'#eef2f6;color:#66758a'}">${esc(s||'-')}</span>`;
}
function paymentBadge(s) {
  const c = { Unpaid:'#fdf2dc;color:#b7770d', Partial:'#fff3cd;color:#856404',
               Paid:'#d1eddd;color:#1a6a35', Overdue:'#f8d7da;color:#842029',
               Hold:'#ede9ff;color:#5b32c7' };
  return `<span class="badge" style="background:${c[s]||'#eef2f6;color:#66758a'}">${esc(s||'-')}</span>`;
}
function callbackBadge(s) {
  const c = { Open:'#fdf2dc;color:#b7770d', Assigned:'#d5e8f0;color:#1a5a7a',
               Attended:'#d1eddd;color:#1a6a35', Completed:'#c9ede0;color:#0a5e40',
               'Pending Parts':'#ede9ff;color:#5b32c7', 'Client Hold':'#eef2f6;color:#66758a',
               Cancelled:'#f8d7da;color:#842029' };
  return `<span class="badge" style="background:${c[s]||'#eef2f6;color:#66758a'}">${esc(s||'-')}</span>`;
}
function priorityBadge(p) {
  const c = { Normal:'#eef2f6;color:#66758a', Urgent:'#fdf2dc;color:#b7770d',
               Emergency:'#f8d7da;color:#842029' };
  return `<span class="badge" style="background:${c[p]||'#eef2f6;color:#66758a'}">${esc(p||'Normal')}</span>`;
}
function linkedBadge(s) {
  if (!s) return '';
  if (s === 'Linked' || s === 'Linked (MC)') return `<span class="badge" style="background:#d1eddd;color:#1a6a35">${esc(s)}</span>`;
  if (s === 'Pending Contract Ref.') return `<span class="badge" style="background:#fff3cd;color:#856404">${esc(s)}</span>`;
  return `<span class="badge" style="background:#fde6e3;color:#c0392b">${esc(s)}</span>`;
}
function amcRenewalBadge(s) {
  const c = { Pending:'#fdf2dc;color:#b7770d', 'Under Review':'#d5e8f0;color:#1a5a7a',
               Approved:'#d1eddd;color:#1a6a35', Rejected:'#f8d7da;color:#842029',
               'Not Renewed':'#fde6e3;color:#c0392b', Cancelled:'#eef2f6;color:#66758a',
               Hold:'#ede9ff;color:#5b32c7' };
  return `<span class="badge" style="background:${c[s]||'#eef2f6;color:#66758a'}">${esc(s||'-')}</span>`;
}
function amcPaymentBadge(s) {
  const c = { Unpaid:'#fdf2dc;color:#b7770d', Partial:'#fff3cd;color:#856404',
               Paid:'#d1eddd;color:#1a6a35', Later:'#d5e8f0;color:#1a5a7a',
               Overdue:'#f8d7da;color:#842029', Hold:'#ede9ff;color:#5b32c7' };
  return `<span class="badge" style="background:${c[s]||'#eef2f6;color:#66758a'}">${esc(s||'-')}</span>`;
}
function amcActivationBadge(s) {
  const c = { Active:'#d1eddd;color:#1a6a35', Hold:'#ede9ff;color:#5b32c7', Inactive:'#eef2f6;color:#66758a' };
  return `<span class="badge" style="background:${c[s]||'#eef2f6;color:#66758a'}">${esc(s||'Inactive')}</span>`;
}

function resetAlertFilters() { AlertsState.filters = { sort_by: 'updated_at', sort_dir: 'desc' }; }

// ── Main render ──────────────────────────────────────────────────────────────
async function renderAlerts(root) {
  root.innerHTML = `
    <div class="tabs">
      <div class="tab ${AlertsState.tab==='expiring'  ?'active':''}" data-tab="expiring">
        <i data-lucide="calendar-x" class="tab-icon" aria-hidden="true"></i>Expiring Contracts
      </div>
      <div class="tab ${AlertsState.tab==='renewals'  ?'active':''}" data-tab="renewals">
        <i data-lucide="refresh-ccw" class="tab-icon" aria-hidden="true"></i>Renewal Status
      </div>
      <div class="tab ${AlertsState.tab==='summary'   ?'active':''}" data-tab="summary">
        <i data-lucide="file-bar-chart-2" class="tab-icon" aria-hidden="true"></i>Monthly CB Summary
      </div>
    </div>
    <div id="alerts-tab-content"></div>
  `;
  renderIcons();
  document.querySelectorAll('.tab[data-tab]').forEach(t => t.addEventListener('click', () => {
    AlertsState.tab = t.dataset.tab;
    syncTabHighlight();
    resetAlertFilters();
    renderAlertsTab();
  }));
  renderAlertsTab();
}

function renderAlertsTab() {
  const content = document.getElementById('alerts-tab-content');
  if (!content) return;
  const tab = AlertsState.tab;
  if (tab === 'expiring')       renderExpiringContracts(content);
  else if (tab === 'renewals')  renderRenewals(content);
  else if (tab === 'summary')   renderCallbackSummary(content);
}

// Sync the active class on tab bar to AlertsState.tab without re-rendering the whole header.
function syncTabHighlight() {
  document.querySelectorAll('.tab[data-tab]').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === AlertsState.tab);
  });
}

// ── 1. EXPIRING CONTRACTS (from maintenance_projects + amc_renewals) ────────────
async function renderExpiringContracts(root) {
  const f = AlertsState.filters;
  root.innerHTML = `
    <div class="kpi-grid" id="exp-kpis"></div>
    <div class="toolbar">
      <input type="text" id="exp-search" placeholder="Search Contract Ref., Client, Emirate…">
      <button class="btn" id="exp-add-renewal" title="Add a new AMC renewal record">+ Add Renewal</button>
      <select id="exp-level">
        <option value="">All Alert Levels</option>
        <option value="expired">Expired</option>
        <option value="7">Within 7 days</option>
        <option value="15">Within 15 days</option>
        <option value="30">Within 30 days</option>
      </select>
      <select id="exp-sort-by">
        <option value="days_remaining" ${f.sort_by==='days_remaining'?'selected':''}>Sort: Days Remaining</option>
        <option value="end_date"       ${f.sort_by==='end_date'?'selected':''}>Sort: End Date</option>
        <option value="contract_ref"   ${f.sort_by==='contract_ref'?'selected':''}>Sort: Contract Ref.</option>
        <option value="client_name"    ${f.sort_by==='client_name'?'selected':''}>Sort: Client Name</option>
      </select>
      <button class="btn secondary" id="exp-sort-dir">${f.sort_dir==='asc'?'&#8593; ASC':'&#8595; DESC'}</button>
    </div>
    <div class="table-wrap"><table class="data-table exp-table">
      <thead><tr>
        <th class="ecol-ref">Contract Ref.</th><th class="ecol-mid">Maintenance ID</th><th class="ecol-client">Client</th>
        <th class="ecol-level" title="Why this contract needs attention">Action Required</th><th class="ecol-emirate">Emirate</th><th class="ecol-date">End Date</th>
        <th class="ecol-days">Days</th><th class="ecol-amc">AMC Status</th><th class="ecol-renewal">Renewal Status</th>
        <th class="ecol-act">Activation</th><th class="ecol-action">Action</th>
      </tr></thead>
      <tbody id="exp-tbody"><tr><td colspan="11">Loading…</td></tr></tbody>
    </table></div>
  `;
  const load = async () => {
    const params = new URLSearchParams();
    const s = document.getElementById('exp-search').value;
    const l = document.getElementById('exp-level').value;
    if (s) params.set('search', s);
    if (l) params.set('alert_level', l);
    params.set('sort_by', AlertsState.filters.sort_by || 'days_remaining');
    params.set('sort_dir', AlertsState.filters.sort_dir || 'asc');
    const data = await API.get('/api/alerts/expiring-contracts?' + params);
    const tbody = document.getElementById('exp-tbody');
    const kpis  = document.getElementById('exp-kpis');
    if (kpis) kpis.innerHTML = [
      { label: 'Expired', val: data.summary.expired, style:'background:#f8d7da;color:#842029' },
      { label: '≤7 Days', val: data.summary.within7, style:'background:#fde6e3;color:#c0392b' },
      { label: '≤15 Days', val: data.summary.within15, style:'background:#fdf2dc;color:#b7770d' },
      { label: '≤30 Days', val: data.summary.within30, style:'background:#fff3cd;color:#856404' },
    ].map(c => `<div class="kpi-card" style="${c.style}"><div class="num">${c.val}</div><div class="label">${c.label}</div></div>`).join('')
      + (data.summary.other_attention ? `<div style="grid-column:1/-1;font-size:12px;color:#66758a;margin-top:-4px">
          + ${data.summary.other_attention} other AMC item${data.summary.other_attention === 1 ? '' : 's'} needing action (payment / activation / renewal approval) — shown in the list, not counted in the expiry cards.</div>` : '');
    if (!data.rows.length) { tbody.innerHTML = `<tr><td colspan="11" class="empty-state">No AMC contracts require action for the selected filter.</td></tr>`; return; }
    tbody.innerHTML = data.rows.map(r => {
      const style = alertLevelStyle(r.alert_level);
      // Action Required badge = primary reason from the backend attention queue;
      // tooltip lists every reason. Non-expiry reasons use a neutral amber style.
      const reasonStyle = r.alert_level !== 'ok' ? style : 'background:#fff3cd;color:#7a5a00;';
      const levelLabel = r.action_reason || 'Attention';
      const reasonTip = (r.action_reasons || [levelLabel]).join(' · ');
      // Renewal info + Add Renewal eligibility are decided by the backend
      // (current AMC period logic) — the browser only renders them.
      const hasRenewal = !!r.renewal_ref;
      const canAdd = Number(r.can_add_renewal) === 1;
      const ACT = { payment: ['Update Payment', true], activation: ['Activation', false], review: ['Review', false] }[r.permitted_action];
      const actionCell = canAdd
        ? `<button class="${hasRenewal ? 'btn small secondary' : 'btn small'}"
            data-add-renewal data-ref="${esc(r.contract_ref||'')}"
            data-mid="${esc(r.maintenance_id||'')}" data-mpid="${r.id||''}"
            title="${hasRenewal ? 'Add next renewal' : 'Add Renewal'}">
            ${hasRenewal ? '+ Renew Again' : '+ Add Renewal'}
          </button>`
        : (ACT && r.display_renewal_id)
          ? `<button class="btn small secondary" data-open-renewal="${r.display_renewal_id}" data-focus-pay="${ACT[1] ? 1 : 0}"
               title="${esc((r.renewal_ref || '') + ' — ' + reasonTip)}">${ACT[0]}</button>`
          : `<span style="color:#66758a;font-size:0.82em">${Number(r.renewal_in_progress) === 1 ? 'Renewal in progress' : '—'}</span>`;
      return `<tr>
        <td title="${esc(r.contract_ref||'')}">${esc(r.contract_ref||'-')}</td>
        <td style="font-size:0.82em;color:#66758a" title="${esc(r.maintenance_id||'')}">${esc(r.maintenance_id||'-')}</td>
        <td title="${esc(r.client_name||'')}">${esc(r.client_name||'-')}</td>
        <td title="${esc(reasonTip)}"><span class="badge" style="${reasonStyle}">${esc(levelLabel)}</span></td>
        <td>${esc(r.location||'-')}</td>
        <td>${fmtDate(r.maintenance_end_date)}</td>
        <td><span class="badge" style="${style}">${alertLevelLabel(r.alert_level, r.days_remaining)}</span></td>
        <td title="${esc(r.current_status||'')}">${esc(r.current_status||'-')}</td>
        <td>${hasRenewal ? amcRenewalBadge(r.renewal_status) : '<span style="color:#aaa">No renewal</span>'}</td>
        <td>${hasRenewal ? amcActivationBadge(r.amc_activation_status) : '-'}</td>
        <td>${actionCell}</td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('[data-add-renewal]').forEach(btn => {
      btn.addEventListener('click', () => openAddRenewalModal(btn.dataset.ref, btn.dataset.mid, btn.dataset.mpid));
    });
    tbody.querySelectorAll('[data-open-renewal]').forEach(btn => {
      btn.addEventListener('click', () => openAmcRenewalModal(btn.dataset.openRenewal, btn.dataset.focusPay === '1'));
    });
  };
  document.getElementById('exp-search').addEventListener('input', debounce(load, 350));
  document.getElementById('exp-level').addEventListener('change', load);
  document.getElementById('exp-add-renewal').addEventListener('click', () => openAddRenewalModal('', '', ''));
  document.getElementById('exp-sort-by').addEventListener('change', e => { AlertsState.filters.sort_by = e.target.value; load(); });
  document.getElementById('exp-sort-dir').addEventListener('click', () => {
    AlertsState.filters.sort_dir = AlertsState.filters.sort_dir === 'asc' ? 'desc' : 'asc';
    document.getElementById('exp-sort-dir').innerHTML = AlertsState.filters.sort_dir === 'asc' ? '&#8593; ASC' : '&#8595; DESC';
    load();
  });
  await load();
}

async function openAddRenewalModal(contractRef, maintenanceId, maintenanceProjectId) {
  // Build form with whatever we know; fetch supplementary data if we have a contract ref
  let renewalRef = '';
  let proj = {};

  if (contractRef) {
    try {
      const refData = await API.get(`/api/renewals/generate-ref?contract_ref=${encodeURIComponent(contractRef)}`);
      renewalRef = refData.renewal_ref || '';
    } catch(_) {}
    try {
      const lookup = await API.get(`/api/alerts/maintenance-lookup?contract_ref=${encodeURIComponent(contractRef)}`);
      proj = lookup.project || {};
    } catch(_) {}
  }

  const prevInfo = (proj.start_date || proj.end_date)
    ? `<div class="form-field span2" style="background:#f0f7f4;padding:10px 12px;border-radius:6px;font-size:0.85em;color:#2c6e49;">
        <strong>Previous AMC Period:</strong> ${fmtDate(proj.start_date)} – ${fmtDate(proj.end_date)} &nbsp;|&nbsp;
        <strong>Value:</strong> ${proj.amc_value ? fmtCurrency(proj.amc_value, 'AED') : 'N/A'} &nbsp;|&nbsp;
        <strong>Maintenance ID:</strong> ${esc(proj.maintenance_id||'-')}
       </div>`
    : '';

  openModal(`
    <h2>Add AMC Renewal${contractRef ? ' — ' + esc(contractRef) : ''}</h2>
    <form id="add-renewal-form">
      <div class="form-grid">
        ${formField('Contract Ref. *', 'contract_ref', contractRef||'')}
        ${formField('Renewal Ref. *', 'renewal_ref', renewalRef)}
        ${formField('Client / Company Name', 'client_name', proj.client_name||'')}
        ${formField('Emirate', 'emirate', proj.emirate||'')}
        ${formField('Maintenance Type', 'maintenance_type', proj.maintenance_type||'')}
        ${prevInfo}
        ${formField('Prev. Start Date', 'prev_start_date', proj.start_date||'', { type:'date' })}
        ${formField('Prev. End Date', 'prev_end_date', proj.end_date||'', { type:'date' })}
        ${formField('Renewal Status', 'renewal_status', 'Pending', { select: AMC_RENEWAL_STATUS_OPTS })}
        <div id="renewal-date-fields" style="display:contents;">
          ${formField('New Start Date *', 'new_start_date', '', { type:'date' })}
          ${formField('New End Date *', 'new_end_date', '', { type:'date' })}
          ${formField('New AMC Value (AED)', 'new_amc_value', '', { type:'number', step:'0.01' })}
          ${formField('Payment Status', 'payment_status', 'Unpaid', { select: AMC_PAYMENT_STATUS_OPTS })}
        </div>
        <div id="renewal-cancel-fields" style="display:none;contents:none;">
          ${formField('Cancellation / Rejection Reason *', 'cancellation_reason', '', { textarea:true, span2:true })}
        </div>
        ${formField('Remarks', 'remarks', '', { textarea:true, span2:true })}
      </div>
      <div class="modal-actions">
        <div class="spacer"></div>
        <button type="button" class="btn secondary" id="cancel-modal">Cancel</button>
        <button type="submit" class="btn">Create Renewal</button>
      </div>
    </form>
  `);

  // If contract ref field is manually changed, auto-fill from maintenance module
  const contractRefEl = document.querySelector('#add-renewal-form [name="contract_ref"]');
  if (contractRefEl) {
    contractRefEl.addEventListener('change', async () => {
      const cr = contractRefEl.value.trim();
      if (!cr) return;
      try {
        const refData = await API.get(`/api/renewals/generate-ref?contract_ref=${encodeURIComponent(cr)}`);
        const refEl = document.querySelector('#add-renewal-form [name="renewal_ref"]');
        if (refEl && !refEl.value) refEl.value = refData.renewal_ref || '';
      } catch(_) {}
      try {
        const lookup = await API.get(`/api/alerts/maintenance-lookup?contract_ref=${encodeURIComponent(cr)}`);
        const p = lookup.project || {};
        const set = (n, v) => { const el = document.querySelector(`#add-renewal-form [name="${n}"]`); if (el && !el.value && v) el.value = v; };
        set('client_name', p.client_name);
        set('emirate', p.emirate);
        set('maintenance_type', p.maintenance_type);
        set('prev_start_date', p.start_date);
        set('prev_end_date', p.end_date);
      } catch(_) {}
    });
  }

  // Toggle date/cancel fields based on renewal status
  function toggleRenewalFields() {
    const statusEl = document.querySelector('#add-renewal-form [name="renewal_status"]');
    const dateDiv  = document.getElementById('renewal-date-fields');
    const cancelDiv = document.getElementById('renewal-cancel-fields');
    if (!statusEl || !dateDiv || !cancelDiv) return;
    const isCancelDecision = ['Rejected','Cancelled'].includes(statusEl.value);
    dateDiv.style.cssText   = isCancelDecision ? 'display:none' : 'display:contents';
    cancelDiv.style.cssText = isCancelDecision ? 'display:contents' : 'display:none';
  }
  const statusSelectEl = document.querySelector('#add-renewal-form [name="renewal_status"]');
  if (statusSelectEl) {
    statusSelectEl.addEventListener('change', toggleRenewalFields);
    toggleRenewalFields(); // apply on open in case default is Rejected/Cancelled
  }

  document.getElementById('cancel-modal').addEventListener('click', closeModal);
  document.getElementById('add-renewal-form').addEventListener('submit', async e => {
    e.preventDefault();
    const body = readForm(e.target);
    if (maintenanceProjectId) body.maintenance_project_id = maintenanceProjectId;
    if (!body.contract_ref) return toast('Contract Ref. is required', true);
    if (!body.renewal_ref)  return toast('Renewal Ref. is required', true);
    const isCancelDecision = ['Rejected','Cancelled'].includes(body.renewal_status);
    if (!isCancelDecision && (!body.new_start_date || !body.new_end_date))
      return toast('New Start Date and New End Date are required', true);
    try {
      await API.post('/api/renewals', body);
      const msg = isCancelDecision
        ? `Renewal saved as Cancelled. Maintenance contract updated.`
        : 'Renewal record created';
      toast(msg);
      closeModal();
      AlertsState.tab = 'renewals';
      syncTabHighlight();
      resetAlertFilters();
      renderAlertsTab();
    } catch(err) { toast(err.message || 'Failed to create renewal', true); }
  });
}

// ── 2. RENEWAL STATUS (AMC Renewals via amc_renewals table) ──────────────────
// 2026-10-03 desktop-fit layout: compact fixed columns + a capped Client column.
// Base widths fit a 1440px screen (content ≈1138px); on wider screens the spare
// width beyond the Client cap (260px) is shared by the other columns; below
// ≈1140px content a short horizontal scroll remains.
const REN_COLS = [
  { k: 'ref', w: 94 }, { k: 'contract', w: 86 }, { k: 'client', w: 0 }, { k: 'prev', w: 112 }, { k: 'new', w: 112 },
  { k: 'amc', w: 72 }, { k: 'rec', w: 66 }, { k: 'due', w: 64 }, { k: 'pdate', w: 64 },
  { k: 'rstatus', w: 100 }, { k: 'pstatus', w: 64 }, { k: 'act', w: 68 }, { k: 'actions', w: 104 },
];
const REN_CLIENT_MIN = 128, REN_CLIENT_MAX = 260;
function _renLayout() {
  const tbl = document.querySelector('table.ren-table'), cols = document.querySelectorAll('#ren-cols col');
  if (!tbl || !cols.length) return;
  const avail = tbl.parentElement.clientWidth || 0;
  const wide = avail >= 1240;                               // room for the full "Edit Pmt" label
  const base = REN_COLS.map(c => c.k === 'actions' ? (wide ? 132 : 104) : c.w);
  const fixed = base.reduce((s, w) => s + w, 0);
  const client = Math.max(REN_CLIENT_MIN, Math.min(REN_CLIENT_MAX, avail - fixed));
  const extra = Math.max(0, avail - fixed - client);
  const share = REN_COLS.filter(c => c.w && c.k !== 'actions').reduce((s, c) => s + c.w, 0);
  cols.forEach((col, i) => {
    const c = REN_COLS[i];
    const w = c.k === 'client' ? client : c.k === 'actions' ? base[i] : Math.floor(base[i] + extra * c.w / share);
    col.style.width = w + 'px';
  });
  tbl.style.minWidth = (fixed + client) + 'px';
  document.querySelectorAll('.ren-pay-btn').forEach(b => { b.textContent = wide ? 'Edit Pmt' : 'Edit'; });
}
window.addEventListener('resize', debounce(() => { if (document.querySelector('table.ren-table')) _renLayout(); }, 150));

async function renderRenewals(root) {
  const f = AlertsState.filters;
  root.innerHTML = `
    <style>
      /* 2026-10-03: compact, desktop-fit Renewal Status table (single-line rows) */
      .ren-toolbar{flex-wrap:wrap;gap:6px}
      .ren-toolbar input[type=text]{flex:1;min-width:170px;max-width:300px}
      .ren-toolbar select{max-width:160px}
      table.ren-table{table-layout:fixed;width:100%;font-size:11.5px}
      table.ren-table td.per{font-size:11px;letter-spacing:-0.1px}
      table.ren-table th{padding:7px 5px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:sticky;top:0;z-index:2}
      table.ren-table td{padding:5px 5px;height:40px;vertical-align:middle;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      table.ren-table td.num, table.ren-table th.num{text-align:right}
      table.ren-table .badge{padding:2px 7px;font-size:10.5px}
      table.ren-table .btn.small{padding:3px 6px;font-size:11px;line-height:1.3}
      .ren-warn{color:#b7770d;font-size:12px;margin-left:3px;cursor:help}
    </style>
    <div class="toolbar ren-toolbar">
      <input type="text" id="renewal-search" placeholder="Search Renewal Ref., Contract Ref., Client…">
      <select id="renewal-status-filter">
        <option value="">All Renewal Status</option>
        ${AMC_RENEWAL_STATUS_OPTS.map(s=>`<option>${s}</option>`).join('')}
      </select>
      <select id="renewal-payment-filter">
        <option value="">All Payment Status</option>
        ${AMC_PAYMENT_STATUS_OPTS.map(s=>`<option>${s}</option>`).join('')}
      </select>
      <select id="renewal-activation-filter">
        <option value="">All Activation</option>
        ${AMC_ACTIVATION_OPTS.map(s=>`<option>${s}</option>`).join('')}
      </select>
      <select id="renewal-sort-by">
        <option value="updated_at">Sort: Last Updated</option>
        <option value="renewal_ref">Sort: Renewal Ref.</option>
        <option value="contract_ref">Sort: Contract Ref.</option>
        <option value="renewal_status">Sort: Renewal Status</option>
        <option value="new_end_date">Sort: New End Date</option>
      </select>
      <button class="btn secondary" id="renewal-sort-dir">${f.sort_dir==='asc'?'&#8593; ASC':'&#8595; DESC'}</button>
      <label style="font-size:12px;color:#556;display:flex;align-items:center;gap:4px;white-space:nowrap" title="Completed renewals (Approved + Active + payment received, period synchronized) are kept as history">
        <input type="checkbox" id="renewal-show-completed" ${f.show_completed?'checked':''}> Show completed</label>
    </div>
    <div id="renewal-queue-note" style="font-size:11.5px;color:#556;margin:-2px 0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
    <div class="table-wrap"><table class="data-table ren-table">
      <colgroup id="ren-cols">${REN_COLS.map(c => `<col style="width:${c.w ? c.w + 'px' : 'auto'}">`).join('')}</colgroup>
      <thead><tr>
        <th>Renewal Ref.</th><th>Contract Ref.</th><th>Client</th>
        <th>Prev. Period</th><th>New Period</th>
        <th class="num" title="AMC Value (AED)">AMC Value</th>
        <th class="num" title="Total received (AED)">Received</th>
        <th class="num" title="Balance due (AED)">Due</th>
        <th>Pmt Date</th>
        <th>Renewal Status</th><th title="Payment Status">Payment</th><th>Activation</th><th></th>
      </tr></thead>
      <tbody id="renewal-tbody"><tr><td colspan="13">Loading…</td></tr></tbody>
    </table></div>
  `;
  const load = async () => {
    const params = new URLSearchParams();
    const s  = document.getElementById('renewal-search').value;
    const rs = document.getElementById('renewal-status-filter').value;
    const ps = document.getElementById('renewal-payment-filter').value;
    const as = document.getElementById('renewal-activation-filter').value;
    if (s)  params.set('search', s);
    if (rs) params.set('renewal_status', rs);
    if (ps) params.set('payment_status', ps);
    if (as) params.set('amc_activation_status', as);
    params.set('sort_by', AlertsState.filters.sort_by || 'updated_at');
    params.set('sort_dir', AlertsState.filters.sort_dir || 'desc');
    if (AlertsState.filters.show_completed) params.set('include_completed', '1');
    const data = await API.get('/api/renewals?' + params);
    const tbody = document.getElementById('renewal-tbody');
    const qn = document.getElementById('renewal-queue-note');
    if (qn) qn.innerHTML = data.include_completed
      ? 'Action queue + completed renewals (history).'
      : `Action queue — renewals awaiting decision, activation or first payment.${data.completed_hidden ? ` <span style="color:#1f7a5c">${data.completed_hidden} completed renewal(s) hidden — now current AMC periods</span>.` : ''}`;
    if (!data.rows || !data.rows.length) {
      const isFiltered = !!(document.getElementById('renewal-search')?.value ||
        document.getElementById('renewal-status-filter')?.value ||
        document.getElementById('renewal-payment-filter')?.value ||
        document.getElementById('renewal-activation-filter')?.value);
      tbody.innerHTML = `<tr><td colspan="13" class="empty-state">
        ${isFiltered
          ? 'No renewal records match the selected filters. <a href="#" id="clear-renewal-filters" style="color:#2980b9">Clear filters</a>'
          : 'No renewal records found. <button class="btn small" onclick="openAddRenewalModal(\'\',\'\',\'\')">+ Add Renewal</button>'
        }
      </td></tr>`;
      const clearLink = document.getElementById('clear-renewal-filters');
      if (clearLink) clearLink.addEventListener('click', e => { e.preventDefault();
        document.getElementById('renewal-search').value = '';
        document.getElementById('renewal-status-filter').value = '';
        document.getElementById('renewal-payment-filter').value = '';
        document.getElementById('renewal-activation-filter').value = '';
        load();
      });
      return;
    }
    const cc = r => r.currency_code || 'AED';
    // compact cell formats — full values are in the tooltips
    const amt = (v, c) => { const t = fmtCurrency(v, c); return c === 'AED' ? t.replace(/^AED\s/, '') : t; };
    // compact DD/MM/YY (full dates in the tooltip)
    const dShort = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); if (!m) return v ? esc(v) : '-';
      return `${m[3]}/${m[2]}/${m[1].slice(2)}`; };
    const period = (a, b) => (a || b) ? `${dShort(a)}–${dShort(b)}` : '-';
    const periodFull = (a, b) => `${fmtDate(a)} – ${fmtDate(b)}`;
    tbody.innerHTML = data.rows.map(r => {
      const totalReceived = parseFloat(r.total_received) || 0;
      const amcValue      = parseFloat(r.new_amc_value)  || 0;
      const due           = amcValue - totalReceived;
      const effStatus     = r.effective_payment_status || r.payment_status;
      const dueColor      = due > 0 ? 'color:#c0392b;font-weight:600' : due < 0 ? 'color:#e67e22' : 'color:#27ae60';
      // status cell = primary badge only; data-review findings live in Details (optional ⚠ marker)
      const review = r.queue_reason && /^Data Review/.test(r.queue_reason)
        ? '<span class="ren-warn" title="Data review required — open Details">⚠</span>' : '';
      return `<tr data-id="${r.id}" style="cursor:pointer;">
        <td title="${esc(r.renewal_ref||'')}"><strong>${esc(r.renewal_ref||'-')}</strong></td>
        <td title="${esc(r.contract_ref||'')}">${esc(r.contract_ref||'-')}</td>
        <td title="${esc(r.client_name||'')}">${esc(r.client_name||'-')}</td>
        <td class="per" title="${periodFull(r.prev_start_date, r.prev_end_date)}">${period(r.prev_start_date, r.prev_end_date)}</td>
        <td class="per" title="${periodFull(r.new_start_date, r.new_end_date)}">${period(r.new_start_date, r.new_end_date)}</td>
        <td class="num" title="${amcValue ? fmtCurrency(amcValue, cc(r)) : ''}">${amcValue ? amt(amcValue, cc(r)) : '-'}</td>
        <td class="num" title="${totalReceived ? fmtCurrency(totalReceived, cc(r)) : ''}" style="color:${totalReceived>0?'#27ae60':'#888'}">${totalReceived ? amt(totalReceived, cc(r)) : '-'}</td>
        <td class="num" title="${amcValue ? fmtCurrency(due, cc(r)) : ''}" style="${dueColor}">${amcValue ? amt(due, cc(r)) : '-'}</td>
        <td title="${fmtDate(r.payment_date)}">${dShort(r.payment_date)}</td>
        <td>${amcRenewalBadge(r.renewal_status)}${review}</td>
        <td>${amcPaymentBadge(effStatus)}</td>
        <td>${amcActivationBadge(r.amc_activation_status)}</td>
        <td>
          <button class="btn small secondary" data-edit="${r.id}">Details</button><button class="btn small ren-pay-btn" data-edit-pay="${r.id}" style="margin-left:3px" title="Edit Payment">Edit Pmt</button>
        </td>
      </tr>`;
    }).join('');
    _renLayout();
    tbody.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      openAmcRenewalModal(tr.dataset.id);
    }));
    tbody.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => openAmcRenewalModal(btn.dataset.edit)));
    tbody.querySelectorAll('[data-edit-pay]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      openAmcRenewalModal(btn.dataset.editPay, true);
    }));
  };
  document.getElementById('renewal-search').addEventListener('input', debounce(load, 350));
  document.getElementById('renewal-status-filter').addEventListener('change', load);
  document.getElementById('renewal-payment-filter').addEventListener('change', load);
  document.getElementById('renewal-activation-filter').addEventListener('change', load);
  document.getElementById('renewal-show-completed').addEventListener('change', e => { AlertsState.filters.show_completed = e.target.checked; load(); });
  document.getElementById('renewal-sort-by').addEventListener('change', e => { AlertsState.filters.sort_by = e.target.value; load(); });
  document.getElementById('renewal-sort-dir').addEventListener('click', () => {
    AlertsState.filters.sort_dir = AlertsState.filters.sort_dir === 'asc' ? 'desc' : 'asc';
    document.getElementById('renewal-sort-dir').innerHTML = AlertsState.filters.sort_dir === 'asc' ? '&#8593; ASC' : '&#8595; DESC';
    load();
  });
  await load();
}

// ── Payment transaction edit helpers (global scope — called from inline onclick) ──
function _editTxn(txnId) {
  const editRow = document.getElementById(`txn-edit-${txnId}`);
  if (editRow) editRow.style.display = '';
}
function _cancelTxnEdit(txnId) {
  const editRow = document.getElementById(`txn-edit-${txnId}`);
  if (editRow) editRow.style.display = 'none';
}
async function _saveTxnEdit(renewalId, txnId) {
  const amount         = document.getElementById(`edit-txn-amount-${txnId}`)?.value;
  const payment_date   = document.getElementById(`edit-txn-date-${txnId}`)?.value;
  const invoice_ref    = document.getElementById(`edit-txn-invoice-${txnId}`)?.value;
  const payment_method = document.getElementById(`edit-txn-method-${txnId}`)?.value;
  const reason         = document.getElementById(`edit-txn-reason-${txnId}`)?.value?.trim();
  if (!reason)             return toast('Reason for change is required', true);
  if (!amount || parseFloat(amount) <= 0) return toast('Amount must be greater than 0', true);
  try {
    await API.patch(`/api/renewals/${renewalId}/payment-txn/${txnId}`,
      { amount, payment_date, invoice_ref, payment_method, reason_for_change: reason });
    toast('Payment transaction updated');
    renderAlertsTab();
    openAmcRenewalModal(renewalId, true);
  } catch(err) { toast(err.message || 'Update failed', true); }
}

// focusPayment=true scrolls to the payment section on open (from "Edit Pmt" button in list)
async function openAmcRenewalModal(id, focusPayment) {
  let data;
  try { data = await API.get(`/api/renewals/${id}`); } catch(e) { toast('Failed to load renewal', true); return; }
  const r = data.row || {};
  const auditLog     = data.auditLog     || [];
  const transactions = data.transactions || [];
  const totalReceived = parseFloat(data.total_received) || 0;
  const balance       = parseFloat(data.balance)        || 0;
  const amcValue      = parseFloat(r.new_amc_value)     || 0;
  const cc            = r.currency_code || 'AED';
  const isAdmin  = APP.user && ['admin','management'].includes(APP.user.role);
  const canEdit  = APP.user && APP.user.role !== 'viewer';
  const effStatus = totalReceived === 0 ? 'Unpaid'
    : (amcValue > 0 && totalReceived >= amcValue) ? 'Paid' : 'Partial';
  const displayStatus = ['Later','Overdue','Hold'].includes(r.payment_status) ? r.payment_status : effStatus;
  // Fetch sibling renewals for Renewal History section (fire-and-forget; fills in after modal opens)
  let historyRows = [];
  try {
    const hist = await API.get(`/api/renewals/contract/${encodeURIComponent(r.contract_ref||'')}/history`);
    historyRows = (hist.rows || []).filter(h => h.id !== r.id);
  } catch(_) {}

  openModal(`
    <h3>AMC Renewal: ${esc(r.renewal_ref||'-')}</h3>
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
      ${amcRenewalBadge(r.renewal_status)}
      ${amcPaymentBadge(displayStatus)}
      ${amcActivationBadge(r.amc_activation_status)}
    </div>
    ${data.completed ? `<div style="background:#e8f5ef;border:1px solid #b7dfc2;color:#1f5f3f;border-radius:6px;padding:7px 12px;margin-bottom:12px;font-size:12.5px">
        <b>Completed</b> — this renewal is the current AMC period in Maintenance Records.</div>`
      : data.queue_reason ? `<div style="background:${/^Data Review/.test(data.queue_reason) ? '#fff4e0;border:1px solid #f0c987;color:#7a4b00' : '#f4f7fb;border:1px solid #dde3ec;color:#3a4a5c'};border-radius:6px;padding:7px 12px;margin-bottom:12px;font-size:12.5px">
        <b>${/^Data Review/.test(data.queue_reason) ? 'Data Review' : 'Action required'}:</b> ${esc(String(data.queue_reason).replace(/^Data Review\s*—\s*/, ''))}</div>` : ''}
    <div class="form-grid" style="margin-bottom:14px;">
      <div class="form-field"><label>Contract Ref.</label><div style="padding:6px 0">${esc(r.contract_ref||'-')}</div></div>
      <div class="form-field"><label>Client</label><div style="padding:6px 0">${esc(r.client_name||'-')}</div></div>
      <div class="form-field"><label>Emirate</label><div style="padding:6px 0">${esc(r.emirate||'-')}</div></div>
      <div class="form-field"><label>Maintenance Type</label><div style="padding:6px 0">${esc(r.maintenance_type||'-')}</div></div>
      <div class="form-field"><label>Prev. Period</label><div style="padding:6px 0">${fmtDate(r.prev_start_date)} – ${fmtDate(r.prev_end_date)}</div></div>
      <div class="form-field"><label>New Period</label><div style="padding:6px 0">${fmtDate(r.new_start_date)} – ${fmtDate(r.new_end_date)}</div></div>
      <div class="form-field"><label>AMC Value</label><div style="padding:6px 0;font-weight:600">${amcValue ? fmtCurrency(amcValue, cc) : '-'}</div></div>
      <div class="form-field"><label>Total Received</label><div style="padding:6px 0;font-weight:600;color:${totalReceived>0?'#27ae60':'#888'}">${totalReceived ? fmtCurrency(totalReceived, cc) : '-'}</div></div>
      <div class="form-field"><label>Balance Due</label><div style="padding:6px 0;font-weight:600;color:${balance>0?'#c0392b':balance<0?'#e67e22':'#27ae60'}">${amcValue ? fmtCurrency(balance, cc) : '-'}</div></div>
      <div class="form-field"><label>Last Payment Date</label><div style="padding:6px 0">${fmtDate(r.payment_date)}</div></div>
      <div class="form-field"><label>Approval Date</label><div style="padding:6px 0">${fmtDate(r.approval_date)}</div></div>
      <div class="form-field"><label>Approved By</label><div style="padding:6px 0">${esc(r.approved_by||'-')}</div></div>
      <div class="form-field span2"><label>Remarks</label><div style="padding:6px 0">${esc(r.remarks||'-')}</div></div>
    </div>

    <!-- Payment History -->
    <div style="margin-bottom:14px;" id="payment-section-${id}">
      <strong style="display:block;margin-bottom:6px;font-size:0.9em;color:#2c3e50;">Payment History</strong>
      ${transactions.length ? `
      <table class="data-table" style="font-size:0.82em;">
        <thead><tr><th>#</th><th>Date</th><th style="text-align:right">Amount</th><th>Method</th><th>Invoice Ref.</th><th>Notes</th><th>By</th>${canEdit?'<th></th>':''}</tr></thead>
        <tbody id="pay-history-tbody">
          ${transactions.map((t,i)=>`
          <tr id="txn-row-${t.id}">
            <td>${i+1}</td>
            <td>${fmtDate(t.payment_date)}</td>
            <td style="text-align:right;font-weight:600">${fmtCurrency(t.amount, cc)}</td>
            <td>${esc(t.payment_method||'-')}</td>
            <td>${esc(t.invoice_ref||'-')}</td>
            <td>${esc(t.notes||'-')}</td>
            <td style="font-size:0.85em;color:#888">${esc(t.entered_by||'-')}</td>
            ${canEdit?`<td><button class="btn small secondary" onclick="_editTxn(${t.id})">Edit</button></td>`:''}
          </tr>
          ${canEdit?`<tr id="txn-edit-${t.id}" style="display:none;background:#fffbee;">
            <td colspan="8" style="padding:8px 4px;">
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
                <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:90px;">
                  <label style="font-size:0.72em;font-weight:600;color:#666">AMOUNT (${cc})</label>
                  <input id="edit-txn-amount-${t.id}" type="number" step="0.01" value="${t.amount||''}" style="width:100%">
                </div>
                <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:110px;">
                  <label style="font-size:0.72em;font-weight:600;color:#666">PAYMENT DATE</label>
                  <input id="edit-txn-date-${t.id}" type="date" value="${t.payment_date||''}" style="width:100%">
                </div>
                <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:90px;">
                  <label style="font-size:0.72em;font-weight:600;color:#666">INVOICE REF</label>
                  <input id="edit-txn-invoice-${t.id}" type="text" value="${esc(t.invoice_ref||'')}" style="width:100%">
                </div>
                <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:100px;">
                  <label style="font-size:0.72em;font-weight:600;color:#666">METHOD</label>
                  <select id="edit-txn-method-${t.id}" style="width:100%">
                    <option value="">Select…</option>
                    ${['Cash','Cheque','Bank Transfer','Card','Online'].map(m=>`<option value="${m}" ${m===(t.payment_method||'')?'selected':''}>${m}</option>`).join('')}
                  </select>
                </div>
                <div style="display:flex;flex-direction:column;gap:2px;flex:2;min-width:140px;">
                  <label style="font-size:0.72em;font-weight:600;color:#c0392b">REASON FOR CHANGE *</label>
                  <input id="edit-txn-reason-${t.id}" type="text" placeholder="Required" style="width:100%;border-color:#c0392b">
                </div>
                <div style="display:flex;gap:4px;align-items:flex-end;">
                  <button class="btn small" onclick="_saveTxnEdit(${id}, ${t.id})">Save</button>
                  <button class="btn small secondary" onclick="_cancelTxnEdit(${t.id})">Cancel</button>
                </div>
              </div>
            </td>
          </tr>`:''}
          `).join('')}
          <tr style="background:#f0f7f4;font-weight:700;">
            <td colspan="2">Total</td>
            <td style="text-align:right">${fmtCurrency(totalReceived, cc)}</td>
            <td colspan="${canEdit?5:4}"></td>
          </tr>
        </tbody>
      </table>` : `<div style="color:#888;font-size:0.85em;padding:8px 0">No payment transactions recorded yet.</div>`}
    </div>

    ${canEdit ? `
    <!-- Add Payment Transaction -->
    <div style="background:#f0f7f4;border-radius:8px;padding:14px;margin-bottom:12px;">
      <strong style="display:block;margin-bottom:8px;">Add Payment</strong>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
        <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:120px;">
          <label style="font-size:0.75em;color:#666;font-weight:600;">AMOUNT (${cc})</label>
          <input type="number" id="txn-amount" step="0.01" placeholder="0.00" style="width:100%">
        </div>
        <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:120px;">
          <label style="font-size:0.75em;color:#666;font-weight:600;">PAYMENT DATE</label>
          <input type="date" id="txn-date" style="width:100%">
        </div>
        <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:120px;">
          <label style="font-size:0.75em;color:#666;font-weight:600;">INVOICE REF.</label>
          <input type="text" id="txn-invoice" placeholder="Invoice Ref." style="width:100%">
        </div>
        <div style="display:flex;flex-direction:column;gap:2px;flex:2;min-width:160px;">
          <label style="font-size:0.75em;color:#666;font-weight:600;">NOTES</label>
          <input type="text" id="txn-notes" placeholder="Notes (optional)" style="width:100%">
        </div>
        <button class="btn" id="btn-add-txn" style="align-self:flex-end;white-space:nowrap">Add Payment</button>
      </div>
    </div>
    <!-- Update AMC Value / Payment Override -->
    <div style="background:#f5f6fa;border-radius:8px;padding:14px;margin-bottom:12px;">
      <strong style="display:block;margin-bottom:8px;font-size:0.87em;">Set AMC Value / Override Status</strong>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
        <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:130px;">
          <label style="font-size:0.75em;color:#666;font-weight:600;">AMC VALUE (${cc})</label>
          <input type="number" id="pay-amc-value" step="0.01" placeholder="0.00" value="${r.new_amc_value||''}" style="width:100%">
        </div>
        <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:110px;">
          <label style="font-size:0.75em;color:#666;font-weight:600;">OVERRIDE STATUS</label>
          <select id="pay-status" style="width:100%;">
            <option value="">Auto-derive</option>
            ${AMC_PAYMENT_STATUS_OPTS.map(s=>`<option value="${s}" ${s===r.payment_status?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <button class="btn secondary" id="btn-payment" style="align-self:flex-end">Update</button>
      </div>
    </div>` : ''}

    ${isAdmin && r.renewal_status !== 'Approved' ? `
    <div style="background:#f0f7f4;border-radius:8px;padding:14px;margin-bottom:12px;">
      <strong style="display:block;margin-bottom:8px;">Approve Renewal</strong>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <select id="approve-activation" style="flex:1;min-width:140px;">
          <option value="Active">Activate AMC (generate schedules)</option>
          <option value="Hold">Set to Hold (no schedules)</option>
        </select>
        <input type="text" id="approve-hold-reason" placeholder="Hold reason (if Hold)" style="flex:1;min-width:140px;display:none">
        <button class="btn" id="btn-approve">Approve</button>
      </div>
    </div>` : ''}

    ${isAdmin && r.renewal_status === 'Approved' && r.amc_activation_status !== 'Active' ? `
    <div style="background:#f0f7f4;border-radius:8px;padding:14px;margin-bottom:12px;">
      <strong style="display:block;margin-bottom:8px;">Activate AMC</strong>
      <p style="font-size:0.85em;color:#66758a;margin:0 0 8px">Generates visit schedules for remaining renewal period.</p>
      <button class="btn" id="btn-activate">Activate AMC</button>
    </div>` : ''}

    ${isAdmin && r.renewal_status === 'Approved' && r.amc_activation_status === 'Active' ? `
    <div style="background:#fff8e7;border-radius:8px;padding:14px;margin-bottom:12px;">
      <strong style="display:block;margin-bottom:8px;">Put AMC on Hold</strong>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input type="text" id="hold-reason" placeholder="Hold reason" style="flex:1;min-width:180px">
        <button class="btn warning" id="btn-hold">Hold AMC</button>
      </div>
    </div>` : ''}

    ${isAdmin && r.renewal_status !== 'Cancelled' ? `
    <div style="background:#fdf3f3;border:1px solid #f5c6c6;border-radius:8px;padding:14px;margin-bottom:12px;">
      <strong style="display:block;margin-bottom:8px;color:#842029;">Cancel / Reject Renewal</strong>
      <p style="font-size:0.83em;color:#842029;margin:0 0 10px">Both options result in final status: <strong>Cancelled</strong>. The maintenance contract will be moved to Cancelled AMC and removed from active alerts.</p>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
        <select id="cancel-decision" style="flex:0 0 160px;">
          <option value="Cancelled">Cancelled</option>
          <option value="Rejected">Rejected</option>
        </select>
        <input type="text" id="cancel-reason" placeholder="Reason (required)" style="flex:1;min-width:200px">
      </div>
      <button class="btn danger" id="btn-cancel-renewal">Confirm Cancel / Reject</button>
    </div>` : ''}

    ${r.renewal_status === 'Cancelled' ? `
    <div style="background:#f5f6fa;border-radius:8px;padding:12px;margin-bottom:12px;font-size:0.85em;color:#66758a;">
      <strong>This renewal is Cancelled.</strong> The maintenance contract has been moved to Cancelled AMC and is excluded from active alerts and scheduling.
    </div>` : ''}

    ${historyRows.length ? `
    <details style="margin-top:8px;">
      <summary style="cursor:pointer;font-weight:600;color:#2c3e50;font-size:0.87em;">Renewal History (${historyRows.length} previous renewal${historyRows.length>1?'s':''})</summary>
      <div style="margin-top:8px;max-height:180px;overflow-y:auto;">
        <table class="data-table" style="font-size:0.79em;">
          <thead><tr><th>Renewal Ref.</th><th>New Period</th><th style="text-align:right">AMC Value</th><th style="text-align:right">Received</th><th>Payment Status</th><th>Renewal Status</th><th>Activation</th></tr></thead>
          <tbody>${historyRows.map(h=>{
            const hReceived = parseFloat(h.total_received)||0;
            const hValue    = parseFloat(h.new_amc_value)||0;
            const hStatus   = hReceived===0?'Unpaid':(hValue>0&&hReceived>=hValue?'Paid':'Partial');
            const hDisplay  = ['Later','Overdue','Hold'].includes(h.payment_status)?h.payment_status:hStatus;
            return `<tr style="cursor:pointer" onclick="openAmcRenewalModal(${h.id})">
              <td><a style="color:#2980b9;text-decoration:underline;cursor:pointer">${esc(h.renewal_ref||'-')}</a></td>
              <td>${fmtDate(h.new_start_date)} – ${fmtDate(h.new_end_date)}</td>
              <td style="text-align:right">${hValue?fmtCurrency(hValue,cc):'-'}</td>
              <td style="text-align:right">${hReceived?fmtCurrency(hReceived,cc):'-'}</td>
              <td>${amcPaymentBadge(hDisplay)}</td>
              <td>${amcRenewalBadge(h.renewal_status)}</td>
              <td>${amcActivationBadge(h.amc_activation_status)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    </details>` : ''}

    ${auditLog.length ? `
    <details style="margin-top:8px;">
      <summary style="cursor:pointer;font-weight:600;color:#2c3e50;font-size:0.87em;">Audit Trail (${auditLog.length} entries)</summary>
      <div style="margin-top:8px;max-height:180px;overflow-y:auto;">
        <table class="data-table" style="font-size:0.79em;">
          <thead><tr><th>When</th><th>Action</th><th>Field</th><th>Old</th><th>New</th><th>By</th></tr></thead>
          <tbody>${auditLog.map(a=>`<tr>
            <td>${fmtDate(a.performed_at)}</td>
            <td>${esc(a.action||'-')}</td>
            <td>${esc(a.field_name||'-')}</td>
            <td>${esc(a.old_value||'-')}</td>
            <td>${esc(a.new_value||'-')}</td>
            <td>${esc(a.performed_by||'-')}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </details>` : ''}

    <div class="modal-actions" style="margin-top:16px;">
      ${isAdmin ? `<button type="button" class="btn danger" id="renewal-delete-btn">Delete</button>` : ''}
      <div class="spacer"></div>
      <button type="button" class="btn secondary" id="cancel-modal">Close</button>
    </div>
  `);

  document.getElementById('cancel-modal').addEventListener('click', closeModal);

  // Scroll to payment section if opened via "Edit Pmt" button
  if (focusPayment) {
    const paySection = document.getElementById(`payment-section-${id}`);
    if (paySection) setTimeout(() => paySection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  // Add Payment Transaction
  const btnAddTxn = document.getElementById('btn-add-txn');
  if (btnAddTxn) {
    btnAddTxn.addEventListener('click', async () => {
      const amount      = document.getElementById('txn-amount')?.value;
      const payment_date = document.getElementById('txn-date')?.value;
      const invoice_ref = document.getElementById('txn-invoice')?.value;
      const notes       = document.getElementById('txn-notes')?.value;
      if (!amount || parseFloat(amount) <= 0) return toast('Enter a valid payment amount', true);
      try {
        if (window._amcTxnBusy) return;                     // double-click guard
        window._amcTxnBusy = true;
        const client_request_id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `alr-${Date.now()}-${Math.random()}`;
        try { await API.post(`/api/renewals/${id}/payment-txn`, { amount, payment_date, invoice_ref, notes, client_request_id }); }
        finally { window._amcTxnBusy = false; }
        toast('Payment recorded');
        renderAlertsTab();
        openAmcRenewalModal(id);
      } catch(err) { toast(err.message || 'Failed to record payment', true); }
    });
  }

  // Update AMC Value / Override Status
  const btnPayment = document.getElementById('btn-payment');
  if (btnPayment) {
    btnPayment.addEventListener('click', async () => {
      const new_amc_value  = document.getElementById('pay-amc-value')?.value;
      const payment_status = document.getElementById('pay-status')?.value || null;
      if (!new_amc_value && !payment_status) return toast('Enter AMC value or select a status to override', true);
      try {
        const res = await API.post(`/api/renewals/${id}/payment`, { new_amc_value, payment_status });
        if (res.prompt_activate) {
          toast('Updated. AMC is still on Hold — activate it from the renewal details.');
        } else {
          toast('Updated');
        }
        renderAlertsTab();
        openAmcRenewalModal(id);
      } catch(err) { toast(err.message || 'Update failed', true); }
    });
  }

  const approveActivationEl = document.getElementById('approve-activation');
  const holdReasonInputEl   = document.getElementById('approve-hold-reason');
  if (approveActivationEl && holdReasonInputEl) {
    approveActivationEl.addEventListener('change', () => {
      holdReasonInputEl.style.display = approveActivationEl.value === 'Hold' ? '' : 'none';
    });
  }

  const btnApprove = document.getElementById('btn-approve');
  if (btnApprove) {
    btnApprove.addEventListener('click', async () => {
      const activation = approveActivationEl ? approveActivationEl.value : 'Hold';
      const holdReason = holdReasonInputEl ? holdReasonInputEl.value : '';
      try {
        const res = await API.post(`/api/renewals/${id}/approve`, { activation, hold_reason: holdReason });
        toast(`Renewal Approved. Activation: ${res.activation}. Schedules generated: ${res.schedules_generated||0}`);
        closeModal();
        renderAlertsTab();
      } catch(err) { toast(err.message || 'Approval failed', true); }
    });
  }

  const btnActivate = document.getElementById('btn-activate');
  if (btnActivate) {
    btnActivate.addEventListener('click', async () => {
      if (!confirm('Activate this AMC? This will generate visit schedules for the remaining period.')) return;
      try {
        const res = await API.post(`/api/renewals/${id}/activate`, {});
        toast(`AMC Activated. ${res.schedules_generated||0} schedule(s) generated.`);
        closeModal();
        renderAlertsTab();
      } catch(err) { toast(err.message || 'Activation failed', true); }
    });
  }

  const btnHold = document.getElementById('btn-hold');
  if (btnHold) {
    btnHold.addEventListener('click', async () => {
      const reason = document.getElementById('hold-reason')?.value || '';
      if (!confirm('Put this AMC on Hold? Future pending visits will be paused.')) return;
      try {
        const res = await API.post(`/api/renewals/${id}/hold`, { hold_reason: reason });
        toast(`AMC placed on Hold. ${res.visits_paused||0} visit(s) paused.`);
        closeModal();
        renderAlertsTab();
      } catch(err) { toast(err.message || 'Hold failed', true); }
    });
  }

  const btnCancelRenewal = document.getElementById('btn-cancel-renewal');
  if (btnCancelRenewal) {
    btnCancelRenewal.addEventListener('click', async () => {
      const decision = document.getElementById('cancel-decision')?.value || 'Cancelled';
      const reason   = document.getElementById('cancel-reason')?.value?.trim() || '';
      if (!reason) return toast('Please enter a cancellation reason', true);
      if (!confirm(`Mark this renewal as ${decision}? The maintenance contract will be moved to Cancelled AMC. This cannot be undone.`)) return;
      try {
        const res = await API.post(`/api/renewals/${id}/cancel`, { original_decision: decision, cancellation_reason: reason });
        toast(`Renewal ${decision}. ${res.visits_cancelled||0} future visit(s) cancelled. Maintenance moved to Cancelled AMC.`);
        closeModal();
        renderAlertsTab();
      } catch(err) { toast(err.message || 'Cancellation failed', true); }
    });
  }

  const btnDeleteRenewal = document.getElementById('renewal-delete-btn');
  if (btnDeleteRenewal) {
    btnDeleteRenewal.addEventListener('click', async () => {
      if (!await confirmDelete({ title: 'Delete Renewal Record', message: `Delete renewal ${r.renewal_ref}?` })) return;
      try {
        await API.del(`/api/renewals/${id}`);
        toast('Renewal deleted');
        closeModal();
        renderAlertsTab();
      } catch(err) { toast(err.message || 'Delete failed', true); }
    });
  }
}


// ── 3. PAYMENT STATUS ────────────────────────────────────────────────────────
async function renderPayments(root) {
  const f = AlertsState.filters;
  root.innerHTML = `
    <div class="toolbar">
      <button class="btn" id="payment-add">+ Add Payment Alert</button>
      <input type="text" id="payment-search" placeholder="Search Contract Ref., Invoice Ref., Client…">
      <select id="payment-status-filter">
        <option value="">All Statuses</option>
        ${PAYMENT_STATUS_OPTS.map(s=>`<option>${s}</option>`).join('')}
      </select>
      <select id="payment-sort-by">
        <option value="updated_at">Sort: Last Updated</option>
        <option value="contract_ref">Sort: Contract Ref.</option>
        <option value="invoice_date">Sort: Invoice Date</option>
        <option value="payment_due_date">Sort: Payment Due</option>
        <option value="invoice_amount">Sort: Amount</option>
      </select>
      <button class="btn secondary" id="payment-sort-dir">${f.sort_dir==='asc'?'&#8593; ASC':'&#8595; DESC'}</button>
    </div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th>Contract Ref.</th><th>Linked</th><th>Client / Company Name</th>
        <th>Invoice Ref.</th><th>Invoice Date</th><th>Invoice Amount</th><th>Paid Amount</th>
        <th>Balance Amount</th><th>Payment Due</th><th>Days Overdue</th><th>Status</th><th>Remarks</th><th></th>
      </tr></thead>
      <tbody id="payment-tbody"><tr><td colspan="13">Loading…</td></tr></tbody>
    </table></div>
  `;
  const load = async () => {
    const params = new URLSearchParams();
    const s = document.getElementById('payment-search').value;
    const st = document.getElementById('payment-status-filter').value;
    if (s) params.set('search', s);
    if (st) params.set('payment_status', st);
    params.set('sort_by', AlertsState.filters.sort_by || 'updated_at');
    params.set('sort_dir', AlertsState.filters.sort_dir);
    const data = await API.get('/api/alerts/payments?' + params);
    const tbody = document.getElementById('payment-tbody');
    if (!data.rows.length) { tbody.innerHTML = `<tr><td colspan="13" class="empty-state">No payment alerts. Use "+ Add Payment Alert" to create one.</td></tr>`; return; }
    tbody.innerHTML = data.rows.map(r => `
      <tr data-id="${r.id}" style="cursor:pointer;">
        <td>${esc(r.contract_ref||'-')}</td>
        <td>${linkedBadge(r.linked_contract_status)}</td>
        <td>${esc(r.client_name||'-')}</td>
        <td>${esc(r.invoice_ref||'-')}</td>
        <td>${fmtDate(r.invoice_date)}</td>
        <td>${fmtMoney(r.invoice_amount)}</td>
        <td>${fmtMoney(r.paid_amount)}</td>
        <td>${fmtMoney(r.balance_amount)}</td>
        <td>${fmtDate(r.payment_due_date)}</td>
        <td>${r.days_overdue > 0 ? `<span class="badge" style="background:#f8d7da;color:#842029">${r.days_overdue}d overdue</span>` : '-'}</td>
        <td>${paymentBadge(r.payment_status)}</td>
        <td>${esc(r.remarks||'-')}</td>
        <td><button class="btn small secondary" data-edit="${r.id}">Edit</button></td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => openPaymentModal(btn.dataset.edit)));
  };
  document.getElementById('payment-add').addEventListener('click', () => openPaymentModal());
  document.getElementById('payment-search').addEventListener('input', debounce(load, 350));
  document.getElementById('payment-status-filter').addEventListener('change', load);
  document.getElementById('payment-sort-by').addEventListener('change', e => { AlertsState.filters.sort_by = e.target.value; load(); });
  document.getElementById('payment-sort-dir').addEventListener('click', () => {
    AlertsState.filters.sort_dir = AlertsState.filters.sort_dir === 'asc' ? 'desc' : 'asc';
    document.getElementById('payment-sort-dir').innerHTML = AlertsState.filters.sort_dir === 'asc' ? '&#8593; ASC' : '&#8595; DESC';
    load();
  });
  await load();

  // ── AMC Renewal Payments sub-section ──────────────────────────────────────
  const renewalPaymentsSection = document.createElement('div');
  renewalPaymentsSection.id = 'renewal-payments-section';
  renewalPaymentsSection.style.marginTop = '28px';
  root.appendChild(renewalPaymentsSection);
  (async () => {
    try {
      const rdata = await API.get('/api/alerts/payments?renewal_payments=1');
      if (rdata.renewal_payments && rdata.renewal_payments.length) {
        renewalPaymentsSection.innerHTML = `
          <h3 style="margin:0 0 10px;color:#2c3e50;font-size:1em;font-weight:700;">
            AMC Renewal Payments Outstanding (${rdata.renewal_payments.length})
          </h3>
          <div class="table-wrap"><table class="data-table">
            <thead><tr>
              <th>Renewal Ref.</th><th>Contract Ref.</th><th>Client</th>
              <th>New AMC Value</th><th>Amount Paid</th><th>Payment Status</th><th>Activation</th><th></th>
            </tr></thead>
            <tbody>
              ${rdata.renewal_payments.map(r => `<tr>
                <td><strong>${esc(r.renewal_ref||'-')}</strong></td>
                <td>${esc(r.contract_ref||'-')}</td>
                <td>${esc(r.client_name||'-')}</td>
                <td>${r.new_amc_value ? fmtCurrency(r.new_amc_value, r.currency_code||'AED') : '-'}</td>
                <td>${r.amount_paid ? fmtCurrency(r.amount_paid, r.currency_code||'AED') : '-'}</td>
                <td>${amcPaymentBadge(r.payment_status)}</td>
                <td>${amcActivationBadge(r.amc_activation_status)}</td>
                <td><button class="btn small secondary" onclick="openAmcRenewalModal(${r.id})">Details</button></td>
              </tr>`).join('')}
            </tbody>
          </table></div>`;
      }
    } catch(_) {}
  })();
}

async function openPaymentModal(id) {
  const isEdit = !!id;
  const r = isEdit ? (await API.get(`/api/alerts/payments`)).rows.find(x=>String(x.id)===String(id)) || {} : {};
  openModal(`
    <h2>${isEdit ? 'Edit Payment Alert' : 'Add Payment Alert'}</h2>
    <form id="payment-form">
      <div class="form-grid">
        ${formField('Contract Ref. *', 'contract_ref', r.contract_ref)}
        ${formField('Invoice Ref.', 'invoice_ref', r.invoice_ref)}
        ${formField('Client / Company Name', 'client_name', r.client_name)}
        ${formField('Invoice Date', 'invoice_date', r.invoice_date, { type:'date' })}
        ${formField('Payment Due Date', 'payment_due_date', r.payment_due_date, { type:'date' })}
        ${formField('Invoice Amount', 'invoice_amount', r.invoice_amount, { type:'number' })}
        ${formField('Paid Amount',    'paid_amount',    r.paid_amount,    { type:'number' })}
        ${formField('Payment Status', 'payment_status', r.payment_status||'Unpaid', { select: PAYMENT_STATUS_OPTS })}
        ${formField('Remarks', 'remarks', r.remarks, { textarea:true, span2:true })}
      </div>
      <div class="modal-actions">
        ${isEdit && APP.user && APP.user.role === 'admin' ? `<button type="button" class="btn danger" id="payment-delete">Delete</button>` : ''}
        <div class="spacer"></div>
        <button type="button" class="btn secondary" id="cancel-modal">Cancel</button>
        <button type="submit" class="btn">${isEdit ? 'Save' : 'Add Alert'}</button>
      </div>
    </form>
  `);
  document.getElementById('cancel-modal').addEventListener('click', closeModal);
  if (isEdit && APP.user && APP.user.role === 'admin') {
    const _pdel = document.getElementById('payment-delete');
    if (_pdel) _pdel.addEventListener('click', async () => {
      if (!await confirmDelete({ title: 'Delete Payment Alert', message: 'Delete this payment alert?' })) return;
      try {
        await API.del(`/api/alerts/payments/${id}`);
        toast('Payment alert deleted'); closeModal(); renderAlertsTab();
      } catch(err) { toast('Unable to delete the payment alert. Please try again.', true); }
    });
  }
  document.getElementById('payment-form').addEventListener('submit', async e => {
    e.preventDefault();
    const body = readForm(e.target);
    try {
      if (isEdit) { await API.patch(`/api/alerts/payments/${id}`, body); toast('Payment alert updated'); }
      else        { await API.post('/api/alerts/payments', body);         toast('Payment alert added'); }
      closeModal(); renderAlertsTab();
    } catch(err) { toast(err.message, true); }
  });
}

// ── 4. MONTHLY CALL BACK SUMMARY ─────────────────────────────────────────────
// (Call Back / Emergency operational page moved to Maintenance module 2026-07-23)
async function renderCallbackSummary(root) {
  const now = new Date();
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  root.innerHTML = `
    <div class="toolbar" style="flex-wrap:wrap;gap:8px;">
      <select id="sum-year">
        ${[now.getFullYear()-1, now.getFullYear(), now.getFullYear()+1].map(y => `<option ${y===now.getFullYear()?'selected':''}>${y}</option>`).join('')}
      </select>
      <select id="sum-month">
        <option value="">All Months</option>
        ${months.map((m,i) => `<option value="${String(i+1).padStart(2,'0')}" ${i===now.getMonth()?'selected':''}>${m}</option>`).join('')}
      </select>
      <input type="text" id="sum-contract" placeholder="Contract Ref." style="width:140px;">
      <input type="text" id="sum-client"   placeholder="Client Name" style="width:160px;">
      <select id="sum-tech"><option value="">All Technicians</option></select>
      <select id="sum-cb-status"><option value="">All Statuses</option>${CALLBACK_STATUS_OPTS.map(s=>`<option>${s}</option>`).join('')}</select>
      <select id="sum-priority"><option value="">All Priorities</option>${PRIORITY_OPTS.map(s=>`<option>${s}</option>`).join('')}</select>
      <button class="btn" id="sum-apply">Apply Filters</button>
    </div>
    <div class="kpi-grid" id="sum-kpis" style="margin:16px 0;"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:16px;">
      <div id="sum-by-tech" class="kpi-card" style="text-align:left;"></div>
      <div id="sum-by-proj" class="kpi-card" style="text-align:left;"></div>
      <div id="sum-by-cref" class="kpi-card" style="text-align:left;"></div>
    </div>
    <div id="sum-detail-wrap"></div>
  `;

  const load = async () => {
    const params = new URLSearchParams();
    const y  = document.getElementById('sum-year').value;
    const m  = document.getElementById('sum-month').value;
    const cr = document.getElementById('sum-contract').value;
    const cl = document.getElementById('sum-client').value;
    const te = document.getElementById('sum-tech').value;
    const st = document.getElementById('sum-cb-status').value;
    const pr = document.getElementById('sum-priority').value;
    if (y) params.set('year', y);
    if (m) params.set('month', m);
    if (cr) params.set('contract_ref', cr);
    if (cl) params.set('client_name', cl);
    if (te) params.set('assigned_technician', te);
    if (st) params.set('callback_status', st);
    if (pr) params.set('priority', pr);
    const data = await API.get('/api/alerts/callback-summary?' + params);
    const s = data.summary;

    // Populate technician dropdown with live options
    const techSel = document.getElementById('sum-tech');
    const prevTech = techSel.value;
    while (techSel.options.length > 1) techSel.remove(1);
    (data.filterOptions?.technicians || []).forEach(t => { const o = document.createElement('option'); o.value=t; o.textContent=t; techSel.appendChild(o); });
    if (prevTech) techSel.value = prevTech;

    // KPI cards
    const avgResp = s.avgResponseMins !== null ? (s.avgResponseMins < 60 ? `${s.avgResponseMins} min` : `${Math.floor(s.avgResponseMins/60)}h ${s.avgResponseMins%60}m`) : 'N/A';
    document.getElementById('sum-kpis').innerHTML = [
      { label: 'Total Call Backs',      val: s.total },
      { label: 'Attended',              val: s.attended },
      { label: 'Completed',             val: s.completed },
      { label: 'Pending',               val: s.pending },
      { label: 'Emergency',             val: s.emergency },
      { label: 'Avg. Response Time',    val: avgResp },
    ].map(c => `<div class="kpi-card"><div class="num">${c.val}</div><div class="label">${c.label}</div></div>`).join('');

    // Breakdown tables
    document.getElementById('sum-by-tech').innerHTML = `<b>By Technician</b><br><br>${
      data.byTechnician.length ? data.byTechnician.map(r=>`<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>${esc(r.tech)}</span><b>${r.count}</b></div>`).join('') : '<span class="meta">No data</span>'
    }`;
    document.getElementById('sum-by-proj').innerHTML = `<b>By Project</b><br><br>${
      data.byProject.slice(0,10).map(r=>`<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;" title="${esc(r.project)}">${esc(r.project)}</span><b>${r.count}</b></div>`).join('') || '<span class="meta">No data</span>'
    }`;
    document.getElementById('sum-by-cref').innerHTML = `<b>By Contract Ref.</b><br><br>${
      data.byContractRef.slice(0,10).map(r=>`<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>${esc(r.contract_ref)}</span><b>${r.count}</b></div>`).join('') || '<span class="meta">No data</span>'
    }`;

    // Detail table
    const wrap = document.getElementById('sum-detail-wrap');
    if (!data.rows.length) { wrap.innerHTML = `<p class="empty-state">No call back records match the selected filters.</p>`; return; }
    wrap.innerHTML = `<div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th>CB Ref.</th><th>Contract Ref.</th><th>Client</th>
        <th>Complaint Date</th><th>Complaint Type</th><th>Priority</th>
        <th>Technician</th><th>Response Time</th><th>Attended</th><th>Completed</th><th>Status</th>
      </tr></thead>
      <tbody>${data.rows.map(r=>`<tr>
        <td>${esc(r.callback_ref||'-')}</td>
        <td>${esc(r.contract_ref||'-')}</td>
        <td>${esc(r.client_name||'-')}</td>
        <td>${r.complaint_datetime ? fmtDate(r.complaint_datetime) : '-'}</td>
        <td>${esc(r.complaint_type||'-')}</td>
        <td>${priorityBadge(r.priority)}</td>
        <td>${esc(r.assigned_technician||'-')}</td>
        <td>${esc(r.response_time||'-')}</td>
        <td>${r.attended_datetime ? fmtDate(r.attended_datetime) : '-'}</td>
        <td>${r.completion_datetime ? fmtDate(r.completion_datetime) : '-'}</td>
        <td>${callbackBadge(r.callback_status)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  };

  document.getElementById('sum-apply').addEventListener('click', load);
  await load();
}

// ── NOTE: Cancelled AMC records are managed in the Maintenance module ─────────
// The Maintenance → Cancelled AMC tab (mode=cancelled) is the single source
// of truth for cancelled maintenance projects. The former Alerts tab was
// removed 2026-07-27. No data was deleted; records remain in maintenance_contracts
// with renewal_status = 'Cancelled'.
