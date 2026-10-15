## SH-PMS-v2026.10.10.01 — 2026-10-10
### Contracts ↔ Factory Ref. — one authoritative relationship (factory_contract_links)
- New `db/factoryLinks.js`: live link = junction row (is_deleted = 0) whose Factory Ref. has a live record in that factory table (resolved by Factory Ref. + table, not the stale factory_record_id); contracts matched by Contract Ref. (trimmed, case-insensitive).
- Contracts List / Contract details / Factory Ref. filter / Contract Register report + exports read the junction (previously the single factory-record contract_ref text). List rows add `factory_refs[]` + `factory_ref_display`; multi refs show "FJ-xxxx +N".
- Contract → Factory tab link/unlink write the junction (many-to-many, unlink keeps history as is_deleted = 1, audited); Factory New Orders show linked contracts from the junction and search by them; re-created factory orders re-point existing links.
- Reconciliation (backup PRE_FACTORY_LINK_RECONCILIATION_20261010_121155): 18 links back-filled for grouped contract records, 5 stale factory_record_id re-pointed (FJ-6051 ×3, FJ-6048, FJ-6031). No factory, payment or contract data changed.
- Cache busters: contracts.js?v=20261010a, factory.js?v=20261010a

## SH-PMS-v2026.10.08.01 — 2026-10-08
### Reports & Analytics — chart lifecycle / blinking fix (12-Month Service Trend and every standard report chart)
- One Chart.js instance per report chart: filter / page / year changes update it in place (`update('none')`) instead of destroy → recreate → re-animate; stale async draws blocked by a render token; `Chart.getChart()` guard against two instances on one canvas; destroyed when switching to a report without a chart.
- Chart box isolated: fixed height, width 100 %, min-width 0, overflow hidden, `contain: layout size`; Chart.js `resizeDelay: 150`; 400 ms animation on first draw only.
- Sticky horizontal scrollbar: one ResizeObserver + one listener pair (previously a new observer and two listeners on every report load, never disconnected); rAF-throttled, change-only DOM writes, show/hide hysteresis, sub-pixel-safe scroll sync.
- Presentation View destroys its chart on close; Chart.js loader memoised (one script load).
- No backend / data changes. Cache busters: reports.js?v=20261008a, maintenance_contracts.js?v=20261008a

## SH-PMS-v2026.10.07.02 — 2026-10-07
### AMC Renewal Performance — one definition (Portfolio report = Dashboard = Monthly Management Report)
- New `db/amcRenewals.js` (`getRenewalPerformance`, `getRenewalMonthDetails`, `allRenewals`): renewal history (not the Renewal Status queue); completed = Approved + Active + payment received; Renewal Date = first valid payment date; units = Maintenance Record units, one row per renewal; Projects = distinct Contract Ref.; pending / Renewal Date Missing / Legacy Data Review listed separately.
- Reports → AMC Portfolio & Renewal: KPI, chart, month table (Renewed Projects / Renewed Units), month drill-down (server-side, month-scoped renewal list with reconciliation tick, empty state), Payment Status filter, exports.
- Maintenance Dashboard Renewal Performance + month detail (now filter-aware) and Monthly Management Report use the same service.
- Root cause of Oct = 1: report used approval → activation → AMC start date; SH-044-R01 (approved 22-Sep, first payment 02-Oct) was put in September. Month drill showed the full portfolio register.
- No data changed. Cache busters: maintenance_contracts.js?v=20261007b, reports.js?v=20261007c

## SH-PMS-v2026.10.07.01 — 2026-10-07
### AMC Collections — one authoritative calculation (Maintenance Dashboard = Reports)
- New `db/amcCollections.js` (`getAmcCollections`, `getAmcCollectionTransactions`, `getAmcMissingDateTransactions`): valid AMC ledger transactions (renewal not soft-deleted; voids already excluded) summed by actual `payment_date`, integer-fils precision, all 12 months, undated payments flagged "Payment Date Missing".
- Maintenance Dashboard: AMC Collections chart, "AMC Collected — period" KPI, drill-downs (now transaction-level, click a bar), print and legacy `/maint-dashboard/payments` all use the service. "Total Received" relabelled "Received on Current AMCs" (portfolio position).
- Reports → AMC Payments: chart, month-wise table, month drill-down (transaction list with reconciliation tick) and exports use the service; added "Collected — period" KPI; payment-status/search filters no longer affect collections.
- Root cause fixed: Report counted 5 ledger rows on soft-deleted duplicate renewals (Jan +1,000; Aug +12,000); Dashboard bucketed each current renewal's total into its latest payment month.
- No data changed. Cache busters: maintenance_contracts.js?v=20261007a, reports.js?v=20261007a

