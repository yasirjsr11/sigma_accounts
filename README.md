# Sigma Height Elevators — Project Management System

A complete, private, offline-capable business management tool for tracking client projects, factory/supplier orders, payments, and shipments. Runs entirely on your own computer — no internet required, no monthly fees, no third party holding your data.

## 1. First-time setup

1. Install **Node.js version 22 or newer** if it isn't already installed: https://nodejs.org/ (download the "LTS" installer, click through with defaults).
2. Double-click **`start.bat`** inside this folder.
   - The first time, it will take a minute or two to install some components automatically — this only happens once.
   - A browser window will open to the system automatically.
3. **Keep the black command window open** while you're using the system — closing it shuts the system down. Minimizing it is fine.

To stop the system, close the black command window. To start it again later, just double-click `start.bat` again — all your data is saved.

## 2. Logging in

Six accounts were created from your existing data. **Change these passwords after your first login** (Users module, admin only).

| Username | Password | Role |
|---|---|---|
| admin | Admin@123 | Full access, including Users and Backup |
| sales | Sales@123 | Sales / client projects |
| accounts | Accounts@123 | Payments and financials |
| coordinator | Coord@123 | Project coordination |
| installer | Install@123 | Installation team |
| viewer | Viewer@123 | Read-only |

Each role only sees the menus and fields relevant to their job. Admin can adjust this in the Users module. In the Contracts module specifically, only **admin** can create a new contract or delete one; **admin** and **accounts** can both edit an existing contract's status/value/date fields and set yearly salesperson targets — other roles (sales, viewer) can view, search, filter, sort, and export the Contracts list and Dashboard but not change anything, since contract values are sensitive financial data.

## 3. What's already in the system

Your two spreadsheets (`SH_EMIRATES_QUOTES.xlsx` and `SH-FACTORY QUOTES.xlsx`) have already been imported:

- **1,938 client projects** (across all years/sheets, including AMC, OTJ, Installation, BuildIn)
- **515 factory/supplier orders**
- **24 projects automatically linked** to their matching factory order by project code / quotation number

**Important data note:** in your original spreadsheets, most historical "Confirmed" projects were never given a contract value (only 7 of 237 have one filled in). The system imported this as-is rather than guessing numbers — you'll want to fill these in over time as you touch each project, and the dashboard totals will become more accurate as you do.

Your "All Contract Updates" spreadsheet has also been imported into the **Contracts** module: **273 contracts**, of which **30 were automatically linked** to an existing client project by matching Quotation Ref. The remaining contracts simply have no matching project record in the system yet — they still appear and work normally in the Contracts module, just without a "Linked Project" value. Going forward, every new or confirmed quotation can be turned into a contract (or just tracked as one) directly from the Contracts module without re-typing anything already on file.

**2026-06-26 update — Client Projects module cleared:** at your request, all records were removed from the Client Projects module to prepare it for a clean restart. The module, its table, filters, and permissions are all still in place and ready for new entries — only the old data was removed. This did not touch Contract Records or Maintenance Records, which remain fully intact. See the Maintenance Records entry below for the related field and scheduling changes made at the same time.

## 4. Modules

- **Dashboard** — the Main Dashboard now shows only Factory Orders activity (Under Production, Shipped, Pending Supplier Payments count/value) plus the existing Maintenance & AMC Overview panel (scheduled, in progress, overdue, completed this month, AMC active/expiring/expired/pending collection value). Client Projects KPIs and the salesperson/year/month performance tables were removed from this view as part of the 2026-06-26 update — Contracts keeps its own dashboard with that detail (see below), and the new Maintenance Records module has its own dedicated Maintenance Dashboard (see below).
- **Projects** — every client project: status, quotation, contract value, payments, delivery, installation, handover, remarks, file attachments, and full edit history. **Currently empty** as of 2026-06-26 (cleared at your request) — add new projects here whenever you're ready; nothing about how the module works has changed.
- **Factory Orders** — every supplier order: quotation, order confirmation, production, invoice, supplier payments, packing list, BL copy, shipping, ETA, delivery.
- **Linking** — connect a client project to its factory order (auto-detected where possible, or link manually).
- **Maintenance** — elevator service/AMC visit records, always linked to a client project. Tracks maintenance ID, building, elevator type/serial, maintenance category (Preventive, Corrective, Emergency Breakdown, Annual Inspection), service date, technician, work done, parts replaced, status, next due date, customer remarks, a digital signature pad, and Service Report/Photo uploads. Includes a Monthly/Weekly/Daily calendar view, an Overdue list, and automatic recurring-visit scheduling.
- **AMC Contracts** — annual maintenance contracts per project: contract value, payment status (Advance/Partial/Final/Full), amount received, contract period, included visits, and contract status (Active/Expiring Soon/Expired/Renewed/Cancelled). Each contract shows its linked maintenance visit history.
- **Contracts** — tracks confirmed sales contracts, separate from AMC. Each contract has: Contract Ref. (auto-numbered, e.g. SH254), Quotation Ref. (soft-linked to a client project when a match exists — no duplicate data entry needed), Client/Company Name, Emirate, Approval Date, Sales By, Delivery Status, Mechanical Status, Electrical Status, Handover Date, and Contract Value. Searchable list with filters and sorting by salesperson, month, year, contract value, and date — both ascending and descending. Includes a **Yearly Individual Target Entry** screen where admin/accounts manually set each salesperson's sales target for a year, and a **Dashboard** sub-view with summary cards (total contracts, total contract value) plus a per-salesperson table of monthly/yearly contracts achieved, monthly value achieved, yearly target, year-to-date achieved value, balance against target, and achievement % — both monthly and yearly, using the formula **Achievement % = Total Achieved ÷ Target Value × 100**. Month-wise and year-wise performance summary tables are included alongside. Every field change is logged to a History tab, same as other modules. Exports to Excel/PDF with the company logo as the default header, like every other module.
- **Maintenance Records** — a separate, Contract-Ref.-keyed module rebuilt from your AMC tracking sheet, distinct from the existing Maintenance and AMC Contracts modules above. As of the 2026-06-26 update, each record contains only client and schedule information — Project/Site Name was removed entirely. The field list is: Contract Ref., Client/Company Name, Emirate, Maintenance Type, Maintenance Start Date, Maintenance End Date, Maintenance Period, Renewal Status, Current Status, Assigned Technician, Last Service Date, Next Service Date, Monthly Schedule, Remarks, Last Updated Date. Every record's Contract Ref. is automatically checked against the Contracts module and flagged Linked, Contract Ref. Not Found, or Pending Contract Ref.
  - **Manual Monthly Schedule** — every client can be assigned one or more months (January–December) for service, independent of the Maintenance Period calculation (e.g. quarterly clients on Jan/Apr/Jul/Oct, or a client serviced Every Month). Editable at any time from the record; each change is logged to its History tab.
  - **Monthly Maintenance Views** — January Maintenance through December Maintenance: twelve filtered views, each showing only the clients assigned to that month. Not shown on the Main Dashboard.
  - **Maintenance Dashboard** — a dedicated dashboard for this module: Total Active AMC Contracts, Expired AMC Contracts, Renewals Due, Services Pending This Month, Services Completed This Month, Clients Scheduled This Month.
  - Still includes Excel and PDF export (company-logo header, with a Signature column for the maintenance team to sign off on each visit).
