// Project Lifecycle Hub — redesigned 2026-07-03
// Replaces the old project_links search-and-create UI.
// Uses global openModal / closeModal / esc / toast / badge / fmtDate / debounce / API from common.js / api.js.

const LIFECYCLE_STAGES = [
  'Quotation','Revised','Approved','Contract Created','Production',
  'Shipping','Delivered','Installation','Testing & Commissioning',
  'Handover','Free Maintenance','AMC Active','AMC Expired'
];

const LIFECYCLE_STAGE_COLORS = {
  'Quotation':               '#6c757d',
  'Revised':                 '#7c3aed',
  'Approved':                '#16a34a',
  'Contract Created':        '#0891b2',
  'Production':              '#d97706',
  'Shipping':                '#2563eb',
  'Delivered':               '#0d9488',
  'Installation':            '#7c3aed',
  'Testing & Commissioning': '#b45309',
  'Handover':                '#15803d',
  'Free Maintenance':        '#166534',
  'AMC Active':              '#14532d',
  'AMC Expired':             '#dc2626',
};

function lcStageBadge(stage) {
  const color = LIFECYCLE_STAGE_COLORS[stage] || '#667';
  return `<span style="background:${color};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;white-space:nowrap">${esc(stage || '-')}</span>`;
}

// ── State ─────────────────────────────────────────────────────────────────────

const LinksState = { page: 1, pageSize: 25, filters: {}, data: null };

// ── Main Render ───────────────────────────────────────────────────────────────

async function renderLinks(root) {
  root.innerHTML = `
    <div class="panel">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:14px">
        <h2 style="margin:0;font-size:16px">📋 Project Lifecycle Hub</h2>
        <button class="btn small" id="lc-new-btn">+ New Link</button>
      </div>

      <div class="toolbar" style="flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px">
        <input type="text" id="lc-search" placeholder="Search Quote / Contract / Client / Project…" style="min-width:240px">
        <select id="lc-stage">
          <option value="">All Stages</option>
          ${LIFECYCLE_STAGES.map(s => `<option value="${s}">${s}</option>`).join('')}
        </select>
        <select id="lc-status">
          <option value="Active">Active</option>
          <option value="Archived">Archived</option>
          <option value="all">All</option>
        </select>
        <button class="btn small secondary" id="lc-reset-filters">Clear</button>
      </div>

      <div style="overflow-x:auto">
        <table class="data-table" id="lc-table">
          <thead><tr>
            <th>Quote Ref.</th>
            <th>Contract Ref.</th>
            <th>Client</th>
            <th>Project</th>
            <th>Salesperson</th>
            <th>Factory Links</th>
            <th>Maintenance</th>
            <th>Stage</th>
            <th>Updated</th>
            <th></th>
          </tr></thead>
          <tbody id="lc-tbody"><tr><td colspan="10" style="text-align:center;padding:24px;color:#99aabb">Loading…</td></tr></tbody>
        </table>
      </div>

      <div id="lc-pagination" style="margin-top:4px"></div>
    </div>
  `;

  document.getElementById('lc-new-btn').addEventListener('click', lcShowNewModal);
  document.getElementById('lc-search').addEventListener('input', debounce(lcReload, 400));
  document.getElementById('lc-stage').addEventListener('change', lcReload);
  document.getElementById('lc-status').addEventListener('change', lcReload);
  document.getElementById('lc-reset-filters').addEventListener('click', () => {
    document.getElementById('lc-search').value = '';
    document.getElementById('lc-stage').value = '';
    document.getElementById('lc-status').value = 'Active';
    lcReload();
  });

  const pgDiv = document.getElementById('lc-pagination');
  pgDiv.addEventListener('click', lcPaginationClick);
  pgDiv.addEventListener('change', lcPaginationChange);
  pgDiv.addEventListener('keydown', lcPaginationKeydown);

  await lcLoad();
}