## SH-PMS-v2026.07.22.06 — 2026-07-22
### Alerts & Notifications → Expiring Contracts — Remove Technician Column
- **Frontend**: Removed `<th>Technician</th>` header and `assigned_technician` data cell from the Expiring Contracts table. `colspan` updated from 12 → 11 in loading and empty-state rows.
- **Backend**: Removed `mp.assigned_technician` from the `SELECT` in `GET /api/alerts/expiring-contracts` (no longer fetched/sent). Removed `assigned_technician` from `SORT_COLS` (unused sort key).
- Excel export (DOM-scraped) automatically reflects the updated layout — Technician column no longer exported.
- All other modules (Maintenance Records, Monthly Schedule, Calendar, Dashboard, Callbacks, Reports) retain Technician information unchanged.
- Cache buster: `alerts.js?v=20260722f`

## SH-PMS-v2026.07.22.05 — 2026-07-22
### Fix: Edit Cancelled AMC Contract → Save Now Working
**Root cause:** `maintenance_contracts` table was missing `cancellation_date` and `cancellation_reason` columns. Every PATCH attempt failed silently with a column-not-found SQL error. A secondary issue: the `renewal_status` CHECK constraint only accepted 4 values but the form offered 6, causing further failures if the user changed the status dropdown.

**Fixes:**
- **DB migration (`db/db.js`)**: Rebuilt `maintenance_contracts` as `maintenance_contracts_v3` — adds `cancellation_date TEXT` and `cancellation_reason TEXT` columns; removes the strict CHECK constraint on `renewal_status` so all form values are accepted. All 160 existing records preserved.
- **Backend (`routes/alerts.js`)**: `PATCH /api/alerts/cancelled-amc/:id` wrapped in try-catch; validates `renewal_status` against expanded valid list; returns `{ success, message, row }` on success; returns `{ error }` with clear message on failure. No longer crashes silently.
- **Frontend (`public/js/alerts.js`)**: Added `CANC_AMC_RENEWAL_OPTS` constant scoped to the Cancelled AMC form (decoupled from `RENEWAL_STATUS_OPTS` used by alert_renewals). Post-save refresh forces the `cancelled` tab to reload automatically. Error toast now shows the backend error message.
- **Cache buster**: `alerts.js?v=20260722e`

## SH-PMS-v2026.07.22.04 — 2026-07-22
### Contracts Module — Live Factory Ref. in List
- **Contracts list column "Factory Ref."** now shows live data sourced from factory tables (INS/OTJ/SEA) by matching Contract Ref.
  - One linked record → shows factory ref badge (green)
  - Multiple linked records → shows "Multiple (N)" button (blue) — click opens Factory Ref. tab
  - None → shows "Not Linked" (grey)
- **Factory Ref. filter** added to contracts list toolbar — type any factory ref to filter contracts
- **Backend**: `GET /api/contracts` list + `GET /api/contracts/:id` both include `linked_factory_refs` and `factory_ref_count` via live SQLite subqueries (TRIM/UPPER normalized, DISTINCT across all 3 factory tables)
- **Factory Ref. filter** uses EXISTS subquery on all 3 factory tables (INS/OTJ/SEA)

## SH-PMS-v2026.07.20.02 — 2026-07-20

### Fixed
- **New quotation creation 400 error for Follow-up, Draft, Submitted, Under Review, Rejected**: Root cause was a three-way mismatch — frontend `STATUS_OPTS` used display labels as values, backend default was `'Draft'`, and DB CHECK constraint only allowed legacy TitleCase values. All three are now synchronized.

