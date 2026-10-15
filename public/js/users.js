const ROLE_OPTS = ['admin', 'sales', 'accounts', 'coordinator', 'installation', 'viewer'];

async function renderUsers(root) {
  const isAdmin = APP.user && APP.user.role === 'admin';
  root.innerHTML = `
    <div class="toolbar">
      ${isAdmin ? `
        <div class="tab-bar">
          <button class="tab-btn active" data-tab="users">Users</button>
          <button class="tab-btn" data-tab="audit">Audit Log</button>
          <button class="tab-btn" data-tab="sysinfo">System Info</button>
        </div>` : ''}
      <div class="spacer"></div>
      <button class="btn" id="add-user">+ New User</button>
    </div>
    <div id="users-panel">
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Username</th><th>Full Name</th><th>Role</th><th>Active</th><th>Created</th><th></th></tr></thead>
        <tbody id="users-tbody"><tr><td colspan="6">Loading...</td></tr></tbody>
      </table></div>
    </div>
    ${isAdmin ? `<div id="audit-panel" class="hidden"></div><div id="sysinfo-panel" class="hidden"></div>` : ''}
  `;
  document.getElementById('add-user').addEventListener('click', () => openUserModal(null));
  if (isAdmin) {
    root.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
      root.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const t = btn.dataset.tab;
      document.getElementById('users-panel').classList.toggle('hidden', t !== 'users');
      document.getElementById('audit-panel').classList.toggle('hidden', t !== 'audit');
      if (document.getElementById('sysinfo-panel')) document.getElementById('sysinfo-panel').classList.toggle('hidden', t !== 'sysinfo');
      if (t === 'audit') loadAuditLog();
      if (t === 'sysinfo') loadSystemInfo();
    }));
  }
  await loadUsers();
}

async function loadUsers() {
  const data = await API.get('/api/users');
  const me = APP.user ? APP.user.id : null;
  const isAdmin = APP.user && APP.user.role === 'admin';
  document.getElementById('users-tbody').innerHTML = data.rows.map(u => `
    <tr class="${u.active ? '' : 'row-muted'}">
      <td>${esc(u.username)}</td>
      <td>${esc(u.full_name)}</td>
      <td>${esc(u.role)}</td>
      <td>${u.active ? '<span style="color:#1f7a5c;font-weight:600">Active</span>' : '<span style="color:#c0392b">Inactive</span>'}</td>
      <td>${fmtDate(u.created_at)}</td>
      <td style="display:flex;gap:6px">
        <button class="btn small secondary" data-edit-user="${u.id}">Edit</button>
        ${isAdmin && String(u.id) !== String(me) && u.active ? `<button class="btn small danger" data-deactivate-user="${u.id}" data-uname="${esc(u.username)}">Deactivate</button>` : ''}
      </td>
    </tr>`).join('');
  document.querySelectorAll('[data-edit-user]').forEach(btn => btn.addEventListener('click', () => {
    const u = data.rows.find(x => x.id == btn.dataset.editUser);
    openUserModal(u);
  }));
  document.querySelectorAll('[data-deactivate-user]').forEach(btn => btn.addEventListener('click', async () => {
    const uname = btn.dataset.uname;
    const uid = btn.dataset.deactivateUser;
    if (!await confirmDelete({ title: 'Deactivate User', message: `Deactivate account "${uname}"? They will no longer be able to log in.`, confirmLabel: 'Deactivate' })) return;
    try {
      await API.del(`/api/users/${uid}`);
      toast('User deactivated');
      loadUsers();
    } catch (err) { toast(err.message, true); }
  }));
}

