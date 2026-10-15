const APP = {
  user: null,
  currentView: 'dashboard',
};

// 2026-06-27 (Module Changes step): 'projects' nav key renamed to 'quotations' (full rename,
// Client Projects -> Quotations). 'maintenance' and 'amc' nav entries removed (modules retired).
// The separate 'maintenance_contracts' (Maintenance Records) module is untouched.
// 2026-10-03: approved module order (Accounts & Payments kept, after Factory & Suppliers).
// group = sidebar section; accent = restrained per-module icon colour; module = permission key.
// 2026-07-28: 'links' (Project Management / Lifecycle Hub) removed from nav.
// DB tables preserved. Admin can still reach the module via browser console: navigateTo('links')
const NAV_ITEMS = [
  { key: 'dashboard',             label: 'Dashboard',              icon: 'layout-dashboard', group: 'Overview',              accent: '#60a5fa' },

  { key: 'quotations',            label: 'Sales Quotations',       icon: 'file-text',        group: 'Sales & Contracts',     accent: '#22d3ee', tabs: true },
  { key: 'contracts',             label: 'Contracts',              icon: 'handshake',        group: 'Sales & Contracts',     accent: '#34d399', tabs: true },

  { key: 'maintenance_contracts', label: 'Maintenance',            icon: 'wrench',           group: 'Operations',            accent: '#f59e0b', tabs: true },
  { key: 'alerts',                label: 'Callbacks & Alerts',      icon: 'bell-ring',        group: 'Operations',            accent: '#fb7185', tabs: true },
  { key: 'factory',               label: 'Factory & Suppliers',    icon: 'factory',          group: 'Operations',            accent: '#a78bfa', tabs: true },

  { key: 'accounts',              label: 'Accounts & Payments',    icon: 'wallet-cards',     group: 'Finance & Reporting',   accent: '#2dd4bf', tabs: true },
  { key: 'reports',               label: 'Reports & Analytics',    icon: 'bar-chart-3',      group: 'Finance & Reporting',   accent: '#38bdf8' },

  { key: 'users',                 label: 'User Management',        icon: 'user-cog',         group: 'Administration',        accent: '#60a5fa', adminOnly: true },
  { key: 'backup',                label: 'System Backup',          icon: 'database-backup',  group: 'Administration',        accent: '#94a3b8' },
];
// Menu visibility follows the role's module permissions (same list the server enforces)
function navAllowed(item) {
  if (item.adminOnly && !(APP.user && APP.user.role === 'admin')) return false;
  const mods = APP.user && APP.user.modules;
  return !Array.isArray(mods) || mods.includes(item.key);
}

const VIEW_RENDERERS = {
  dashboard: renderDashboard,
  quotations: renderQuotations,
  factory: renderFactory,
  links: renderLinks,
  contracts: renderContracts,
  maintenance_contracts: renderMaintenanceContracts,
  accounts: renderAccounts,
  alerts: renderAlerts,
  reports: renderReports,
  users: renderUsers,
  backup: renderBackup,
};

function renderNav() {
  const nav = document.getElementById('nav-links');
  let lastGroup = null;
  nav.innerHTML = NAV_ITEMS.filter(navAllowed).map(item => {
    const head = item.group !== lastGroup ? `<div class="nav-group">${esc(item.group)}</div>` : '';
    lastGroup = item.group;
    const on = item.key === APP.currentView;
    return `${head}<a class="nav-item ${on ? 'active' : ''}" data-key="${item.key}" title="${item.label}" href="#" role="link" ${on ? 'aria-current="page"' : ''} style="--nav-accent:${item.accent}">
      <span class="nav-icon-wrap"><i data-lucide="${item.icon}" class="nav-icon" aria-hidden="true"></i></span>
      <span class="nav-label">${item.label}</span>
      ${item.tabs ? '<i data-lucide="chevron-right" class="nav-chevron" aria-hidden="true"></i>' : ''}
    </a>`;
  }).join('');
  nav.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();   // sidebar items are not hyperlinks — never let the anchor reset the URL
      // 2026-10-03: opening Maintenance from the sidebar lands on the Maintenance Dashboard
      if (el.dataset.key === 'maintenance_contracts' && typeof maintResetToDefaultTab === 'function') maintResetToDefaultTab();
      navigateTo(el.dataset.key);
    });
  });
  renderIcons();
}