- **Alerts** — automatic flags for things needing attention: payment overdue, no movement in X days, missing contract value on a confirmed deal, ETA passed with no delivery logged, maintenance overdue or due within 7 days, and AMC contracts expiring within 30 days or already expired. Recomputes every 30 minutes, or click "Recompute Now." (Contracts is not wired into this automatic alert engine — delivery/mechanical/electrical status are visible and sortable in the module itself instead.)
- **Reports** — 15 report types (the original 7, plus Monthly Maintenance Summary, Technician Performance, AMC Contract Status, Breakdown Analysis, and Payment Collection, plus three Contracts reports — Contracts List, Salesperson Performance, and Target vs Achievement), previewable on-screen or downloadable as Excel or PDF, each with the company logo as the default header.
- **Users** (admin only) — add/edit/deactivate staff accounts and roles.
- **Backup** (admin only to run/download) — see below.

Every status change anywhere in the system is logged automatically (who changed what, from what value, to what value, when, with optional remarks) — visible on the History tab of each project/order/maintenance record/AMC contract.

Each maintenance record must be linked to an existing client project (no standalone entries) — this keeps service history tied to the right client and building automatically.

## 5. Adding new data later

- **Manually**: use the "+ New Project" / "+ New Factory Order" buttons — full add/edit/delete is supported everywhere (delete is admin-only, and is a safety-checked soft-delete, not a permanent wipe).
- **From updated spreadsheets**: re-running the import (ask your developer/Claude to re-run `import/import_excel.js` against an updated file) will update existing records by matching project code / quotation number and add any brand-new rows — it never deletes or overwrites history.

## 6. Backups

- An automatic backup runs every night at 2:00 AM, and old backups are pruned weekly (keeps the last 14 days, max 12 files) so the backup folder doesn't grow forever.
- Admin can also click "Run Manual Backup" any time from the Backup module.
- Each backup is a single `.zip` containing the full database, your original source spreadsheets, and all uploaded file attachments — download it from the Backup module and store a copy somewhere safe (USB drive, cloud folder, email to yourself) periodically.
- To restore: stop the system, replace `db/sh_pms.sqlite` with the one extracted from a backup zip, restart.

## 7. Folder structure (for reference)

```
SH-PMS-App/
  server.js          → the application
  db/                 → the database (sh_pms.sqlite) and schema
  routes/             → API logic per module
  public/             → the web interface (what you see in the browser)
  uploads/            → uploaded attachments + original source spreadsheets
  backups/            → backup zip files land here
  start.bat           → double-click this to run everything
```

## 8. The company logo

The header and login screen currently show a placeholder icon and wordmark ("Sigma Height Elevators" in text) instead of your real logo. As soon as you have a logo image file, send it over and it will be dropped in to replace the placeholder — no other changes needed.

## 9. Troubleshooting

- **"Node.js was not found"** when running start.bat → install Node.js from nodejs.org, then try again.
- **Browser doesn't open automatically** → manually go to `http://localhost:4000` in any browser while the black window is open.
- **Forgot a password** → log in as admin and reset it from the Users module.
- **Need to run this on a different computer** → copy this entire folder (including the `db` folder, which holds all your data) to the new machine, install Node.js there, and run `start.bat`.