### Changed
- **DB** (`db/db.js`): Startup migration recreates `quotations` table with updated CHECK constraint using lowercase_underscore values: `('enquiry','quoted','draft','submitted','follow_up','under_review','negotiation','approved','rejected','cancelled','revised','hold','lost')`. Migrates all 170 existing records via explicit CASE mapping. Indexes recreated. Backup at `db/sh_pms_backup_20260720_before_status_normalize.sqlite`.
- **Backend** (`routes/quotations.js`): Added `ALLOWED_STATUSES` array as centralized source. POST handler validates status pre-insert (HTTP 400 for invalid). PATCH handler validates status in updates. Default changed from `'Draft'` → `'enquiry'`.
- **Frontend** (`public/js/common.js`): `formField()` now supports `{value, label}` objects in select arrays (backward compatible with plain string arrays).
- **Frontend** (`public/js/quotations.js`): `STATUS_OPTS` replaced with `QUOTATION_STATUS_CONFIG` (array of `{value, label}` objects) + `QUOTATION_STATUS_MAP` + `quotStatusLabel()` helper. Status filter, table badge, New form, and Edit form all use the same centralized config. Display labels shown in UI; internal values sent to API.

### Status mapping (old → new internal value)
| Old (TitleCase) | New (lowercase_underscore) | Display Label |
|---|---|---|
| Enquiry | enquiry | Enquiry |
| Quoted | quoted | Quoted |
| Negotiation | negotiation | Negotiation |
| Approved | approved | Approved |
| Lost | lost | Lost |
| Revised | revised | Revised |
| *(new)* | draft | Draft |
| *(new)* | submitted | Submitted |
| *(new)* | follow_up | Follow-up |
| *(new)* | under_review | Under Review |
| *(new)* | rejected | Rejected |
| *(preserved)* | cancelled | Cancelled |
| *(preserved)* | hold | Hold |

## SH-PMS-v2026.07.20.01 — 2026-07-20

### Fixed
- **500 error on new Sales Quotation creation**: The `quotations` table CHECK constraint only allowed legacy status values (`Enquiry`, `Quoted`, `Revised`, `Negotiation`, `Approved`, `Hold`, `Lost`, `Cancelled`), but the frontend STATUS_OPTS included `Draft`, `Submitted`, and `Follow-up`. Any new quotation with these statuses failed silently with HTTP 500.

### Changed
- `db/db.js`: Startup migration recreates the `quotations` table with an updated CHECK constraint that includes all 11 valid status values. Existing 170 records preserved (all use legacy values). All 3 indexes recreated.
- `routes/quotations.js`: POST handler wrapped in try-catch. CHECK constraint violations return HTTP 400 with descriptive message. UNIQUE constraint violations return HTTP 409. Backend default status changed from `'Draft'` to `'Enquiry'`.

## SH-PMS-v2026.07.18.04 — 2026-07-18
### Fixed
- Client Payment Pending report: removed default year=2026 filter; report now shows ALL contracts with outstanding balances across all years
- Contract_ref JOIN in buildPaymentPendingReport now uses TRIM(UPPER(...)) on both sides to prevent whitespace/case mismatches
- Reset button also clears year filter for payment-pending report type

## SH-PMS-v2026.07.18.03 — 2026-07-18
### Fixed
- Client Payment Entry Report: backend summary now returns 6 new KPI keys (total_entries, total_received_amount, contracts_with_payments, payments_this_month, payments_today, average_payment)
- Frontend: removed default year=2026 filter for Client Payment Entry report; all 190 historical payments (2020–2025) now visible
- Reset button also clears year filter for Client Payment Entry report type

## SH-PMS-v2026.07.18.02 — 2026-07-18
### Changed — Monthly Maintenance Report
- Dashboard KPIs redesigned: 10 month-scoped cards replace overall lifetime stats
  - Card 1: Total Maintenance Contracts (lifetime AMC contract count — only lifetime figure)
  - Cards 2–7: Scheduled / Completed / Pending / Postponed / Hold / Overdue — selected month only
  - Card 8: Monthly Completion % (Completed ÷ Scheduled for selected month)
  - Card 9: Units Serviced This Month (unique elevators, deduplicated)
  - Card 10: Units Not Serviced (scheduled units with no completed visit in selected month)
- Removed lifetime totals: Lifetime Scheduled, Completed, Pending, Missed, Hold, Completion %
- Monthly Jan–Dec summary: each row now calculated independently, no cumulative rollups
- Technician & Emirate summaries now scoped to selected month only
- Selected month row highlighted in the Jan–Dec table
- Month filter refreshes all cards, summaries, detail rows, exports, and print

