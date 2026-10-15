SH PMS LOCAL MARIADB TEST v1
================================
Target: Windows + XAMPP MariaDB 10.4.32, TEST database sh_pms_test.
Source project remains untouched.

Important
- Based on the reconciled cloud/MySQL release, adapted for MariaDB 10.4.
- MySQL-8-only utf8mb4_0900 collations replaced with MariaDB NO-PAD collations.
- SQLite partial UNIQUE index on active factory links is emulated with VIRTUAL generated columns + UNIQUE index.
- AWS/S3 backup dependency removed; backups are local only.
- Uses XAMPP mysqldump.exe and Windows tar.exe for local backup verification.
- Run Node on 127.0.0.1. Later use separate TEST and MAIN hostnames, not two /path prefixes, because the frontend uses absolute /api URLs.

Do NOT put passwords in Git. Copy .env.example to .env locally and edit it.
