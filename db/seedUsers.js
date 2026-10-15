// Creates default login accounts for each role. Run once: node db/seedUsers.js
const bcrypt = require('bcryptjs');
const { run, get } = require('./db.js');

const defaultUsers = [
  { username: 'admin',       full_name: 'Administrator',      role: 'admin',        password: 'Admin@123' },
  { username: 'sales',       full_name: 'Sales User',         role: 'sales',        password: 'Sales@123' },
  { username: 'accounts',    full_name: 'Accounts User',      role: 'accounts',     password: 'Accounts@123' },
  { username: 'coordinator', full_name: 'Project Coordinator',role: 'coordinator',  password: 'Coord@123' },
  { username: 'installer',   full_name: 'Installation Team',  role: 'installation', password: 'Install@123' },
  { username: 'viewer',      full_name: 'Viewer',             role: 'viewer',       password: 'Viewer@123' },
];

for (const u of defaultUsers) {
  const existing = get('SELECT id FROM users WHERE username = ?', [u.username]);
  if (existing) { console.log('skip (exists):', u.username); continue; }
  const hash = bcrypt.hashSync(u.password, 10);
  run('INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)',
    [u.username, hash, u.full_name, u.role]);
  console.log('created:', u.username, '/', u.password, '(role:', u.role + ')');
}
console.log('\nDone. CHANGE THESE PASSWORDS after first login (Users module, admin only).');
