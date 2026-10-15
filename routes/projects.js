// RETIRED 2026-06-27: Client Projects module was renamed to Quotations (see routes/quotations.js).
// The underlying database table was renamed projects -> quotations via db/migrate_modules_v4.js.
// This file could not be physically deleted (filesystem on this mount blocks unlink/rm for
// Claude-driven file operations), so it is left as an inert stub. It is not require()'d
// anywhere in server.js and exports nothing usable.
module.exports = null;
