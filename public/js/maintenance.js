// public/js/maintenance.js — Maintenance Module Complete Redesign (2026-07-12)
// 4 tabs: Maintenance Projects | Maintenance Visits | Cancelled AMC | Dashboard
// v=20260712b — Action button fix: Edit/Schedule/History wired correctly

// ── Module-scoped constants (prefixed MN_ to avoid global collision) ──────
const MN_TYPES = [
  'Free Comprehensive Maintenance','Paid Comprehensive AMC',
  'Paid Non-Comprehensive AMC','Warranty Maintenance',
  'Temporary Maintenance','Other'
];
const MN_PERIODS = [
  'Every Month','Once Every 2 Months','Once Every 3 Months',
  'Once Every 4 Months','Once Every 6 Months','Custom'
];
const MN_STATUSES = ['Active','Under Renewal','Hold','Cancelled'];
const MN_VISIT_TYPES = ['Routine','Emergency','Callback','Follow-up','Inspection','Repair'];
const MN_VISIT_STATUSES = ['Pending','Scheduled','Completed','Postponed','Missed','Cancelled'];
const MN_EMIRATES = ['Abu Dhabi','Dubai','Sharjah','Ajman','Umm Al Quwain','Ras Al Khaimah','Fujairah'];

const MN_STATUS_COLORS = {
  'Active':'#27ae60','Under Renewal':'#f39c12','Hold':'#e67e22','Cancelled':'#95a5a6'
};
const MN_VISIT_STATUS_COLORS = {
  'Pending':'#95a5a6','Scheduled':'#2980b9','Completed':'#27ae60',
  'Postponed':'#f39c12','Missed':'#c0392b','Cancelled':'#bdc3c7'
};

const MN_STATE = {
  tab: 'projects',
  projects: { search:'', status:'', type:'', emirate:'', needs_review:'', page:1 },
  visits: { search:'', status:'', year: new Date().getFullYear(), month: new Date().getMonth()+1 },
  cancelled: { search:'', page:1 },
  dashboard: {}
};

function mnBadge(text, color) {
  return `<span class="badge" style="background:${color||'#95a5a6'};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px">${esc(text||'')}</span>`;
}
function mnYesNo(val) { return val ? '<span style="color:#27ae60">✓ Yes</span>' : '<span style="color:#aaa">No</span>'; }
function mnFmt(v) { return v||'—'; }

// ── Main render entry ─────────────────────────────────────────────────────
async function renderMaintenance(root) {
  root.innerHTML = `
    <div class="module-tabs" id="mn-tabs">
      <button class="tab-btn ${MN_STATE.tab==='projects'?'active':''}" data-tab="projects">Maintenance Projects</button>
      <button class="tab-btn ${MN_STATE.tab==='visits'?'active':''}" data-tab="visits">Maintenance Visits</button>
      <button class="tab-btn ${MN_STATE.tab==='cancelled'?'active':''}" data-tab="cancelled">Cancelled AMC</button>
      <button class="tab-btn ${MN_STATE.tab==='dashboard'?'active':''}" data-tab="dashboard">Dashboard</button>
    </div>
    <div id="mn-view"></div>`;

  document.querySelectorAll('#mn-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      MN_STATE.tab = btn.dataset.tab;
      document.querySelectorAll('#mn-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      mnRenderTab(document.getElementById('mn-view'));
    });
  });
  mnRenderTab(document.getElementById('mn-view'));
}

function mnRenderTab(view) {
  view.innerHTML = '<div class="loading">Loading…</div>';
  if (MN_STATE.tab==='projects')   mnRenderProjects(view);
  else if (MN_STATE.tab==='visits')    mnRenderVisits(view);
  else if (MN_STATE.tab==='cancelled') mnRenderCancelled(view);
  else if (MN_STATE.tab==='dashboard') mnRenderDashboard(view);
}