// ── 2026-10-03: browser history for module navigation ───────────────────────
// Maintenance tabs are addressable (#maintenance/dashboard, /records, /schedule, /calendar,
// /callbacks, /cancelled) so refresh, bookmarks and Back/Forward work. Other modules keep
// their previous URL behaviour (no hash) but get history entries for Back/Forward.
function _appUrlFor(key) {
  if (key === 'maintenance_contracts' && typeof maintTabSlug === 'function') return `#maintenance/${maintTabSlug(MaintContractsState.tab)}`;
  return location.pathname + location.search;
}
function _appStateFor(key) {
  return { view: key, mtab: key === 'maintenance_contracts' && typeof MaintContractsState !== 'undefined' ? MaintContractsState.tab : null };
}
function appPushHistory(key, replace) {
  try {
    const st = _appStateFor(key), cur = history.state;
    const same = cur && cur.view === st.view && cur.mtab === st.mtab;
    if (replace || same) history.replaceState(st, '', _appUrlFor(key));
    else history.pushState(st, '', _appUrlFor(key));
  } catch (_) { /* history API unavailable — navigation still works */ }
}
window.addEventListener('popstate', e => {
  if (!APP.user) return;
  let st = e.state;
  if (!st) { const m = /^#maintenance(?:\/([\w-]+))?/.exec(location.hash); st = m ? { view: 'maintenance_contracts', mtab: maintTabFromSlug(m[1] || 'dashboard') } : { view: 'dashboard' }; }
  if (st.view === 'maintenance_contracts' && st.mtab && typeof MaintContractsState !== 'undefined') MaintContractsState.tab = st.mtab;
  if (VIEW_RENDERERS[st.view]) navigateTo(st.view, { fromHistory: true });
});

async function navigateTo(key, opts) {
  opts = opts || {};
  if (!opts.fromHistory) appPushHistory(key, opts.replace);   // identical view+tab → replaced, not duplicated
  APP.currentView = key;
  renderNav();
  const titleMap = Object.fromEntries(NAV_ITEMS.map(i => [i.key, i]));
  const navItem = titleMap[key] || { label: key, icon: '' };
  const pageTitleEl = document.getElementById('page-title');
  pageTitleEl.innerHTML = navItem.icon
    ? `<span class="page-hdr-icon-wrap" style="--nav-accent:${navItem.accent || '#2563eb'}"><i data-lucide="${navItem.icon}" class="page-hdr-icon" aria-hidden="true"></i></span><span class="page-hdr-text">${esc(navItem.label)}</span>`
    : esc(navItem.label);
  document.title = `${navItem.label} — Sigma Height PMS`;
  renderIcons();
  const root = document.getElementById('view-root');
  root.innerHTML = '<div class="empty-state">Loading...</div>';
  try {
    await VIEW_RENDERERS[key](root);
  } catch (e) {
    if (e.status === 403) {
      root.innerHTML = `<div class="empty-state">Your role (${esc(APP.user.role)}) does not have access to this module.</div>`;
    } else {
      root.innerHTML = `<div class="empty-state">Failed to load: ${esc(e.message)}</div>`;
    }
  }
  renderIcons();
  refreshAlertBadge();
}

// 2026-10-03: bell = action-required items of Alerts & Notifications → Expiring Contracts
// (the existing authoritative queue; no separate alert store). Cached for 60 s.
let _alertBadgeAt = 0, _alertBadgeN = null;
async function refreshAlertBadge(force) {
  const badgeEl = document.getElementById('alert-badge'), cnt = document.getElementById('alert-count');
  if (!badgeEl) return;
  if (!navAllowed({ key: 'alerts' })) { badgeEl.classList.add('hidden'); return; }
  try {
    if (force || _alertBadgeN === null || Date.now() - _alertBadgeAt > 60000) {
      const data = await API.get('/api/alerts/expiring-contracts');
      _alertBadgeN = (data.summary && (data.summary.queue_total ?? data.summary.total)) ?? (data.rows || []).length;
      _alertBadgeAt = Date.now();
    }
    badgeEl.classList.remove('hidden');
    if (cnt) { cnt.textContent = _alertBadgeN > 99 ? '99+' : String(_alertBadgeN || ''); cnt.style.display = _alertBadgeN ? '' : 'none'; }
    badgeEl.title = _alertBadgeN ? `${_alertBadgeN} AMC alert(s) need action — Alerts & Notifications` : 'Alerts & Notifications';
    badgeEl.onclick = () => navigateTo('alerts');
  } catch (e) { badgeEl.classList.add('hidden'); /* role without alerts access */ }
}

// ── 2026-10-03: collapsible sidebar (remembered per browser) ─────────────────
function applySidebarState(collapsed) {
  document.getElementById('app-shell').classList.toggle('sidebar-collapsed', !!collapsed);
  const t = document.getElementById('sidebar-toggle'); if (t) t.setAttribute('aria-expanded', String(!collapsed));
}
function initShellChrome() {
  let collapsed = false;
  try { const v = localStorage.getItem('shpms_sidebar_collapsed'); collapsed = v === null ? window.innerWidth < 1280 : v === '1'; } catch (_) {}
  applySidebarState(collapsed);
  const t = document.getElementById('sidebar-toggle');
  if (t && !t._wired) {
    t._wired = true;
    t.addEventListener('click', () => {
      const now = !document.getElementById('app-shell').classList.contains('sidebar-collapsed');
      applySidebarState(now);
      try { localStorage.setItem('shpms_sidebar_collapsed', now ? '1' : '0'); } catch (_) {}
    });
  }
  // user menu
  const chip = document.getElementById('user-chip'), dd = document.getElementById('user-dropdown');
  if (chip && !chip._wired) {
    chip._wired = true;
    chip.addEventListener('click', e => { e.stopPropagation(); const open = dd.classList.toggle('hidden') === false; chip.setAttribute('aria-expanded', String(open)); });
    document.addEventListener('click', e => { if (!dd.contains(e.target)) { dd.classList.add('hidden'); chip.setAttribute('aria-expanded', 'false'); } });
  }
  initGlobalSearch();
}

// ── 2026-10-03: global search — routes the text into the existing module search
// (no new cross-module search engine): pick a module, the module's own search runs.
const GS_TARGETS = [
  { key: 'contracts',             label: 'Contracts',           input: 'cf-search', hint: 'Contract Ref., Quote Ref., client', test: q => /^(SH|SHM|SHO)[-\s]?\d/i.test(q) },
  { key: 'quotations',            label: 'Sales Quotations',    input: 'qf-search', hint: 'Quote Ref., client, project',      test: q => /^\d{4}(-[A-Z])?$/i.test(q) },
  { key: 'maintenance_contracts', label: 'Maintenance Records', input: 'mf-search', hint: 'AMC / Contract Ref., client',      test: q => /^AMC/i.test(q), before: () => { if (typeof MaintContractsState !== 'undefined') MaintContractsState.tab = 'records'; } },
  { key: 'factory',               label: 'Factory — New Orders', input: 'fs-search', hint: 'Factory Ref., Contract Ref., client', test: q => /^FJ[-\s]?\d/i.test(q), before: () => { if (typeof FactoryState !== 'undefined') FactoryState.sheet = 'ins-quotes'; } },
];
function initGlobalSearch() {
  const inp = document.getElementById('global-search-input'), menu = document.getElementById('global-search-menu');
  if (!inp || inp._wired) return;
  inp._wired = true;
  let idx = 0;
  const targets = () => {
    const q = inp.value.trim();
    const allowed = GS_TARGETS.filter(t => navAllowed({ key: t.key }));
    return allowed.filter(t => t.test(q)).concat(allowed.filter(t => !t.test(q)));
  };
  const draw = () => {
    const q = inp.value.trim();
    if (!q) { menu.classList.add('hidden'); return; }
    const list = targets(); idx = Math.min(idx, list.length - 1);
    menu.innerHTML = list.map((t, i) => `<div class="gs-opt ${i === idx ? 'on' : ''}" data-i="${i}" role="option">
        <span>Search <b>${esc(q)}</b> in <b>${esc(t.label)}</b></span><span class="gs-hint">${esc(t.hint)}</span></div>`).join('')
      || '<div class="gs-opt">No searchable modules for your role</div>';
    menu.classList.remove('hidden');
    menu.querySelectorAll('[data-i]').forEach(el => el.addEventListener('mousedown', e => { e.preventDefault(); go(list[Number(el.dataset.i)]); }));
  };
  const go = async t => {
    const q = inp.value.trim(); if (!t || !q) return;
    menu.classList.add('hidden'); inp.blur();
    if (t.before) t.before();
    await navigateTo(t.key);
    const el = document.getElementById(t.input);
    if (el) { el.value = q; el.dispatchEvent(new Event('input', { bubbles: true })); el.focus(); }
  };
  inp.addEventListener('input', () => { idx = 0; draw(); });
  inp.addEventListener('focus', draw);
  inp.addEventListener('blur', () => setTimeout(() => menu.classList.add('hidden'), 150));
  inp.addEventListener('keydown', e => {
    const list = targets();
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(list.length - 1, idx + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(list[idx]); }
    else if (e.key === 'Escape') { menu.classList.add('hidden'); }
  });
}

async function boot() {
  try {
    const me = await API.get('/api/auth/me');
    if (me.user) {
      APP.user = me.user;
      showApp();
      return;
    }
  } catch (e) { /* not logged in */ }
  showLogin();
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  const name = APP.user.full_name || APP.user.username || '';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'U';
  document.getElementById('current-user').innerHTML = `<b>${esc(name)}</b>${esc(APP.user.role)}`;
  const topbarUser = document.getElementById('topbar-user');
  if (topbarUser) topbarUser.innerHTML = `<span class="topbar-username">${esc(name)}</span><span class="topbar-role">${esc(APP.user.role)}</span>`;
  const av = document.getElementById('user-avatar'); if (av) av.textContent = initials;
  const uh = document.getElementById('ud-head'); if (uh) uh.innerHTML = `<b>${esc(name)}</b><span>${esc(APP.user.username || '')} · ${esc(APP.user.role)}</span>`;
  initShellChrome();
  renderNav();
  // 2026-10-03: a refreshed / bookmarked Maintenance URL re-opens that tab; otherwise the main Dashboard
  const m = /^#maintenance(?:\/([\w-]+))?/.exec(location.hash || '');
  if (m && typeof maintTabFromSlug === 'function') {
    MaintContractsState.tab = maintTabFromSlug(m[1] || 'dashboard');
    navigateTo('maintenance_contracts', { replace: true });
  } else {
    navigateTo('dashboard', { replace: true });
  }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const data = await API.post('/api/auth/login', { username, password });
    APP.user = data.user;
    try { const me = await API.get('/api/auth/me'); if (me.user) APP.user = me.user; } catch (_) {}   // includes module permissions
    showApp();
  } catch (e) {
    errEl.textContent = e.message || 'Login failed';
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await API.post('/api/auth/logout');
  APP.user = null;
  location.reload();
});

boot();