function openUserModal(u) {
  const isNew = !u;
  openModal(`
    <h2>${isNew ? 'New User' : 'Edit ' + esc(u.username)}</h2>
    <form id="user-form">
      <div class="form-grid">
        ${isNew ? formField('Username', 'username', '') : ''}
        ${formField('Full Name', 'full_name', u ? u.full_name : '')}
        ${formField('Role', 'role', u ? u.role : '', { select: ROLE_OPTS })}
        ${formField(isNew ? 'Password' : 'New Password (leave blank to keep current)', 'password', '', { type: 'password' })}
        ${!isNew ? formField('Active', 'active', u.active ? 'Yes' : 'No', { select: ['Yes', 'No'] }) : ''}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn secondary" id="cancel-modal">Cancel</button>
        <button type="submit" class="btn">${isNew ? 'Create User' : 'Save Changes'}</button>
      </div>
    </form>
  `);
  document.getElementById('cancel-modal').addEventListener('click', closeModal);
  document.getElementById('user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readForm(e.target);
    try {
      if (isNew) {
        await API.post('/api/users', data);
        toast('User created');
      } else {
        await API.patch(`/api/users/${u.id}`, { full_name: data.full_name, role: data.role, password: data.password, active: data.active === 'Yes' });
        toast('User updated');
      }
      closeModal();
      loadUsers();
    } catch (err) { toast(err.message, true); }
  });
}

// ── Audit Log (admin only) ──────────────────────────────────────────────────

let _auditPage = 1;
let _auditMod = '';
let _auditAction = '';

const AUDIT_MODULES = ['', 'contracts', 'quotations', 'factory_sea_costs', 'factory_otj_quotes', 'factory_ins_quotes',
  'maintenance_contracts', 'alert_renewals', 'alert_payments', 'alert_callbacks', 'users', 'project_lifecycle',
  'lifecycle_factory_links', 'sales_targets'];
const AUDIT_ACTIONS = ['', 'DELETE', 'DEACTIVATE', 'ARCHIVE', 'UNLINK'];

async function loadAuditLog(page) {
  if (page) _auditPage = page;
  const panel = document.getElementById('audit-panel');
  if (!panel) return;

  const params = new URLSearchParams({ page: _auditPage, pageSize: 50 });
  if (_auditMod) params.set('module', _auditMod);
  if (_auditAction) params.set('action', _auditAction);

  const data = await API.get(`/api/users/audit-log?${params}`);
  const totalPages = Math.ceil(data.total / data.pageSize) || 1;

  panel.innerHTML = `
    <div class="toolbar" style="margin-bottom:8px">
      <select id="audit-mod-filter" style="min-width:160px">
        ${AUDIT_MODULES.map(m => `<option value="${m}" ${m === _auditMod ? 'selected' : ''}>${m || 'All Modules'}</option>`).join('')}
      </select>
      <select id="audit-action-filter" style="min-width:130px">
        ${AUDIT_ACTIONS.map(a => `<option value="${a}" ${a === _auditAction ? 'selected' : ''}>${a || 'All Actions'}</option>`).join('')}
      </select>
    </div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>#</th><th>Action</th><th>Module</th><th>Record Ref</th><th>Details</th><th>Performed By</th><th>Date / Time</th></tr></thead>
      <tbody>
        ${data.rows.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:#66758a">No audit entries found.</td></tr>' :
          data.rows.map(r => {
            let det = '';
            try { const d = JSON.parse(r.details || '{}'); det = Object.entries(d).filter(([,v]) => v).map(([k,v]) => `${k}: ${esc(String(v))}`).join(', '); } catch(_) {}
            return `<tr>
              <td style="color:#66758a;font-size:12px">${r.id}</td>
              <td><span class="badge" style="${auditActionStyle(r.action)}">${esc(r.action)}</span></td>
              <td style="font-size:13px">${esc(r.module)}</td>
              <td style="font-size:13px;font-weight:600">${esc(r.record_ref || '-')}</td>
              <td style="font-size:12px;color:#66758a;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(det)}">${esc(det) || '-'}</td>
              <td style="font-size:13px">${esc(r.performed_by)}</td>
              <td style="font-size:12px;white-space:nowrap">${esc(r.performed_at)}</td>
            </tr>`;
          }).join('')}
      </tbody>
    </table></div>
    <div class="pagination" style="margin-top:8px">
      <button class="btn small secondary" id="audit-prev" ${_auditPage <= 1 ? 'disabled' : ''}>← Prev</button>
      <span style="font-size:13px;color:#66758a">Page ${_auditPage} / ${totalPages} &nbsp;(${data.total} entries)</span>
      <button class="btn small secondary" id="audit-next" ${_auditPage >= totalPages ? 'disabled' : ''}>Next →</button>
    </div>
  `;
  document.getElementById('audit-mod-filter').addEventListener('change', e => { _auditMod = e.target.value; loadAuditLog(1); });
  document.getElementById('audit-action-filter').addEventListener('change', e => { _auditAction = e.target.value; loadAuditLog(1); });
  const prev = document.getElementById('audit-prev');
  const next = document.getElementById('audit-next');
  if (prev) prev.addEventListener('click', () => loadAuditLog(_auditPage - 1));
  if (next) next.addEventListener('click', () => loadAuditLog(_auditPage + 1));
}

