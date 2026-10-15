const express = require('express');
const { run, get, all } = require('../db/db.js');
const { getTotalContractUnits } = require('../db/contractMetrics.js');
const { requireModule, requireRole } = require('../middleware/auth.js');
const { filterFieldsForRole, CONTRACT_MANAGERS } = require('../middleware/permissions.js');
const { writeAuditLog } = require('../db/audit.js');
const FL = require('../db/factoryLinks.js');
const router = express.Router();

const TRACKED_FIELDS = [
  'contract_value', 'approval_date', 'sales_by', 'quote_ref', 'emirate', 'elevator_units',
  'delivery_status', 'mechanical_status', 'electrical_status', 'handover_date', 'remarks',
  'cancellation_type', 'cancellation_date', 'payment_retention_status', 'refund_status', 'cancellation_remarks',
  'delivery_date', 'mechanical_completion_date', 'electrical_completion_date',
];

function requireContractManager(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'Not logged in' });
  if (!CONTRACT_MANAGERS.includes(req.session.user.role)) {
    return res.status(403).json({ error: `Your role (${req.session.user.role}) cannot manage contracts` });
  }
  next();
}

function nextContractRef() {
  const rows = all(`SELECT contract_ref FROM contracts`);
  let max = 0;
  for (const r of rows) {
    const m = /^SH(\d+)/.exec(r.contract_ref || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `SH${String(max + 1).padStart(2, '0')}`;
}

function findLinkedProjectId(quoteRef) {
  if (!quoteRef) return null;
  const p = get(`SELECT id FROM quotations WHERE quote_ref = ? AND is_deleted = 0 LIMIT 1`, [quoteRef]);
  return p ? p.id : null;
}

// ---------- List / filter / sort ----------
router.get('/', requireModule('contracts'), (req, res) => {
  const { search, sales_by, emirate, year, month, sort, dir, page = 1, pageSize = 50 } = req.query;
  const where = ['c.is_deleted = 0'];
  const params = [];
  if (search) {
    where.push('(c.contract_ref LIKE ? OR c.quote_ref LIKE ? OR c.client_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (sales_by) { where.push('c.sales_by = ?'); params.push(sales_by); }
  if (req.query.cancellation_type) { where.push('c.cancellation_type = ?'); params.push(req.query.cancellation_type); }
  if (req.query.cancelled_only === '1') { where.push('c.cancellation_type IS NOT NULL'); }
  if (emirate) { where.push('c.emirate = ?'); params.push(emirate); }
  if (year) { where.push(`strftime('%Y', c.approval_date) = ?`); params.push(String(year)); }
  if (month) { where.push(`strftime('%Y-%m', c.approval_date) = ?`); params.push(String(month)); }
  if (req.query.project_status) { where.push('c.project_status = ?'); params.push(req.query.project_status); }
  if (req.query.factory_ref) {
    const frPat = `%${req.query.factory_ref}%`;
    // 2026-10-10: authoritative Contract ↔ Factory relationship (factory_contract_links)
    where.push(FL.FACTORY_REF_FILTER_SQL('c'));
    params.push(frPat);
  }

  // Sortable columns: numeric (contract_value, id) and date (approval_date, handover_date) ascending/descending
  const SORT_COLS = {
    contract_value: 'c.contract_value',
    contract_ref: 'c.contract_ref',
    client_name: 'c.client_name',
    approval_date: 'c.approval_date',
    // Date sorts: real chronological order (ISO YYYY-MM-DD); undated rows always
    // last in BOTH directions (the leading "IS NULL" key is ascending, the date key
    // takes the requested direction).
    handover_date: `(c.handover_date IS NULL OR c.handover_date = '') ASC, c.handover_date`,
    elevator_units: 'c.elevator_units',
    delivery_status: `CASE COALESCE(c.delivery_status,'') WHEN 'Hold' THEN 1 WHEN 'Active' THEN 2 WHEN 'Shipping' THEN 3 WHEN 'Delivered' THEN 4 WHEN 'Cancel' THEN 5 ELSE 0 END`,
    delivery_date: `(c.delivery_date IS NULL OR c.delivery_date = '') ASC, c.delivery_date`,
    mechanical_completion_date: `(c.mechanical_completion_date IS NULL OR c.mechanical_completion_date = '') ASC, c.mechanical_completion_date`,
    electrical_completion_date: `(c.electrical_completion_date IS NULL OR c.electrical_completion_date = '') ASC, c.electrical_completion_date`,
    project_status: `CASE COALESCE(c.project_status,'Active') WHEN 'Active' THEN 1 WHEN 'Hold' THEN 2 WHEN 'Delay' THEN 3 WHEN 'Cancelled' THEN 4 ELSE 5 END`,
  };
  const sortCol = SORT_COLS[sort] || 'c.approval_date';
  const sortDir = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const whereSql = where.join(' AND ');
  const total = get(`SELECT COUNT(*) c FROM contracts c WHERE ${whereSql}`, params).c;
  const limit = Math.min(parseInt(pageSize) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const rows = all(`
    SELECT c.*, p.project_code AS linked_project_code, p.status AS linked_project_status,
      CASE WHEN c.linked_maintenance_id IS NOT NULL THEN 1 ELSE 0 END AS has_maintenance_link,
      mc.id AS mc_id, mc.contract_ref AS mc_contract_ref,
      ${FL.FACTORY_REFS_SQL('c')} AS linked_factory_refs,
      ${FL.FACTORY_REF_COUNT_SQL('c')} AS factory_ref_count
    FROM contracts c
    LEFT JOIN quotations p ON p.id = c.project_id
    LEFT JOIN maintenance_contracts mc ON mc.id = c.linked_maintenance_id
    WHERE ${whereSql} ORDER BY ${sortCol} ${sortDir}, c.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);

  // factory_refs[] / factory_ref_display derived from the relational links (2026-10-10)
  rows.forEach(r => { r.factory_refs = r.linked_factory_refs ? String(r.linked_factory_refs).split(', ').map(f => ({ factory_ref: f })) : [];
    r.factory_ref_display = r.linked_factory_refs || 'Not Linked'; });
  res.json({ total, page: Number(page), pageSize: limit, rows });
});

router.get('/meta/salespeople', requireModule('contracts'), (req, res) => {
  const rows = all(`
    SELECT DISTINCT sales_by AS name FROM contracts WHERE is_deleted = 0 AND sales_by IS NOT NULL
    UNION
    SELECT DISTINCT salesperson AS name FROM quotations WHERE is_deleted = 0 AND salesperson IS NOT NULL
    ORDER BY name`);
  res.json({ rows: rows.map(r => r.name).filter(Boolean) });
});

router.get('/meta/emirates', requireModule('contracts'), (req, res) => {
  const rows = all(`SELECT DISTINCT emirate AS name FROM contracts WHERE is_deleted = 0 AND emirate IS NOT NULL ORDER BY name`);
  res.json({ rows: rows.map(r => r.name).filter(Boolean) });
});

// ---------- Dashboard ----------
router.get('/dashboard', requireModule('contracts'), (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = req.query.month || `${year}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // total_contracts sourced from db/contractMetrics.js - same function the Main Dashboard uses.
  const totals = {
    total_contracts: getTotalContractUnits(),  // COUNT(*) of non-deleted contracts
    total_contract_value: get(`SELECT COALESCE(SUM(contract_value),0) AS v FROM contracts WHERE is_deleted = 0`).v,
  };

  // Salesperson performance + target vs achievement (count-based)
  const targets = all(`SELECT salesperson, target_units, remarks FROM sales_targets WHERE year = ?`, [year]);
  const targetMap = Object.fromEntries(targets.map(t => [t.salesperson, t.target_units]));

  // All-time: COUNT(*) as contracts_count
  const perSalesAll = all(`
    SELECT COALESCE(sales_by,'Unassigned') AS salesperson,
           COALESCE(SUM(COALESCE(elevator_units,1)),0) AS contracts_count,
           COALESCE(SUM(contract_value),0) AS contract_value_sum
    FROM contracts WHERE is_deleted = 0
    GROUP BY COALESCE(sales_by,'Unassigned') ORDER BY contracts_count DESC`);

  // Achieved contracts = COUNT(*) by approval_date year and salesperson
  // Includes Cancelled (they have Contract Ref.), excludes is_deleted
  const perSalesYear = all(`
    SELECT COALESCE(sales_by,'Unassigned') AS salesperson,
           COALESCE(SUM(COALESCE(elevator_units,1)),0) AS yearly_contracts
    FROM contracts WHERE is_deleted = 0 AND strftime('%Y', approval_date) = ?
    GROUP BY COALESCE(sales_by,'Unassigned')`, [String(year)]);
  const yearMap = Object.fromEntries(perSalesYear.map(r => [r.salesperson, r]));

  const perSalesMonth = all(`
    SELECT COALESCE(sales_by,'Unassigned') AS salesperson,
           COALESCE(SUM(COALESCE(elevator_units,1)),0) AS monthly_contracts
    FROM contracts WHERE is_deleted = 0 AND strftime('%Y-%m', approval_date) = ?
    GROUP BY COALESCE(sales_by,'Unassigned')`, [String(month)]);
  const monthMap = Object.fromEntries(perSalesMonth.map(r => [r.salesperson, r]));

  const names = new Set([...perSalesAll.map(r => r.salesperson), ...Object.keys(targetMap)]);
  const salesperson_performance = [...names].map(name => {
    const allRow = perSalesAll.find(r => r.salesperson === name) || { contracts_count: 0, contract_value_sum: 0 };
    const yr = yearMap[name] || { yearly_contracts: 0 };
    const mo = monthMap[name] || { monthly_contracts: 0 };
    const targetUnits = targetMap[name] != null ? targetMap[name] : null;
    const achievedUnits = yr.yearly_contracts || 0;
    const monthlyAchievedUnits = mo.monthly_contracts || 0;
    const remainingUnits = targetUnits != null ? Math.max(0, targetUnits - achievedUnits) : null;
    const yearlyAchievementPct = (targetUnits != null && targetUnits > 0) ? Math.round((achievedUnits / targetUnits) * 10000) / 100 : null;
    const monthlyTargetUnits = (targetUnits != null && targetUnits > 0) ? targetUnits / 12 : null;
    const monthlyAchievementPct = (monthlyTargetUnits != null && monthlyTargetUnits > 0) ? Math.round((monthlyAchievedUnits / monthlyTargetUnits) * 10000) / 100 : null;
    return {
      salesperson: name,
      total_contracts: allRow.contracts_count,
      total_contract_value: allRow.contract_value_sum,
      monthly_contracts_achieved: monthlyAchievedUnits,
      yearly_contracts_achieved: achievedUnits,
      yearly_target_units: targetUnits,
      remaining_units: remainingUnits,
      monthly_achievement_pct: monthlyAchievementPct,
      yearly_achievement_pct: yearlyAchievementPct,
    };
  }).sort((a, b) => b.total_contracts - a.total_contracts);

  const month_wise = all(`
    SELECT strftime('%Y-%m', approval_date) AS month,
           COALESCE(SUM(COALESCE(elevator_units,1)),0) AS total_contracts,
           COALESCE(SUM(contract_value),0) AS total_value
    FROM contracts WHERE is_deleted = 0 AND approval_date IS NOT NULL
    GROUP BY month ORDER BY month DESC LIMIT 24`);

  const year_wise = all(`
    SELECT strftime('%Y', approval_date) AS year,
           COALESCE(SUM(COALESCE(elevator_units,1)),0) AS total_contracts,
           COALESCE(SUM(contract_value),0) AS total_value
    FROM contracts WHERE is_deleted = 0 AND approval_date IS NOT NULL
    GROUP BY year ORDER BY year DESC`);

  res.json({ year, month, totals, salesperson_performance, month_wise, year_wise });
});

// ---------- Yearly individual target entry ----------
router.get('/targets', requireModule('contracts'), (req, res) => {
  const { year, salesperson } = req.query;
  const where = [], params = [];
  if (year) { where.push('t.year = ?'); params.push(year); }
  if (salesperson) { where.push('t.salesperson = ?'); params.push(salesperson); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  // Join with contracts to compute achieved/remaining/pct per row
  const rows = all(`
    SELECT t.*,
      (SELECT COALESCE(SUM(COALESCE(elevator_units,1)),0) FROM contracts c WHERE c.is_deleted=0 AND c.sales_by=t.salesperson
       AND strftime('%Y',c.approval_date)=CAST(t.year AS TEXT)) AS achieved_units
    FROM sales_targets t ${whereSql} ORDER BY t.year DESC, t.salesperson ASC`, params);
  const enriched = rows.map(r => {
    const remaining = Math.max(0, r.target_units - (r.achieved_units || 0));
    const pct = r.target_units > 0 ? Math.round(((r.achieved_units || 0) / r.target_units) * 1000) / 10 : null;
    return { ...r, remaining_units: remaining, achievement_pct: pct };
  });
  res.json({ rows: enriched });
});

router.post('/targets', requireContractManager, (req, res) => {
  const b = req.body || {};
  if (!b.salesperson || !b.year || b.target_units === undefined || b.target_units === null || b.target_units === '') {
    return res.status(400).json({ error: 'salesperson, year and target_units are required' });
  }
  const targetUnits = parseInt(b.target_units, 10);
  if (isNaN(targetUnits) || targetUnits < 0) {
    return res.status(400).json({ error: 'target_units must be a non-negative integer' });
  }
  const existing = get(`SELECT id FROM sales_targets WHERE salesperson = ? AND year = ?`, [b.salesperson, b.year]);
  if (existing) {
    run(`UPDATE sales_targets SET target_units = ?, remarks = ?, updated_at = datetime('now') WHERE id = ?`,
      [targetUnits, b.remarks || null, existing.id]);
    return res.json({ target: get(`SELECT * FROM sales_targets WHERE id = ?`, [existing.id]) });
  }
  run(`INSERT INTO sales_targets (salesperson, year, target_units, remarks, created_by) VALUES (?,?,?,?,?)`,
    [b.salesperson, b.year, targetUnits, b.remarks || null, req.session.user.username]);
  const target = get(`SELECT * FROM sales_targets WHERE salesperson = ? AND year = ?`, [b.salesperson, b.year]);
  res.status(201).json({ target });
});

router.patch('/targets/:id', requireContractManager, (req, res) => {
  const existing = get(`SELECT * FROM sales_targets WHERE id = ?`, [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const targetUnits = b.target_units !== undefined ? parseInt(b.target_units, 10) : existing.target_units;
  if (isNaN(targetUnits) || targetUnits < 0) {
    return res.status(400).json({ error: 'target_units must be a non-negative integer' });
  }
  run(`UPDATE sales_targets SET target_units = ?, remarks = ?, updated_at = datetime('now') WHERE id = ?`,
    [targetUnits, b.remarks ?? existing.remarks, req.params.id]);
  res.json({ target: get(`SELECT * FROM sales_targets WHERE id = ?`, [req.params.id]) });
});

router.delete('/targets/:id', requireContractManager, (req, res) => {
  const target = get(`SELECT * FROM sales_targets WHERE id = ?`, [req.params.id]);
  if (!target) return res.status(404).json({ error: 'Target not found' });
  run(`DELETE FROM sales_targets WHERE id = ?`, [req.params.id]);
  writeAuditLog({
    action: 'DELETE', module: 'sales_targets',
    recordId: target.id, recordRef: `${target.salesperson} / ${target.year}`,
    details: { salesperson: target.salesperson, year: target.year, target_units: target.target_units },
    performedBy: req.session.user.username,
  });
  res.json({ ok: true });
});

// ── 2026-09-16: GET /api/contracts/handover-report — Handover Report data ────
// Returns: monthly_summary (Jan–Dec rows), detail rows (sortable/filterable register),
// and a summary object with YTD totals. Uses actual handover_date, never approval_date.
router.get('/handover-report', requireModule('contracts'), (req, res) => {
  try {
    const year      = req.query.year   || String(new Date().getFullYear());
    const month     = req.query.month  || '';   // '01'–'12' or ''
    const emirate   = req.query.emirate || '';
    const salesperson = req.query.salesperson || '';
    const search    = (req.query.search || '').trim();
    const sortBy    = req.query.sort_by  || 'handover_date';
    const sortDir   = req.query.sort_dir === 'asc' ? 'ASC' : 'DESC';
    const page      = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize  = Math.min(1000, Math.max(1, parseInt(req.query.page_size || '50', 10)));

    // ── Monthly summary table (Jan–Dec of selected year) ──────────────────────
    const monthlyRows = all(`
      SELECT strftime('%m', handover_date) mm,
             COUNT(*) projects,
             COALESCE(SUM(COALESCE(elevator_units,1)),0) units
      FROM contracts
      WHERE is_deleted = 0
        AND handover_date LIKE ?
      GROUP BY mm`, [year + '%']);

    const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    let cumUnits = 0;
    const monthly_summary = MONTH_LABELS.map((label, i) => {
      const mm = String(i + 1).padStart(2, '0');
      const row = monthlyRows.find(r => r.mm === mm);
      cumUnits += row ? row.units : 0;
      return {
        month: mm,
        label,
        projects: row ? row.projects : 0,
        units: row ? row.units : 0,
        cumulative_units: cumUnits,
      };
    });

    // ── YTD totals ────────────────────────────────────────────────────────────
    const ytd = get(`
      SELECT COUNT(*) projects, COALESCE(SUM(COALESCE(elevator_units,1)),0) units
      FROM contracts
      WHERE is_deleted = 0 AND handover_date LIKE ?`, [year + '%']);

    // ── Detail register ───────────────────────────────────────────────────────
    const params = [];
    let where = `WHERE c.is_deleted = 0 AND c.handover_date LIKE ?`;
    params.push(year + (month ? `-${month}%` : '%'));

    if (emirate)     { where += ` AND c.emirate = ?`;    params.push(emirate); }
    if (salesperson) { where += ` AND c.sales_by = ?`;   params.push(salesperson); }
    if (search) {
      where += ` AND (c.contract_ref LIKE ? OR c.client_name LIKE ? OR c.project_description LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const ALLOWED_SORT = {
      handover_date: 'c.handover_date',
      contract_ref:  'c.contract_ref',
      client_name:   'c.client_name',
      emirate:       'c.emirate',
      salesperson:   'c.sales_by',
      units:         'COALESCE(c.elevator_units,1)',
    };
    const orderCol = ALLOWED_SORT[sortBy] || 'c.handover_date';

    const total = get(`SELECT COUNT(*) c FROM contracts c ${where}`, params).c;
    const offset = (page - 1) * pageSize;
    const rows = all(`
      SELECT c.contract_ref, c.client_name, c.project_description, c.emirate,
             c.sales_by, c.handover_date, c.approval_date,
             COALESCE(c.elevator_units,1) AS units,
             c.delivery_status, c.mechanical_status, c.electrical_status,
             c.contract_value
      FROM contracts c
      ${where}
      ORDER BY ${orderCol} ${sortDir}
      LIMIT ? OFFSET ?`, [...params, pageSize, offset]);

    res.json({
      report_type: 'handover-report',
      year,
      summary: {
        year,
        total_projects: ytd.projects,
        total_units: ytd.units,
      },
      monthly_summary,
      total,
      page,
      page_size: pageSize,
      rows: rows.map(r => [
        r.contract_ref,
        r.client_name || '',
        r.project_description || '',
        r.emirate || '',
        r.sales_by || '',
        r.handover_date || '',
        r.approval_date || '',
        r.units,
        r.delivery_status || '',
        r.mechanical_status || '',
        r.electrical_status || '',
        r.contract_value ? `AED ${Number(r.contract_value).toLocaleString()}` : '',
      ]),
      columns: ['Contract Ref','Client','Project Description','Emirate','Salesperson',
                'Handover Date','Approval Date','Units','Delivery Status',
                'Mechanical Status','Electrical Status','Contract Value'],
    });
  } catch (err) {
    console.error('[GET /api/contracts/handover-report]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── 2026-09-16: GET /api/contracts/delivery-drill — Delivered to Site drill-down ─
// Returns contracts with an actual delivery date in the given year/month.
router.get('/delivery-drill', requireModule('contracts'), (req, res) => {
  try {
    const year  = req.query.year  || String(new Date().getFullYear());
    const month = req.query.month || '';  // '' = YTD, 'MM' = that month
    const pattern = year + (month ? `-${month}%` : '%');

    const rows = all(`
      SELECT c.contract_ref, c.client_name, c.emirate, c.sales_by,
             c.approval_date, c.delivery_status,
             COALESCE(c.elevator_units,1) units,
             c.site_delivery_date,
             (SELECT MAX(f.actual_delivery_date) FROM factory_sea_costs f
              WHERE f.contract_ref = c.contract_ref AND f.actual_delivery_date IS NOT NULL AND f.actual_delivery_date != '') sea_date,
             (SELECT MAX(f.actual_delivery_date) FROM factory_otj_quotes f
              WHERE f.contract_ref = c.contract_ref AND f.actual_delivery_date IS NOT NULL AND f.actual_delivery_date != '') otj_date,
             (SELECT MAX(f.actual_delivery_date) FROM factory_ins_quotes f
              WHERE f.contract_ref = c.contract_ref AND f.actual_delivery_date IS NOT NULL AND f.actual_delivery_date != '') ins_date
      FROM contracts c
      WHERE c.is_deleted = 0
        AND (
          (c.site_delivery_date LIKE ?)
          OR EXISTS (SELECT 1 FROM factory_sea_costs f WHERE f.contract_ref = c.contract_ref AND f.actual_delivery_date LIKE ?)
          OR EXISTS (SELECT 1 FROM factory_otj_quotes f WHERE f.contract_ref = c.contract_ref AND f.actual_delivery_date LIKE ?)
          OR EXISTS (SELECT 1 FROM factory_ins_quotes f WHERE f.contract_ref = c.contract_ref AND f.actual_delivery_date LIKE ?)
        )
      ORDER BY COALESCE(c.site_delivery_date,
        (SELECT MAX(f.actual_delivery_date) FROM factory_sea_costs f WHERE f.contract_ref = c.contract_ref),
        (SELECT MAX(f.actual_delivery_date) FROM factory_otj_quotes f WHERE f.contract_ref = c.contract_ref),
        (SELECT MAX(f.actual_delivery_date) FROM factory_ins_quotes f WHERE f.contract_ref = c.contract_ref)
      ) DESC
      LIMIT 200`, [pattern, pattern, pattern, pattern]);

    res.json({
      rows: rows.map(r => ({
        ...r,
        actual_delivery_date: r.site_delivery_date || r.sea_date || r.otj_date || r.ins_date || '',
      }))
    });
  } catch(err) {
    console.error('[GET /api/contracts/delivery-drill]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── 2026-09-16: GET /api/contracts/handover-drill — Handover drill-down ───────
router.get('/handover-drill', requireModule('contracts'), (req, res) => {
  try {
    const year  = req.query.year  || String(new Date().getFullYear());
    const month = req.query.month || '';
    const pattern = year + (month ? `-${month}%` : '%');

    const rows = all(`
      SELECT contract_ref, client_name, emirate, sales_by, approval_date,
             handover_date, COALESCE(elevator_units,1) units,
             delivery_status, mechanical_status, electrical_status
      FROM contracts
      WHERE is_deleted = 0 AND handover_date LIKE ?
      ORDER BY handover_date DESC
      LIMIT 200`, [pattern]);

    res.json({ rows });
  } catch(err) {
    console.error('[GET /api/contracts/handover-drill]', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Single contract ----------
router.get('/:id', requireModule('contracts'), (req, res) => {
  const contract = get(`
    SELECT c.*, p.project_code AS linked_project_code, p.status AS linked_project_status,
      CASE WHEN c.linked_maintenance_id IS NOT NULL THEN 1 ELSE 0 END AS has_maintenance_link,
      mc.id AS mc_id, mc.contract_ref AS mc_contract_ref, mc.client_name AS mc_client_name,
      mc.renewal_status AS mc_renewal_status, mc.current_status AS mc_current_status,
      ${FL.FACTORY_REFS_SQL('c')} AS linked_factory_refs,
      ${FL.FACTORY_REF_COUNT_SQL('c')} AS factory_ref_count
    FROM contracts c
    LEFT JOIN quotations p ON p.id = c.project_id
    LEFT JOIN maintenance_contracts mc ON mc.id = c.linked_maintenance_id
    WHERE c.id = ?`, [req.params.id]);
  if (!contract) return res.status(404).json({ error: 'Not found' });
  const history = all(`SELECT * FROM contract_history WHERE contract_id = ? ORDER BY changed_at DESC`, [req.params.id]);
  res.json({ contract, history });
});

router.post('/', requireContractManager, (req, res) => {
  const b = req.body || {};
  if (!b.client_name) return res.status(400).json({ error: 'client_name is required' });

  let code = b.contract_ref || nextContractRef();
  let finalCode = code, n = 1;
  while (get('SELECT id FROM contracts WHERE contract_ref = ?', [finalCode])) finalCode = `${code}-${++n}`;

  const projectId = findLinkedProjectId(b.quote_ref);

  const elevatorUnits = Math.max(1, parseInt(b.elevator_units) || 1);
  const _newNow = new Date().toISOString();
  run(`INSERT INTO contracts
    (contract_ref, quote_ref, project_id, client_name, emirate, elevator_units, approval_date, sales_by,
     delivery_status, mechanical_status, electrical_status, handover_date, contract_value, remarks, created_by,
     delivery_date, mechanical_completion_date, electrical_completion_date,
     project_status, project_status_since, project_status_updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [finalCode, b.quote_ref || null, projectId, b.client_name, b.emirate || null, elevatorUnits, b.approval_date || null, b.sales_by || null,
     b.delivery_status || null, b.mechanical_status || null, b.electrical_status || null, b.handover_date || null,
     b.contract_value || null, b.remarks || null, req.session.user.username,
     b.delivery_date || null, b.mechanical_completion_date || null, b.electrical_completion_date || null,
     'Active', _newNow, _newNow]);

  const contract = get('SELECT * FROM contracts WHERE contract_ref = ?', [finalCode]);
  res.status(201).json({ contract });
});

// ── 2026-09-26: Project Status history endpoint ───────────────────────────────
router.get('/:id/status-history', requireModule('contracts'), (req, res) => {
  const history = all(
    `SELECT * FROM contract_status_history WHERE contract_id = ? ORDER BY changed_at DESC`,
    [req.params.id]
  );
  res.json({ history });
});

// ── 2026-09-26: Project Status change endpoint ────────────────────────────────
// Validates the new status and its required conditional fields,
// saves to contracts table, writes a contract_status_history entry.
router.post('/:id/project-status', requireContractManager, (req, res) => {
  const existing = get('SELECT * FROM contracts WHERE id = ? AND is_deleted = 0', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const b = req.body || {};
  const { new_status } = b;
  const VALID = ['Active', 'Hold', 'Delay', 'Cancelled'];
  if (!VALID.includes(new_status))
    return res.status(400).json({ error: `project_status must be one of: ${VALID.join(', ')}` });

  // Per-status required field validation
  if (new_status === 'Hold' && !b.hold_reason)
    return res.status(400).json({ error: 'hold_reason is required when status is Hold' });
  if (new_status === 'Delay' && !b.delay_reason)
    return res.status(400).json({ error: 'delay_reason is required when status is Delay' });
  if (new_status === 'Cancelled') {
    if (!b.cancellation_type)  return res.status(400).json({ error: 'cancellation_type is required when status is Cancelled' });
    if (!b.cancellation_date)  return res.status(400).json({ error: 'cancellation_date is required when status is Cancelled' });
  }

  const now = new Date().toISOString();
  const previousStatus = existing.project_status || 'Active';

  // Build SET clause — always update project_status + timestamps
  const updates = {
    project_status: new_status,
    project_status_updated_at: now,
    updated_at: now,
  };
  if (previousStatus !== new_status) updates.project_status_since = now;

  // Persist conditional fields based on new status
  if (new_status === 'Hold') {
    updates.hold_reason  = b.hold_reason  || null;
    updates.hold_remarks = b.hold_remarks || null;
  } else if (new_status === 'Delay') {
    updates.delay_reason  = b.delay_reason  || null;
    updates.delay_remarks = b.delay_remarks || null;
  } else if (new_status === 'Cancelled') {
    updates.cancellation_type            = b.cancellation_type            || null;
    updates.cancellation_date            = b.cancellation_date            || null;
    updates.payment_retention_status     = b.payment_retention_status     || null;
    updates.refund_status                = b.refund_status                || null;
    updates.cancellation_remarks         = b.cancellation_remarks         || null;
  }

  const setSql = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  run(`UPDATE contracts SET ${setSql} WHERE id = ?`, [...Object.values(updates), req.params.id]);

  // History entry — reason and cancellation snapshot per status
  const histReason = new_status === 'Hold' ? b.hold_reason
    : new_status === 'Delay' ? b.delay_reason : null;
  const histRemarks = new_status === 'Hold' ? (b.hold_remarks || null)
    : new_status === 'Delay' ? (b.delay_remarks || null) : (b.remarks_note || null);

  run(`INSERT INTO contract_status_history
    (contract_id, contract_ref, previous_status, new_status, reason, remarks,
     cancellation_type, cancellation_date, payment_retention_status, refund_status, cancellation_remarks,
     changed_at, changed_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [req.params.id, existing.contract_ref, previousStatus, new_status,
     histReason, histRemarks,
     new_status === 'Cancelled' ? (b.cancellation_type || null) : null,
     new_status === 'Cancelled' ? (b.cancellation_date || null) : null,
     new_status === 'Cancelled' ? (b.payment_retention_status || null) : null,
     new_status === 'Cancelled' ? (b.refund_status || null) : null,
     new_status === 'Cancelled' ? (b.cancellation_remarks || null) : null,
     now, req.session.user.username]);

  res.json({ contract: get('SELECT * FROM contracts WHERE id = ?', [req.params.id]) });
});

router.patch('/:id', requireModule('contracts'), (req, res) => {
  const existing = get('SELECT * FROM contracts WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const role = req.session.user.role;
  const incoming = filterFieldsForRole(role, 'contract', req.body || {});
  delete incoming.remarks_note;
  if (Object.keys(incoming).length === 0) return res.status(403).json({ error: 'No fields in this request are editable by your role' });

  const remarksNote = req.body.remarks_note || null;

  // Validate elevator_units if provided
  if ('elevator_units' in incoming) {
    const eu = parseInt(incoming.elevator_units);
    if (isNaN(eu) || eu < 1) return res.status(400).json({ error: 'elevator_units must be a positive integer (minimum 1)' });
    incoming.elevator_units = eu;
  }
  // Keep project link in sync if quote_ref (linked Quotation Ref.) changes
  if ('quote_ref' in incoming) incoming.project_id = findLinkedProjectId(incoming.quote_ref);

  const updates = { ...incoming, updated_at: new Date().toISOString() };
  const setSql = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  run(`UPDATE contracts SET ${setSql} WHERE id = ?`, [...Object.values(updates), req.params.id]);

  for (const field of TRACKED_FIELDS) {
    if (field in incoming && String(existing[field]) !== String(incoming[field])) {
      run(`INSERT INTO contract_history (contract_id, field_name, old_value, new_value, changed_by, remarks)
           VALUES (?,?,?,?,?,?)`,
        [req.params.id, field, existing[field], incoming[field], req.session.user.username, remarksNote]);
    }
  }

  res.json({ contract: get('SELECT * FROM contracts WHERE id = ?', [req.params.id]) });
});

// ---------- Delete / restore ----------
router.delete('/:id', requireModule('contracts'), requireRole('admin'), (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const force = req.query.force === '1';

    const contract = get(`SELECT * FROM contracts WHERE id = ? AND is_deleted = 0`, [id]);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    // Check all tables that reference this contract_ref
    const linked = [];
    const ref = contract.contract_ref;

    const cpC = get(`SELECT COUNT(*) c FROM client_payments WHERE contract_ref = ? AND is_deleted = 0`, [ref]).c;
    if (cpC > 0) linked.push({ module: 'Accounts & Payments (Client Payments)', count: cpC });

    const mcC = get(`SELECT COUNT(*) c FROM maintenance_contracts WHERE contract_ref = ? AND is_deleted = 0`, [ref]).c;
    if (mcC > 0) linked.push({ module: 'Maintenance Records', count: mcC });

    const seaC = get(`SELECT COUNT(*) c FROM factory_sea_costs WHERE contract_ref = ? AND is_deleted = 0`, [ref]).c;
    if (seaC > 0) linked.push({ module: 'Factory & Suppliers — SEA Costs', count: seaC });

    const otjC = get(`SELECT COUNT(*) c FROM factory_otj_quotes WHERE contract_ref = ? AND is_deleted = 0`, [ref]).c;
    if (otjC > 0) linked.push({ module: 'Factory & Suppliers — OTJ Quotes', count: otjC });

    const insC = get(`SELECT COUNT(*) c FROM factory_ins_quotes WHERE contract_ref = ? AND is_deleted = 0`, [ref]).c;
    if (insC > 0) linked.push({ module: 'Factory & Suppliers — INS Quotes', count: insC });

    const lcC = get(`SELECT COUNT(*) c FROM project_lifecycle WHERE contract_ref = ?`, [ref]).c;
    if (lcC > 0) linked.push({ module: 'Project Management (Lifecycle)', count: lcC });

    // Block deletion if linked records exist and force flag not set
    if (linked.length > 0 && !force) {
      return res.status(409).json({
        error: 'linked_records',
        message: 'This contract is linked with other records and cannot be deleted directly.',
        linkedRecords: linked,
        contractRef: ref,
        clientName: contract.client_name,
      });
    }

    // Force delete: unlink references in other tables (do NOT delete the other records)
    if (force && linked.length > 0) {
      if (cpC > 0) run(`UPDATE client_payments SET is_deleted = 1, updated_at = datetime('now') WHERE contract_ref = ? AND is_deleted = 0`, [ref]);
      if (mcC > 0) run(`UPDATE maintenance_contracts SET contract_ref = NULL WHERE contract_ref = ?`, [ref]);
      if (seaC > 0) run(`UPDATE factory_sea_costs SET contract_ref = NULL, linked_contract_status = NULL WHERE contract_ref = ?`, [ref]);
      if (otjC > 0) run(`UPDATE factory_otj_quotes SET contract_ref = NULL, linked_contract_status = NULL WHERE contract_ref = ?`, [ref]);
      if (insC > 0) run(`UPDATE factory_ins_quotes SET contract_ref = NULL, linked_contract_status = NULL WHERE contract_ref = ?`, [ref]);
      if (lcC > 0) run(`DELETE FROM project_lifecycle WHERE contract_ref = ?`, [ref]);
    }

    // Clear the maintenance link on the contract itself
    if (contract.linked_maintenance_id) {
      run(`UPDATE contracts SET linked_maintenance_id = NULL, maintenance_linked_by = NULL, maintenance_linked_at = NULL WHERE id = ?`, [id]);
    }

    // Soft-delete
    run(`UPDATE contracts SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?`, [id]);
    run(`INSERT INTO contract_history (contract_id, field_name, old_value, new_value, changed_by, remarks)
         VALUES (?, 'is_deleted', '0', '1', ?, ?)`,
      [id, req.session.user.username, force && linked.length > 0 ? 'Force-deleted via UI (links cleared)' : 'Deleted via UI']);

    writeAuditLog({
      action: 'DELETE', module: 'contracts',
      recordId: contract.id, recordRef: contract.contract_ref,
      details: {
        quote_ref: contract.quote_ref,
        client_name: contract.client_name,
        sales_by: contract.sales_by,
        force_delete: force,
        unlinked_modules: linked.map(l => l.module),
      },
      performedBy: req.session.user.username,
    });

    res.json({ ok: true, contractRef: ref });
  } catch (err) {
    console.error('[DELETE /api/contracts/:id]', err);
    res.status(500).json({ error: 'Delete failed: ' + err.message });
  }
});

// ---------- Maintenance Linking ----------

// POST /api/contracts/:id/link-maintenance/existing  — link an existing maintenance record
router.post('/:id/link-maintenance/existing', requireContractManager, (req, res) => {
  try {
    const contract = get('SELECT * FROM contracts WHERE id = ? AND is_deleted = 0', [req.params.id]);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    const maintenanceId = parseInt(req.body.maintenance_id);
    if (!maintenanceId) return res.status(400).json({ error: 'maintenance_id is required' });
    const mc = get('SELECT * FROM maintenance_contracts WHERE id = ? AND is_deleted = 0', [maintenanceId]);
    if (!mc) return res.status(404).json({ error: 'Maintenance record not found' });
    // Enforce 1:1 — if another contract already points here, block
    const alreadyLinked = get('SELECT id, contract_ref FROM contracts WHERE linked_maintenance_id = ? AND id != ? AND is_deleted = 0', [maintenanceId, req.params.id]);
    if (alreadyLinked) {
      return res.status(409).json({ error: `Maintenance record is already linked to contract ${alreadyLinked.contract_ref}` });
    }
    run(`UPDATE contracts SET linked_maintenance_id=?, maintenance_linked_by=?, maintenance_linked_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
      [maintenanceId, req.session.user.username, req.params.id]);
    // Keep maintenance_contracts.contract_ref in sync
    if (!mc.contract_ref) {
      run(`UPDATE maintenance_contracts SET contract_ref=?, updated_at=datetime('now') WHERE id=?`,
        [contract.contract_ref, maintenanceId]);
    }
    writeAuditLog({ action: 'LINK', module: 'contracts', recordId: contract.id, recordRef: contract.contract_ref,
      details: { linked_maintenance_id: maintenanceId, mc_ref: mc.contract_ref },
      performedBy: req.session.user.username });
    const updated = get(`SELECT c.*, mc.id AS mc_id, mc.contract_ref AS mc_contract_ref FROM contracts c LEFT JOIN maintenance_contracts mc ON mc.id=c.linked_maintenance_id WHERE c.id=?`, [req.params.id]);
    res.json({ contract: updated });
  } catch (err) {
    res.status(500).json({ error: 'Link failed: ' + err.message });
  }
});

// POST /api/contracts/:id/link-maintenance/new  — create a NEW maintenance record pre-filled from contract, then link
router.post('/:id/link-maintenance/new', requireContractManager, (req, res) => {
  try {
    const contract = get('SELECT * FROM contracts WHERE id = ? AND is_deleted = 0', [req.params.id]);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (contract.linked_maintenance_id) return res.status(409).json({ error: 'Contract already has a linked maintenance record' });

    const b = req.body || {};
    if (!b.start_date) return res.status(400).json({ error: 'start_date is required for the new maintenance record' });

    // Auto-generate maintenance_id (same format as maintenance_contracts module)
    const maintenanceId = `MR-${contract.contract_ref}-${Date.now()}`;

    run(`INSERT INTO maintenance_contracts
      (maintenance_id, contract_ref, client_name, emirate, maintenance_type, maintenance_period,
       start_date, end_date, total_elevator_units, assigned_technician, renewal_status,
       current_status, remarks, created_by, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
      [maintenanceId, contract.contract_ref, contract.client_name, contract.emirate,
       b.maintenance_type || null, b.maintenance_period || null,
       b.start_date, b.end_date || null,
       contract.elevator_units || 1,
       b.assigned_technician || null,
       b.renewal_status || 'Active Maintenance',
       'Linked',
       b.remarks || null,
       req.session.user.username]);

    const newMc = get(`SELECT * FROM maintenance_contracts WHERE contract_ref=? ORDER BY id DESC LIMIT 1`, [contract.contract_ref]);
    if (!newMc) return res.status(500).json({ error: 'Failed to create maintenance record' });

    // Link
    run(`UPDATE contracts SET linked_maintenance_id=?, maintenance_linked_by=?, maintenance_linked_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
      [newMc.id, req.session.user.username, req.params.id]);

    writeAuditLog({ action: 'LINK_CREATE', module: 'contracts', recordId: contract.id, recordRef: contract.contract_ref,
      details: { created_maintenance_id: newMc.id },
      performedBy: req.session.user.username });

    res.status(201).json({ maintenance_record: newMc });
  } catch (err) {
    res.status(500).json({ error: 'Create & link failed: ' + err.message });
  }
});

// DELETE /api/contracts/:id/link-maintenance  — remove the maintenance link
router.delete('/:id/link-maintenance', requireContractManager, (req, res) => {
  try {
    const contract = get('SELECT * FROM contracts WHERE id = ? AND is_deleted = 0', [req.params.id]);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    run(`UPDATE contracts SET linked_maintenance_id=NULL, maintenance_linked_by=NULL, maintenance_linked_at=NULL, updated_at=datetime('now') WHERE id=?`,
      [req.params.id]);
    writeAuditLog({ action: 'UNLINK', module: 'contracts', recordId: contract.id, recordRef: contract.contract_ref,
      details: { removed_maintenance_id: contract.linked_maintenance_id },
      performedBy: req.session.user.username });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Unlink failed: ' + err.message });
  }
});

// GET /api/contracts/:id/linked-maintenance  — get the linked maintenance record details
router.get('/:id/linked-maintenance', requireModule('contracts'), (req, res) => {
  const contract = get('SELECT linked_maintenance_id FROM contracts WHERE id=? AND is_deleted=0', [req.params.id]);
  if (!contract) return res.status(404).json({ error: 'Not found' });
  if (!contract.linked_maintenance_id) return res.json({ maintenance: null });
  const mc = get('SELECT * FROM maintenance_contracts WHERE id=?', [contract.linked_maintenance_id]);
  res.json({ maintenance: mc || null });
});

// ===================== Factory Links (one-to-many) =====================

// GET /api/contracts/:id/factory-links
// Returns all factory records (INS + OTJ + SEA) whose contract_ref matches this contract
// Also returns factory_contract_links (many-to-many) and payment data (BL No, ETA) from factory_payments
router.get('/:id/factory-links', requireModule('contracts'), (req, res) => {
  try {
    const contract = get(`SELECT id, contract_ref, COALESCE(elevator_units,1) AS elevator_units
      FROM contracts WHERE id = ? AND is_deleted = 0`, [req.params.id]);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    const ref = contract.contract_ref;

    const insRows = ref ? all(
      `SELECT fiq.id, 'ins' AS sheet, fiq.factory_ref, fiq.supplier_name, fiq.project_description,
        COALESCE((SELECT _q.linked_quantity FROM factory_contract_links _q WHERE _q.is_deleted = 0 AND _q.factory_table = 'factory_ins_quotes'
          AND UPPER(TRIM(_q.factory_ref)) = UPPER(TRIM(fiq.factory_ref)) AND UPPER(TRIM(_q.contract_ref)) = UPPER(TRIM(contract_ref_param.r))), fiq.quantity, 1) AS quantity,
        fiq.quantity AS order_quantity,
        (SELECT COUNT(*) FROM factory_contract_links _s WHERE _s.is_deleted = 0 AND _s.factory_table = 'factory_ins_quotes' AND UPPER(TRIM(_s.factory_ref)) = UPPER(TRIM(fiq.factory_ref))) AS shared_contracts,
        fiq.factory_quote_amount AS amount, COALESCE(fiq.currency_code,'USD') AS currency_code,
        fiq.total_paid, fiq.balance_payable, fiq.payment_status,
        fiq.production_status, fiq.factory_delivery_status AS delivery_status,
        fiq.order_date, fiq.expected_delivery_date, fiq.linked_contract_status, fiq.invoice_ref,
        fp.bl_no, fp.eta, fp.shipping_ref, fp.payment_date AS latest_payment_date
       FROM factory_ins_quotes fiq
       CROSS JOIN (SELECT ? AS r) contract_ref_param
       LEFT JOIN (
         SELECT p1.factory_ref, p1.bl_no, p1.eta, p1.shipping_ref, p1.payment_date
         FROM factory_payments p1
         INNER JOIN (SELECT factory_ref, MAX(id) AS max_id FROM factory_payments WHERE is_deleted=0 GROUP BY factory_ref) p2
           ON p1.factory_ref=p2.factory_ref AND p1.id=p2.max_id
       ) fp ON fp.factory_ref=fiq.factory_ref
       WHERE fiq.is_deleted = 0 AND EXISTS (SELECT 1 FROM factory_contract_links _l WHERE _l.is_deleted = 0 AND _l.factory_table = 'factory_ins_quotes'
         AND UPPER(TRIM(_l.factory_ref)) = UPPER(TRIM(fiq.factory_ref)) AND UPPER(TRIM(_l.contract_ref)) = UPPER(TRIM(?)))
       ORDER BY fiq.factory_ref`, [ref, ref]) : [];

    const otjRows = ref ? all(
      `SELECT foq.id, 'otj' AS sheet, foq.factory_ref, foq.supplier_name, foq.project_description,
        NULL AS quantity,
        foq.other_job_cost AS amount, COALESCE(foq.currency_code,'USD') AS currency_code,
        foq.total_paid, foq.balance_payable, foq.payment_status,
        foq.production_status, foq.factory_delivery_status AS delivery_status,
        NULL AS order_date, foq.expected_delivery_date, foq.linked_contract_status, foq.invoice_ref,
        fp.bl_no, fp.eta, fp.shipping_ref, fp.payment_date AS latest_payment_date
       FROM factory_otj_quotes foq
       LEFT JOIN (
         SELECT p1.factory_ref, p1.bl_no, p1.eta, p1.shipping_ref, p1.payment_date
         FROM factory_payments p1
         INNER JOIN (SELECT factory_ref, MAX(id) AS max_id FROM factory_payments WHERE is_deleted=0 GROUP BY factory_ref) p2
           ON p1.factory_ref=p2.factory_ref AND p1.id=p2.max_id
       ) fp ON fp.factory_ref=foq.factory_ref
       WHERE foq.is_deleted = 0 AND EXISTS (SELECT 1 FROM factory_contract_links _l WHERE _l.is_deleted = 0 AND _l.factory_table = 'factory_otj_quotes'
         AND UPPER(TRIM(_l.factory_ref)) = UPPER(TRIM(foq.factory_ref)) AND UPPER(TRIM(_l.contract_ref)) = UPPER(TRIM(?)))
       ORDER BY foq.factory_ref`, [ref]) : [];

    const seaRows = ref ? all(
      `SELECT fsc.id, 'sea' AS sheet, fsc.factory_ref, fsc.supplier_name, fsc.project_description,
        NULL AS quantity,
        fsc.sea_cost AS amount, COALESCE(fsc.currency_code,'USD') AS currency_code,
        fsc.total_paid, fsc.balance_payable, fsc.payment_status,
        NULL AS production_status, fsc.delivery_status,
        NULL AS order_date, fsc.expected_delivery_date, fsc.linked_contract_status, fsc.invoice_ref,
        fp.bl_no, fp.eta, fp.shipping_ref, fp.payment_date AS latest_payment_date
       FROM factory_sea_costs fsc
       LEFT JOIN (
         SELECT p1.factory_ref, p1.bl_no, p1.eta, p1.shipping_ref, p1.payment_date
         FROM factory_payments p1
         INNER JOIN (SELECT factory_ref, MAX(id) AS max_id FROM factory_payments WHERE is_deleted=0 GROUP BY factory_ref) p2
           ON p1.factory_ref=p2.factory_ref AND p1.id=p2.max_id
       ) fp ON fp.factory_ref=fsc.factory_ref
       WHERE fsc.is_deleted = 0 AND EXISTS (SELECT 1 FROM factory_contract_links _l WHERE _l.is_deleted = 0 AND _l.factory_table = 'factory_sea_costs'
         AND UPPER(TRIM(_l.factory_ref)) = UPPER(TRIM(fsc.factory_ref)) AND UPPER(TRIM(_l.contract_ref)) = UPPER(TRIM(?)))
       ORDER BY fsc.factory_ref`, [ref]) : [];

    // Many-to-many links from factory_contract_links junction table
    const fclRows = ref ? all(
      `SELECT * FROM factory_contract_links WHERE UPPER(TRIM(contract_ref))=UPPER(TRIM(?)) AND is_deleted=0 ORDER BY created_at DESC`, [ref]) : [];

    const links = [...insRows, ...otjRows, ...seaRows];
    const elevatorUnits = contract.elevator_units;
    const totalLinkedQty = insRows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
    const totalValue   = links.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const totalPaid    = links.reduce((s, r) => s + (Number(r.total_paid) || 0), 0);
    const totalBalance = links.reduce((s, r) => s + (Number(r.balance_payable) || 0), 0);

    let linkStatus = 'Not Linked';
    if (links.length > 0) {
      if (insRows.length === 0) linkStatus = 'Linked (Cost Only)';
      else if (totalLinkedQty < elevatorUnits) linkStatus = 'Partially Linked';
      else if (totalLinkedQty === elevatorUnits) linkStatus = 'Fully Linked';
      else linkStatus = 'Quantity Mismatch';
    }

    const summary = {
      linkedCount: links.length, insCount: insRows.length,
      otjCount: otjRows.length, seaCount: seaRows.length,
      totalValue, totalPaid, totalBalance, totalLinkedQty,
    };

    res.json({ links, fclRows, elevatorUnits, totalLinkedQty, linkStatus, contractRef: ref, summary });
  } catch (err) {
    console.error('[GET /api/contracts/:id/factory-links]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/contracts/:id/factory-links — link an existing factory record to this contract
// Body: { sheet: 'ins'|'otj'|'sea', factoryId: <number> }
router.post('/:id/factory-links', requireContractManager, (req, res) => {
  try {
    const { sheet, factoryId } = req.body || {};
    if (!sheet || !factoryId) return res.status(400).json({ error: 'sheet and factoryId required' });
    const TBL = { ins: 'factory_ins_quotes', otj: 'factory_otj_quotes', sea: 'factory_sea_costs' };
    const tbl = TBL[sheet];
    if (!tbl) return res.status(400).json({ error: 'Invalid sheet. Use ins, otj, or sea' });

    const contract = get(`SELECT id, contract_ref FROM contracts WHERE id = ? AND is_deleted = 0`, [req.params.id]);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (!contract.contract_ref) return res.status(400).json({ error: 'Contract has no Contract Ref. — save a Contract Ref. first' });

    const factoryRow = get(`SELECT id, factory_ref, contract_ref FROM ${tbl} WHERE id = ? AND is_deleted = 0`, [factoryId]);
    if (!factoryRow) return res.status(404).json({ error: 'Factory record not found' });

    // Duplicate: already linked to THIS contract (relational link or legacy text)
    if (factoryRow.contract_ref === contract.contract_ref && get(`SELECT 1 FROM factory_contract_links WHERE is_deleted=0 AND factory_table=? AND UPPER(TRIM(factory_ref))=UPPER(TRIM(?)) AND UPPER(TRIM(contract_ref))=UPPER(TRIM(?))`, [tbl, factoryRow.factory_ref, contract.contract_ref])) {
      return res.status(409).json({ error: `${factoryRow.factory_ref} is already linked to this contract` });
    }

    // Linked to a DIFFERENT contract — require force flag
    if (factoryRow.contract_ref && req.query.force !== '1') {
      return res.status(409).json({
        error: 'already_linked_elsewhere',
        message: `${factoryRow.factory_ref} is currently linked to ${factoryRow.contract_ref}. Re-link it to ${contract.contract_ref}?`,
        currentContractRef: factoryRow.contract_ref,
        factoryRef: factoryRow.factory_ref,
      });
    }

    // 2026-10-10: the junction row is the authoritative link (many-to-many). A forced
    // re-link soft-deletes the previous contract's link (history kept + audited).
    const u = req.session.user.username;
    if (factoryRow.contract_ref && req.query.force === '1')
      FL.removeLinks({ factory_ref: factoryRow.factory_ref, factory_table: tbl, contract_ref: factoryRow.contract_ref }, u, `Re-linked to ${contract.contract_ref}`);
    const lk = FL.upsertLink({ factory_ref: factoryRow.factory_ref, factory_table: tbl, factory_record_id: factoryRow.id, contract_ref: contract.contract_ref }, u, 'Linked from Contract → Factory Ref. tab');
    if (!lk.created) return res.status(409).json({ error: `${factoryRow.factory_ref} is already linked to this contract` });
    // Legacy display copy on the factory record kept only when it was empty or force re-link
    if (!factoryRow.contract_ref || req.query.force === '1')
      run(`UPDATE ${tbl} SET contract_ref = ?, linked_contract_status = 'Linked', updated_at = datetime('now') WHERE id = ?`, [contract.contract_ref, factoryId]);

    writeAuditLog({
      action: 'LINK_CREATE', module: 'contracts',
      recordId: contract.id, recordRef: contract.contract_ref,
      details: { factory_ref: factoryRow.factory_ref, sheet, factoryId },
      performedBy: req.session.user.username,
    });

    res.json({ ok: true, factoryRef: factoryRow.factory_ref, contractRef: contract.contract_ref });
  } catch (err) {
    console.error('[POST /api/contracts/:id/factory-links]', err);
    res.status(500).json({ error: 'Link failed: ' + err.message });
  }
});

// DELETE /api/contracts/:id/factory-links/:sheet/:factoryId — unlink a factory record
router.delete('/:id/factory-links/:sheet/:factoryId', requireContractManager, (req, res) => {
  try {
    const { sheet, factoryId } = req.params;
    const TBL = { ins: 'factory_ins_quotes', otj: 'factory_otj_quotes', sea: 'factory_sea_costs' };
    const tbl = TBL[sheet];
    if (!tbl) return res.status(400).json({ error: 'Invalid sheet' });

    const contract = get(`SELECT id, contract_ref FROM contracts WHERE id = ? AND is_deleted = 0`, [req.params.id]);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    const factoryRow = get(`SELECT id, factory_ref FROM ${tbl} WHERE id = ? AND is_deleted = 0`, [factoryId]);
    if (!factoryRow) return res.status(404).json({ error: 'Factory record not found' });

    const removed = FL.removeLinks({ factory_ref: factoryRow.factory_ref, factory_table: tbl, contract_ref: contract.contract_ref }, req.session.user.username, 'Unlinked from Contract → Factory Ref. tab');
    const rec = get(`SELECT contract_ref FROM ${tbl} WHERE id = ?`, [factoryId]);
    if (rec && String(rec.contract_ref || '').trim().toUpperCase() === String(contract.contract_ref || '').trim().toUpperCase())
      run(`UPDATE ${tbl} SET contract_ref = NULL, linked_contract_status = NULL, updated_at = datetime('now') WHERE id = ?`, [factoryId]);
    if (!removed && !(rec && rec.contract_ref)) { /* nothing linked — idempotent */ }

    writeAuditLog({
      action: 'UNLINK', module: 'contracts',
      recordId: contract.id, recordRef: contract.contract_ref,
      details: { factory_ref: factoryRow.factory_ref, sheet },
      performedBy: req.session.user.username,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/contracts/:id/factory-links/:sheet/:factoryId]', err);
    res.status(500).json({ error: 'Unlink failed: ' + err.message });
  }
});

module.exports = router;
