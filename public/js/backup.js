async function renderBackup(root) {
  const isAdmin = APP.user.role === 'admin';
  root.innerHTML = `
    <div class="panel">
      <h3>Backup Now</h3>
      <p style="color:var(--text-mute);font-size:13px;" id="backup-intro">Backs up the database and all uploaded attachments into a single zip file. Daily automatic backups also run at 2:00 AM.</p>
      ${isAdmin ? `<button class="btn" id="run-backup">Run Manual Backup</button>` : `<div class="empty-state">Only Admin users can trigger or download backups.</div>`}
      <div id="backup-config" style="margin-top:10px;font-size:12px;color:var(--text-mute)"></div>
    </div>
    <div class="panel">
      <h3>Backup History</h3>
      <div class="table-wrap"><table class="data-table">
        <thead id="backup-thead"><tr><th>File</th><th>Type</th><th>Size</th><th>Created</th><th></th></tr></thead>
        <tbody id="backup-tbody"><tr><td colspan="5">Loading...</td></tr></tbody>
      </table></div>
    </div>
    <div class="panel hidden" id="backup-legacy-panel">
      <h3>Earlier Backups (Windows edition)</h3>
      <p style="color:var(--text-mute);font-size:12px">These were made by the previous Windows installation. The files are not stored on the cloud server.</p>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>File</th><th>Type</th><th>Size</th><th>Created</th></tr></thead>
        <tbody id="backup-legacy-tbody"></tbody>
      </table></div>
    </div>
  `;
  if (isAdmin) {
    document.getElementById('run-backup').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget; btn.disabled = true;
      toast('Running backup...');
      try {
        const r = await API.post('/api/backup/run');
        toast(r.backup_id ? `Backup completed and verified (${r.backup_id})` : 'Backup completed');
        loadBackups();
      } catch (e) { toast(e.message, true); loadBackups(); }
      finally { btn.disabled = false; }
    });
  }
  await loadBackups();
}

async function loadBackups() {
  const data = await API.get('/api/backup');
  const isAdmin = APP.user.role === 'admin';
  const mb = b => b == null ? '-' : (b / 1024 / 1024).toFixed(2) + ' MB';
  if (!data.cloud) {   // SQLite edition (unchanged)
    document.getElementById('backup-tbody').innerHTML = data.rows.length ? data.rows.map(b => `
    <tr>
      <td>${esc(b.file_path)}</td>
      <td>${esc(b.backup_type)}</td>
      <td>${(b.size_bytes / 1024 / 1024).toFixed(2)} MB</td>
      <td>${fmtDate(b.created_at)}</td>
      <td>${isAdmin ? `<a class="btn small secondary" href="/api/backup/download/${encodeURIComponent(b.file_path)}">Download</a>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty-state">No backups yet</td></tr>';
    return;
  }
  // Cloud (MySQL) edition
  const c = data.config || {};
  document.getElementById('backup-intro').textContent = 'Backs up the database (MySQL logical dump), all uploaded documents and a checksum manifest into one verified package, copied to separate off-server storage. Automatic backups run daily at 2:00 AM (UAE time).';
  document.getElementById('backup-config').innerHTML = [
    `Off-server storage: <b>${c.s3_configured ? 'configured' : '<span style="color:#c0392b">NOT configured — local copies only</span>'}</b>`,
    `Schedule: ${esc(c.schedule || '-')}`,
    `Retention: daily ${esc((c.retention || {}).daily || '-')}, weekly ${esc((c.retention || {}).weekly || '-')}, monthly ${esc((c.retention || {}).monthly || '-')}, manual ${esc((c.retention || {}).manual || '-')}`,
    c.running ? `<b>A backup is running now:</b> ${esc(c.running)}` : '',
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');
  document.getElementById('backup-thead').innerHTML = '<tr><th>Backup ID</th><th>Type</th><th>Status</th><th>Size</th><th>Contents</th><th>Storage</th><th>Started (UTC)</th><th></th></tr>';
  const badge = s => `<span class="badge" style="background:${s === 'success' ? '#d4edda;color:#155724' : s === 'failed' ? '#f8d7da;color:#842029' : '#fff3cd;color:#856404'}">${esc(s)}</span>`;
  document.getElementById('backup-tbody').innerHTML = data.rows.length ? data.rows.map(b => `
    <tr>
      <td title="SHA-256: ${esc(b.sha256 || '')}">${esc(b.backup_id)}</td>
      <td>${esc(b.backup_type)}</td>
      <td>${badge(b.status)}${b.verified ? ' <span title="' + esc(b.verify_details || '') + '">✔ verified</span>' : ''}${b.error ? `<div style="font-size:11px;color:#842029">${esc(b.error)}</div>` : ''}</td>
      <td>${mb(b.size_bytes)}</td>
      <td style="font-size:12px">${b.tables_count != null ? `${b.tables_count} tables · ${b.total_rows} rows · ${b.uploads_files} files` : '-'}</td>
      <td>${esc(b.storage || '-')}</td>
      <td>${esc((b.started_at || '').replace('T', ' ').slice(0, 19))}</td>
      <td>${isAdmin && b.status === 'success' && b.local_present ? `<a class="btn small secondary" href="/api/backup/download/${encodeURIComponent(b.backup_id)}">Download</a>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="8" class="empty-state">No backups yet</td></tr>';
  if ((data.legacy || []).length) {
    document.getElementById('backup-legacy-panel').classList.remove('hidden');
    document.getElementById('backup-legacy-tbody').innerHTML = data.legacy.map(b => `<tr><td>${esc(b.file_path)}</td><td>${esc(b.backup_type)}</td><td>${mb(b.size_bytes)}</td><td>${fmtDate(b.created_at)}</td></tr>`).join('');
  }
}
