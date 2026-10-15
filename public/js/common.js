function toast(msg, isError) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 3500);
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  if (isNaN(n)) return esc(v);
  return n.toLocaleString('en-AE', { maximumFractionDigits: 2 });
}
// fmtCurrency — formats a monetary value with a currency code prefix (e.g. 'AED 12,500.00').
// Used across all modules: AED for client-side (quotations/contracts/maintenance/client payments),
// USD for factory-side (factory costs/payments). 2026-07-07.
function fmtCurrency(v, code) {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  if (isNaN(n)) return esc(v);
  return (code || 'AED') + ' ' + n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


function fmtDate(v) {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d.getTime())) return esc(v);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// DD/MM/YYYY format — used for ETA in Shipping Costs.
// Handles YYYY-MM-DD (HTML date input) directly to avoid timezone shift.
function fmtDateDMY(v) {
  if (!v) return '-';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(v);
  if (isNaN(d.getTime())) return esc(v);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function badge(value) {
  if (!value) return '-';
  return `<span class="badge" style="${badgeStyle(value)}">${esc(value)}</span>`;
}
function badgeStyle(value) {
  const map = {
    'Confirmed': 'background:#e8f5ef;color:#1f7a5c', 'Completed': 'background:#e8f5ef;color:#1f7a5c',
    'Delivered': 'background:#e8f5ef;color:#1f7a5c', 'Handed Over': 'background:#e8f5ef;color:#1f7a5c',
    'Lost': 'background:#fde6e3;color:#c0392b', 'Delayed': 'background:#fde6e3;color:#c0392b',
    'On Hold': 'background:#f3e8fd;color:#7e3ba8', 'Negotiation': 'background:#fdf2dc;color:#d68910',
    'In Progress': 'background:#fdf2dc;color:#d68910', 'In Transit': 'background:#fdf2dc;color:#d68910',
    'Quoted': 'background:#e8f0fb;color:#2563ad', 'Enquiry': 'background:#eef2f6;color:#66758a',
    'Pending': 'background:#eef2f6;color:#66758a', 'Not Started': 'background:#eef2f6;color:#66758a',
    // Maintenance service status
    'Scheduled': 'background:#e8f0fb;color:#2563ad', 'Overdue': 'background:#fde6e3;color:#c0392b',
    'Cancelled': 'background:#fde6e3;color:#c0392b',
    'Terminated': 'background:#f3e8fd;color:#7e3ba8',
    'Cancelled After Payment': 'background:#fde6e3;color:#c0392b',
    'Terminated After Payment': 'background:#f3e8fd;color:#7e3ba8',
    'Payment Retained': 'background:#fdf2dc;color:#d68910',
    'Partially Refunded': 'background:#fdf2dc;color:#d68910',
    'Fully Refunded': 'background:#e8f5ef;color:#1f7a5c',
    'No Refund': 'background:#fde6e3;color:#c0392b',
    'Partial Refund': 'background:#fdf2dc;color:#d68910',
    'Full Refund': 'background:#e8f5ef;color:#1f7a5c',
    // AMC renewal_status values
    'Active Maintenance': 'background:#e8f5ef;color:#1f7a5c',
    'Expired / Renewal Required': 'background:#fde6e3;color:#c0392b',
    // AMC contract status
    'Active': 'background:#e8f5ef;color:#1f7a5c', 'Expiring Soon': 'background:#fdf2dc;color:#d68910',
    'Expired': 'background:#fde6e3;color:#c0392b', 'Renewed': 'background:#e8f0fb;color:#2563ad',
    // AMC / payment status
    'Advance': 'background:#fdf2dc;color:#d68910', 'Partial': 'background:#fdf2dc;color:#d68910',
    'Final': 'background:#e8f0fb;color:#2563ad', 'Full': 'background:#e8f5ef;color:#1f7a5c',
    // Contracts: delivery/mechanical/electrical status
    'Hold': 'background:#f3e8fd;color:#7e3ba8', 'Cancel': 'background:#fde6e3;color:#c0392b',
    'Shipping': 'background:#dbeafe;color:#1d4ed8',
    'Approved': 'background:#e8f5ef;color:#1f7a5c', 'Revised': 'background:#e8f0fb;color:#2563ad',
    // Quotation statuses (2026-09-21 simplified set)
    'Follow Up': 'background:#fdf2dc;color:#d68910', 'Tender': 'background:#f0edfb;color:#5b21b6',
  };
  return map[value] || 'background:#eef2f6;color:#66758a';
}

// ── Modal system ─────────────────────────────────────────────────────────────
// openModal(html, opts?)
//   opts.title    — string: renders a sticky header with title + X close button.
//                   When omitted the first <h3> found in html is promoted automatically.
//   opts.readOnly — boolean (default true): no unsaved-changes prompt on X / Esc.
//   opts.wide     — boolean: expands modal to 92vw.
//   opts.onClose  — function: called before closing; return false to cancel.
//
// The sticky header + X button are injected automatically for every modal,
// so all existing openModal() calls get the X button without changes.
// Title extraction: if opts.title is not set, the first <h3> tag in html is used
// as the title text and removed from the body (de-duplication).

let _modalIsForm = false;   // set true when a form modal registers dirty tracking
let _modalDirty  = false;   // set true when a tracked form input changes

function openModal(html, opts) {
  opts = opts || {};
  const box     = document.getElementById('modal-box');
  const overlay = document.getElementById('modal-overlay');

  // --- extract title from opts or first <h3>/<h2> in html ---
  let title = opts.title || '';
  if (!title) {
    // prefer h3 (detail modals), fall back to h2 (some list modals)
    const m = html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) || html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (m) {
      title = m[1].replace(/<[^>]+>/g, '').trim();
      html = html.replace(m[0], '');
    }
  }

  // --- build sticky header ---
  const headerHtml = `
    <div class="modal-sticky-header" id="_modal-hdr">
      <span class="modal-title" title="${title.replace(/"/g,'&quot;')}">${title}</span>
      <button type="button" class="modal-close-btn" id="_modal-x"
              aria-label="Close" title="Close">&#x2715;</button>
    </div>`;

  box.innerHTML = `${headerHtml}<div class="modal-body" id="_modal-body">${html}</div>`;

  if (opts.wide) { box.style.maxWidth = '92vw'; box.style.width = '92vw'; }
  else           { box.style.maxWidth = ''; box.style.width = ''; }

  overlay.classList.remove('hidden');

  // reset dirty tracking
  _modalIsForm = false;
  _modalDirty  = false;

  // wire X button
  document.getElementById('_modal-x').addEventListener('click', () => _requestCloseModal(opts));

  // auto-track dirty state for any input/select/textarea inside the modal
  setTimeout(() => {
    const body = document.getElementById('_modal-body');
    if (!body) return;
    const fields = body.querySelectorAll('input,select,textarea');
    if (fields.length) {
      _modalIsForm = true;
      fields.forEach(f => f.addEventListener('change', () => { _modalDirty = true; }, { once: true }));
      fields.forEach(f => f.addEventListener('input',  () => { _modalDirty = true; }, { once: true }));
    }
  }, 0);
}

