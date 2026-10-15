// ══════════════════════════════════════════════════════════════════════════════
// SALES FOLLOW-UP + IMPORTANT NOTES (2026-10-01)
// Sales Quotations module → [ Sales Quotations ] [ Sales Follow-Up ]   [📝 Notes]
// Follow-Up works on top of existing quotations (Quote Ref. is the link); each
// follow-up is a new history row. Notes are personal reminders, separate from
// the formal follow-up history.
// ══════════════════════════════════════════════════════════════════════════════
const SFState = { page: 1, pageSize: 50, filters: {}, data: null };
const SF_ALERT_STYLE = {
  'Overdue': 'background:#fde6e3;color:#b03a2e', 'Due Today': 'background:#fff1d6;color:#9a5b00',
  'Upcoming': 'background:#e3f0fb;color:#1c5a96', 'No Follow-Up': 'background:#f1f3f5;color:#5b6573',
  'Not Scheduled': 'background:#f6f1fb;color:#6b46a0', 'Completed': 'background:#e8f5ef;color:#1f7a5c',
};
const sfAlertBadge = a => `<span class="badge" style="${SF_ALERT_STYLE[a] || ''};white-space:nowrap">${esc(a)}</span>`;
const sfDate = d => d ? fmtDateDMY(String(d).slice(0, 10)) : '';
const sfToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function sfWaNumber(m) {                      // UAE mobile 05x-xxxxxxx → 9715xxxxxxxx (opens chat only; never sends)
  const d = String(m || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith('971')) return d;
  if (d.startsWith('0')) return '971' + d.slice(1);
  return d;
}
// "My Quotations" — offered when the signed-in username matches a salesperson code (e.g. user "SY")
const sfMyCode = () => { const u = String((APP.user && APP.user.username) || '').toUpperCase(); return SALESPERSON_OPTS.includes(u) ? u : null; };

// ── Module shell: tab bar + Notes button ─────────────────────────────────────
async function renderQuotations(root) {
  QuotationsState.view = QuotationsState.view || 'register';
  root.innerHTML = `
    <div style="display:flex;align-items:stretch;border-bottom:1px solid var(--border,#dde3ec);margin-bottom:10px;background:#fff">
      <div class="tab ${QuotationsState.view === 'register' ? 'active' : ''}" data-qview="register" style="cursor:pointer">Sales Quotations</div>
      <div class="tab ${QuotationsState.view === 'followup' ? 'active' : ''}" data-qview="followup" style="cursor:pointer">Sales Follow-Up</div>
      <div style="flex:1"></div>
      <button class="btn secondary small" id="sf-notes-btn" style="margin:6px 4px" title="Important Notes — personal reminders">📝 Notes <span id="sf-notes-badge" class="badge" style="display:none;background:#c0392b;color:#fff;margin-left:2px"></span></button>
    </div>
    <div id="q-module-body"></div>`;
  root.querySelectorAll('[data-qview]').forEach(t => t.addEventListener('click', () => { QuotationsState.view = t.dataset.qview; renderQuotations(root); }));
  document.getElementById('sf-notes-btn').addEventListener('click', () => sfOpenNotes());
  sfRefreshNotesBadge();
  const body = document.getElementById('q-module-body');
  if (QuotationsState.view === 'followup') await renderSalesFollowUp(body);
  else await renderQuotationsRegister(body);
}