## SH-PMS-v2026.07.18.01 — 2026-07-18
### Added
- Seeded 18 new quotations (6152–6169) as a db.js startup migration (MIG-2026-07-18)
- Refs: 6152, 6153-OTJ, 6154, 6155, 6156, 6157, 6158-MAT, 6159, 6160, 6161-OTJ, 6162, 6163, 6164, 6165, 6166-MAT, 6167, 6168-OTJ, 6169
- All inserted with status "Quoted", currency AED, salespersons SY/MM/NM
- Migration is idempotent — skips any quote_ref that already exists

## SH-PMS-v2026.07.16.04 — 2026-07-16
### Fixed
- Client Payment Pending report: data source switched to `client_payments` table (was returning AED 0)
- Renamed "Paid Amount (AED)" → "Received Amount (AED)" throughout report and exports
- Renamed "Outstanding (AED)" → "Balance Receivable (AED)"
- Removed Days Overdue / Due Date columns; added Last Payment Date, Contract Status, Salesperson, Emirate, Remarks
- Payment Status now calculated from client_payments SUM (Unpaid / Partial Paid / Full Paid / Overpaid)
- Invoice Ref. preserved via grouped alert_payments subquery
- Added "View Payment History" button per row — modal shows all payment transactions for that contract
- New filters: payment_status, contract_status, salesperson, emirate, needs_review, date range
- New sort options: balance_receivable, received_amount, last_payment_date, payment_status
- Summary cards: Pending Contracts, Total Received, Total Outstanding

## SH-PMS-v2026.07.16.03 (2026-07-16)
### Added
- **Reports: Client Payment Entry** — new report under Contracts category
  - Single source of truth: `client_payments` table
  - Detail view: one row per payment transaction (22 columns incl. Alert flag)
  - Summary view: one row per Contract Ref. with payment count + totals
  - 7 KPI cards: Total Contract Value, Total Received, Balance Receivable, Unpaid, Partial Paid, Full Paid, Overpaid/Needs Review
  - Payment Status logic: Unpaid / Partial Paid / Full Paid / Overpaid (per contract)
  - Mismatch detection: flags when `contracts.total_received` diverges from calculated sum
  - Unlinked payment detection: payments with no matching contract flagged
  - 17 filters: search, year, month, date range, contract_ref, client, payment_type, payment_mode, payment_status, contract_status, salesperson, emirate, needs_review, view_mode, sort
  - Export: Excel, PDF, Print (all views)
  - Highlights alert rows in amber when unlinked, mismatch, or overpaid

## SH-PMS-v2026.07.16.02 (2026-07-16)

### Sales Quotations — CRM-Only Module Redesign

- **REDESIGN**: Sales Quotations is now a fully independent CRM module with no links to Contracts, Maintenance, Factory, or Accounts.
- **STATUS**: Workflow updated to `Draft → Submitted → Follow-up → Negotiation → Revised → Approved / Lost / Cancelled`.
- **REMOVED FIELDS**: Quotation Value, Payment Terms, Payment Received, Balance Amount hidden from form and API (DB columns preserved).
- **REMOVED TABS**: Attachments and Linked Factory Orders tabs removed; modal now shows Details, History, Revisions only.
- **BACKEND**: `GET /:id` no longer fetches attachments or project_links; `PATCH` no longer auto-recalculates balance_amount; default status for new records changed from `Enquiry` to `Draft`.
- **TRACKING**: `payment_received` removed from TRACKED_FIELDS; status and quoted_value (contract_value) still tracked in history.
- **CACHE**: `quotations.js?v=20260716c`

## SH-PMS-v2026.07.16.01 (2026-07-16)

### Maintenance Module – Hold Renewal Status + Sort Controls

**New Feature: Hold Renewal Status**
- Added 'Hold' as the 2nd option in Renewal Status dropdown (Active Maintenance | Hold | Expired / Renewal Required | Cancelled)
- Hold contracts: excluded from scheduled/pending/overdue visit generation, Monthly Calendar, Upcoming Visits (MN-7), technician workload, and completion calculations
- Hold contracts: continue to count in Total Maintenance Contracts on dashboard
- Hold contracts: appear in Monthly Maintenance Report detail list tagged with Contract Status = Hold and Alert = "Contract On Hold"; excluded from operational summary totals (scheduled units, completed, pending, overdue, monthly summary, technician perf, emirate summary)
- Reactivating to Active Maintenance resumes scheduling from next applicable cycle without duplicates