function closeModal() {
  const box     = document.getElementById('modal-box');
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('hidden');
  box.innerHTML = '';
  box.style.maxWidth = '';
  box.style.width = '';
  _modalIsForm = false;
  _modalDirty  = false;
}

// Internal: called by X button and Esc key.
// Shows unsaved-changes confirmation for form modals with dirty state.
function _requestCloseModal(opts) {
  opts = opts || {};
  if (typeof opts.onClose === 'function') {
    if (opts.onClose() === false) return;
  }
  // unsaved-changes guard: only for form modals, skip read-only
  const readOnly = opts.readOnly !== undefined ? opts.readOnly : !_modalIsForm;
  if (!readOnly && _modalDirty) {
    _unsavedChangesPrompt();
    return;
  }
  closeModal();
}

function _unsavedChangesPrompt() {
  // Temporarily overlay a confirmation inside the modal body
  const body = document.getElementById('_modal-body');
  if (!body) { closeModal(); return; }
  const prev = body.innerHTML;
  body.insertAdjacentHTML('afterbegin', `
    <div id="_uc-banner" style="
      background:#fff8e7;border:1px solid #f5c518;border-radius:6px;
      padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;
      gap:12px;font-size:13px;color:#7d5a00;">
      <span style="font-size:18px">⚠️</span>
      <span style="flex:1"><strong>Unsaved changes</strong> — close without saving?</span>
      <button type="button" class="btn secondary" id="_uc-stay" style="font-size:12px;padding:4px 12px">Stay</button>
      <button type="button" class="btn danger"    id="_uc-discard" style="font-size:12px;padding:4px 12px">Discard &amp; Close</button>
    </div>`);
  document.getElementById('_uc-stay').addEventListener('click', () => {
    const b = document.getElementById('_uc-banner');
    if (b) b.remove();
  });
  document.getElementById('_uc-discard').addEventListener('click', () => {
    _modalDirty = false;
    closeModal();
  });
}

