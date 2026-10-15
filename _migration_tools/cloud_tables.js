'use strict';
// Cloud-only tables (not in the SQLite source). Created by migrate.js after the data load, or applied to an
// existing database with:  node cloud_tables.js --env <env file> --target <db>     (idempotent, migrator account)
const DDL = {
  sessions: `CREATE TABLE IF NOT EXISTS sessions (session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL, expires INT UNSIGNED NOT NULL,
    data MEDIUMTEXT COLLATE utf8mb4_bin, PRIMARY KEY (session_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // System Backup (cloud): one row per backup run — status, checksums, storage location, verification
  system_backups: `CREATE TABLE IF NOT EXISTS system_backups (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    backup_id VARCHAR(128) NOT NULL UNIQUE,
    backup_type VARCHAR(16) NOT NULL,
    status VARCHAR(16) NOT NULL,
    started_at VARCHAR(32) NOT NULL, finished_at VARCHAR(32) NULL,
    database_name VARCHAR(64) NOT NULL, app_version VARCHAR(80) NULL, mysql_version VARCHAR(64) NULL,
    file_name VARCHAR(200) NULL, size_bytes BIGINT NULL, sha256 CHAR(64) NULL, db_dump_sha256 CHAR(64) NULL,
    tables_count INT NULL, total_rows BIGINT NULL, uploads_files INT NULL, uploads_bytes BIGINT NULL,
    verified TINYINT NOT NULL DEFAULT 0, verify_details TEXT NULL,
    storage VARCHAR(32) NULL, s3_uris TEXT NULL, local_present TINYINT NOT NULL DEFAULT 0,
    error TEXT NULL, created_by VARCHAR(64) NULL,
    CONSTRAINT chk_system_backups_type CHECK (backup_type IN ('manual','daily','weekly','monthly')),
    CONSTRAINT chk_system_backups_status CHECK (status IN ('running','success','failed'))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin`,
};
module.exports = { DDL };
if (require.main === module) {
  const fs = require('fs'); const mysql = require('mysql2/promise');
  const args = Object.fromEntries(process.argv.slice(2).map((a, i, A) => a.startsWith('--') ? [a.slice(2), A[i + 1]] : null).filter(Boolean));
  const env = Object.fromEntries(fs.readFileSync(args.env, 'utf8').split('\n').filter(l => /^\w+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  (async () => { const cn = await mysql.createConnection({ host: env.DB_HOST, port: +env.DB_PORT, user: env.MIGRATION_DB_USER, password: env.MIGRATION_DB_PASSWORD, database: args.target });
    for (const [n, sql] of Object.entries(DDL)) { await cn.query(sql); console.log('ensured', n); } await cn.end(); })().catch(e => { console.error(e.message); process.exit(1); });
}