**New Feature: Maintenance Records Sorting**
- Added Sort By dropdown to Maintenance Records toolbar: Maintenance ID / Contract Ref. / Client Name / Emirate / Start Date / End Date / Next Service Date / Renewal Status / Last Updated
- Added Order dropdown: Descending (default) / Ascending
- Sort state preserved across pagination; filters remain unaffected

**Files Changed**
- `public/js/maintenance_contracts.js` (v=20260716a): MAINT_RENEWAL_OPTS, MaintContractsState sort/dir, toolbar sort selects, event listeners, loadMaintList params
- `reports/builder.js`: Report 15 SELECT adds mc.renewal_status; opRows/holdRows split; summary stats use opRows; detail includes all rows tagged; MN-7 excludes Hold contracts
- `routes/maintenance_contracts.js` (previous session): SORT_COLS expanded; dashboard scheduledVisits excludes Hold; calendar mcWhere excludes Hold
- `public/index.html`: cache buster bumped to v=20260716a
- `VERSION.json`: bumped to SH-PMS-v2026.07.16.01

## v2026.07.14.06 — 2026-07-16

### Fixed
- **Emirate-Wise Summary duplicate rows** — emirate keys not normalized with TRIM(); any emirate with leading/trailing whitespace in the DB (e.g. 'Ajman ' vs 'Ajman') created two separate map entries that both rendered as the same name in the table.
  - `routes/maintenance_contracts.js` (dashboard endpoint): `contractsByEmirate` SQL now uses `TRIM(emirate)` in SELECT and GROUP BY; both emirate map loops now apply `.trim()` to the key string.
  - `reports/builder.js` (Report 15 emirate summary): same `.trim()` normalization applied.
- Result: each emirate appears exactly once; unit counts merge correctly; completion % is accurate.

---

## v2026.07.14.05 — 2026-07-14

### Maintenance Module: Unit-Based Counting

**Backend (`routes/maintenance_contracts.js`)**
- `ensureVisit()` now inserts `units_scheduled = mc.total_elevator_units` on visit creation
- Dashboard endpoint (`/dashboard`): all KPIs now count units, not visits; added `partial` (partially-completed units) and `visit_count`/`visit_completed` for reference
- Calendar endpoint (`/calendar`): `sched_units`, `comp_units`, and summary now unit-based; `Partially Completed` included in comp_units
- Visit PATCH: validates `units_serviced ≤ units_scheduled ≤ total_elevator_units`; auto-derives `units_not_serviced = units_scheduled - units_serviced`; auto-sets status to `Partially Completed` when completing with partial units

**DB (`db/db.js`)**
- Startup migration adds `units_scheduled` column to `maintenance_visits` and backfills from `total_elevator_units` or linked contract

**Frontend (`public/js/maintenance_contracts.js`)**
- `MAINT_VISIT_STATUS_OPTS`: added `'Partially Completed'`
- `MAINT_CAL_STATUS_COLORS`: added `'Partially Completed'` (yellow); updated Postponed colour
- Visit form: added `Units Scheduled` field between Total Elevator Units and Units Serviced; auto-compute now uses `units_scheduled`; Unserviced Reason field shows/hides based on `units_not_serviced > 0`; client-side validation checks `units_serviced ≤ units_scheduled`
- Monthly Calendar: summary KPI cards now show Scheduled/Completed/Partial/Postponed/Hold/Unserviced units + Completion %; chips show `REF X/Yu` format with colour-coded completion ratio
- Maintenance Dashboard: KPI card labels updated to "Scheduled Units", "Completed Units", "Partial Units", etc.; drill-down shows `serviced/scheduled u` column; technician table updated to unit columns
- Schedule tab: units display uses `units_scheduled` as denominator

**Reports (`reports/builder.js`)**
- Report 15 (Monthly Maintenance): all summary totals, monthly breakdown, technician performance, and emirate summary now unit-based using `SUM(units_scheduled)` and `SUM(units_serviced)`; `partial` count added to summary
- MN-7 (Upcoming Visits): summary unit-based; added `units_scheduled` and `units_serviced` detail columns