function auditActionStyle(action) {
  const map = {
    'DELETE':     'background:#fde6e3;color:#c0392b',
    'DEACTIVATE': 'background:#f3e8fd;color:#7e3ba8',
    'ARCHIVE':    'background:#fdf2dc;color:#d68910',
    'UNLINK':     'background:#eef2f6;color:#66758a',
  };
  return map[action] || 'background:#eef2f6;color:#66758a';
}


// ── System Info (admin only) ────────────────────────────────────────────────

async function loadSystemInfo() {
  const panel = document.getElementById('sysinfo-panel');
  if (!panel) return;
  panel.innerHTML = '<p style="padding:20px;color:#66758a">Loading system info...</p>';
  try {
    const d = await API.get('/api/users/system-info');
    const v = d.current_version || {};
    const counts = d.record_counts || {};
    const countRows = Object.entries(counts).map(([k, c]) =>
      `<tr><td style="font-weight:500">${esc(k)}</td><td style="text-align:right">${c !== null ? c : '-'}</td></tr>`
    ).join('');
    const histRows = (d.version_history || []).map(v =>
      `<tr>
        <td style="font-weight:600;color:#1f7a5c">${esc(v.version)}</td>
        <td style="font-size:12px;color:#66758a">${esc((v.applied_at||'').slice(0,10))}</td>
        <td style="font-size:12px">${esc(v.description||'-')}</td>
      </tr>`
    ).join('');
    const uptime = d.server_uptime_sec || 0;
    const uptimeFmt = uptime < 3600
      ? Math.floor(uptime/60) + 'm ' + (uptime%60) + 's'
      : Math.floor(uptime/3600) + 'h ' + Math.floor((uptime%3600)/60) + 'm';

    panel.innerHTML = `
      <div style="padding:16px;max-width:800px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
          <div style="background:#f8fafc;border:1px solid #d6dde8;border-radius:8px;padding:16px">
            <div style="font-size:11px;color:#66758a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Current Version</div>
            <div style="font-size:18px;font-weight:700;color:#1f2d3d">${esc(v.version||'Unknown')}</div>
            ${v.applied_at ? `<div style="font-size:12px;color:#66758a;margin-top:4px">Applied: ${esc(v.applied_at.slice(0,10))}</div>` : ''}
            ${v.description ? `<div style="font-size:13px;margin-top:8px">${esc(v.description)}</div>` : ''}
          </div>
          <div style="background:#f8fafc;border:1px solid #d6dde8;border-radius:8px;padding:16px">
            <div style="font-size:11px;color:#66758a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Server Status</div>
            <div style="font-size:13px;line-height:1.8">
              <strong>Node:</strong> ${esc(d.node_version||'-')}<br>
              <strong>Platform:</strong> ${esc(d.platform||'-')}<br>
              <strong>Uptime:</strong> ${esc(uptimeFmt)}<br>
              <strong>As of:</strong> ${esc((d.timestamp||'').slice(0,19).replace('T',' '))}
            </div>
          </div>
        </div>

        <h4 style="margin:0 0 8px;font-size:14px;color:#1f2d3d">Record Counts (live)</h4>
        <div class="table-wrap" style="margin-bottom:20px"><table class="data-table">
          <thead><tr><th>Table</th><th style="text-align:right">Count</th></tr></thead>
          <tbody>${countRows}</tbody>
        </table></div>

        ${histRows ? `
        <h4 style="margin:0 0 8px;font-size:14px;color:#1f2d3d">Version History</h4>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Version</th><th>Date</th><th>Description</th></tr></thead>
          <tbody>${histRows}</tbody>
        </table></div>` : ''}
      </div>
    `;
  } catch(e) {
    panel.innerHTML = `<p style="padding:20px;color:#c0392b">Failed to load system info: ${esc(e.message)}</p>`;
  }
}