// Esc key: close topmost modal (same guard as X button)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const overlay = document.getElementById('modal-overlay');
  if (!overlay || overlay.classList.contains('hidden')) return;
  e.preventDefault();
  _requestCloseModal({ readOnly: !_modalIsForm });
});

// Background click: close read-only modals; leave form modals alone
document.addEventListener('click', (e) => {
  if (e.target.id !== 'modal-overlay') return;
  if (!_modalIsForm) closeModal();
});

function confirmDelete(opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    openModal(`
      <div style="text-align:center;padding:8px 0 4px">
        <div style="font-size:32px;margin-bottom:8px">🗑️</div>
        <h2 style="margin:0 0 10px;font-size:17px">${esc(opts.title || 'Delete Record')}</h2>
        <p style="color:#66758a;margin:0 0 6px;font-size:14px">${esc(opts.message || 'Are you sure you want to delete this record?')}</p>
        <p style="color:#e53e3e;font-size:12px;font-weight:600;margin:0 0 20px">This action cannot be undone.</p>
        <div style="display:flex;gap:10px;justify-content:center">
          <button class="btn secondary" id="cd-cancel" style="min-width:90px">Cancel</button>
          <button class="btn danger" id="cd-confirm" style="min-width:90px">${esc(opts.confirmLabel || 'Delete')}</button>
        </div>
      </div>
    `);
    document.getElementById('cd-confirm').addEventListener('click', () => { closeModal(); resolve(true); });
    document.getElementById('cd-cancel').addEventListener('click', () => { closeModal(); resolve(false); });
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function formField(label, name, value, opts) {
  opts = opts || {};
  const v = value === null || value === undefined ? '' : value;
  const cls = 'form-field' + (opts.span2 ? ' span2' : '');
  if (opts.select) {
    const options = opts.select.map(o => {
      const v = (o && typeof o === 'object') ? o.value : o;
      const l = (o && typeof o === 'object') ? o.label : o;
      return `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`;
    }).join('');
    return `<div class="${cls}"><label>${esc(label)}</label><select name="${name}" ${opts.disabled ? 'disabled' : ''}><option value="">--</option>${options}</select></div>`;
  }
  if (opts.textarea) {
    return `<div class="${cls}"><label>${esc(label)}</label><textarea name="${name}" ${opts.disabled ? 'disabled' : ''}>${esc(v)}</textarea></div>`;
  }
  const type = opts.type || 'text';
  return `<div class="${cls}"><label>${esc(label)}</label><input type="${type}" name="${name}" value="${esc(v)}" ${opts.disabled ? 'disabled' : ''}></div>`;
}

function readForm(form) {
  const data = {};
  new FormData(form).forEach((v, k) => { data[k] = v === '' ? null : v; });
  return data;
}

// ── Lucide icon renderer ──────────────────────────────────────────────────────
// Replaces all <i data-lucide="name"> elements in the document with inline SVG.
// Call after any DOM mutation that introduces icon markup.
function renderIcons() {
  if (window.lucide) {
    lucide.createIcons({ attrs: { 'stroke-width': '1.75' } });
  }
}

// ── shPrint — Professional print utility (2026-07-21) ──────────────────────
// Usage:
//   shPrint({ title, contentEl, filters, landscape })
//   contentEl  – DOM element to clone and print (action columns are stripped)
//   contentHtml – raw HTML string (used when contentEl is not available)
//   filters    – {label: value} object; empty/null values are omitted
//   landscape  – boolean, adds landscape page CSS hint
//
// The function injects a hidden #sh-print-overlay div, prints it, then
// removes it. The companion print.css hides all app chrome during printing.
function shPrint(opts) {
  opts = opts || {};
  const title    = opts.title    || 'Report';
  const subtitle = opts.subtitle || '';
  const landscape = opts.landscape || false;
  const user = (typeof APP !== 'undefined' && APP.user && APP.user.username)
    ? APP.user.username : (opts.user || '—');
  const now = new Date();
  const printDate = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  // ── Active filters (skip blank values) ──
  const filterPairs = Object.entries(opts.filters || {}).filter(([, v]) => v && String(v).trim());
  const filtersHtml = filterPairs.length
    ? '<div class="sh-print-filters"><strong>Filters Applied:</strong> '
      + filterPairs.map(([k, v]) => `<span>${esc(k)}: <strong>${esc(String(v))}</strong></span>`).join(' &nbsp;|&nbsp; ')
      + '</div>'
    : '';

  // ── Content ──
  let contentHtml = '';
  if (opts.contentEl) {
    // Deep-clone the DOM element
    const clone = opts.contentEl.cloneNode(true);
    // Strip action columns (last <th>/<td> that contain only buttons, and any button/input inside)
    clone.querySelectorAll('button, input, select, .btn, .spacer, .pagination').forEach(el => el.remove());
    // If last <th> in every row is now empty, remove those cells
    const headerRows = clone.querySelectorAll('thead tr');
    let stripLastCol = false;
    headerRows.forEach(tr => {
      const ths = tr.querySelectorAll('th');
      if (ths.length && !ths[ths.length - 1].textContent.trim()) stripLastCol = true;
    });
    if (stripLastCol) {
      clone.querySelectorAll('tr').forEach(tr => {
        const cells = tr.querySelectorAll('th, td');
        if (cells.length) cells[cells.length - 1].remove();
      });
    }
    contentHtml = clone.outerHTML;
  } else {
    contentHtml = opts.contentHtml || '';
  }

  // ── Build overlay ──
  const overlay = document.createElement('div');
  overlay.id = 'sh-print-overlay';
  if (landscape) overlay.setAttribute('data-landscape', '1');

  overlay.innerHTML = `
    <div class="sh-print-header">
      <img src="/img/logo.png" alt="Sigma Height Elevators LLC" class="sh-print-logo">
      <div class="sh-print-company">
        <div class="sh-print-company-name">Sigma Height Elevators LLC</div>
        <div class="sh-print-company-sub">SH-PMS Project Management System</div>
        <div class="sh-print-report-title">${esc(title)}</div>
        ${subtitle ? `<div class="sh-print-report-subtitle">${esc(subtitle)}</div>` : ''}
      </div>
      <div class="sh-print-meta">
        <div>Generated: ${esc(printDate)}</div>
        <div>Printed By: ${esc(user)}</div>
      </div>
    </div>
    ${filtersHtml}
    <div class="sh-print-content">${contentHtml}</div>
    <div class="sh-print-footer">
      <span>Sigma Height Elevators LLC &nbsp;|&nbsp; SH-PMS &nbsp;|&nbsp; Generated: ${esc(printDate)} &nbsp;|&nbsp; By: ${esc(user)}</span>
      <span></span>
    </div>
  `;

  // If landscape, inject a <style> to set @page orientation
  if (landscape) {
    const styleEl = document.createElement('style');
    styleEl.textContent = '@media print { @page { size: A4 landscape; margin: 10mm 12mm; } }';
    overlay.appendChild(styleEl);
  }

  document.body.appendChild(overlay);

  // Cleanup after printing (afterprint fires in Chrome/Firefox/Edge)
  const cleanup = () => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  // Small delay ensures styles are applied before dialog opens
  setTimeout(() => {
    window.print();
    // Safety fallback: clean up if afterprint didn't fire within 5s
    setTimeout(cleanup, 5000);
  }, 150);
}