// =============================================================================
// TAB 1: MAINTENANCE PROJECTS
// =============================================================================
async function mnRenderProjects(view) {
  const st = MN_STATE.projects;
  const qs = new URLSearchParams({
    search:st.search, status:st.status, type:st.type,
    emirate:st.emirate, needs_review:st.needs_review,
    page:st.page, limit:50
  });

  let data;
  try {
    data = await API.get(`/api/maintenance/projects?${qs}`);
  } catch(e) {
    view.innerHTML = `<div style="padding:24px;color:#c0392b">
      Unable to load Maintenance Projects. Please refresh the page and try again.<br>
      <small style="color:#aaa">${esc(e.message||'')}</small>
    </div>`;
    return;
  }

  view.innerHTML = `
    <div class="toolbar">
      <input type="text" id="mn-proj-search" placeholder="Search ID, client, contract…" value="${esc(st.search)}" style="width:220px">
      <select id="mn-proj-status"><option value="">All Statuses</option>
        ${MN_STATUSES.map(s=>`<option value="${s}" ${st.status===s?'selected':''}>${s}</option>`).join('')}
      </select>
      <select id="mn-proj-type"><option value="">All Types</option>
        ${MN_TYPES.map(t=>`<option value="${t}" ${st.type===t?'selected':''}>${t}</option>`).join('')}
      </select>
      <select id="mn-proj-emirate"><option value="">All Emirates</option>
        ${MN_EMIRATES.map(e=>`<option value="${e}" ${st.emirate===e?'selected':''}>${e}</option>`).join('')}
      </select>
      <label><input type="checkbox" id="mn-proj-nr" ${st.needs_review==='1'?'checked':''}> Needs Review Only</label>
      <button class="btn-primary" id="mn-add-proj">+ New Project</button>
    </div>
    <div class="meta">Showing ${data.rows.length} of ${data.total} projects</div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>MNT ID</th><th>Client</th><th>Contract Ref</th><th>Type</th>
          <th>Period</th><th>Start</th><th>End</th>
          <th>Status</th><th>Visits</th><th>Review</th><th>Actions</th>
        </tr></thead>
        <tbody>${data.rows.map(r => `
          <tr>
            <td><a href="#" class="mn-proj-link" data-id="${r.id}" style="cursor:pointer">${esc(r.maintenance_id)}</a></td>
            <td>${esc(r.client_name||'—')}</td>
            <td>${esc(r.contract_ref||'—')}</td>
            <td style="font-size:11px">${esc(r.maintenance_type||'—')}</td>
            <td>${esc(r.maintenance_period||'—')}</td>
            <td>${esc(r.start_date||'—')}</td>
            <td>${esc(r.end_date||'—')}</td>
            <td>${mnBadge(r.maintenance_status, MN_STATUS_COLORS[r.maintenance_status])}</td>
            <td>${r.completed_visits||0}/${r.total_visits||0}</td>
            <td>${r.needs_review ? '<span style="color:#e74c3c;font-weight:bold">⚠ Yes</span>' : ''}</td>
            <td style="white-space:nowrap">
              <button class="btn-small mn-edit-proj" data-id="${r.id}" style="cursor:pointer" title="Edit this maintenance project">Edit</button>
              <button class="btn-small mn-view-sched" data-id="${r.id}" style="cursor:pointer" title="View or manage visit schedule">Schedule</button>
              <button class="btn-small mn-view-hist" data-id="${r.id}" style="cursor:pointer" title="View full history for this project">History</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${mnPager('mn-proj', data.total, st.page, 50)}`;

  // ── Toolbar events ──────────────────────────────────────────────────────
  const filterAndReload = () => {
    st.search      = document.getElementById('mn-proj-search').value;
    st.status      = document.getElementById('mn-proj-status').value;
    st.type        = document.getElementById('mn-proj-type').value;
    st.emirate     = document.getElementById('mn-proj-emirate').value;
    st.needs_review = document.getElementById('mn-proj-nr').checked ? '1' : '';
    st.page = 1;
    mnRenderProjects(view);
  };
  ['mn-proj-search','mn-proj-status','mn-proj-type','mn-proj-emirate'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', filterAndReload);
  });
  document.getElementById('mn-proj-search').addEventListener('keydown', e => { if(e.key==='Enter') filterAndReload(); });
  document.getElementById('mn-proj-nr').addEventListener('change', filterAndReload);
  document.getElementById('mn-add-proj').addEventListener('click', () => mnShowProjectModal(null, view));

  // ── Row link: click MNT ID to edit ──────────────────────────────────────
  document.querySelectorAll('.mn-proj-link').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    mnShowProjectModal(a.dataset.id, view);
  }));

  // ── Action buttons — bound by DB id from data-id attribute ───────────────
  document.querySelectorAll('.mn-edit-proj').forEach(b =>
    b.addEventListener('click', () => mnShowProjectModal(b.dataset.id, view))
  );
  document.querySelectorAll('.mn-view-sched').forEach(b =>
    b.addEventListener('click', () => mnShowProjectSchedule(b.dataset.id, view))
  );
  document.querySelectorAll('.mn-view-hist').forEach(b =>
    b.addEventListener('click', () => mnShowHistory(b.dataset.id, view))
  );

  mnBindPager('mn-proj', st, () => mnRenderProjects(view));
}

function mnPager(prefix, total, page, limit) {
  const pages = Math.ceil(total/limit);
  if (pages<=1) return '';
  return `<div class="pager">
    <button id="${prefix}-prev" ${page<=1?'disabled':''}>&#8249; Prev</button>
    <span>Page ${page} of ${pages}</span>
    <button id="${prefix}-next" ${page>=pages?'disabled':''}>Next &#8250;</button>
  </div>`;
}
function mnBindPager(prefix, st, reload) {
  const prev = document.getElementById(`${prefix}-prev`);
  const next = document.getElementById(`${prefix}-next`);
  if (prev) prev.addEventListener('click', () => { st.page--; reload(); });
  if (next) next.addEventListener('click', () => { st.page++; reload(); });
}

// =============================================================================
// PROJECT MODAL — Edit / New
// =============================================================================
async function mnShowProjectModal(id, view) {
  const isNew = !id;
  let proj = null;

  if (!isNew) {
    try {
      proj = await API.get(`/api/maintenance/projects/${id}`);
    } catch(e) {
      console.error('[Maintenance] Edit load error for id', id, e);
      showToast(
        e.message || 'Unable to load the selected Maintenance Project. Please refresh the page and try again.',
        'error'
      );
      return;
    }
  }

  const title = isNew ? 'New Maintenance Project' : `Edit — ${proj.maintenance_id}`;
  const v = proj || {};

  const renewalSection = !isNew ? `
    <hr>
    <h4>Renew Contract</h4>
    <div class="form-row">
      <label>New Start Date</label><input type="date" id="mn-renew-start">
      <label>New End Date</label><input type="date" id="mn-renew-end">
      <label>New AMC Value (AED)</label><input type="number" id="mn-renew-value">
    </div>
    <button class="btn-secondary" id="mn-renew-btn" style="cursor:pointer">Process Renewal</button>
    ${v.renewals && v.renewals.length ? `<div class="meta">Renewal history: ${v.renewals.length} period(s)</div>` : ''}
  ` : '';

  showModal(title, `
    <div class="form-grid" style="max-height:70vh;overflow-y:auto;padding-right:8px">
      <h4>Basic Information</h4>
      <div class="form-row">
        <label>Client Name *</label>
        <input id="mn-client" value="${esc(v.client_name||'')}">
        <label>Project / Site Name</label>
        <input id="mn-projname" value="${esc(v.project_name||'')}">
      </div>
      <div class="form-row">
        <label>Contract Ref</label>
        <input id="mn-cref" value="${esc(v.contract_ref||'')}">
        <label>Emirate</label>
        <select id="mn-emirate">
          <option value="">—</option>
          ${MN_EMIRATES.map(e=>`<option value="${e}" ${v.emirate===e?'selected':''}>${e}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label>Location / Address</label>
        <input id="mn-location" value="${esc(v.location||'')}">
        <label>Total Elevator Units</label>
        <input type="number" id="mn-units" value="${v.total_elevator_units||''}">
      </div>

      <h4>Maintenance Configuration</h4>
      <div class="form-row">
        <label>Maintenance Type *</label>
        <select id="mn-type">
          <option value="">—</option>
          ${MN_TYPES.map(t=>`<option value="${t}" ${v.maintenance_type===t?'selected':''}>${t}</option>`).join('')}
        </select>
        <label>Maintenance Period</label>
        <select id="mn-period">
          <option value="">—</option>
          ${MN_PERIODS.map(p=>`<option value="${p}" ${v.maintenance_period===p?'selected':''}>${p}</option>`).join('')}
        </select>
      </div>
      <div class="form-row" id="mn-custom-period-row" style="${v.maintenance_period==='Custom'?'':'display:none'}">
        <label>Custom Period (months)</label>
        <input type="number" id="mn-custom-months" min="1" value="${v.custom_period_months||''}">
      </div>
      <div class="form-row">
        <label>Start Date</label><input type="date" id="mn-start" value="${v.start_date||''}">
        <label>End Date</label><input type="date" id="mn-end" value="${v.end_date||''}">
      </div>
      <div class="form-row">
        <label>Status</label>
        <select id="mn-status">
          ${MN_STATUSES.map(s=>`<option value="${s}" ${(v.maintenance_status||'Active')===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>

      <h4>Financial</h4>
      <div class="form-row">
        <label>AMC Value</label>
        <input type="number" id="mn-amc-val" value="${v.amc_value||''}">
        <label>Currency</label>
        <select id="mn-currency">
          <option value="AED" ${(v.currency_code||'AED')==='AED'?'selected':''}>AED</option>
          <option value="USD" ${v.currency_code==='USD'?'selected':''}>USD</option>
        </select>
        <label>Payment Terms</label>
        <input id="mn-payterms" value="${esc(v.payment_terms||'')}">
      </div>

      <h4>Status-Specific Fields</h4>
      <div id="mn-status-fields">
        ${mnStatusFields(v)}
      </div>

      <h4>Remarks</h4>
      <textarea id="mn-remarks" rows="2">${esc(v.remarks||'')}</textarea>

      ${v.needs_review ? `<div class="alert-box" style="background:#fff3cd;border:1px solid #ffc107;padding:8px;border-radius:4px;margin-top:8px">
        ⚠ <strong>Needs Review:</strong> ${esc(v.review_notes||'')}
      </div>` : ''}

      <div class="form-row" style="margin-top:8px">
        ${isNew ? '<label><input type="checkbox" id="mn-auto-sched" checked> Auto-generate visit schedule</label>' : ''}
      </div>
      ${renewalSection}
    </div>`,
    [{
      label: isNew ? 'Create Project' : 'Save Changes',
      primary: true,
      onClick: async () => {
        const body = {
          client_name:          document.getElementById('mn-client').value.trim(),
          project_name:         document.getElementById('mn-projname').value.trim(),
          contract_ref:         document.getElementById('mn-cref').value.trim(),
          emirate:              document.getElementById('mn-emirate').value,
          location:             document.getElementById('mn-location').value.trim(),
          total_elevator_units: document.getElementById('mn-units').value || null,
          maintenance_type:     document.getElementById('mn-type').value,
          maintenance_period:   document.getElementById('mn-period').value,
          custom_period_months: document.getElementById('mn-custom-months')?.value || null,
          start_date:           document.getElementById('mn-start').value,
          end_date:             document.getElementById('mn-end').value,
          maintenance_status:   document.getElementById('mn-status').value,
          amc_value:            document.getElementById('mn-amc-val').value || null,
          currency_code:        document.getElementById('mn-currency').value,
          currency_symbol:      document.getElementById('mn-currency').value,
          payment_terms:        document.getElementById('mn-payterms').value.trim(),
          remarks:              document.getElementById('mn-remarks').value.trim(),
          cancellation_reason:  document.getElementById('mn-cancel-reason')?.value?.trim() || null,
          cancellation_date:    document.getElementById('mn-cancel-date')?.value || null,
          hold_reason:          document.getElementById('mn-hold-reason')?.value?.trim() || null,
          hold_date:            document.getElementById('mn-hold-date')?.value || null,
          hold_release_date:    document.getElementById('mn-hold-release')?.value || null,
          auto_generate_schedule: isNew && document.getElementById('mn-auto-sched')?.checked
        };
        if (!body.maintenance_type) return showToast('Maintenance Type is required', 'error');
        try {
          if (isNew) {
            const r = await API.post('/api/maintenance/projects', body);
            showToast(`Created ${r.maintenance_id}${r.scheduled_visits > 0 ? ' — ' + r.scheduled_visits + ' visits scheduled' : ''}`);
          } else {
            await API.put(`/api/maintenance/projects/${id}`, body);
            showToast('Saved');
          }
          closeModal();
          mnRenderProjects(view);
        } catch(e) {
          showToast(e.message || 'Error saving project', 'error');
        }
      }
    }]
  );

  // Period toggle
  document.getElementById('mn-period').addEventListener('change', function() {
    const row = document.getElementById('mn-custom-period-row');
    if (row) row.style.display = this.value === 'Custom' ? '' : 'none';
  });
  // Status-specific field toggle
  document.getElementById('mn-status').addEventListener('change', function() {
    const sf = document.getElementById('mn-status-fields');
    if (sf) sf.innerHTML = mnStatusFields({
      maintenance_status: this.value,
      cancellation_reason: v.cancellation_reason, cancellation_date: v.cancellation_date,
      hold_reason: v.hold_reason, hold_date: v.hold_date, hold_release_date: v.hold_release_date
    });
  });
  // Renewal button
  const renewBtn = document.getElementById('mn-renew-btn');
  if (renewBtn) {
    renewBtn.addEventListener('click', async () => {
      const newStart = document.getElementById('mn-renew-start').value;
      const newEnd   = document.getElementById('mn-renew-end').value;
      const newVal   = document.getElementById('mn-renew-value').value;
      if (!newStart || !newEnd) return showToast('New start and end date required', 'error');
      try {
        const r = await API.post(`/api/maintenance/projects/${id}/renew`, {
          new_start_date: newStart, new_end_date: newEnd, amc_value: newVal || null
        });
        showToast(`Renewed — ${r.visits_created} new visits scheduled`);
        closeModal();
        mnRenderProjects(view);
      } catch(e) {
        showToast(e.message || 'Error processing renewal', 'error');
      }
    });
  }
}

function mnStatusFields(v) {
  const status = v.maintenance_status || 'Active';
  if (status === 'Cancelled') return `
    <div class="form-row">
      <label>Cancellation Date</label><input type="date" id="mn-cancel-date" value="${v.cancellation_date||''}">
      <label>Cancellation Reason</label><input id="mn-cancel-reason" value="${esc(v.cancellation_reason||'')}">
    </div>`;
  if (status === 'Hold') return `
    <div class="form-row">
      <label>Hold Date</label><input type="date" id="mn-hold-date" value="${v.hold_date||''}">
      <label>Hold Reason</label><input id="mn-hold-reason" value="${esc(v.hold_reason||'')}">
      <label>Expected Release Date</label><input type="date" id="mn-hold-release" value="${v.hold_release_date||''}">
    </div>`;
  return '<div class="meta" style="color:#aaa;font-size:11px">No extra fields for this status.</div>';
}

// =============================================================================
// SCHEDULE MODAL — per-project visit schedule view
// =============================================================================
async function mnShowProjectSchedule(id, view) {
  let proj;
  try {
    proj = await API.get(`/api/maintenance/projects/${id}`);
  } catch(e) {
    console.error('[Maintenance] Schedule load error for id', id, e);
    showToast(
      e.message || 'Unable to load the selected Maintenance Project. Please refresh the page and try again.',
      'error'
    );
    return;
  }

  const SHORT_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const curYear   = new Date().getFullYear();

  // Sort visits chronologically
  const allVisits = (proj.visits || []).slice().sort((a, b) => {
    return a.visit_year !== b.visit_year
      ? a.visit_year - b.visit_year
      : a.visit_month - b.visit_month;
  });

  const visitYears = [...new Set(allVisits.map(v => v.visit_year))].sort((a, b) => a - b);
  let displayYear  = visitYears.includes(curYear) ? curYear : (visitYears[visitYears.length - 1] || curYear);

  // Build visit rows for a given year
  function buildRows(yr) {
    const yv = allVisits.filter(v => v.visit_year === yr);
    if (!yv.length) {
      return `<tr><td colspan="8" style="text-align:center;color:#aaa;padding:16px">
        No visits found for ${yr}.
      </td></tr>`;
    }
    return yv.map(v => `
      <tr>
        <td><strong>${SHORT_MON[v.visit_month - 1]}</strong></td>
        <td style="font-size:11px">${esc(v.visit_ref || '—')}</td>
        <td>${esc(v.scheduled_date || '—')}</td>
        <td>${esc(v.actual_date || '—')}</td>
        <td>${mnBadge(v.visit_status || 'Pending', MN_VISIT_STATUS_COLORS[v.visit_status] || '#aaa')}</td>
        <td style="font-size:11px">${esc(v.remarks || '')}</td>
        <td>
          <button class="btn-small mn-sched-v-edit" data-visit-id="${v.id}" style="cursor:pointer">Edit</button>
        </td>
      </tr>`).join('');
  }

  // Bind edit buttons on visit rows
  function bindVisitEdits() {
    document.querySelectorAll('.mn-sched-v-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        closeModal();
        mnShowVisitModal(btn.dataset.visitId, null, view);
      });
    });
  }

  const noVisits   = allVisits.length === 0;
  const canGenerate = proj.maintenance_period && proj.start_date && proj.end_date;

  const yearSelectHtml = visitYears.length > 0
    ? visitYears.map(y => `<option value="${y}" ${y === displayYear ? 'selected' : ''}>${y}</option>`).join('')
    : `<option value="${curYear}">${curYear}</option>`;

  showModal(
    `Schedule — ${esc(proj.maintenance_id)} &nbsp;&middot;&nbsp; ${esc(proj.client_name || '—')}`,
    `<div style="max-height:65vh;overflow-y:auto">

      <!-- Project summary bar -->
      <div style="background:#f8f9fa;border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#555;line-height:2">
        <strong>Status:</strong>&nbsp;${mnBadge(proj.maintenance_status, MN_STATUS_COLORS[proj.maintenance_status])}
        &nbsp;&nbsp;<strong>Type:</strong>&nbsp;${esc(proj.maintenance_type || '—')}
        &nbsp;&nbsp;<strong>Period:</strong>&nbsp;${esc(proj.maintenance_period || '—')}<br>
        <strong>Contract Dates:</strong>&nbsp;${esc(proj.start_date || '—')} &rarr; ${esc(proj.end_date || '—')}
      </div>

      ${noVisits ? `
        <!-- No visits yet -->
        <div style="text-align:center;padding:28px 16px;border:2px dashed #ddd;border-radius:8px">
          <div style="color:#777;margin-bottom:14px;font-size:14px">
            No schedule has been generated for this Maintenance Project.
          </div>
          ${canGenerate ? `
            <button class="btn-primary" id="mn-sched-gen-inline" style="cursor:pointer;padding:8px 20px">
              Generate Schedule
            </button>
            <div style="font-size:11px;color:#aaa;margin-top:10px">
              Will generate visit slots from&nbsp;<strong>${esc(proj.start_date)}</strong>
              to&nbsp;<strong>${esc(proj.end_date)}</strong>
              &middot;&nbsp;${esc(proj.maintenance_period)}
            </div>` : `
            <div style="font-size:12px;color:#e74c3c;margin-top:8px">
              Cannot generate schedule: Start Date, End Date, or Maintenance Period is missing.<br>
              Please edit this project first to fill in the required fields.
            </div>`}
        </div>
      ` : `
        <!-- Visits table -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
          <label style="font-size:12px;font-weight:600">Year:</label>
          <select id="mn-sched-yr" style="padding:4px 8px">${yearSelectHtml}</select>
          <button class="btn-secondary" id="mn-sched-filter" style="cursor:pointer">Filter</button>
          <button class="btn-primary"   id="mn-sched-add"    style="cursor:pointer">+ Add Visit</button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr>
              <th>Month</th><th>Visit Ref</th><th>Sched. Date</th><th>Actual Date</th>
              <th>Status</th><th>Remarks</th><th>Actions</th>
            </tr></thead>
            <tbody id="mn-sched-rows">${buildRows(displayYear)}</tbody>
          </table>
        </div>
      `}
    </div>`,
    [{ label: 'Close', onClick: closeModal }]
  );

  if (noVisits) {
    const genBtn = document.getElementById('mn-sched-gen-inline');
    if (genBtn) {
      genBtn.addEventListener('click', async () => {
        genBtn.disabled = true;
        genBtn.textContent = 'Generating…';
        try {
          const r = await API.post(`/api/maintenance/projects/${id}/generate-schedule`, {});
          showToast(`${r.visits_created} visit slots created`);
          closeModal();
          // Re-open the schedule modal with fresh data
          mnShowProjectSchedule(id, view);
        } catch(e) {
          showToast(e.message || 'Error generating schedule', 'error');
          genBtn.disabled = false;
          genBtn.textContent = 'Generate Schedule';
        }
      });
    }
  } else {
    const filterBtn = document.getElementById('mn-sched-filter');
    if (filterBtn) {
      filterBtn.addEventListener('click', () => {
        const yr = parseInt(document.getElementById('mn-sched-yr').value);
        displayYear = yr;
        const tbody = document.getElementById('mn-sched-rows');
        if (tbody) tbody.innerHTML = buildRows(yr);
        bindVisitEdits();
      });
    }
    const addBtn = document.getElementById('mn-sched-add');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        closeModal();
        mnShowVisitModal(null, {
          maintenance_project_id: proj.id,
          visit_year:  displayYear,
          visit_month: new Date().getMonth() + 1
        }, view);
      });
    }
    bindVisitEdits();
  }
}

// =============================================================================
// HISTORY MODAL — read-only event timeline
// =============================================================================
async function mnShowHistory(id, view) {
  let rows, proj;
  try {
    [rows, proj] = await Promise.all([
      API.get(`/api/maintenance/projects/${id}/history`),
      API.get(`/api/maintenance/projects/${id}`)
    ]);
  } catch(e) {
    console.error('[Maintenance] History load error for id', id, e);
    showToast(
      e.message || 'Unable to load the selected Maintenance Project. Please refresh the page and try again.',
      'error'
    );
    return;
  }

  showModal(
    `History — ${esc(proj.maintenance_id)} &nbsp;&middot;&nbsp; ${esc(proj.client_name || '—')}`,
    `<div style="max-height:62vh;overflow-y:auto">
      ${!rows.length ? '<div style="padding:16px;color:#aaa;text-align:center">No history events recorded yet.</div>' : `
      <table class="data-table">
        <thead><tr>
          <th>Date / Time</th><th>Event</th><th>Description</th>
          <th>Field</th><th>Old Value</th><th>New Value</th><th>By</th>
        </tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td style="font-size:11px;white-space:nowrap">${esc((r.changed_at||'').slice(0,16).replace('T',' '))}</td>
          <td><strong>${esc(r.event_type)}</strong></td>
          <td style="font-size:11px">${esc(r.event_description||'')}</td>
          <td style="font-size:11px">${esc(r.field_name||'')}</td>
          <td style="font-size:11px;color:#777">${esc(r.old_value||'')}</td>
          <td style="font-size:11px">${esc(r.new_value||'')}</td>
          <td style="font-size:11px">${esc(r.changed_by||'')}</td>
        </tr>`).join('')}
        </tbody>
      </table>`}
    </div>`,
    [{ label: 'Close', onClick: closeModal }]
  );
}

// =============================================================================
// TAB 2: MAINTENANCE VISITS (Monthly Schedule View)
// =============================================================================
async function mnRenderVisits(view) {
  const st = MN_STATE.visits;
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  let data;
  try {
    data = await API.get(`/api/maintenance/visits/schedule/${st.year}/${st.month}`);
  } catch(e) {
    view.innerHTML = `<div style="padding:24px;color:#c0392b">
      Unable to load visit schedule. Please refresh the page and try again.<br>
      <small style="color:#aaa">${esc(e.message||'')}</small>
    </div>`;
    return;
  }
  const rows = data.rows;

  const summary = { Scheduled:0, Completed:0, Pending:0, Postponed:0, Missed:0, Cancelled:0, 'No Visit':0 };
  rows.forEach(r => {
    const s = r.visit_status || 'No Visit';
    summary[s] = (summary[s] || 0) + 1;
  });

  view.innerHTML = `
    <div class="toolbar">
      <label>Year:</label>
      <select id="mn-vis-year">
        ${[2024,2025,2026,2027].map(y=>`<option value="${y}" ${st.year==y?'selected':''}>${y}</option>`).join('')}
      </select>
      <label>Month:</label>
      <select id="mn-vis-month">
        ${MONTH_NAMES.map((m,i)=>`<option value="${i+1}" ${st.month==i+1?'selected':''}>${m}</option>`).join('')}
      </select>
      <button id="mn-vis-go" class="btn-secondary" style="cursor:pointer">View</button>
      <button id="mn-add-visit" class="btn-primary" style="cursor:pointer">+ Log Visit</button>
    </div>
    <div class="kpi-grid" style="margin-bottom:12px">
      ${Object.entries(summary).map(([s,c])=>`
        <div class="kpi-card" style="padding:8px 12px">
          <div class="num" style="color:${MN_VISIT_STATUS_COLORS[s]||'#333'}">${c}</div>
          <div class="label" style="font-size:11px">${s}</div>
        </div>`).join('')}
    </div>
    <div class="meta">${rows.length} active AMC projects for ${MONTH_NAMES[st.month-1]} ${st.year}</div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>MNT ID</th><th>Client</th><th>Type</th>
          <th>Units</th><th>Visit Ref</th><th>Sched. Date</th>
          <th>Visit Status</th><th>Actions</th>
        </tr></thead>
        <tbody>${rows.map(r=>`
          <tr>
            <td>${esc(r.maintenance_id)}</td>
            <td>${esc(r.client_name||'—')}</td>
            <td style="font-size:11px">${esc(r.maintenance_type||'—')}</td>
            <td>${esc(r.total_elevator_units||'—')}</td>
            <td>${esc(r.visit_ref||'—')}</td>
            <td>${esc(r.scheduled_date||'—')}</td>
            <td>${mnBadge(r.visit_status||'No Visit', MN_VISIT_STATUS_COLORS[r.visit_status]||'#ccc')}</td>
            <td>
              ${r.visit_id
                ? `<button class="btn-small mn-edit-visit" data-id="${r.visit_id}" style="cursor:pointer">Edit</button>`
                : `<button class="btn-small mn-log-visit" data-proj-id="${r.project_id}" data-mnt="${esc(r.maintenance_id)}" style="cursor:pointer">Log Visit</button>`}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  document.getElementById('mn-vis-go').addEventListener('click', () => {
    st.year  = parseInt(document.getElementById('mn-vis-year').value);
    st.month = parseInt(document.getElementById('mn-vis-month').value);
    mnRenderVisits(view);
  });
  document.getElementById('mn-add-visit').addEventListener('click', () => mnShowVisitModal(null, null, view));
  document.querySelectorAll('.mn-edit-visit').forEach(b =>
    b.addEventListener('click', () => mnShowVisitModal(b.dataset.id, null, view))
  );
  document.querySelectorAll('.mn-log-visit').forEach(b =>
    b.addEventListener('click', () => mnShowVisitModal(null, {
      maintenance_project_id: b.dataset.projId,
      visit_year: st.year, visit_month: st.month
    }, view))
  );
}

// =============================================================================
// VISIT MODAL — Log / Edit a single visit
// =============================================================================
async function mnShowVisitModal(visitId, prefill, view) {
  const isNew = !visitId;
  let v = {};
  if (!isNew) {
    try {
      v = await API.get(`/api/maintenance/visits/${visitId}`);
    } catch(e) {
      showToast(e.message || 'Unable to load visit record. Please try again.', 'error');
      return;
    }
  } else if (prefill) {
    v = { ...prefill };
  }

  const title = isNew ? 'Log Maintenance Visit' : `Edit Visit — ${v.visit_ref || visitId}`;
  showModal(title, `
    <div class="form-grid" style="max-height:70vh;overflow-y:auto;padding-right:8px">
      <div class="form-row">
        <label>Maintenance Project ID</label>
        <input id="mn-v-projid" placeholder="Enter project DB id…" value="${v.maintenance_project_id||''}">
        <label>Visit Ref (auto)</label>
        <input id="mn-v-ref" value="${esc(v.visit_ref||'')}" readonly style="background:#f5f5f5">
      </div>
      <div class="form-row">
        <label>Year *</label><input type="number" id="mn-v-yr" value="${v.visit_year||new Date().getFullYear()}">
        <label>Month *</label>
        <select id="mn-v-mo">
          ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m,i)=>
            `<option value="${i+1}" ${(v.visit_month||new Date().getMonth()+1)==i+1?'selected':''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label>Visit Type</label>
        <select id="mn-v-type">
          ${MN_VISIT_TYPES.map(t=>`<option value="${t}" ${v.visit_type===t?'selected':''}>${t}</option>`).join('')}
        </select>
        <label>Lift No.</label>
        <input id="mn-v-lift" value="${esc(v.lift_no||'')}">
      </div>
      <div class="form-row">
        <label>Scheduled Date</label><input type="date" id="mn-v-sched" value="${v.scheduled_date||''}">
        <label>Actual Date</label><input type="date" id="mn-v-actual" value="${v.actual_date||''}">
      </div>
      <div class="form-row">
        <label>Visit Status</label>
        <select id="mn-v-status">
          ${MN_VISIT_STATUSES.map(s=>`<option value="${s}" ${(v.visit_status||'Pending')===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <label>Checklist Completed</label>
        <select id="mn-v-checklist">
          <option value="0" ${!v.checklist_completed?'selected':''}>No</option>
          <option value="1" ${v.checklist_completed?'selected':''}>Yes</option>
        </select>
      </div>
      <div class="form-row">
        <label>Technicians</label>
        <input id="mn-v-techs" value="${esc(v.technicians||'')}">
        <label>Client Signature / Confirmation</label>
        <input id="mn-v-sig" value="${esc(v.client_signature||'')}">
      </div>
      <div class="form-row">
        <label>Total Units</label><input type="number" id="mn-v-total" value="${v.total_elevator_units||''}">
        <label>Units Serviced</label><input type="number" id="mn-v-serviced" value="${v.units_serviced||''}">
        <label>Units Not Serviced</label><input type="number" id="mn-v-not" value="${v.units_not_serviced||''}">
      </div>
      <div class="form-row"><label>Unserviced Reason</label><input id="mn-v-unsvc" value="${esc(v.unserviced_reason||'')}"></div>
      <div class="form-row"><label>Work Performed</label><textarea id="mn-v-work" rows="2">${esc(v.work_performed||'')}</textarea></div>
      <div class="form-row"><label>Findings</label><textarea id="mn-v-findings" rows="2">${esc(v.findings||'')}</textarea></div>
      <div class="form-row"><label>Parts Replaced</label><input id="mn-v-parts" value="${esc(v.parts_replaced||'')}"></div>
      <div class="form-row"><label>Spare Parts Used</label><textarea id="mn-v-spare" rows="2">${esc(v.spare_parts_used||'')}</textarea></div>
      <div class="form-row"><label>Pending Issues</label><textarea id="mn-v-pending" rows="2">${esc(v.pending_issues||'')}</textarea></div>
      <div class="form-row">
        <label>Postponed Date</label><input type="date" id="mn-v-postdate" value="${v.postponed_date||''}">
        <label>Postponement Reason</label><input id="mn-v-postreason" value="${esc(v.postponement_reason||'')}">
      </div>
      <div class="form-row">
        <label>Missed Reason</label><input id="mn-v-missed" value="${esc(v.missed_reason||'')}">
        <label>Cancellation Reason</label><input id="mn-v-cancelreason" value="${esc(v.cancellation_reason||'')}">
      </div>
      <div class="form-row"><label>Remarks</label><textarea id="mn-v-remarks" rows="2">${esc(v.remarks||'')}</textarea></div>
      ${!isNew ? `<button class="btn-danger" id="mn-v-del" style="margin-top:8px;cursor:pointer">Delete Visit</button>` : ''}
    </div>`,
    [{
      label: isNew ? 'Log Visit' : 'Save Visit',
      primary: true,
      onClick: async () => {
        const body = {
          maintenance_project_id: document.getElementById('mn-v-projid').value,
          visit_year:    parseInt(document.getElementById('mn-v-yr').value),
          visit_month:   parseInt(document.getElementById('mn-v-mo').value),
          visit_type:    document.getElementById('mn-v-type').value,
          lift_no:       document.getElementById('mn-v-lift').value.trim(),
          scheduled_date: document.getElementById('mn-v-sched').value || null,
          actual_date:    document.getElementById('mn-v-actual').value || null,
          visit_status:   document.getElementById('mn-v-status').value,
          checklist_completed: document.getElementById('mn-v-checklist').value === '1' ? 1 : 0,
          technicians:    document.getElementById('mn-v-techs').value.trim(),
          client_signature: document.getElementById('mn-v-sig').value.trim(),
          total_elevator_units: document.getElementById('mn-v-total').value || null,
          units_serviced:      document.getElementById('mn-v-serviced').value || null,
          units_not_serviced:  document.getElementById('mn-v-not').value || null,
          unserviced_reason:   document.getElementById('mn-v-unsvc').value.trim(),
          work_performed:      document.getElementById('mn-v-work').value.trim(),
          findings:            document.getElementById('mn-v-findings').value.trim(),
          parts_replaced:      document.getElementById('mn-v-parts').value.trim(),
          spare_parts_used:    document.getElementById('mn-v-spare').value.trim(),
          pending_issues:      document.getElementById('mn-v-pending').value.trim(),
          postponed_date:      document.getElementById('mn-v-postdate').value || null,
          postponement_reason: document.getElementById('mn-v-postreason').value.trim(),
          missed_reason:       document.getElementById('mn-v-missed').value.trim(),
          cancellation_reason: document.getElementById('mn-v-cancelreason').value.trim(),
          remarks:             document.getElementById('mn-v-remarks').value.trim()
        };
        if (!body.maintenance_project_id || !body.visit_year || !body.visit_month)
          return showToast('Project ID, year, and month are required', 'error');
        try {
          if (isNew) await API.post('/api/maintenance/visits', body);
          else       await API.put(`/api/maintenance/visits/${visitId}`, body);
          showToast(isNew ? 'Visit logged' : 'Saved');
          closeModal();
          mnRenderVisits(view);
        } catch(e) {
          showToast(e.message || 'Error saving visit', 'error');
        }
      }
    }]
  );
  const delBtn = document.getElementById('mn-v-del');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      if (!confirm('Delete this visit record?')) return;
      try {
        await API.delete(`/api/maintenance/visits/${visitId}`);
        showToast('Deleted');
        closeModal();
        mnRenderVisits(view);
      } catch(e) {
        showToast(e.message || 'Error deleting visit', 'error');
      }
    });
  }
}

// =============================================================================
// TAB 3: CANCELLED AMC
// =============================================================================
async function mnRenderCancelled(view) {
  const st = MN_STATE.cancelled;
  const qs = new URLSearchParams({ search:st.search, page:st.page, limit:50 });

  let data;
  try {
    data = await API.get(`/api/maintenance/cancelled?${qs}`);
  } catch(e) {
    view.innerHTML = `<div style="padding:24px;color:#c0392b">
      Unable to load cancelled contracts. Please refresh the page and try again.
    </div>`;
    return;
  }

  view.innerHTML = `
    <div class="toolbar">
      <input type="text" id="mn-can-search" placeholder="Search…" value="${esc(st.search)}" style="width:220px">
      <button class="btn-secondary" id="mn-can-go" style="cursor:pointer">Search</button>
    </div>
    <div class="meta">${data.total} cancelled AMC contracts</div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>MNT ID</th><th>Client</th><th>Contract Ref</th><th>Type</th>
          <th>Start</th><th>End</th><th>Cancellation Date</th><th>Reason</th><th>Technician</th>
        </tr></thead>
        <tbody>${data.rows.map(r=>`<tr>
          <td>${esc(r.maintenance_id)}</td>
          <td>${esc(r.client_name||'—')}</td>
          <td>${esc(r.contract_ref||'—')}</td>
          <td style="font-size:11px">${esc(r.maintenance_type||'—')}</td>
          <td>${esc(r.start_date||'—')}</td>
          <td>${esc(r.end_date||'—')}</td>
          <td>${esc(r.cancellation_date||'—')}</td>
          <td>${esc(r.cancellation_reason||'—')}</td>
          <td>${esc(r.assigned_technician||'—')}</td>
        </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${mnPager('mn-can', data.total, st.page, 50)}`;

  document.getElementById('mn-can-go').addEventListener('click', () => {
    st.search = document.getElementById('mn-can-search').value;
    st.page = 1;
    mnRenderCancelled(view);
  });
  document.getElementById('mn-can-search').addEventListener('keydown', e => {
    if (e.key === 'Enter') { st.search = e.target.value; st.page = 1; mnRenderCancelled(view); }
  });
  mnBindPager('mn-can', st, () => mnRenderCancelled(view));
}

// =============================================================================
// TAB 4: MAINTENANCE DASHBOARD
// =============================================================================
async function mnRenderDashboard(view) {
  let d;
  try {
    d = await API.get('/api/maintenance/dashboard');
  } catch(e) {
    view.innerHTML = `<div style="padding:24px;color:#c0392b">
      Unable to load dashboard. Please refresh the page and try again.
    </div>`;
    return;
  }
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const curMonthLabel = `${MONTH_NAMES[d.current_month-1]} ${d.current_year}`;

  view.innerHTML = `
    <h3>Maintenance Overview</h3>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="num">${d.total}</div><div class="label">Total Projects</div></div>
      <div class="kpi-card good"><div class="num">${d.active}</div><div class="label">Active</div></div>
      <div class="kpi-card warn"><div class="num">${d.under_renewal}</div><div class="label">Under Renewal</div></div>
      <div class="kpi-card warn"><div class="num">${d.on_hold}</div><div class="label">On Hold</div></div>
      <div class="kpi-card"><div class="num">${d.cancelled}</div><div class="label">Cancelled</div></div>
      ${d.needs_review > 0 ? `<div class="kpi-card warn"><div class="num">${d.needs_review}</div><div class="label">Needs Review</div></div>` : ''}
    </div>

    <h3>Visits — ${curMonthLabel}</h3>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="num">${d.visits_this_month}</div><div class="label">Total Visits</div></div>
      <div class="kpi-card good"><div class="num">${d.completed_this_month}</div><div class="label">Completed</div></div>
      <div class="kpi-card"><div class="num">${d.pending_this_month}</div><div class="label">Pending / Scheduled</div></div>
      <div class="kpi-card warn"><div class="num">${d.missed_this_month}</div><div class="label">Missed</div></div>
      <div class="kpi-card"><div class="num">${d.cancelled_visits_this_month}</div><div class="label">Cancelled Visits</div></div>
    </div>

    ${d.expiring_soon.length ? `
    <div class="panel">
      <h3>Expiring Within 60 Days</h3>
      <table class="data-table"><thead><tr>
        <th>MNT ID</th><th>Client</th><th>Contract</th><th>End Date</th><th>Status</th>
      </tr></thead><tbody>
        ${d.expiring_soon.map(r=>`<tr>
          <td>${esc(r.maintenance_id)}</td>
          <td>${esc(r.client_name||'—')}</td>
          <td>${esc(r.contract_ref||'—')}</td>
          <td><strong>${esc(r.end_date)}</strong></td>
          <td>${mnBadge(r.maintenance_status, MN_STATUS_COLORS[r.maintenance_status])}</td>
        </tr>`).join('')}
      </tbody></table>
    </div>` : ''}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
      <div class="panel">
        <h4>By Maintenance Type</h4>
        ${d.by_type.map(r=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #eee">
          <span style="font-size:12px">${esc(r.maintenance_type||'Unknown')}</span>
          <strong>${r.c}</strong>
        </div>`).join('')}
      </div>
      <div class="panel">
        <h4>By Emirate</h4>
        ${d.by_emirate.map(r=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #eee">
          <span>${esc(r.emirate)}</span>
          <strong>${r.c}</strong>
        </div>`).join('')}
      </div>
    </div>`;
}
