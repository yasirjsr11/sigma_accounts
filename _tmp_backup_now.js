const { createBackup } = require('./backup/backup.js');

createBackup('manual').then((result) => {
  console.log('BACKUP OK:', JSON.stringify(result));
}).catch((err) => {
  console.error('BACKUP FAILED:', err);
  process.exit(1);
});