// ── Sales Follow-Up tab ──────────────────────────────────────────────────────
async function renderSalesFollowUp(root) {
  const f = SFState.filters;
  if (f.salesperson === undefined) f.salesperson = sfMyCode() || '';
  const yearOpts = ['2026', '2025', '2024', '2023'].map(y => `<option ${f.year === y ? 'selected' : ''}>${y}</option>`).join('');
  const monthOpts = MONTH_LABELS.map((m, i) => { const v = String(i + 1).padStart(2, '0'); return `<option value="${v}" ${f.month === v ? 'selected' : ''}>${m}</option>`; }).join('');
  root.innerHTML = `
    <div id="sf-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px"></div>
    <div class="toolbar" style="flex-wrap:wrap;gap:6px">
      <input type="text" id="sf-search" placeholder="Search quote ref, client, project, contact, mobile, tel, e-mail…" value="${esc(f.search || '')}" style="min-width:260px">
      <select id="sf-salesperson"><option value="">All Salespeople</option>${sfMyCode() ? `<option value="${sfMyCode()}">My Quotations (${sfMyCode()})</option>` : ''}
        ${SALESPERSON_OPTS.map(s => `<option ${f.salesperson === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select id="sf-status"><option value="">All Status</option>${QUOTATION_STATUS_CONFIG.map(s => `<option value="${s.value}" ${f.status === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
      <select id="sf-alert"><option value="">All Follow-Up Alerts</option>${Object.keys(SF_ALERT_STYLE).map(a => `<option ${f.alert === a ? 'selected' : ''}>${a}</option>`).join('')}</select>
      <select id="sf-year"><option value="">All Years</option>${yearOpts}</select>
      <select id="sf-month"><option value="">All Months</option>${monthOpts}</select>
      <select id="sf-sort">
        <option value="">Sort: Priority (Overdue first)</option>
        ${[['next_followup', 'Next Follow-Up'], ['last_followup', 'Last Follow-Up'], ['quotation_date', 'Quotation Date'], ['quote_ref', 'Quote Ref.'], ['client_name', 'Client']]
          .map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>Sort: ${l}</option>`).join('')}
      </select>
      <select id="sf-dir"><option value="asc" ${f.dir !== 'desc' ? 'selected' : ''}>Asc</option><option value="desc" ${f.dir === 'desc' ? 'selected' : ''}>Desc</option></select>
      <div class="spacer"></div>
      <button class="btn small" id="sf-xlsx">⬇ Excel</button><button class="btn small" id="sf-pdf">⬇ PDF</button><button class="btn small secondary" id="sf-print">🖨 Print</button>
    </div>
    <div class="table-wrap" id="sf-table-wrap" style="overflow-x:auto"><div class="loading-state">Loading…</div></div>
    <div class="pagination" id="sf-pagination"></div>`;
  const reload = () => { SFState.page = 1; sfLoad(); };
  document.getElementById('sf-search').addEventListener('input', debounce(e => { f.search = e.target.value; reload(); }, 350));
  [['sf-salesperson', 'salesperson'], ['sf-status', 'status'], ['sf-alert', 'alert'], ['sf-year', 'year'], ['sf-month', 'month'], ['sf-sort', 'sort'], ['sf-dir', 'dir']]
    .forEach(([id, k]) => document.getElementById(id).addEventListener('change', e => { f[k] = e.target.value; reload(); }));
  if (f.salesperson) document.getElementById('sf-salesperson').value = f.salesperson;
  const qs = (extra = {}) => { const p = new URLSearchParams(); Object.entries({ ...f, ...extra }).forEach(([k, v]) => { if (v) p.set(k, v); }); return p.toString(); };
  document.getElementById('sf-xlsx').addEventListener('click', () => window.open(`/api/sales-followup/export.xlsx?${qs()}`, '_blank'));
  document.getElementById('sf-pdf').addEventListener('click', () => window.open(`/api/sales-followup/export.pdf?${qs()}`, '_blank'));
  document.getElementById('sf-print').addEventListener('click', sfPrint);
  await sfLoad();
}

async function sfLoad() {
  const wrap = document.getElementById('sf-table-wrap');
  if (!wrap) return;
  const p = new URLSearchParams({ page: SFState.page, pageSize: SFState.pageSize });
  Object.entries(SFState.filters).forEach(([k, v]) => { if (v) p.set(k, v); });
  let d;
  try { d = await API.get('/api/sales-followup?' + p.toString()); }
  catch (e) {
    console.error('[Sales Follow-Up] load failed', e);
    wrap.innerHTML = `<div class="empty-state" style="color:#c0392b">Unable to load Sales Follow-Up.<div style="margin-top:8px"><button class="btn secondary small" id="sf-retry">Retry</button></div></div>`;
    document.getElementById('sf-retry').addEventListener('click', sfLoad);
    return;
  }
  SFState.data = d;
  const k = d.kpis;
  const card = (label, val, alert, tone) => `<div class="sf-kpi" data-alert="${alert || ''}" style="background:#fff;border:1px solid var(--border,#dde3ec);border-left:3px solid ${tone};border-radius:8px;padding:8px 12px;${alert !== null ? 'cursor:pointer' : ''}" title="${alert ? 'Click to filter' : ''}">
      <div style="font-size:10.5px;color:#667;text-transform:uppercase;letter-spacing:.04em">${label}</div><div style="font-size:20px;font-weight:700;color:${tone}">${val}</div></div>`;
  document.getElementById('sf-kpis').innerHTML = card('Open Quotations', k.open, '', '#2563ad') + card('Follow-Up Due Today', k.due_today, 'Due Today', '#d97706')
    + card('Overdue Follow-Ups', k.overdue, 'Overdue', '#c0392b') + card('No Follow-Up Yet', k.no_followup, 'No Follow-Up', '#5b6573')
    + card('Negotiation', k.negotiation, null, '#7c3aed') + card('Approved This Month', k.approved_this_month, null, '#1e8449');
  document.querySelectorAll('.sf-kpi[data-alert]').forEach(c => { if (c.dataset.alert === '' && c.textContent.includes('Open')) c.addEventListener('click', () => { SFState.filters.alert = ''; document.getElementById('sf-alert').value = ''; SFState.page = 1; sfLoad(); });
    else if (c.dataset.alert) c.addEventListener('click', () => { SFState.filters.alert = c.dataset.alert; document.getElementById('sf-alert').value = c.dataset.alert; SFState.page = 1; sfLoad(); }); });

  if (!d.rows.length) { wrap.innerHTML = '<div class="empty-state">No quotations found for the selected filters.</div>'; document.getElementById('sf-pagination').innerHTML = ''; return; }
  const ell = (t, w) => `<div style="max-width:${w}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(t || '')}">${esc(t || '')}</div>`;
  wrap.innerHTML = `<table class="data-table" style="font-size:12.5px;table-layout:auto;min-width:1500px">
    <thead><tr><th>Quote Ref.</th><th>Client / Company</th><th>Project Details</th><th>Attention</th><th>Mobile</th><th>Tel No.</th><th>E-mail</th>
      <th>Sales</th><th>Quotation Date</th><th>Last Follow-Up</th><th>Next Follow-Up</th><th>Status</th><th>Remarks</th><th>Action</th></tr></thead>
    <tbody>${d.rows.map(r => `<tr>
      <td style="font-weight:600;white-space:nowrap">${esc(r.quote_ref || '')}</td>
      <td>${ell(r.client_name, 230)}</td>
      <td>${ell(r.project_name, 320)}</td>
      <td>${ell(r.attn_name, 140)}</td>
      <td style="white-space:nowrap">${r.mobile ? `<a href="tel:${esc(String(r.mobile).replace(/[^\d+]/g, ''))}">${esc(r.mobile)}</a>` : ''}</td>
      <td style="white-space:nowrap">${r.phone ? `<a href="tel:${esc(String(r.phone).replace(/[^\d+]/g, ''))}">${esc(r.phone)}</a>` : ''}</td>
      <td>${r.email ? `<div style="max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><a href="mailto:${esc(r.email)}" title="${esc(r.email)}">${esc(r.email)}</a></div>` : ''}</td>
      <td>${esc(r.salesperson || '')}</td>
      <td style="white-space:nowrap">${sfDate(r.quotation_date)}</td>
      <td style="white-space:nowrap" title="${r.days_since_followup != null ? r.days_since_followup + ' day(s) since last follow-up' : 'No follow-up recorded'}">${sfDate(r.last_followup)}${r.days_since_followup != null ? `<div style="font-size:10.5px;color:#889">${r.days_since_followup}d ago</div>` : ''}</td>
      <td style="white-space:nowrap">${sfDate(r.next_followup)}<div>${sfAlertBadge(r.alert)}</div></td>
      <td>${badge(quotStatusLabel(r.status))}</td>
      <td>${ell(r.last_remarks || '', 220)}</td>
      <td style="white-space:nowrap">
        <button class="btn small sf-fu" data-id="${r.id}">Follow Up</button>
        ${r.mobile ? `<a class="btn small secondary" style="padding:2px 6px" title="WhatsApp (opens chat — nothing is sent automatically)" target="_blank" rel="noopener" href="https://wa.me/${sfWaNumber(r.mobile)}">💬</a>` : ''}
        ${r.email ? `<a class="btn small secondary" style="padding:2px 6px" title="E-mail" href="mailto:${esc(r.email)}">✉</a>` : ''}
      </td></tr>`).join('')}</tbody></table>`;
  wrap.querySelectorAll('.sf-fu').forEach(b => b.addEventListener('click', () => sfOpenFollowUp(b.dataset.id)));
  const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
  document.getElementById('sf-pagination').innerHTML = `<button class="btn small secondary" id="sf-prev" ${SFState.page <= 1 ? 'disabled' : ''}>Prev</button>
    <span>Page ${d.page} of ${pages} — ${d.total} quotation(s)</span><button class="btn small secondary" id="sf-next" ${SFState.page >= pages ? 'disabled' : ''}>Next</button>`;
  document.getElementById('sf-prev')?.addEventListener('click', () => { SFState.page--; sfLoad(); });
  document.getElementById('sf-next')?.addEventListener('click', () => { SFState.page++; sfLoad(); });
}

async function sfPrint() {
  const p = new URLSearchParams({ page: 1, pageSize: 9999 });
  Object.entries(SFState.filters).forEach(([k, v]) => { if (v) p.set(k, v); });
  try {
    const d = await API.get('/api/sales-followup?' + p.toString());
    const cols = ['Quote Ref.', 'Client', 'Project', 'Attention', 'Mobile', 'Tel', 'Sales', 'Quot. Date', 'Last F/U', 'Next F/U', 'Alert', 'Status', 'Latest Remarks'];
    const k = d.kpis;
    const html = `<table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:9pt"><tr>${[['Open Quotations', k.open], ['Due Today', k.due_today], ['Overdue', k.overdue], ['No Follow-Up Yet', k.no_followup], ['Negotiation', k.negotiation], ['Approved This Month', k.approved_this_month]]
        .map(([l, v]) => `<td style="border:1px solid #cfd8e3;padding:5px 8px"><div style="font-size:7.5pt;color:#556">${l}</div><b style="font-size:12pt">${v}</b></td>`).join('')}</tr></table>
      ${d.rows.length ? `<table class="sh-print-table" style="font-size:7.8pt"><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${d.rows.map((r, i) => `<tr${i % 2 ? ' class="sh-print-alt"' : ''}>
        ${[r.quote_ref, r.client_name, r.project_name, r.attn_name, r.mobile, r.phone, r.salesperson, sfDate(r.quotation_date), sfDate(r.last_followup), sfDate(r.next_followup), r.alert, quotStatusLabel(r.status), r.last_remarks]
          .map(v => `<td style="white-space:normal">${esc(v || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p class="sh-print-empty">No quotations found for the selected filters.</p>'}`;
    const flt = {}; Object.entries(SFState.filters).forEach(([kk, v]) => { if (v) flt[kk] = kk === 'status' ? quotStatusLabel(v) : v; });
    shPrint({ title: 'Sales Follow-Up Register', subtitle: 'Weekly sales follow-up review', contentHtml: html, landscape: true, filters: flt });
  } catch (e) { toast('Print failed: ' + e.message, true); }
}

// ── Follow-Up modal: summary + add form + full history ───────────────────────
async function sfOpenFollowUp(quotationId, order = 'desc') {
  let d;
  try { d = await API.get(`/api/sales-followup/${quotationId}/history?order=${order}`); } catch (e) { return toast(e.message || 'Unable to load follow-up history', true); }
  const q = d.quotation, s = d.summary, today = sfToday();
  const opt = (arr, sel) => arr.map(v => Array.isArray(v) ? `<option value="${v[0]}" ${v[0] === sel ? 'selected' : ''}>${v[1]}</option>` : `<option ${v === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const reqId = 'fu-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  openModal(`
    <h3 style="margin:0 0 6px">Sales Follow-Up — Quote ${esc(q.quote_ref)}</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:6px 16px;background:#f7f9fc;border:1px solid #e3e8ef;border-radius:6px;padding:8px 12px;font-size:12.5px;margin-bottom:10px">
      <div><span style="color:#778">Client</span><br><b>${esc(q.client_name || '')}</b></div>
      <div style="grid-column:span 2"><span style="color:#778">Project</span><br>${esc(q.project_name || '')}</div>
      <div><span style="color:#778">Contact Person</span><br>${esc(q.attn_name || '')}</div>
      <div><span style="color:#778">Mobile / Tel / E-mail</span><br>${[q.mobile, q.phone, q.email].filter(Boolean).map(esc).join(' · ')}</div>
      <div><span style="color:#778">Salesperson · Quotation Date</span><br>${esc(q.salesperson || '')} · ${sfDate(q.quotation_date)}</div>
      <div><span style="color:#778">Status</span><br>${badge(q.status_label)}</div>
      <div><span style="color:#778">Last / Next Follow-Up</span><br>${sfDate(s.last_followup) || '—'} / ${sfDate(s.next_followup) || '—'} ${sfAlertBadge(s.alert)}</div>
    </div>
    ${d.can_write ? `<form id="sf-form" style="border:1px solid #e3e8ef;border-radius:6px;padding:10px 12px;margin-bottom:12px">
      <div style="font-weight:700;color:#0f2d5e;font-size:13px;margin-bottom:6px">ADD SALES FOLLOW-UP</div>
      <div class="form-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="form-field"><label>Follow-Up Date *</label><input type="date" name="followup_date" value="${today}" max="${today}" required></div>
        <div class="form-field"><label>Follow-Up Method *</label><select name="method" required>${opt(d.options.methods, 'Phone Call')}</select></div>
        <div class="form-field"><label>Follow-Up Result *</label><select name="result" required>${opt(d.options.results, 'Contacted')}</select></div>
        <div class="form-field"><label>Quotation Status ${d.can_edit_status ? '' : '(view only)'}</label><select name="quotation_status" ${d.can_edit_status ? '' : 'disabled'}>${opt(d.options.statuses, q.status)}</select>
          <div style="font-size:10.5px;color:#889">Changes only if you select a different status</div></div>
        <div class="form-field"><label>Next Follow-Up Date</label><input type="date" name="next_followup_date" min="${today}"></div>
        <div class="form-field"></div>
        <div class="form-field span2" style="grid-column:1/-1"><label>Remarks *</label><textarea name="remarks" rows="2" required placeholder="e.g. Client reviewing proposal; asked for revised price…"></textarea></div>
      </div>
      <details style="margin-top:4px;font-size:12px"><summary style="cursor:pointer;color:#2563ad">Contact details changed?</summary>
        <div class="form-grid" style="grid-template-columns:repeat(4,1fr);margin-top:6px">
          <div class="form-field"><label>Attention</label><input name="c_attn_name" value="${esc(q.attn_name || '')}"></div>
          <div class="form-field"><label>Mobile</label><input name="c_mobile" value="${esc(q.mobile || '')}"></div>
          <div class="form-field"><label>Tel No.</label><input name="c_phone" value="${esc(q.phone || '')}"></div>
          <div class="form-field"><label>E-mail</label><input name="c_email" value="${esc(q.email || '')}"></div>
        </div></details>
      <div class="modal-actions"><div class="spacer"></div><button type="button" class="btn secondary" onclick="closeModal()">Cancel</button><button type="submit" class="btn" id="sf-save">Save Follow-Up</button></div>
    </form>` : '<div style="font-size:12px;color:#889;margin-bottom:8px">Your role can view follow-ups but not record them.</div>'}
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <div style="font-weight:700;color:#0f2d5e;font-size:13px">FOLLOW-UP HISTORY (${s.count})</div>
      <button class="btn small secondary" id="sf-order">${order === 'desc' ? 'Show oldest first' : 'Show newest first'}</button>
      <div style="flex:1"></div>
      <a class="btn small secondary" href="/api/sales-followup/export.xlsx?quotation_id=${q.id}" target="_blank">⬇ Excel</a>
      <a class="btn small secondary" href="/api/sales-followup/export.pdf?quotation_id=${q.id}" target="_blank">⬇ PDF</a>
    </div>
    <div style="max-height:38vh;overflow:auto">${d.history.length ? `<table class="data-table" style="font-size:12.5px"><thead><tr><th>Date</th><th>Method</th><th>Result</th><th>Status</th><th>Next Follow-Up</th><th>Remarks</th><th>Entered By</th><th></th></tr></thead>
      <tbody>${d.history.map(h => `<tr style="${h.is_void ? 'opacity:.55;text-decoration:line-through' : ''}">
        <td style="white-space:nowrap">${sfDate(h.followup_date)}</td><td>${esc(h.method)}</td><td>${esc(h.result)}</td>
        <td>${h.quotation_status_label ? badge(h.quotation_status_label) : ''}${h.status_changed_from ? `<div style="font-size:10px;color:#889">changed</div>` : ''}</td>
        <td style="white-space:nowrap">${sfDate(h.next_followup_date)}</td><td style="white-space:pre-wrap;min-width:220px">${esc(h.remarks)}${h.updated_by ? `<div style="font-size:10px;color:#889">edited by ${esc(h.updated_by)}</div>` : ''}${h.is_void ? `<div style="font-size:10px;color:#b03a2e;text-decoration:none">voided: ${esc(h.void_reason || '')}</div>` : ''}</td>
        <td>${esc(h.entered_by || '')}</td>
        <td style="white-space:nowrap">${!h.is_void && d.can_write && (d.is_admin || h.entered_by === d.me) ? `<button class="btn small secondary sf-edit" data-id="${h.id}">Edit</button> <button class="btn small danger sf-void" data-id="${h.id}">Void</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty-state">No follow-up recorded yet.</div>'}</div>
    <div style="text-align:right;margin-top:10px"><button class="btn secondary" onclick="closeModal()">Close</button></div>`, { wide: true });

  document.getElementById('sf-order').addEventListener('click', () => sfOpenFollowUp(quotationId, order === 'desc' ? 'asc' : 'desc'));
  const form = document.getElementById('sf-form');
  if (form) form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('sf-save');
    if (btn.disabled) return;
    btn.disabled = true; btn.textContent = 'Saving…';                       // double-click protection
    const fd = new FormData(form);
    const body = { followup_date: fd.get('followup_date'), method: fd.get('method'), result: fd.get('result'),
      quotation_status: fd.get('quotation_status') || q.status, next_followup_date: fd.get('next_followup_date') || null,
      remarks: fd.get('remarks'), client_request_id: reqId,
      contact: { attn_name: fd.get('c_attn_name'), mobile: fd.get('c_mobile'), phone: fd.get('c_phone'), email: fd.get('c_email') } };
    if (body.quotation_status === 'lost' && body.quotation_status !== q.status && !confirm('Mark this quotation as LOST? Make sure the reason is in Remarks.')) { btn.disabled = false; btn.textContent = 'Save Follow-Up'; return; }
    try {
      await API.post(`/api/sales-followup/${q.id}`, body);
      toast('Follow-up saved');
      await sfOpenFollowUp(quotationId, order);
      sfLoad();
    } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = 'Save Follow-Up'; }
  });
  document.querySelectorAll('.sf-void').forEach(b => b.addEventListener('click', async () => {
    const reason = prompt('Reason for voiding this follow-up (it stays in history as voided):');
    if (!reason || !reason.trim()) return;
    try { await API.post(`/api/sales-followup/entry/${b.dataset.id}/void`, { reason }); toast('Follow-up voided'); await sfOpenFollowUp(quotationId, order); sfLoad(); }
    catch (err) { toast(err.message, true); }
  }));
  document.querySelectorAll('.sf-edit').forEach(b => b.addEventListener('click', () => {
    const h = d.history.find(x => String(x.id) === b.dataset.id);
    const tr = b.closest('tr');
    tr.innerHTML = `<td colspan="8"><div class="form-grid" style="grid-template-columns:repeat(5,1fr);gap:6px">
        <input type="date" class="e-date" value="${h.followup_date}" max="${today}">
        <select class="e-method">${opt(d.options.methods, h.method)}</select>
        <select class="e-result">${opt(d.options.results, h.result)}</select>
        <input type="date" class="e-next" value="${h.next_followup_date || ''}">
        <input class="e-reason" placeholder="Reason for correction *">
        <textarea class="e-remarks" rows="2" style="grid-column:1/-1">${esc(h.remarks)}</textarea></div>
        <div style="text-align:right;margin-top:4px"><button class="btn small secondary e-cancel">Cancel</button> <button class="btn small e-save">Save Correction</button></div></td>`;
    tr.querySelector('.e-cancel').addEventListener('click', () => sfOpenFollowUp(quotationId, order));
    tr.querySelector('.e-save').addEventListener('click', async ev => {
      ev.target.disabled = true;
      try {
        await API.patch(`/api/sales-followup/entry/${h.id}`, { followup_date: tr.querySelector('.e-date').value, method: tr.querySelector('.e-method').value,
          result: tr.querySelector('.e-result').value, next_followup_date: tr.querySelector('.e-next').value || null,
          remarks: tr.querySelector('.e-remarks').value, edit_reason: tr.querySelector('.e-reason').value });
        toast('Follow-up corrected'); await sfOpenFollowUp(quotationId, order); sfLoad();
      } catch (err) { toast(err.message, true); ev.target.disabled = false; }
    });
  }));
}

// ── Important Notes — right-side slide-out panel ─────────────────────────────
const SFNotes = { view: 'active', scope: 'mine' };
async function sfRefreshNotesBadge() {
  try {
    const d = await API.get('/api/sales-followup/notes?view=active');
    const b = document.getElementById('sf-notes-badge');
    if (b) { b.textContent = d.badge; b.style.display = d.badge ? 'inline-block' : 'none'; }
  } catch (_) { /* badge is optional */ }
}
function sfCloseNotes() { document.getElementById('sf-notes-panel')?.remove(); }
async function sfOpenNotes() {
  sfCloseNotes();
  const panel = document.createElement('div');
  panel.id = 'sf-notes-panel';
  panel.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:380px;max-width:95vw;background:#fff;box-shadow:-8px 0 28px rgba(0,0,0,.18);z-index:9000;display:flex;flex-direction:column';
  document.body.appendChild(panel);
  const pri = { High: 'background:#fde6e3;color:#b03a2e', Normal: 'background:#e3f0fb;color:#1c5a96', Low: 'background:#f1f3f5;color:#5b6573' };
  const draw = async () => {
    let d;
    try { d = await API.get(`/api/sales-followup/notes?view=${SFNotes.view}&scope=${SFNotes.scope}`); }
    catch (e) { panel.innerHTML = `<div style="padding:16px;color:#c0392b">Unable to load notes. <button class="btn small secondary" id="nt-retry">Retry</button></div>`; panel.querySelector('#nt-retry').onclick = draw; return; }
    const today = d.today;
    panel.innerHTML = `
      <div style="display:flex;align-items:center;padding:12px 14px;border-bottom:1px solid #e3e8ef;background:#f8fafd">
        <b style="font-size:14px;color:#0f2d5e">📝 IMPORTANT NOTES</b><div style="flex:1"></div><button class="btn small secondary" id="nt-close" aria-label="Close">✕</button></div>
      <div style="padding:10px 14px;border-bottom:1px solid #eef1f5">
        <form id="nt-form" style="display:grid;gap:6px">
          <textarea name="note" rows="2" placeholder="Reminder, e.g. Call client 6235 tomorrow" required></textarea>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
            <select name="priority"><option>High</option><option selected>Normal</option><option>Low</option></select>
            <input type="date" name="reminder_date" title="Reminder date">
            <input name="quote_ref" placeholder="Quote Ref. (optional)">
          </div>
          <button class="btn small" type="submit" id="nt-add">+ Add Note</button>
        </form></div>
      <div style="display:flex;gap:6px;padding:8px 14px;align-items:center">
        <button class="btn small ${SFNotes.view === 'active' ? '' : 'secondary'}" data-v="active">Active</button>
        <button class="btn small ${SFNotes.view === 'completed' ? '' : 'secondary'}" data-v="completed">Completed</button>
        ${d.can_team ? `<label style="margin-left:auto;font-size:11.5px"><input type="checkbox" id="nt-team" ${SFNotes.scope === 'team' ? 'checked' : ''}> Team notes</label>` : ''}
      </div>
      <div style="flex:1;overflow:auto;padding:0 14px 14px">${d.rows.length ? d.rows.map(n => `
        <div style="border:1px solid #e3e8ef;border-radius:6px;padding:8px 10px;margin-bottom:6px;${n.is_completed ? 'opacity:.7' : ''}">
          <div style="display:flex;gap:8px;align-items:flex-start">
            <input type="checkbox" class="nt-done" data-id="${n.id}" ${n.is_completed ? 'checked' : ''} title="${n.is_completed ? 'Reopen' : 'Mark complete'}" style="margin-top:3px">
            <div style="flex:1;min-width:0">
              <div style="font-size:12.5px;${n.is_completed ? 'text-decoration:line-through' : ''};white-space:pre-wrap">${esc(n.note)}</div>
              <div style="font-size:11px;color:#778;margin-top:3px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                <span class="badge" style="${pri[n.priority]}">${esc(n.priority)}</span>
                ${n.reminder_date ? `<span style="${!n.is_completed && n.reminder_date < today ? 'color:#b03a2e;font-weight:600' : !n.is_completed && n.reminder_date === today ? 'color:#9a5b00;font-weight:600' : ''}">Due: ${sfDate(n.reminder_date)}</span>` : ''}
                ${n.quote_ref ? `<a href="#" class="nt-quote" data-ref="${esc(n.quote_ref)}">Quote ${esc(n.quote_ref)}</a>` : '<span>General</span>'}
                ${SFNotes.scope === 'team' ? `<span>· ${esc(n.owner)}</span>` : ''}
                ${n.is_completed ? `<span>· completed ${sfDate(String(n.completed_at || '').slice(0, 10))}</span>` : ''}
              </div></div>
            <button class="btn small secondary nt-del" data-id="${n.id}" title="Remove note" style="padding:1px 6px">🗑</button>
          </div></div>`).join('') : `<div class="empty-state">${SFNotes.view === 'active' ? 'No active notes.' : 'No completed notes.'}</div>`}</div>`;
    panel.querySelector('#nt-close').onclick = sfCloseNotes;
    panel.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { SFNotes.view = b.dataset.v; draw(); });
    const team = panel.querySelector('#nt-team'); if (team) team.onchange = () => { SFNotes.scope = team.checked ? 'team' : 'mine'; draw(); };
    panel.querySelector('#nt-form').onsubmit = async e => {
      e.preventDefault();
      const btn = panel.querySelector('#nt-add'); if (btn.disabled) return; btn.disabled = true;
      const fd = new FormData(e.target);
      try { await API.post('/api/sales-followup/notes', { note: fd.get('note'), priority: fd.get('priority'), reminder_date: fd.get('reminder_date') || null, quote_ref: fd.get('quote_ref') || null });
        toast('Note added'); SFNotes.view = 'active'; await draw(); sfRefreshNotesBadge(); }
      catch (err) { toast(err.message, true); btn.disabled = false; }
    };
    panel.querySelectorAll('.nt-done').forEach(c => c.onchange = async () => {
      try { await API.patch(`/api/sales-followup/notes/${c.dataset.id}`, { is_completed: c.checked }); await draw(); sfRefreshNotesBadge(); } catch (err) { toast(err.message, true); }
    });
    panel.querySelectorAll('.nt-del').forEach(b => b.onclick = async () => {
      if (!confirm('Remove this note?')) return;
      try { await API.del(`/api/sales-followup/notes/${b.dataset.id}`); await draw(); sfRefreshNotesBadge(); } catch (err) { toast(err.message, true); }
    });
    panel.querySelectorAll('.nt-quote').forEach(a => a.onclick = async e => {
      e.preventDefault();
      try { const r = await API.get('/api/quotations?quote_ref=' + encodeURIComponent(a.dataset.ref)); if (r.rows && r.rows[0]) sfOpenFollowUp(r.rows[0].id); } catch (_) {}
    });
  };
  await draw();
}
