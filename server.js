// SH PMS Local Edition — Windows/XAMPP + MariaDB. Times follow UAE local time (Asia/Dubai, UTC+4, no DST).
process.env.TZ = process.env.TZ || 'Asia/Dubai';
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');

const { DB_CLIENT } = require('./db/db.js'); // MySQL (cloud default) or SQLite (DB_CLIENT=sqlite, staging only)
const { recomputeAlerts } = require('./alerts/engine.js');
const { createBackup, pruneOldBackups } = require('./backup/backup.js');

const app = express();
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '127.0.0.1';          // behind Nginx; never exposed directly
const IS_PROD = process.env.NODE_ENV === 'production';
const UPLOAD_PATH = process.env.UPLOAD_PATH || path.join(__dirname, 'uploads');

// Session secret comes from the environment only — no hard-coded fallback in the cloud edition
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('FATAL: SESSION_SECRET must be set (at least 32 random characters)');
  process.exit(1);
}
if (IS_PROD) app.set('trust proxy', 1);                 // Nginx terminates HTTPS

// Session store: MySQL table `sessions` (created by the migration) — sessions survive restarts
let sessionStore;
if ((DB_CLIENT || 'sqlite') === 'mysql') {
  const MySQLStore = require('express-mysql-session')(session);
  const mysqlPool = require('mysql2/promise').createPool({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), socketPath: process.env.DB_SOCKET || undefined,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    connectionLimit: 3, charset: 'UTF8MB4_UNICODE_CI',
  });
  sessionStore = new MySQLStore({
    createDatabaseTable: false, clearExpired: true, checkExpirationInterval: 15 * 60 * 1000, expiration: 12 * 60 * 60 * 1000,
    schema: { tableName: 'sessions', columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' } },
  }, mysqlPool);
}

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(session({
 name: process.env.SESSION_COOKIE_NAME || 'shpms.sid',
  secret: SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12, httpOnly: true, secure: IS_PROD, sameSite: 'lax' },
}));

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', (req, res, next) => {
  if (!req.session || !req.session.user) return res.status(401).end();
  next();
}, express.static(UPLOAD_PATH));

// API routes
app.use('/api/auth', require('./routes/auth.js'));
app.use('/api/dashboard', require('./routes/dashboard.js'));
app.use('/api/quotations', require('./routes/quotations.js'));
app.use('/api/sales-followup', require('./routes/sales_followup.js'));
app.use('/api/factory', require('./routes/factory.js'));
app.use('/api/suppliers', require('./routes/suppliers.js'));
app.use('/api/links', require('./routes/links.js'));
app.use('/api/alerts', require('./routes/alerts.js'));
app.use('/api/users', require('./routes/users.js'));
app.use('/api/attachments', require('./routes/attachments.js'));
app.use('/api/backup', require('./routes/backup.js'));
app.use('/api/reports', require('./routes/reports.js'));
app.use('/api/contracts', require('./routes/contracts.js'));
app.use('/api/maintenance-contracts', require('./routes/maintenance_contracts.js'));
app.use('/api/maintenance', require('./routes/maintenance.js'));
app.use('/api/accounts', require('./routes/accounts.js'));
app.use('/api/renewals', require('./routes/renewals.js'));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Cloud edition: the diagnostic GET /api/debug and the duplicate form POST /login were removed
// (security review, Stage 4). Login uses POST /api/auth/login only; /api/auth/me and logout unchanged.

// Fallback to SPA index.html - no-store prevents browser caching the HTML
app.get(/^\/(?!api|uploads).*/, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Recompute alerts on boot, then every 30 minutes
try { recomputeAlerts(); } catch (e) { console.error('Initial alert recompute failed:', e.message); }
cron.schedule('*/30 * * * *', () => {
  try { recomputeAlerts(); } catch (e) { console.error('Alert recompute failed:', e.message); }
});

// Daily backup at 2:00 AM, weekly prune on Sundays at 2:15 AM — SQLite mode only.
// The cloud (MySQL) System Backup is being rebuilt with mysqldump + uploads (not yet enabled).
if (DB_CLIENT !== 'mysql') {
  cron.schedule('0 2 * * *', async () => {
    try {
      await createBackup('daily');
      console.log('Daily backup completed');
    } catch (e) { console.error('Daily backup failed:', e.message); }
  });
  cron.schedule('15 2 * * 0', () => {
    try { pruneOldBackups(14, 12); } catch (e) { console.error('Backup prune failed:', e.message); }
  });
} else if ((process.env.BACKUP_SCHEDULE || 'on') !== 'off') {
  // Cloud System Backup: daily 02:00 UAE time (Sunday also → weekly/, 1st of month also → monthly/ in S3).
  // Result/failure is recorded in system_backups and logged; a failure never stops the application.
  cron.schedule('0 2 * * *', async () => {
    try { const r = await createBackup('daily', 'system'); console.log(`[backup] daily backup ${r.backup_id} OK (${r.storage}, ${r.sizeBytes} bytes)`); }
    catch (e) { console.error('[backup] daily backup FAILED:', e.message); }
  }, { timezone: 'Asia/Dubai' });
}

app.listen(PORT, HOST, () => {
  console.log(`SH Project Management System (Local Edition, ${DB_CLIENT || 'sqlite'}) running on http://${HOST}:${PORT}`);
});