---
## v2026.07.14.04 — 2026-07-14
### Added
- Monthly Calendar tab in Maintenance Module (between Monthly Schedule and Maintenance Dashboard)
- Backend: GET /api/maintenance-contracts/calendar — groups visits by effective date (postponed→postponed_date, others→scheduled_date), returns dayMap with entries, sched_units, comp_units; unscheduled contracts list; summary KPIs
- Frontend: Year/month selector + filters (contract_ref, client, emirate, type)
- Summary KPI strip: Total Visits, Completed, Pending/Sched., Postponed, Hold, Unscheduled
- 7-column Sun-Sat calendar grid — color-coded chips per status, unit count per day
- Click chip → entry detail modal with Mark Complete / Postpone / Hold action forms
- Click day cell (multi-visit) → day overview modal → entry modal drill-down
- Unscheduled contracts table below calendar (contracts in monthly schedule with no visit logged)
- Status colour legend
- Print button (window.print)
- State persisted in MaintContractsState: calYear, calMonth, calFilters, _calEntries

# SH-PMS Changelog

All notable changes to the SH Project Management System are recorded here.
Format: [Version] — [Date] — [Summary]

---

## v2026.07.14.03 — 2026-07-14
### Maintenance Dashboard — Monthly Filter
- Added Month selector (default = current month) next to the Year selector on the Maintenance Dashboard tab
- All visit KPIs (Scheduled, Completed, Pending, Overdue, Hold, Postponed, Missed) now filter to the selected month only
- Total AMC Contracts remains a global count (no month filter)
- Renamed KPI cards with month suffix: "Completed Visits – July 2026" etc.
- Reordered cards: Total AMC → Scheduled → Completed → Pending → Overdue → Completion % → Hold → Postponed → Missed (Cancelled card removed)
- Each card is clickable — reveals a drill-down table of that status for the selected month; clicking again collapses it
- Backend: `GET /api/maintenance-contracts/dashboard` now accepts `month` query param; returns `completed_list`, `pending_list` in addition to existing lists
- Try-catch added to all JSON.parse(technicians) calls in the dashboard endpoint

### MN-7: Upcoming Month Scheduled Visits Report
- New report added to Reports → Maintenance: "Upcoming Month Scheduled Visits"
- Defaults to next calendar month on selection
- Full filter set: Year, Month, Contract Ref., Client, Emirate, Type, Status, Technician, Sort
- Summary KPIs: Total Scheduled, Completed, Pending, Overdue, Total Units
- Excel / PDF / Print export supported
- Files changed: `routes/maintenance_contracts.js`, `public/js/maintenance_contracts.js`, `reports/builder.js`, `public/js/reports.js`, `public/index.html`

## SH-PMS-v2026.07.13.02 — 2026-07-13

**Modules:** Reports, Accounts, QA Audit

