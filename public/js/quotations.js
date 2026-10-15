// Quotations module (redesigned 2026-07-02; CRM-only update 2026-07-16).
// 2026-09-21: Status simplified to 6 approved values:
//   Quoted | Follow Up | Negotiation | Approved | Lost | Tender
// Quote Ref. is the primary unique ID; Project Code not shown.
// Independent CRM module — no links to Contracts / Maintenance / Factory / Accounts.
// Tabs: Details, History, Revisions only (Attachments + Linked Factory Orders removed).
// Payment fields removed from form: Quotation Value, Payment Terms, Payment Received, Balance Amount.
// "Project Name" renamed to "Project Description" in all UI labels (DB column project_name unchanged).
// Filters: search (client/project/quote-ref), status, salesperson, year, month.
// Sort: any column, ASC/DESC; persists across filter/page changes.
const QuotationsState = { page: 1, filters: { sort: 'updated_at', dir: 'desc' } };

// Centralized quotation status configuration — single source of truth (2026-09-21).
// value: internal DB value (lowercase_underscore); label: user-facing display text.
// Approved six-status set only — legacy statuses removed from selection.
const QUOTATION_STATUS_CONFIG = [
  { value: 'quoted',       label: 'Quoted' },
  { value: 'follow_up',    label: 'Follow Up' },
  { value: 'negotiation',  label: 'Negotiation' },
  { value: 'approved',     label: 'Approved' },
  { value: 'lost',         label: 'Lost' },
  { value: 'tender',       label: 'Tender' },
];
const QUOTATION_STATUS_MAP = Object.fromEntries(QUOTATION_STATUS_CONFIG.map(s => [s.value, s.label]));
function quotStatusLabel(v) { return QUOTATION_STATUS_MAP[String(v || '')] || v || '-'; }
const SALESPERSON_OPTS = ['SY', 'MM', 'NM', 'SS', 'MGMT'];
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// 2026-10-01: the module shell (tabs Sales Quotations | Sales Follow-Up + Notes) lives in
// sales_followup.js as renderQuotations(); this renders the unchanged quotation register.
async function renderQuotationsRegister(root) {
  const yearOpts = ['2026','2025','2024','2023'].map(y =>
    `<option value="${y}" ${QuotationsState.filters.year === y ? 'selected' : ''}>${y}</option>`).join('');
  const monthOpts = MONTH_LABELS.map((m, i) =>
    `<option value="${String(i+1).padStart(2,'0')}">${m}</option>`).join('');

  root.innerHTML = `
    <div class="qm-sticky-bar">
      <div class="toolbar">
        <input type="text" id="qf-search" placeholder="Search client, project, quote ref..." value="${esc(QuotationsState.filters.search || '')}">
        <select id="qf-status">
          <option value="">All Status</option>
          ${QUOTATION_STATUS_CONFIG.map(s => `<option value="${s.value}" ${QuotationsState.filters.status === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
        <select id="qf-salesperson">
          <option value="">All Salesperson</option>
          ${SALESPERSON_OPTS.map(s => `<option value="${s}" ${QuotationsState.filters.salesperson === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <select id="qf-year"><option value="">All Years</option>${yearOpts}</select>
        <select id="qf-month"><option value="">All Months</option>${monthOpts}</select>
        <select id="qf-sort">
          <option value="updated_at" ${QuotationsState.filters.sort === 'updated_at' ? 'selected' : ''}>Sort: Updated Date</option>
          <option value="quote_ref" ${QuotationsState.filters.sort === 'quote_ref' ? 'selected' : ''}>Sort: Quote Ref.</option>
          <option value="client_name" ${QuotationsState.filters.sort === 'client_name' ? 'selected' : ''}>Sort: Client Name</option>
          <option value="project_name" ${QuotationsState.filters.sort === 'project_name' ? 'selected' : ''}>Sort: Project Description</option>
          <option value="salesperson" ${QuotationsState.filters.sort === 'salesperson' ? 'selected' : ''}>Sort: Salesperson</option>
          <option value="status" ${QuotationsState.filters.sort === 'status' ? 'selected' : ''}>Sort: Status</option>
          <option value="quotation_date" ${QuotationsState.filters.sort === 'quotation_date' ? 'selected' : ''}>Sort: Quotation Date</option>
          <option value="quoted_value" ${QuotationsState.filters.sort === 'quoted_value' ? 'selected' : ''}>Sort: Quoted Value</option>
        </select>
        <select id="qf-dir">
          <option value="desc" ${QuotationsState.filters.dir === 'desc' ? 'selected' : ''}>Descending</option>
          <option value="asc" ${QuotationsState.filters.dir === 'asc' ? 'selected' : ''}>Ascending</option>
        </select>
        <div class="spacer"></div>
        <button class="btn" id="qf-add">+ New Quotation</button>
      </div>
    </div>
    <div class="table-wrap quotations-table-wrap"><table class="data-table quotations-table">
      <colgroup>
        <col class="qcol-ref">
        <col class="qcol-client">
        <col class="qcol-status">
        <col class="qcol-sales">
        <col class="qcol-date">
        <col class="qcol-value">
        <col class="qcol-updated">
        <col class="qcol-desc">
      </colgroup>
      <thead><tr>
        <th>Quote Ref.</th><th>Client / Company Name</th><th>Status</th>
        <th>Salesperson</th><th>Quotation Date</th><th>Quoted Value</th>
        <th>Updated Date</th><th>Project Description</th>
      </tr></thead>
      <tbody id="quotations-tbody"><tr><td colspan="8">Loading...</td></tr></tbody>
    </table></div>
    <div class="pagination" id="quotations-pagination"></div>
  `;

  document.getElementById('qf-search').addEventListener('input', debounce(() => {
    QuotationsState.filters.search = document.getElementById('qf-search').value;
    QuotationsState.page = 1; loadQuotations();
  }, 350));
  document.getElementById('qf-status').addEventListener('change', (e) => {
    QuotationsState.filters.status = e.target.value; QuotationsState.page = 1; loadQuotations();
  });
  document.getElementById('qf-salesperson').addEventListener('change', (e) => {
    QuotationsState.filters.salesperson = e.target.value; QuotationsState.page = 1; loadQuotations();
  });
  document.getElementById('qf-year').addEventListener('change', (e) => {
    QuotationsState.filters.year = e.target.value; QuotationsState.page = 1; loadQuotations();
  });
  document.getElementById('qf-month').addEventListener('change', (e) => {
    QuotationsState.filters.month = e.target.value; QuotationsState.page = 1; loadQuotations();
  });
  document.getElementById('qf-sort').addEventListener('change', (e) => {
    QuotationsState.filters.sort = e.target.value; loadQuotations();
  });
  document.getElementById('qf-dir').addEventListener('change', (e) => {
    QuotationsState.filters.dir = e.target.value; loadQuotations();
  });
  document.getElementById('qf-add').addEventListener('click', () => openQuotationModal(null));

  await loadQuotations();
}

async function loadQuotations() {
  const params = new URLSearchParams({ page: QuotationsState.page, pageSize: 50 });
  Object.entries(QuotationsState.filters).forEach(([k, v]) => { if (v) params.set(k, v); });
  const data = await API.get('/api/quotations?' + params.toString());
  const tbody = document.getElementById('quotations-tbody');
  if (!data.rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No quotations found</td></tr>';
  } else {
    tbody.innerHTML = data.rows.map(p => {
      const fullDesc = p.project_name || '-';
      const shortDesc = fullDesc; // CSS text-overflow handles visual truncation
      const infoBtn = fullDesc.length > 150
        ? `<button class="q-info-btn" tabindex="-1" onclick="showQDesc(event,'${esc(fullDesc).replace(/\\/g,'\\\\').replace(/'/g,'\\&#39;')}')">&#9432;</button>`
        : '';
      return `
      <tr class="q-row" data-id="${p.id}">
        <td class="q-ref">${esc(p.quote_ref || '-')}</td>
        <td>${esc(p.client_name || '-')}</td>
        <td>${badge(quotStatusLabel(p.status))}</td>
        <td>${esc(p.salesperson || '-')}</td>
        <td>${fmtDate(p.quotation_date)}</td>
        <td>${fmtCurrency(p.quoted_value, 'AED')}</td>
        <td>${fmtDate(p.updated_at)}</td>
        <td class="q-desc-cell"><span class="q-desc-text" title="${esc(fullDesc)}">${esc(shortDesc)}</span>${infoBtn}</td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('.q-row').forEach(row =>
      row.addEventListener('click', e => {
        if (e.target.closest('.q-info-btn')) return;
        openQuotationModal(row.dataset.id);
      }));
  }
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  document.getElementById('quotations-pagination').innerHTML = `
    <button class="btn small secondary" ${QuotationsState.page <= 1 ? 'disabled' : ''} id="pg-prev">Prev</button>
    <span>Page ${data.page} of ${totalPages} — ${data.total} total</span>
    <button class="btn small secondary" ${QuotationsState.page >= totalPages ? 'disabled' : ''} id="pg-next">Next</button>
  `;
  const prevBtn = document.getElementById('pg-prev'), nextBtn = document.getElementById('pg-next');
  if (prevBtn) prevBtn.addEventListener('click', () => { QuotationsState.page--; loadQuotations(); });
  if (nextBtn) nextBtn.addEventListener('click', () => { QuotationsState.page++; loadQuotations(); });
}

async function openQuotationModal(id) {
  if (!id) { renderQuotationForm(null, [], []); return; }
  const data = await API.get(`/api/quotations/${id}`);
  let revisions = [];
  try {
    const revData = await API.get(`/api/quotations/revisions/${encodeURIComponent(data.project.quote_ref)}`);
    revisions = revData.revisions || [];
  } catch(e) { /* revisions unavailable */ }
  renderQuotationForm(data.project, data.history, revisions);
}

function renderQuotationForm(p, history, revisions) {
  p = p || {};
  revisions = revisions || [];
  const isNew = !p.id;
  const canDelete = APP.user.role === 'admin';
  const title = isNew ? 'New Quotation' : `Quote Ref: ${esc(p.quote_ref || '-')}`;

  openModal(`
    <h2>${title}</h2>
    ${!isNew ? `<div class="tabs">
      <div class="tab active" data-tab="details">Details</div>
      <div class="tab" data-tab="history">History (${history.length})</div>
      <div class="tab" data-tab="revisions">Revisions (${revisions.length})</div>
    </div>` : ''}

    <div id="tab-details">
      <form id="quotation-form">
        <div class="form-grid">
          ${formField('Quote Ref.', 'quote_ref', p.quote_ref, { disabled: !isNew })}
          ${formField('Client Name', 'client_name', p.client_name)}
          ${formField('Project Description', 'project_name', p.project_name)}
          ${formField('Location', 'location', p.location)}
          ${formField('Salesperson', 'salesperson', p.salesperson, { select: SALESPERSON_OPTS })}
          ${formField('Attn Name', 'attn_name', p.attn_name)}
          ${formField('Phone', 'phone', p.phone)}
          ${formField('Mobile', 'mobile', p.mobile)}
          ${formField('Email', 'email', p.email)}
          ${formField('Quotation Date', 'quotation_date', p.quotation_date ? String(p.quotation_date).slice(0, 10) : '', { type: 'date' })}
          ${formField('Status', 'status', p.status, { select: QUOTATION_STATUS_CONFIG })}
          ${formField('Quoted Value', 'quoted_value', p.quoted_value, { type: 'number' })}
          ${formField('Remarks', 'remarks', p.remarks, { textarea: true, span2: true })}
          ${!isNew ? formField('Note for this change (optional)', 'remarks_note', '', { span2: true }) : ''}
        </div>
        <div class="modal-actions">
          ${!isNew && canDelete ? `<button type="button" class="btn danger" id="delete-quotation">Delete</button>` : ''}
          <div class="spacer"></div>
          <button type="button" class="btn secondary" id="cancel-modal">Cancel</button>
          <button type="submit" class="btn">${isNew ? 'Create' : 'Save Changes'}</button>
        </div>
      </form>
    </div>
    ${!isNew ? `
    <div id="tab-history" class="hidden">
      <div class="history-list">
        ${history.length ? history.map(h => `
          <div class="history-item">
            <div><b>${esc(h.field_name)}</b>: ${esc(h.old_value ?? '-')} &rarr; ${esc(h.new_value ?? '-')}</div>
            <div class="meta">${fmtDate(h.changed_at)} by ${esc(h.changed_by)} ${h.remarks ? '— ' + esc(h.remarks) : ''}</div>
          </div>`).join('') : '<div class="empty-state">No history yet</div>'}
      </div>
    </div>
    <div id="tab-revisions" class="hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <b style="font-size:13px">Revision History — ${esc(p.quote_ref || '')}</b>
        <button class="btn small" id="add-revision-btn">+ Add Revision</button>
      </div>

      <div id="revision-form-wrap" style="display:none;background:#f8f9fa;border-radius:6px;padding:12px;margin-bottom:12px">
        <div class="form-grid">
          <div style="grid-column:1/-1">
            <label style="font-size:12px;color:#667;font-weight:600">REASON FOR REVISION *</label>
            <input type="text" id="rev-reason" placeholder="e.g. Scope change, client request, price adjustment" style="width:100%;margin-top:4px">
          </div>
          <div>
            <label style="font-size:12px;color:#667;font-weight:600">NEW QUOTED VALUE (AED)</label>
            <input type="number" id="rev-value" value="${p.quoted_value || ''}" style="width:100%;margin-top:4px">
          </div>
          <div>
            <label style="font-size:12px;color:#667;font-weight:600">REMARKS</label>
            <input type="text" id="rev-remarks" style="width:100%;margin-top:4px">
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:10px">
          <button class="btn small" id="rev-save-btn">Create Revision</button>
          <button class="btn small secondary" id="rev-cancel-btn">Cancel</button>
        </div>
      </div>

      ${revisions.length ? `
        <table class="data-table">
          <thead><tr>
            <th>Rev.</th><th>Date</th><th>Reason</th><th>Quoted Value</th>
            <th>Status</th><th>Client Approval</th><th>Revised By</th><th>Remarks</th><th></th>
          </tr></thead>
          <tbody>
            ${revisions.map(r => `
              <tr style="${r.is_current ? 'background:#f0fff4' : ''}">
                <td><b>${r.revision_no === 0 ? 'R0 (Original)' : 'R' + r.revision_no}</b>${r.is_current ? ' <span style="font-size:10px;color:#15803d;font-weight:600">CURRENT</span>' : ''}</td>
                <td>${fmtDate(r.revision_date)}</td>
                <td>${esc(r.revision_reason || '-')}</td>
                <td>${fmtCurrency(r.quoted_value, 'AED')}</td>
                <td>${badge(r.status)}</td>
                <td>${badge(r.client_approval_status)}</td>
                <td>${esc(r.revised_by || '-')}</td>
                <td>${esc(r.remarks || '-')}</td>
                <td>${r.is_current && r.client_approval_status !== 'Approved'
                  ? '<button class="btn small" data-approve-rev="' + r.id + '">Mark Approved</button>' : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      ` : '<div class="empty-state">No revisions yet. Click &quot;+ Add Revision&quot; to create the first one.</div>'}
    </div>` : ''}
  `);

  if (!isNew) {
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      ['details', 'history', 'revisions'].forEach(name => {
        const el = document.getElementById('tab-' + name);
        if (el) el.classList.toggle('hidden', name !== t.dataset.tab);
      });
    }));
    const delBtn = document.getElementById('delete-quotation');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!await confirmDelete({ title: 'Delete Quotation', message: 'Delete this quotation? It can be restored later by an admin.' })) return;
      await API.del(`/api/quotations/${p.id}`);
      toast('Quotation deleted');
      closeModal();
      loadQuotations();
    });
    // ── Revision handlers
    const addRevBtn = document.getElementById('add-revision-btn');
    if (addRevBtn) {
      addRevBtn.addEventListener('click', () => {
        const form = document.getElementById('revision-form-wrap');
        if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
      });
    }
    const revCancelBtn = document.getElementById('rev-cancel-btn');
    if (revCancelBtn) {
      revCancelBtn.addEventListener('click', () => {
        const form = document.getElementById('revision-form-wrap');
        if (form) form.style.display = 'none';
      });
    }
    const revSaveBtn = document.getElementById('rev-save-btn');
    if (revSaveBtn) {
      revSaveBtn.addEventListener('click', async () => {
        const reason = document.getElementById('rev-reason').value.trim();
        if (!reason) return toast('Revision reason is required', true);
        try {
          const result = await API.post('/api/quotations/revisions', {
            quote_ref: p.quote_ref,
            revision_reason: reason,
            quoted_value: document.getElementById('rev-value').value || p.quoted_value,
            remarks: document.getElementById('rev-remarks').value,
          });
          toast(`Revision ${result.label} created`);
          openQuotationModal(p.id);
        } catch(e) { toast(e.message, true); }
      });
    }
    document.querySelectorAll('[data-approve-rev]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Mark this revision as Client Approved? This will update the quotation status to Approved.')) return;
        try {
          await API.patch(`/api/quotations/revisions/${btn.dataset.approveRev}`, {
            client_approval_status: 'Approved'
          });
          toast('Revision marked as Approved');
          openQuotationModal(p.id);
        } catch(e) { toast(e.message, true); }
      });
    });
  }

  document.getElementById('cancel-modal').addEventListener('click', closeModal);
  document.getElementById('quotation-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readForm(e.target);
    try {
      if (isNew) {
        await API.post('/api/quotations', data);
        toast('Quotation created');
      } else {
        await API.patch(`/api/quotations/${p.id}`, data);
        toast('Quotation updated');
      }
      closeModal();
      loadQuotations();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ── Description popover ──────────────────────────────────────────────────────
function showQDesc(event, desc) {
  event.stopPropagation();
  document.querySelectorAll('.q-desc-popover').forEach(el => el.remove());
  const pop = document.createElement('div');
  pop.className = 'q-desc-popover';
  pop.textContent = desc;
  document.body.appendChild(pop);
  const btn = event.currentTarget;
  const rect = btn.getBoundingClientRect();
  pop.style.top  = (rect.bottom + window.scrollY + 6) + 'px';
  pop.style.left = Math.min(rect.left + window.scrollX, window.innerWidth - 340) + 'px';
  const dismiss = (e) => {
    if (!pop.contains(e.target) && e.target !== btn) {
      pop.remove();
      document.removeEventListener('click', dismiss);
    }
  };
  setTimeout(() => document.addEventListener('click', dismiss), 0);
}