function lcCollectFilters() {
  LinksState.filters = {
    search: document.getElementById('lc-search')?.value || '',
    stage:  document.getElementById('lc-stage')?.value || '',
    status: document.getElementById('lc-status')?.value || 'Active',
  };
}

function lcReload() { lcCollectFilters(); LinksState.page = 1; lcLoad(); }

async function lcLoad() {
  const { page, pageSize, filters } = LinksState;
  const params = new URLSearchParams({ page, page_size: pageSize });
  if (filters.search) params.set('search', filters.search);
  if (filters.stage)  params.set('stage', filters.stage);
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);

  const tbody = document.getElementById('lc-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;color:#99aabb">Loading…</td></tr>';

  try {
    const data = await API.get(`/api/links/lifecycle?${params}`);
    LinksState.data = data;
    lcRenderTable(data.rows);
    lcRenderPagination(data);
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="empty-state" style="color:#c0392b">Error: ${esc(e.message)}</td></tr>`;
  }
}

function lcRenderTable(rows) {
  const tbody = document.getElementById('lc-tbody');
  if (!tbody) return;
  if (!rows || !rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No lifecycle entries found. Click "+ New Link" to start.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td><b>${esc(r.quote_ref || '-')}</b></td>
      <td>${esc(r.contract_ref || '-')}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.client_name||'')}">${esc(r.client_name || '-')}</td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.project_name||r.q_project_name||'')}">${esc(r.project_name || r.q_project_name || '-')}</td>
      <td>${esc(r.salesperson || '-')}</td>
      <td style="text-align:center">${r.factory_link_count ? `<span style="background:#e8f0fb;color:#2563ad;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">${r.factory_link_count} linked</span>` : '<span style="color:#bbb;font-size:12px">—</span>'}</td>
      <td>${r.maintenance_ref ? `<span style="font-size:12px;color:#15803d;font-weight:600">${esc(r.maintenance_ref)}</span>` : '<span style="color:#bbb;font-size:12px">—</span>'}</td>
      <td>${lcStageBadge(r.current_stage)}</td>
      <td style="font-size:12px;color:#667">${fmtDate(r.updated_at)}</td>
      <td><button class="btn small secondary" data-lc-edit="${r.id}">Edit</button></td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-lc-edit]').forEach(btn => {
    btn.addEventListener('click', () => lcShowEditModal(parseInt(btn.dataset.lcEdit)));
  });
}

// ── Pagination ────────────────────────────────────────────────────────────────

function lcPaginationClick(e) {
  const btn = e.target.closest('button[data-pgact]');
  if (!btn || btn.disabled) return;
  const act = btn.dataset.pgact;
  if (act === 'size') {
    LinksState.pageSize = parseInt(btn.dataset.sz, 10);
    LinksState.page = 1;
    lcLoad();
    return;
  }
  if (act === 'goto-go') { lcHandleGoto(); return; }
  lcCollectFilters();
  const total = LinksState.data ? LinksState.data.total : 0;
  const totalPages = Math.max(1, Math.ceil(total / LinksState.pageSize));
  if (act === 'first') LinksState.page = 1;
  else if (act === 'prev')  LinksState.page = Math.max(1, LinksState.page - 1);
  else if (act === 'next')  LinksState.page = Math.min(totalPages, LinksState.page + 1);
  else if (act === 'last')  LinksState.page = totalPages;
  lcLoad();
}
function lcPaginationChange(e) {
  const sel = e.target.closest('select[data-pgact="size"]');
  if (!sel) return;
  LinksState.pageSize = parseInt(sel.value, 10);
  LinksState.page = 1;
  lcLoad();
}
function lcPaginationKeydown(e) {
  if (e.key !== 'Enter') return;
  if (e.target.closest('input[data-pgact="goto-input"]')) lcHandleGoto();
}
function lcHandleGoto() {
  const input = document.getElementById('lc-goto-input');
  if (!input) return;
  const total = LinksState.data ? LinksState.data.total : 0;
  const totalPages = Math.max(1, Math.ceil(total / LinksState.pageSize));
  const val = parseInt(input.value, 10);
  if (!val || val < 1 || val > totalPages) {
    input.style.outline = '2px solid #e53e3e';
    setTimeout(() => { input.style.outline = ''; }, 1500);
    return;
  }
  LinksState.page = val;
  input.value = '';
  lcLoad();
}

function lcRenderPagination(data) {
  const pg = document.getElementById('lc-pagination');
  if (!pg) return;
  const total = data ? data.total : 0;
  if (!total) { pg.innerHTML = ''; return; }
  const ps = LinksState.pageSize, cp = LinksState.page;
  const tp = Math.max(1, Math.ceil(total / ps));
  const from = (cp - 1) * ps + 1, to = Math.min(cp * ps, total);
  const nb = (act, lbl, dis) =>
    `<button data-pgact="${act}" class="btn small secondary" ${dis ? 'disabled' : ''} style="padding:4px 8px;font-size:12px">${lbl}</button>`;
  const sizes = [25, 50, 100, 250].map(s =>
    s === ps
      ? `<span style="font-weight:700;color:var(--accent);font-size:13px;padding:0 3px">${s}</span>`
      : `<button data-pgact="size" data-sz="${s}" class="btn small secondary" style="padding:3px 7px;font-size:12px">${s}</button>`
  ).join('<span style="color:#ccd;padding:0 1px">|</span>');
  pg.innerHTML = `<div style="border-top:1px solid var(--border);padding-top:10px;margin-top:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13px;color:#667">
    <span>Showing <b>${from}</b>–<b>${to}</b> of <b>${total}</b></span>
    ${tp > 1 ? `
      ${nb('first', '« First', cp <= 1)}
      ${nb('prev', '‹ Prev', cp <= 1)}
      <span style="padding:0 8px;font-weight:600;color:#334">Page ${cp} of ${tp}</span>
      ${nb('next', 'Next ›', cp >= tp)}
      ${nb('last', 'Last »', cp >= tp)}
      <span style="margin-left:8px;font-size:12px;color:#667">Go to:</span>
      <input type="number" id="lc-goto-input" data-pgact="goto-input" min="1" max="${tp}" placeholder="#"
        style="width:50px;padding:3px 5px;border:1px solid var(--border);border-radius:4px;font-size:12px">
      ${nb('goto-go', 'Go', false)}
    ` : ''}
    <span style="margin-left:8px;font-size:12px;color:#667">Rows:</span>
    <div style="display:flex;align-items:center;gap:2px">${sizes}</div>
  </div>`;
}

// ── New Link Modal ────────────────────────────────────────────────────────────

function lcShowNewModal() {
  let activeTab = 'quote';
  let selectedRef = { quote_ref: null, contract_ref: null, client_name: null, project_name: null, salesperson: null };

  openModal(`
    <h3 style="margin:0 0 14px;font-size:16px">New Project Lifecycle Entry</h3>
    <div style="display:flex;gap:8px;margin-bottom:14px" id="nlm-tabs">
      <button class="btn small" id="nlm-tab-quote">Start from Quotation</button>
      <button class="btn small secondary" id="nlm-tab-contract">Start from Contract</button>
    </div>

    <div id="nlm-quote-section">
      <label style="font-size:12px;color:#667;font-weight:600">QUOTE REF. / CLIENT
        <input type="text" id="nlm-qref" placeholder="Search quote ref, client…" style="width:100%;margin-top:3px">
      </label>
      <div id="nlm-qresults" style="max-height:160px;overflow-y:auto;margin-top:4px;border:1px solid var(--border);border-radius:4px;display:none"></div>
    </div>

    <div id="nlm-contract-section" style="display:none">
      <label style="font-size:12px;color:#667;font-weight:600">CONTRACT REF. / CLIENT
        <input type="text" id="nlm-cref" placeholder="Search contract ref, client…" style="width:100%;margin-top:3px">
      </label>
      <div id="nlm-cresults" style="max-height:160px;overflow-y:auto;margin-top:4px;border:1px solid var(--border);border-radius:4px;display:none"></div>
    </div>

    <div id="nlm-selected" style="margin-top:10px;padding:8px;background:#f0f4f8;border-radius:6px;display:none;font-size:13px">
      ✓ Selected: <b id="nlm-selected-label"></b>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">
      <label style="font-size:12px;color:#667;font-weight:600">INITIAL STAGE
        <select id="nlm-stage" style="width:100%;margin-top:3px">
          ${LIFECYCLE_STAGES.map(s => `<option value="${s}">${s}</option>`).join('')}
        </select>
      </label>
      <label style="font-size:12px;color:#667;font-weight:600">REMARKS
        <input type="text" id="nlm-remarks" style="width:100%;margin-top:3px">
      </label>
    </div>

    <div class="modal-actions">
      <button class="btn" id="nlm-save">Create Entry</button>
      <button class="btn secondary" onclick="closeModal()">Cancel</button>
    </div>
  `);

  function setNlmTab(tab) {
    activeTab = tab;
    document.getElementById('nlm-quote-section').style.display = tab === 'quote' ? '' : 'none';
    document.getElementById('nlm-contract-section').style.display = tab === 'contract' ? '' : 'none';
    document.getElementById('nlm-tab-quote').className = `btn small${tab === 'quote' ? '' : ' secondary'}`;
    document.getElementById('nlm-tab-contract').className = `btn small${tab === 'contract' ? '' : ' secondary'}`;
    selectedRef = { quote_ref: null, contract_ref: null, client_name: null, project_name: null, salesperson: null };
    document.getElementById('nlm-selected').style.display = 'none';
  }

  function setSelected(label, data) {
    Object.assign(selectedRef, data);
    document.getElementById('nlm-selected-label').textContent = label;
    document.getElementById('nlm-selected').style.display = '';
  }

  document.getElementById('nlm-tab-quote').addEventListener('click', () => setNlmTab('quote'));
  document.getElementById('nlm-tab-contract').addEventListener('click', () => setNlmTab('contract'));

  // Quote search
  document.getElementById('nlm-qref').addEventListener('input', debounce(async () => {
    const q = document.getElementById('nlm-qref').value.trim();
    const res = document.getElementById('nlm-qresults');
    if (!q) { res.style.display = 'none'; return; }
    try {
      const data = await API.get('/api/links/search/quotes?q=' + encodeURIComponent(q));
      if (!data.rows.length) { res.style.display = 'none'; return; }
      res.style.display = '';
      res.innerHTML = data.rows.map(r => `
        <div class="history-item" style="cursor:pointer;padding:6px 10px" data-qref="${esc(r.quote_ref)}"
          data-client="${esc(r.client_name||'')}" data-project="${esc(r.project_name||'')}" data-sp="${esc(r.salesperson||'')}">
          <b>${esc(r.quote_ref)}</b> — ${esc(r.client_name||'')} ${badge(r.status)}
        </div>`).join('');
      res.querySelectorAll('[data-qref]').forEach(el => {
        el.addEventListener('click', () => {
          setSelected(`Quote Ref. ${el.dataset.qref} — ${el.dataset.client}`, {
            quote_ref: el.dataset.qref, client_name: el.dataset.client,
            project_name: el.dataset.project, salesperson: el.dataset.sp
          });
          document.getElementById('nlm-stage').value = 'Quotation';
          res.style.display = 'none';
        });
      });
    } catch(e) { /* silent */ }
  }, 350));

  // Contract search
  document.getElementById('nlm-cref').addEventListener('input', debounce(async () => {
    const q = document.getElementById('nlm-cref').value.trim();
    const res = document.getElementById('nlm-cresults');
    if (!q) { res.style.display = 'none'; return; }
    try {
      const data = await API.get('/api/links/search/contracts?q=' + encodeURIComponent(q));
      if (!data.rows.length) { res.style.display = 'none'; return; }
      res.style.display = '';
      res.innerHTML = data.rows.map(r => `
        <div class="history-item" style="cursor:pointer;padding:6px 10px" data-cref="${esc(r.contract_ref)}"
          data-qref="${esc(r.quote_ref||'')}" data-client="${esc(r.client_name||'')}" data-sp="${esc(r.salesperson||'')}">
          <b>${esc(r.contract_ref)}</b> — ${esc(r.client_name||'')}
          ${r.quote_ref ? `<span style="font-size:11px;color:#99aabb">(Quote: ${esc(r.quote_ref)})</span>` : ''}
        </div>`).join('');
      res.querySelectorAll('[data-cref]').forEach(el => {
        el.addEventListener('click', () => {
          setSelected(`Contract Ref. ${el.dataset.cref} — ${el.dataset.client}`, {
            contract_ref: el.dataset.cref, quote_ref: el.dataset.qref || null,
            client_name: el.dataset.client, salesperson: el.dataset.sp
          });
          document.getElementById('nlm-stage').value = 'Contract Created';
          res.style.display = 'none';
        });
      });
    } catch(e) { /* silent */ }
  }, 350));

  document.getElementById('nlm-save').addEventListener('click', async () => {
    if (!selectedRef.quote_ref && !selectedRef.contract_ref) return toast('Select a quotation or contract first', true);
    try {
      await API.post('/api/links/lifecycle', {
        ...selectedRef,
        current_stage: document.getElementById('nlm-stage').value,
        remarks: document.getElementById('nlm-remarks').value,
      });
      toast('Lifecycle entry created');
      closeModal();
      lcLoad();
    } catch(e) { toast(e.message, true); }
  });
}

// ── Edit / Detail Modal ───────────────────────────────────────────────────────

async function lcShowEditModal(id) {
  let lc;
  try { lc = await API.get(`/api/links/lifecycle/${id}`); }
  catch(e) { return toast(e.message, true); }

  openModal(`
    <h3 style="margin:0 0 10px;font-size:15px">Lifecycle: ${esc(lc.contract_ref || lc.quote_ref || '#' + id)}</h3>
    <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap" id="lcm-tabs">
      <button class="btn small" id="lcm-tab-overview">Overview</button>
      <button class="btn small secondary" id="lcm-tab-factory">Factory Links</button>
      <button class="btn small secondary" id="lcm-tab-maintenance">Maintenance</button>
    </div>

    <!-- ── OVERVIEW ── -->
    <div id="lcm-overview">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
        <label style="font-size:12px;color:#667;font-weight:600">QUOTE REF.
          <input type="text" id="lcm-qref" value="${esc(lc.quote_ref||'')}" placeholder="SHQ-26001" style="width:100%;margin-top:3px">
        </label>
        <label style="font-size:12px;color:#667;font-weight:600">CONTRACT REF.
          <input type="text" id="lcm-cref" value="${esc(lc.contract_ref||'')}" placeholder="SH-001" style="width:100%;margin-top:3px">
        </label>
        <label style="font-size:12px;color:#667;font-weight:600">CLIENT
          <input type="text" id="lcm-client" value="${esc(lc.client_name||'')}" style="width:100%;margin-top:3px">
        </label>
        <label style="font-size:12px;color:#667;font-weight:600">SALESPERSON
          <input type="text" id="lcm-sp" value="${esc(lc.salesperson||'')}" style="width:100%;margin-top:3px">
        </label>
        <label style="font-size:12px;color:#667;font-weight:600;grid-column:1/-1">PROJECT
          <input type="text" id="lcm-project" value="${esc(lc.project_name||lc.q_project_name||lc.project_description||'')}" style="width:100%;margin-top:3px">
        </label>
        <label style="font-size:12px;color:#667;font-weight:600">CURRENT STAGE
          <select id="lcm-stage" style="width:100%;margin-top:3px">
            ${LIFECYCLE_STAGES.map(s => `<option value="${s}" ${s === lc.current_stage ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </label>
        <label style="font-size:12px;color:#667;font-weight:600">MAINTENANCE REF.
          <input type="text" id="lcm-mref" value="${esc(lc.maintenance_ref||'')}" placeholder="MC-2026-001" style="width:100%;margin-top:3px">
        </label>
        <label style="font-size:12px;color:#667;font-weight:600;grid-column:1/-1">REMARKS
          <textarea id="lcm-remarks" rows="2" style="width:100%;margin-top:3px">${esc(lc.remarks||'')}</textarea>
        </label>
      </div>

      ${lc.contract_linked_by ? `<div style="font-size:11px;color:#99aabb;margin-bottom:3px">Contract linked by <b>${esc(lc.contract_linked_by)}</b> on ${fmtDate(lc.contract_linked_at)}${lc.contract_link_remarks ? ` — ${esc(lc.contract_link_remarks)}` : ''}</div>` : ''}
      ${lc.quote_linked_by ? `<div style="font-size:11px;color:#99aabb;margin-bottom:3px">Quote linked by <b>${esc(lc.quote_linked_by)}</b> on ${fmtDate(lc.quote_linked_at)}</div>` : ''}
      ${lc.maintenance_linked_by ? `<div style="font-size:11px;color:#99aabb;margin-bottom:3px">Maintenance linked by <b>${esc(lc.maintenance_linked_by)}</b> on ${fmtDate(lc.maintenance_linked_at)}</div>` : ''}

      <div class="modal-actions">
        <button class="btn" id="lcm-save">Save Changes</button>
        <button class="btn danger" id="lcm-archive">Archive</button>
        <button class="btn secondary" onclick="closeModal()">Close</button>
      </div>
    </div>

    <!-- ── FACTORY LINKS ── -->
    <div id="lcm-factory" style="display:none">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <b style="font-size:13px">Linked Factory Records</b>
        <button class="btn small" id="lcm-add-factory-btn">+ Add Factory Link</button>
      </div>
      <div id="lcm-factory-table">
        ${lc.factory_links && lc.factory_links.length
          ? `<table class="data-table"><thead><tr><th>Factory Ref.</th><th>Table</th><th>Supplier</th><th>Linked By</th><th>Date</th><th></th></tr></thead><tbody>
            ${lc.factory_links.map(fl => `<tr>
              <td><b>${esc(fl.factory_ref)}</b></td>
              <td>${badge(fl.factory_table)}</td>
              <td>${esc(fl.supplier_name||'-')}</td>
              <td>${esc(fl.linked_by||'-')}</td>
              <td>${fmtDate(fl.linked_at)}</td>
              <td><button class="btn small danger" data-del-fl="${fl.id}">Unlink</button></td>
            </tr>`).join('')}
          </tbody></table>`
          : '<div class="empty-state" style="padding:16px">No factory records linked yet.</div>'}
      </div>
      <div id="lcm-add-factory-form" style="display:none;margin-top:12px;padding:12px;background:#f8f9fa;border-radius:6px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <label style="font-size:12px;color:#667">Factory Ref. *
            <input type="text" id="lcm-ff-ref" placeholder="FJ-001" style="width:100%;margin-top:2px">
          </label>
          <label style="font-size:12px;color:#667">Source Table *
            <select id="lcm-ff-table" style="width:100%;margin-top:2px">
              <option value="">Select…</option>
              <option value="sea_costs">SEA COSTS</option>
              <option value="otj_quotes">OTJ QUOTES</option>
              <option value="ins_quotes">INS QUOTES</option>
            </select>
          </label>
          <label style="font-size:12px;color:#667">Supplier
            <input type="text" id="lcm-ff-supplier" placeholder="Optional" style="width:100%;margin-top:2px">
          </label>
          <label style="font-size:12px;color:#667">Remarks
            <input type="text" id="lcm-ff-remarks" style="width:100%;margin-top:2px">
          </label>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn small" id="lcm-ff-save">Save Factory Link</button>
          <button class="btn small secondary" id="lcm-ff-cancel">Cancel</button>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn secondary" onclick="closeModal()">Close</button>
      </div>
    </div>

    <!-- ── MAINTENANCE ── -->
    <div id="lcm-maintenance" style="display:none">
      ${lc.maintenance_ref
        ? `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px">
            <div style="font-weight:700;font-size:14px;color:#15803d;margin-bottom:6px">✓ Maintenance Record Linked</div>
            <div style="margin-bottom:3px"><b>Maintenance Ref.:</b> ${esc(lc.maintenance_ref)}</div>
            ${lc.renewal_status ? `<div style="margin-bottom:3px"><b>Status:</b> ${badge(lc.renewal_status)}</div>` : ''}
            ${lc.mc_end_date ? `<div><b>End Date:</b> ${fmtDate(lc.mc_end_date)}</div>` : ''}
            <div style="margin-top:8px;font-size:12px;color:#667">To change, update the Maintenance Ref. field in the Overview tab.</div>
          </div>`
        : `<div style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:14px;margin-bottom:14px">
            <div style="font-weight:600;margin-bottom:4px">No Maintenance Record Linked</div>
            <div style="font-size:12px;color:#667">Create one automatically from the linked Contract, or enter an existing Maintenance Ref. in the Overview tab.</div>
          </div>
          ${lc.contract_ref
            ? `<div style="padding:14px;background:#f8f9fa;border-radius:6px">
                <div style="font-size:13px;font-weight:600;margin-bottom:10px">Create from Contract: ${esc(lc.contract_ref)}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
                  <label style="font-size:12px;color:#667">Free Maintenance Period (months)
                    <input type="number" id="lcm-mc-period" min="1" placeholder="12" style="width:100%;margin-top:2px">
                  </label>
                  <label style="font-size:12px;color:#667">Start Date
                    <input type="date" id="lcm-mc-start" style="width:100%;margin-top:2px">
                  </label>
                  <label style="font-size:12px;color:#667">Remarks
                    <input type="text" id="lcm-mc-remarks" style="width:100%;margin-top:2px">
                  </label>
                </div>
                <button class="btn small" id="lcm-mc-create">Create Maintenance Record</button>
              </div>`
            : '<div class="empty-state" style="padding:16px">Link a Contract first (Overview tab) to auto-create a Maintenance Record.</div>'}
      `}
      <div class="modal-actions">
        <button class="btn secondary" onclick="closeModal()">Close</button>
      </div>
    </div>
  `);

  // ── Tab switching
  function lcmSetTab(tab) {
    ['overview','factory','maintenance'].forEach(t => {
      document.getElementById('lcm-' + t).style.display = t === tab ? '' : 'none';
    });
    document.getElementById('lcm-tab-overview').className    = `btn small${tab === 'overview'    ? '' : ' secondary'}`;
    document.getElementById('lcm-tab-factory').className     = `btn small${tab === 'factory'     ? '' : ' secondary'}`;
    document.getElementById('lcm-tab-maintenance').className = `btn small${tab === 'maintenance' ? '' : ' secondary'}`;
  }
  document.getElementById('lcm-tab-overview').addEventListener('click', () => lcmSetTab('overview'));
  document.getElementById('lcm-tab-factory').addEventListener('click', () => lcmSetTab('factory'));
  document.getElementById('lcm-tab-maintenance').addEventListener('click', () => lcmSetTab('maintenance'));

  // ── Save Overview
  document.getElementById('lcm-save').addEventListener('click', async () => {
    const body = {
      client_name:  document.getElementById('lcm-client').value.trim(),
      project_name: document.getElementById('lcm-project').value.trim(),
      salesperson:  document.getElementById('lcm-sp').value.trim(),
      current_stage: document.getElementById('lcm-stage').value,
      remarks:      document.getElementById('lcm-remarks').value,
    };
    const newCref = document.getElementById('lcm-cref').value.trim();
    const newQref = document.getElementById('lcm-qref').value.trim();
    const newMref = document.getElementById('lcm-mref').value.trim();
    if (newCref !== (lc.contract_ref || '')) body.link_contract_ref = newCref;
    if (newQref !== (lc.quote_ref || ''))    body.link_quote_ref = newQref;
    if (newMref !== (lc.maintenance_ref || '')) body.link_maintenance_ref = newMref;
    try {
      await API.patch(`/api/links/lifecycle/${id}`, body);
      toast('Saved');
      closeModal();
      lcLoad();
    } catch(e) { toast(e.message, true); }
  });

  // ── Archive
  document.getElementById('lcm-archive').addEventListener('click', async () => {
    if (!await confirmDelete({ title: 'Archive Entry', message: 'Archive this lifecycle entry? It will be hidden from the Active view.', confirmLabel: 'Archive' })) return;
    try {
      await API.del(`/api/links/lifecycle/${id}`);
      toast('Entry archived');
      closeModal();
      lcLoad();
    } catch(e) { toast(e.message, true); }
  });

  // ── Factory: show add form
  document.getElementById('lcm-add-factory-btn').addEventListener('click', () => {
    document.getElementById('lcm-add-factory-form').style.display = '';
  });
  document.getElementById('lcm-ff-cancel').addEventListener('click', () => {
    document.getElementById('lcm-add-factory-form').style.display = 'none';
  });

  // ── Factory: save
  document.getElementById('lcm-ff-save').addEventListener('click', async () => {
    const fref = document.getElementById('lcm-ff-ref').value.trim();
    const ftbl = document.getElementById('lcm-ff-table').value;
    if (!fref || !ftbl) return toast('Factory Ref. and Source Table are required', true);
    try {
      await API.post(`/api/links/lifecycle/${id}/factory-link`, {
        factory_ref: fref,
        factory_table: ftbl,
        supplier_name: document.getElementById('lcm-ff-supplier').value.trim(),
        remarks: document.getElementById('lcm-ff-remarks').value.trim(),
      });
      toast('Factory link added');
      closeModal();
      lcShowEditModal(id);
    } catch(e) { toast(e.message, true); }
  });

  // ── Factory: unlink
  document.getElementById('lcm-factory-table').querySelectorAll('[data-del-fl]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await confirmDelete({ title: 'Remove Factory Link', message: 'Remove this factory link?', confirmLabel: 'Remove' })) return;
      try {
        await API.del(`/api/links/factory-link/${btn.dataset.delFl}`);
        toast('Factory link removed');
        closeModal();
        lcShowEditModal(id);
      } catch(e) { toast(e.message, true); }
    });
  });

  // ── Maintenance: create record
  const mcCreateBtn = document.getElementById('lcm-mc-create');
  if (mcCreateBtn) {
    mcCreateBtn.addEventListener('click', async () => {
      try {
        const res = await API.post(`/api/links/lifecycle/${id}/create-maintenance`, {
          free_maintenance_period: document.getElementById('lcm-mc-period').value,
          start_date: document.getElementById('lcm-mc-start').value,
          remarks: document.getElementById('lcm-mc-remarks').value.trim(),
        });
        toast(`Maintenance Record created: ${res.maintenance_id}`);
        closeModal();
        lcShowEditModal(id);
        lcLoad();
      } catch(e) { toast(e.message, true); }
    });
  }
}