### Fixed
- **Critical**: `reports/builder.js` Reports 1 (Sales), 6 (Salesperson Performance), and 11 (Contracts by Salesperson) all joined `alert_payments.paid_amount` instead of `client_payments.received_amount` for received/collected amount totals. `alert_payments` had only 1 row (AED 4,000); `client_payments` has 208 rows (AED 17,654,473.75). All financial totals in these reports were therefore near-zero instead of correct.
- **Critical**: `reports/builder.js` Report 2 (Client Payment Pending) used `alert_payments.paid_amount` to compute outstanding balances, causing almost every contract to appear as fully outstanding. Fixed by adding a `client_payments` subquery for total received, keeping `alert_payments` as optional enrichment for invoice metadata only.
- **Critical**: `reports/builder.js` Report 7 (Monthly Management) hardcoded `collections: 0` and `outstanding: contractVal` with a comment "alert_payments currently empty". Fixed by querying `client_payments` grouped by `entry_date` month for real monthly collections.
- **Bug**: `routes/accounts.js` `syncContractPaymentTotals()` queried `MAX(payment_date)` against `client_payments`, but that column is `entry_date` (not `payment_date`). This would throw "no such column" on every payment add/edit/delete via the UI. Fixed to `MAX(entry_date)`.
- **Bug**: `routes/accounts.js` client payment history query selected `payment_date` from `client_payments` (column doesn't exist). Removed the invalid column.

### Changed
- `reports/builder.js` data source comment updated to reflect that `client_payments` is the primary payment source and `alert_payments` is metadata-only (invoice tracking).

---

## SH-PMS-v2026.07.13.01 — 2026-07-13

**Modules:** Contracts, Factory & Suppliers, Data Integrity System

### Added
- `app_versions` table in SQLite DB — records every applied update with version string, affected modules, record counts before/after, rollback point, and change summary.
- `VERSION.json` — current system state snapshot (version, build date, record counts, change list).
- `scripts/integrity-check.js` — validates table existence, record counts vs baseline, duplicate ref keys, broken factory links, null mandatory fields, audit log and version history. Exits non-zero on errors.
- `scripts/safe-backup.js` — versioned backup/restore with `.meta.json` sidecar (version, counts, label, size). Refuses to restore an older version over a newer one without `--force`.
- `db/backups/` directory convention for all versioned backups.
- `GET /api/factory/search-for-link` — searches all 3 factory tables (INS, OTJ, SEA) across 5 fields (factory_ref, client_name, supplier_name, project_description, contract_ref). Returns up to 50 results with link status indicators.
- `POST /api/factory/create-for-link` — creates a new factory record in any of the 3 tables and immediately links it to the specified contract. Writes audit log.
- Factory Link tab (Contracts module) — 3-section inline UI replacing the old popup modal:
  - Section 1: Linked Factory Records table with colour-coded link status badge.
  - Section 2: Search existing factory records with sheet filter; Link / Re-link actions with confirmation dialog.
  - Section 3: Create Manual Factory Record form (Create & Link in one step).
- `GET /api/admin/system-info` endpoint — returns version, record counts, uptime, Node version.

### Fixed
- **Critical**: `GET /api/factory/search-for-link` was returning "Not Found" because `router.get('/:id')` in `routes/factory.js` was registered *before* `router.get('/search-for-link')`. Express matched the wildcard first and queried `factory_orders` for ID "search-for-link". Fixed by moving specific routes before the wildcard (line 579 < line 712).

### Changed
- `search-for-link` permission changed from `requireModule('factory')` to `requireModule('contracts')` — the endpoint is called from the Contracts module context.
- Cache busters bumped: `contracts.js?v=20260713c`, `factory.js?v=20260713c`.

### DB Backup
- `db/sh_pms_backup_20260713_factory_link.sqlite` — pre-session baseline.

---

## SH-PMS-v2026.07.12.01 — 2026-07-12

**Modules:** Maintenance (redesign), Contracts (elevator units + maintenance link)

### Added
- Maintenance module complete redesign: 4 new DB tables (`maintenance_projects`, `maintenance_project_visits`, `maintenance_project_history`, `maintenance_renewal_history`), MNT-YYYY-NNNN ID scheme, 4-tab frontend, 6 new reports.
- One-time migration: 168 records from `maintenance_contracts` → `maintenance_projects` (all flagged `needs_review`).
- Legacy module kept as "Maintenance (Legacy)" for reference.
- `elevator_units` column on contracts (integer, default 1) — all sales counting uses `SUM(elevator_units)` not `COUNT(*)`.
- `linked_maintenance_id`, `maintenance_linked_by`, `maintenance_linked_at` columns on contracts — bidirectional 1:1 link to Maintenance record.
- `mn_rollback_archive` table — rollback-safe archive of maintenance_projects before destructive changes.

---

## SH-PMS-v2026.07.11.01 — 2026-07-11

**Modules:** Factory (INS Quotes), Payments

### Added
- `quantity`, `order_date`, `shipping_mode` columns on `factory_ins_quotes`.
- `last_payment_date` columns on contracts, factory_ins_quotes, factory_otj_quotes, factory_sea_costs (payment sync).
- `maintenance_visits` and `maintenance_visit_technicians` tables for per-month visit tracking.

### Data Import
- 415 factory payment rows imported (USD 2,108,416 total); FP-IMP-0001–FP-IMP-0410 series.

---

## SH-PMS-v2026.07.10.01 — 2026-07-10

**Modules:** Factory Payments

### Added
- 410 factory payment rows imported from ED-SH-FACTORY-QUOTES.xlsx.
- FJ-3062 data-entry correction applied; FJ-5025 placeholder date 1900-01-01 noted.

---

## SH-PMS-v2026.07.07.01 — 2026-07-07

**Modules:** Contracts (Cancellation), Multi-Currency

### Added
- Cancellation feature: 5 DB columns on contracts (`cancellation_type`, `cancellation_date`, `payment_retention_status`, `refund_status`, `cancellation_remarks`), filter + modal section, Report 13 (cancelled contracts), badge styles.
- Multi-currency architecture: `currency_code` and `currency_symbol` columns added to 8 tables; `fmtCurrency()` helper in `common.js`; AED default for client-side, USD default for factory-side.
- Nav renamed/reordered per user spec.

---

## SH-PMS-v2026.07.03.01 — 2026-07-03

**Modules:** Quotations (Lifecycle Hub)

### Added
- `project_lifecycle` and `quotation_revisions` DB tables.
- Full lifecycle API in `routes/links.js`.
- Revision management in quotations module.
- Stage badges.
- 398 pre-populated lifecycle rows.

---

## SH-PMS-v2026.07.02.01 — 2026-07-02

**Modules:** Contracts, Quotations, Alerts, Reports, Factory

### Changed
- Contracts module: 11-field redesign, new status options.
- Quotations module: Quote Ref. as primary ID, Quoted Value (was Contract Value), DB CHECK constraint rebuilt.
- Alerts module: 5-tab rebuild (Expiring Contracts, Renewal Status, Payment Status, Call Back/Emergency, Monthly CB Summary).
- Reports module: 12 reports rebuilt from Contracts/Maintenance/Factory; filter+pagination+sort+export; sidebar UI.
- Factory/Suppliers module: 3-tab layout (SEA COSTS / OTJ COSTS / INS QUOTES), Add New per tab, expanded sort, soft-delete.

---

## SH-PMS-v2026.07.01.01 — 2026-07-01

**Modules:** Accounts & Payments (initial)

### Added
- `client_payments` and `factory_payments` tables with full CRUD.
- Payment tracking columns on contracts (`total_received`, `payment_status`, `balance_amount`).
- 208 client payment rows imported.
- Accounts module UI (2-tab: Client Payments / Factory Payments).
- Dashboard payment KPI cards.

---

## SH-PMS-v2026.06.01.01 — 2026-06-01

**Modules:** Emirates Quotes Import

### Added
- 150 new 2026 quotations imported from "SH QUOTES - 2026" sheet of ED-SH-EMIRATES-QUOTES.xlsx.
- `monthly_quotations_2026` dashboard field.

---

## SH-PMS-v2026.05.01.01 — 2026-05-01 (approximate)

**Modules:** All core modules

### Foundation
- Initial build: Dashboard, Contracts, Quotations, Factory & Suppliers, Maintenance (Legacy), Alerts, Reports, Users/Admin.
- SQLite DB with `node:sqlite` DatabaseSync (experimental), no native build step.
- Express.js backend on port 4000; single-page frontend with module-based JS files.
- Role-based permissions: Admin, Manager, Sales, Viewer.
- FUSE mount workaround: `PRAGMA journal_mode = MEMORY` (no sidecar journal file).

---

*This changelog is maintained by the SH-PMS Data Integrity system. Each entry corresponds to a row in the `app_versions` table.*

## [v2026.07.14.01] — 2026-07-14

### Fixed
- **Save Visit error "no such table: main.maintenance_visits_bak"** — Added orphan bak-table cleanup
  block in `db/db.js` that runs at server startup before the 2026-07-11b migration. Detects and
  resolves both `maintenance_visits_bak` and `maintenance_visits_sn_bak` orphans left by FUSE
  crash mid-migration. If bak exists and main table is intact → DROP bak; if bak exists and main
  is missing → RENAME bak back to main so migration re-runs cleanly.
- **Save Visit error message sanitized** — `PATCH /:id/visits/:visitId` in
  `routes/maintenance_contracts.js` now logs full error (visitId, contractId, user, message,
  stack) to server console and returns the user-friendly message
  "Unable to save the Maintenance Visit. Please contact the administrator." instead of the raw
  SQLite error string.

### Added
- DB backup: `db/sh_pms_backup_20260714_152228_pre_bak_fix.sqlite`

