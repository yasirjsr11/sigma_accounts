// routes/maintenance.js — Maintenance Module Complete Redesign (2026-07-12)
// Handles /api/maintenance/* for maintenance_projects, maintenance_project_visits,
// maintenance_project_history, maintenance_renewal_history tables.
// The legacy maintenance_contracts module (/api/maintenance-contracts) is NOT touched here.

const express = require('express');
const { refNotCancelledSql } = require('../db/amcEligibility.js');
const { db, run, get, all } = require('../db/db.js');
const { requireModule } = require('../middleware/auth.js');
const router = express.Router();

// ── Constants ──────────────────────────────────────────────────────────────
const MAINT_TYPES = [
  'Free Comprehensive Maintenance','Paid Comprehensive AMC',
  'Paid Non-Comprehensive AMC','Warranty Maintenance',
  'Temporary Maintenance','Other'
];
const MAINT_PERIODS = [
  'Every Month','Once Every 2 Months','Once Every 3 Months',
  'Once Every 4 Months','Once Every 6 Months','Custom'
];
const MAINT_STATUSES = ['Active','Under Renewal','Hold','Cancelled'];
const VISIT_TYPES = ['Routine','Emergency','Callback','Follow-up','Inspection','Repair'];
const VISIT_STATUSES = ['Pending','Scheduled','Completed','Postponed','Missed','Cancelled'];
const EMIRATES = ['Abu Dhabi','Dubai','Sharjah','Ajman','Umm Al Quwain','Ras Al Khaimah','Fujairah'];

// Period → months mapping
function periodToMonths(period, customMonths) {
  const map = {
    'Every Month':1,'Once Every 2 Months':2,'Once Every 3 Months':3,
    'Once Every 4 Months':4,'Once Every 6 Months':6
  };
  if (period === 'Custom') return parseInt(customMonths)||null;
  return map[period]||null;
}

// Generate next sequence ID  MNT-YYYY-NNNN
function genMaintenanceId(yr) {
  const row = get(
    `SELECT maintenance_id FROM maintenance_projects
     WHERE maintenance_id LIKE ? ORDER BY maintenance_id DESC LIMIT 1`,
    [`MNT-${yr}-%`]
  );
  if (!row) return `MNT-${yr}-0001`;
  const last = parseInt((row.maintenance_id||'').split('-')[2]||'0');
  return `MNT-${yr}-${String(last+1).padStart(4,'0')}`;
}

// Generate Visit Ref  VIS-[MNT-ID]-[YYYYMM]-[seq]
function genVisitRef(maintenanceId, yr, mo) {
  const prefix = `VIS-${maintenanceId}-${yr}${String(mo).padStart(2,'0')}`;
  const row = get(
    `SELECT visit_ref FROM maintenance_project_visits
     WHERE visit_ref LIKE ? ORDER BY visit_ref DESC LIMIT 1`,
    [`${prefix}-%`]
  );
  if (!row) return `${prefix}-001`;
  const last = parseInt((row.visit_ref||'').split('-').pop()||'0');
  return `${prefix}-${String(last+1).padStart(3,'0')}`;
}

// Log a history event
function logHistory(projectId, maintenanceId, eventType, desc, changedBy, fieldName, oldVal, newVal) {
  try {
    run(`INSERT INTO maintenance_project_history
      (maintenance_project_id,maintenance_id,event_type,event_description,field_name,old_value,new_value,changed_by)
      VALUES (?,?,?,?,?,?,?,?)`,
      [projectId, maintenanceId, eventType, desc, fieldName||null, oldVal!=null?String(oldVal):null, newVal!=null?String(newVal):null, changedBy||'system']
    );
  } catch(e) { /* non-fatal */ }
}

// Auto-generate schedule visits for a project
function generateSchedule(project) {
  const months = periodToMonths(project.maintenance_period, project.custom_period_months);
  if (!months || !project.start_date || !project.end_date) return 0;
  const startY = parseInt(project.start_date.slice(0,4));
  const startM = parseInt(project.start_date.slice(5,7));
  const endY   = parseInt(project.end_date.slice(0,4));
  const endM   = parseInt(project.end_date.slice(8,10)||project.end_date.slice(5,7));
  // endM is already slice(5,7) since end_date is YYYY-MM-DD
  const endMonth2 = parseInt(project.end_date.slice(5,7));
  const endYear2  = parseInt(project.end_date.slice(0,4));

  let created = 0;
  let curY = startY, curM = startM;
  while (curY < endYear2 || (curY === endYear2 && curM <= endMonth2)) {
    const scheduledDate = `${curY}-${String(curM).padStart(2,'0')}-01`;
    const visitRef = genVisitRef(project.maintenance_id, curY, curM);
    try {
      run(`INSERT OR IGNORE INTO maintenance_project_visits
        (maintenance_project_id,maintenance_id,contract_ref,visit_ref,
         visit_year,visit_month,scheduled_date,visit_status,
         total_elevator_units,created_by)
        VALUES (?,?,?,?,?,?,?,'Scheduled',?,?)`,
        [project.id, project.maintenance_id, project.contract_ref||null, visitRef,
         curY, curM, scheduledDate, project.total_elevator_units||null, 'system']
      );
      created++;
    } catch(e) { /* duplicate — visit already exists */ }
    // advance by period
    curM += months;
    while (curM > 12) { curM -= 12; curY++; }
  }
  return created;
}

// ── GET /api/maintenance/meta — constants for frontend ────────────────────
router.get('/meta', requireModule('maintenance'), (req, res) => {
  res.json({ MAINT_TYPES, MAINT_PERIODS, MAINT_STATUSES, VISIT_TYPES, VISIT_STATUSES, EMIRATES });
});

// ── GET /api/maintenance/dashboard ────────────────────────────────────────
router.get('/dashboard', requireModule('maintenance'), (req, res) => {
  const total      = get(`SELECT COUNT(*) c FROM maintenance_projects WHERE is_deleted=0`).c;
  const active     = get(`SELECT COUNT(*) c FROM maintenance_projects WHERE is_deleted=0 AND maintenance_status='Active'`).c;
  const underRenewal = get(`SELECT COUNT(*) c FROM maintenance_projects WHERE is_deleted=0 AND maintenance_status='Under Renewal'`).c;
  const onHold     = get(`SELECT COUNT(*) c FROM maintenance_projects WHERE is_deleted=0 AND maintenance_status='Hold'`).c;
  const cancelled  = get(`SELECT COUNT(*) c FROM maintenance_projects WHERE is_deleted=0 AND maintenance_status='Cancelled'`).c;
  const needsReview = get(`SELECT COUNT(*) c FROM maintenance_projects WHERE is_deleted=0 AND needs_review=1`).c;

  // Visit stats — current month
  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth()+1;
  const visitsThisMonth = get(
    `SELECT COUNT(*) c FROM maintenance_project_visits WHERE visit_year=? AND visit_month=?`, [cy,cm]).c;
  const completedThisMonth = get(
    `SELECT COUNT(*) c FROM maintenance_project_visits WHERE visit_year=? AND visit_month=? AND visit_status='Completed'`, [cy,cm]).c;
  const pendingThisMonth = get(
    `SELECT COUNT(*) c FROM maintenance_project_visits WHERE visit_year=? AND visit_month=? AND visit_status IN ('Pending','Scheduled')`, [cy,cm]).c;
  const missedThisMonth = get(
    `SELECT COUNT(*) c FROM maintenance_project_visits WHERE visit_year=? AND visit_month=? AND visit_status='Missed'`, [cy,cm]).c;
  const cancelledVisits = get(
    `SELECT COUNT(*) c FROM maintenance_project_visits WHERE visit_year=? AND visit_month=? AND visit_status='Cancelled'`, [cy,cm]).c;

  // Expiring soon (within 60 days)
  const today = now.toISOString().slice(0,10);
  const in60  = new Date(now.getTime()+60*864e5).toISOString().slice(0,10);
  const expiringSoon = all(
    `SELECT maintenance_id,client_name,contract_ref,end_date,maintenance_status
     FROM maintenance_projects
     WHERE is_deleted=0 AND maintenance_status IN ('Active','Under Renewal')
       AND end_date BETWEEN ? AND ?
     ORDER BY end_date ASC LIMIT 10`,
    [today, in60]
  );

  // By type breakdown
  const byType = all(
    `SELECT maintenance_type, COUNT(*) c FROM maintenance_projects
     WHERE is_deleted=0 GROUP BY maintenance_type`
  );

  // By emirate
  const byEmirate = all(
    `SELECT emirate, COUNT(*) c FROM maintenance_projects
     WHERE is_deleted=0 AND emirate IS NOT NULL GROUP BY emirate`
  );

  res.json({
    total, active, under_renewal: underRenewal, on_hold: onHold, cancelled,
    needs_review: needsReview,
    visits_this_month: visitsThisMonth,
    completed_this_month: completedThisMonth,
    pending_this_month: pendingThisMonth,
    missed_this_month: missedThisMonth,
    cancelled_visits_this_month: cancelledVisits,
    expiring_soon: expiringSoon,
    by_type: byType,
    by_emirate: byEmirate,
    current_year: cy,
    current_month: cm
  });
});

// ── GET /api/maintenance/projects ─────────────────────────────────────────
router.get('/projects', requireModule('maintenance'), (req, res) => {
  const {
    search='', status='', type='', emirate='',
    needs_review='', page=1, limit=50
  } = req.query;
  const offset = (parseInt(page)-1) * parseInt(limit);
  const where = ['mp.is_deleted=0'];
  const params = [];
  if (search) {
    where.push('(mp.maintenance_id LIKE ? OR mp.client_name LIKE ? OR mp.contract_ref LIKE ? OR mp.project_name LIKE ?)');
    const s = `%${search}%`; params.push(s,s,s,s);
  }
  if (status)   { where.push('mp.maintenance_status=?'); params.push(status); }
  if (type)     { where.push('mp.maintenance_type=?'); params.push(type); }
  if (emirate)  { where.push('mp.emirate=?'); params.push(emirate); }
  if (needs_review === '1') { where.push('mp.needs_review=1'); }

  const wSql = where.length ? 'WHERE '+where.join(' AND ') : '';
  const total = get(`SELECT COUNT(*) c FROM maintenance_projects mp ${wSql}`, params).c;
  const rows  = all(
    `SELECT mp.*,
       (SELECT COUNT(*) FROM maintenance_project_visits v WHERE v.maintenance_project_id=mp.id) total_visits,
       (SELECT COUNT(*) FROM maintenance_project_visits v WHERE v.maintenance_project_id=mp.id AND v.visit_status='Completed') completed_visits
     FROM maintenance_projects mp ${wSql}
     ORDER BY mp.maintenance_status ASC, mp.end_date ASC
     LIMIT ? OFFSET ?`,
    [...params, parseInt(limit), offset]
  );
  res.json({ total, page: parseInt(page), limit: parseInt(limit), rows });
});

// ── GET /api/maintenance/projects/:id ────────────────────────────────────
router.get('/projects/:id', requireModule('maintenance'), (req, res) => {
  const row = get(`SELECT * FROM maintenance_projects WHERE id=? AND is_deleted=0`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const visits = all(
    `SELECT * FROM maintenance_project_visits WHERE maintenance_project_id=? ORDER BY visit_year,visit_month`,
    [row.id]
  );
  const history = all(
    `SELECT * FROM maintenance_project_history WHERE maintenance_project_id=? ORDER BY changed_at DESC`,
    [row.id]
  );
  const renewals = all(
    `SELECT * FROM maintenance_renewal_history WHERE maintenance_project_id=? ORDER BY renewal_period_no DESC`,
    [row.id]
  );
  res.json({ ...row, visits, history, renewals });
});

// ── POST /api/maintenance/projects ────────────────────────────────────────
router.post('/projects', requireModule('maintenance'), (req, res) => {
  const u = req.session?.user?.username||'unknown';
  const {
    contract_ref, client_name, project_name, emirate, location,
    maintenance_type, maintenance_period, custom_period_months,
    start_date, end_date, total_elevator_units, assigned_technician, technician_team,
    amc_value, currency_code='AED', currency_symbol='AED', payment_terms,
    maintenance_status='Active', remarks,
    cancellation_date, cancellation_reason, hold_reason, hold_date, hold_release_date,
    auto_generate_schedule=false
  } = req.body;

  if (!maintenance_type || !MAINT_TYPES.includes(maintenance_type))
    return res.status(400).json({ error: 'Invalid maintenance_type' });
  if (maintenance_status && !MAINT_STATUSES.includes(maintenance_status))
    return res.status(400).json({ error: 'Invalid maintenance_status' });

  const yr = (start_date||new Date().toISOString()).slice(0,4);
  const newId = genMaintenanceId(yr);

  // Needs review logic
  const missing = [];
  if (!maintenance_period) missing.push('Maintenance Period');
  if (!assigned_technician) missing.push('Technician');
  if (!start_date) missing.push('Start Date');
  if (!end_date) missing.push('End Date');
  if (!total_elevator_units) missing.push('Total Elevator Units');
  const needsReview = missing.length > 0 ? 1 : 0;
  const reviewNotes = missing.length ? 'Missing: '+missing.join(', ') : null;

  const r = run(`INSERT INTO maintenance_projects
    (maintenance_id,contract_ref,client_name,project_name,emirate,location,
     maintenance_type,maintenance_period,custom_period_months,
     start_date,end_date,total_elevator_units,assigned_technician,technician_team,
     amc_value,currency_code,currency_symbol,payment_terms,
     maintenance_status,cancellation_date,cancellation_reason,
     hold_reason,hold_date,hold_release_date,remarks,
     needs_review,review_notes,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [newId,contract_ref||null,client_name||null,project_name||null,emirate||null,location||null,
     maintenance_type,maintenance_period||null,custom_period_months||null,
     start_date||null,end_date||null,total_elevator_units||null,
     assigned_technician||null,technician_team||null,
     amc_value||null,currency_code,currency_symbol,payment_terms||null,
     maintenance_status,cancellation_date||null,cancellation_reason||null,
     hold_reason||null,hold_date||null,hold_release_date||null,remarks||null,
     needsReview,reviewNotes,u]
  );
  const projId = r.lastInsertRowid;
  logHistory(projId, newId, 'Created', 'Maintenance project created', u);

  let scheduledVisits = 0;
  if (auto_generate_schedule && maintenance_period && start_date && end_date) {
    const proj = get('SELECT * FROM maintenance_projects WHERE id=?', [projId]);
    scheduledVisits = generateSchedule(proj);
    if (scheduledVisits > 0) {
      logHistory(projId, newId, 'Schedule Generated', `Auto-generated ${scheduledVisits} visit slots`, u);
    }
  }
  res.json({ ok:true, id:projId, maintenance_id:newId, scheduled_visits:scheduledVisits,
             needs_review:needsReview, review_notes:reviewNotes });
});

// ── PUT /api/maintenance/projects/:id ────────────────────────────────────
router.put('/projects/:id', requireModule('maintenance'), (req, res) => {
  const u = req.session?.user?.username||'unknown';
  const existing = get('SELECT * FROM maintenance_projects WHERE id=? AND is_deleted=0', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const fields = [
    'contract_ref','client_name','project_name','emirate','location',
    'maintenance_type','maintenance_period','custom_period_months',
    'start_date','end_date','total_elevator_units','assigned_technician','technician_team',
    'amc_value','currency_code','currency_symbol','payment_terms','maintenance_status',
    'cancellation_date','cancellation_reason','hold_reason','hold_date','hold_release_date',
    'last_service_date','next_service_date','remarks','needs_review','review_notes'
  ];
  const setClauses = [], params = [];
  for (const f of fields) {
    if (f in req.body) {
      setClauses.push(`${f}=?`);
      params.push(req.body[f]??null);
      // log field changes
      if (existing[f] !== req.body[f]) {
        logHistory(existing.id, existing.maintenance_id, 'Updated', `Field ${f} changed`, u, f, existing[f], req.body[f]);
      }
    }
  }
  if (!setClauses.length) return res.json({ ok:true });
  setClauses.push('updated_at=?'); params.push(new Date().toISOString().slice(0,19).replace('T',' '));
  params.push(req.params.id);
  run(`UPDATE maintenance_projects SET ${setClauses.join(',')} WHERE id=?`, params);
  res.json({ ok:true });
});

// ── DELETE /api/maintenance/projects/:id (soft-delete) ───────────────────
router.delete('/projects/:id', requireModule('maintenance'), (req, res) => {
  const u = req.session?.user?.username||'unknown';
  const existing = get('SELECT * FROM maintenance_projects WHERE id=?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  run('UPDATE maintenance_projects SET is_deleted=1, updated_at=? WHERE id=?',
    [new Date().toISOString().slice(0,19).replace('T',' '), req.params.id]);
  logHistory(existing.id, existing.maintenance_id, 'Deleted', 'Project soft-deleted', u);
  res.json({ ok:true });
});

// ── POST /api/maintenance/projects/:id/generate-schedule ──────────────────
router.post('/projects/:id/generate-schedule', requireModule('maintenance'), (req, res) => {
  const u = req.session?.user?.username||'unknown';
  const proj = get('SELECT * FROM maintenance_projects WHERE id=? AND is_deleted=0', [req.params.id]);
  if (!proj) return res.status(404).json({ error: 'Not found' });
  if (!proj.maintenance_period||!proj.start_date||!proj.end_date)
    return res.status(400).json({ error: 'maintenance_period, start_date, and end_date are required to generate a schedule' });
  const created = generateSchedule(proj);
  if (created > 0) logHistory(proj.id, proj.maintenance_id, 'Schedule Generated', `Auto-generated ${created} visit slots`, u);
  res.json({ ok:true, visits_created: created });
});

// ── GET /api/maintenance/projects/:id/history ────────────────────────────
router.get('/projects/:id/history', requireModule('maintenance'), (req, res) => {
  const rows = all(
    'SELECT * FROM maintenance_project_history WHERE maintenance_project_id=? ORDER BY changed_at DESC',
    [req.params.id]
  );
  res.json(rows);
});

// ── POST /api/maintenance/projects/:id/renew ─────────────────────────────
router.post('/projects/:id/renew', requireModule('maintenance'), (req, res) => {
  const u = req.session?.user?.username||'unknown';
  const proj = get('SELECT * FROM maintenance_projects WHERE id=? AND is_deleted=0', [req.params.id]);
  if (!proj) return res.status(404).json({ error: 'Not found' });
  const { new_start_date, new_end_date, amc_value, remarks } = req.body;
  if (!new_start_date || !new_end_date) return res.status(400).json({ error: 'new_start_date and new_end_date required' });

  // Insert renewal history
  const prevRenewal = get(
    'SELECT MAX(renewal_period_no) n FROM maintenance_renewal_history WHERE maintenance_project_id=?',
    [proj.id]
  );
  const periodNo = (prevRenewal?.n||0) + 1;
  run(`INSERT INTO maintenance_renewal_history
    (maintenance_project_id,maintenance_id,renewal_period_no,start_date,end_date,amc_value,renewal_status,renewed_by,remarks)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [proj.id, proj.maintenance_id, periodNo, new_start_date, new_end_date, amc_value||null, 'Renewed', u, remarks||null]
  );

  // Update project
  run(`UPDATE maintenance_projects SET start_date=?,end_date=?,maintenance_status='Active',
       amc_value=COALESCE(?,amc_value), updated_at=? WHERE id=?`,
    [new_start_date, new_end_date, amc_value||null, new Date().toISOString().slice(0,19).replace('T',' '), proj.id]
  );
  logHistory(proj.id, proj.maintenance_id, 'Renewed', `Renewed for period ${periodNo}: ${new_start_date} to ${new_end_date}`, u);

  // Auto-generate schedule for new period
  const updatedProj = get('SELECT * FROM maintenance_projects WHERE id=?', [proj.id]);
  const created = generateSchedule(updatedProj);
  if (created > 0) logHistory(proj.id, proj.maintenance_id, 'Schedule Generated', `Auto-generated ${created} visit slots for renewal`, u);

  res.json({ ok:true, renewal_period_no: periodNo, visits_created: created });
});

// ── GET /api/maintenance/visits ───────────────────────────────────────────
router.get('/visits', requireModule('maintenance'), (req, res) => {
  const {
    maintenance_id='', status='', year='', month='',
    search='', page=1, limit=100
  } = req.query;
  const offset = (parseInt(page)-1)*parseInt(limit);
  const where = [];
  const params = [];
  if (maintenance_id) { where.push('v.maintenance_id=?'); params.push(maintenance_id); }
  if (status)  { where.push('v.visit_status=?'); params.push(status); }
  if (year)    { where.push('v.visit_year=?'); params.push(parseInt(year)); }
  if (month)   { where.push('v.visit_month=?'); params.push(parseInt(month)); }
  if (search)  {
    where.push('(v.visit_ref LIKE ? OR v.maintenance_id LIKE ? OR mp.client_name LIKE ?)');
    const s=`%${search}%`; params.push(s,s,s);
  }
  const wSql = where.length ? 'WHERE '+where.join(' AND ') : '';
  const total = get(`SELECT COUNT(*) c FROM maintenance_project_visits v
    LEFT JOIN maintenance_projects mp ON mp.id=v.maintenance_project_id ${wSql}`, params).c;
  const rows = all(
    `SELECT v.*, mp.client_name, mp.maintenance_type, mp.maintenance_status,
       mp.total_elevator_units as project_elevator_units
     FROM maintenance_project_visits v
     LEFT JOIN maintenance_projects mp ON mp.id=v.maintenance_project_id
     ${wSql}
     ORDER BY v.visit_year DESC, v.visit_month DESC
     LIMIT ? OFFSET ?`,
    [...params, parseInt(limit), offset]
  );
  res.json({ total, page:parseInt(page), limit:parseInt(limit), rows });
});

// ── GET /api/maintenance/visits/schedule/:year/:month ────────────────────
// Monthly schedule view — all projects with their visit status for that month
router.get('/visits/schedule/:year/:month', requireModule('maintenance'), (req, res) => {
  const yr  = parseInt(req.params.year);
  const mo  = parseInt(req.params.month);
  if (!yr||!mo||mo<1||mo>12) return res.status(400).json({ error: 'Invalid year/month' });

  const rows = all(
    `SELECT mp.id as project_id, mp.maintenance_id, mp.client_name, mp.contract_ref,
       mp.emirate, mp.maintenance_type, mp.maintenance_status, mp.total_elevator_units,
       mp.assigned_technician, mp.maintenance_period, mp.end_date,
       v.id as visit_id, v.visit_ref, v.visit_status, v.scheduled_date,
       v.actual_date, v.completion_date, v.technicians, v.checklist_completed,
       v.units_serviced, v.units_not_serviced, v.work_performed, v.remarks as visit_remarks
     FROM maintenance_projects mp
     LEFT JOIN maintenance_project_visits v
       ON v.maintenance_project_id=mp.id AND v.visit_year=? AND v.visit_month=?
     WHERE mp.is_deleted=0
       AND mp.maintenance_status IN ('Active','Under Renewal')
     ORDER BY mp.client_name ASC`,
    [yr, mo]
  );
  res.json({ year:yr, month:mo, rows });
});

// ── GET /api/maintenance/visits/:id ──────────────────────────────────────
router.get('/visits/:id', requireModule('maintenance'), (req, res) => {
  const row = get(
    `SELECT v.*, mp.client_name, mp.maintenance_type, mp.contract_ref
     FROM maintenance_project_visits v
     LEFT JOIN maintenance_projects mp ON mp.id=v.maintenance_project_id
     WHERE v.id=?`, [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// ── POST /api/maintenance/visits ──────────────────────────────────────────
router.post('/visits', requireModule('maintenance'), (req, res) => {
  const u = req.session?.user?.username||'unknown';
  const {
    maintenance_project_id, visit_year, visit_month,
    lift_no, visit_type='Routine', scheduled_date, actual_date,
    visit_status='Pending', checklist_completed=0, spare_parts_used, client_signature,
    technicians, total_elevator_units, units_serviced, units_not_serviced,
    unserviced_reason, work_performed, findings, parts_replaced, pending_issues,
    completion_date, completed_by, postponed_date, postponement_reason,
    missed_reason, cancellation_reason, remarks
  } = req.body;
  if (!maintenance_project_id||!visit_year||!visit_month)
    return res.status(400).json({ error: 'maintenance_project_id, visit_year, visit_month required' });
  const proj = get('SELECT * FROM maintenance_projects WHERE id=?', [maintenance_project_id]);
  if (!proj) return res.status(404).json({ error: 'Project not found' });

  // Duplicate check
  const existing = get(
    'SELECT id FROM maintenance_project_visits WHERE maintenance_project_id=? AND visit_year=? AND visit_month=?',
    [maintenance_project_id, visit_year, visit_month]
  );
  if (existing) return res.status(409).json({ error: 'Visit already exists for this project/year/month', existing_id: existing.id });

  const visitRef = genVisitRef(proj.maintenance_id, visit_year, visit_month);
  const r = run(`INSERT INTO maintenance_project_visits
    (maintenance_project_id,maintenance_id,contract_ref,visit_ref,
     lift_no,visit_type,visit_year,visit_month,scheduled_date,actual_date,
     visit_status,checklist_completed,spare_parts_used,client_signature,
     technicians,total_elevator_units,units_serviced,units_not_serviced,
     unserviced_reason,work_performed,findings,parts_replaced,pending_issues,
     completion_date,completed_by,postponed_date,postponement_reason,
     missed_reason,cancellation_reason,remarks,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [maintenance_project_id,proj.maintenance_id,proj.contract_ref,visitRef,
     lift_no||null,visit_type,visit_year,visit_month,scheduled_date||null,actual_date||null,
     visit_status,checklist_completed?1:0,spare_parts_used||null,client_signature||null,
     technicians||null,total_elevator_units||null,units_serviced||null,units_not_serviced||null,
     unserviced_reason||null,work_performed||null,findings||null,parts_replaced||null,pending_issues||null,
     completion_date||null,completed_by||null,postponed_date||null,postponement_reason||null,
     missed_reason||null,cancellation_reason||null,remarks||null,u]
  );

  // Update project last/next service dates
  if (visit_status==='Completed' && actual_date) {
    run('UPDATE maintenance_projects SET last_service_date=?, updated_at=? WHERE id=?',
      [actual_date, new Date().toISOString().slice(0,19).replace('T',' '), maintenance_project_id]);
    logHistory(proj.id, proj.maintenance_id, 'Visit Completed',
      `Visit ${visitRef} completed on ${actual_date}`, u);
  }
  res.json({ ok:true, id:r.lastInsertRowid, visit_ref:visitRef });
});

// ── PUT /api/maintenance/visits/:id ──────────────────────────────────────
router.put('/visits/:id', requireModule('maintenance'), (req, res) => {
  const u = req.session?.user?.username||'unknown';
  const existing = get('SELECT * FROM maintenance_project_visits WHERE id=?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const fields = [
    'lift_no','visit_type','scheduled_date','actual_date','visit_status',
    'checklist_completed','spare_parts_used','client_signature','technicians',
    'total_elevator_units','units_serviced','units_not_serviced','unserviced_reason',
    'work_performed','findings','parts_replaced','pending_issues',
    'completion_date','completed_by','postponed_date','postponement_reason',
    'missed_reason','cancellation_reason','remarks'
  ];
  const setClauses=['updated_by=?','updated_at=?'];
  const params=[u, new Date().toISOString().slice(0,19).replace('T',' ')];
  for (const f of fields) {
    if (f in req.body) { setClauses.push(`${f}=?`); params.push(req.body[f]??null); }
  }
  params.push(req.params.id);
  run(`UPDATE maintenance_project_visits SET ${setClauses.join(',')} WHERE id=?`, params);

  // Update project last_service_date when completed
  const newStatus = req.body.visit_status;
  const actualDate = req.body.actual_date||existing.actual_date;
  if (newStatus==='Completed' && actualDate && existing.visit_status!=='Completed') {
    run('UPDATE maintenance_projects SET last_service_date=?, updated_at=? WHERE id=?',
      [actualDate, new Date().toISOString().slice(0,19).replace('T',' '), existing.maintenance_project_id]);
    logHistory(existing.maintenance_project_id, existing.maintenance_id,
      'Visit Completed', `Visit ${existing.visit_ref} marked completed`, u);
  }
  res.json({ ok:true });
});

// ── DELETE /api/maintenance/visits/:id ───────────────────────────────────
router.delete('/visits/:id', requireModule('maintenance'), (req, res) => {
  const existing = get('SELECT id FROM maintenance_project_visits WHERE id=?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  run('DELETE FROM maintenance_project_visits WHERE id=?', [req.params.id]);
  res.json({ ok:true });
});

// ── GET /api/maintenance/cancelled ────────────────────────────────────────
router.get('/cancelled', requireModule('maintenance'), (req, res) => {
  const { search='', page=1, limit=50 } = req.query;
  const offset = (parseInt(page)-1)*parseInt(limit);
  const where = ["mp.is_deleted=0 AND mp.maintenance_status='Cancelled'"];
  const params = [];
  if (search) {
    where.push('(mp.maintenance_id LIKE ? OR mp.client_name LIKE ? OR mp.contract_ref LIKE ?)');
    const s=`%${search}%`; params.push(s,s,s);
  }
  const wSql = 'WHERE '+where.join(' AND ');
  const total = get(`SELECT COUNT(*) c FROM maintenance_projects mp ${wSql}`, params).c;
  const rows  = all(
    `SELECT * FROM maintenance_projects mp ${wSql}
     ORDER BY mp.cancellation_date DESC NULLS LAST, mp.updated_at DESC
     LIMIT ? OFFSET ?`,
    [...params, parseInt(limit), offset]
  );
  res.json({ total, page:parseInt(page), limit:parseInt(limit), rows });
});

// ── GET /api/maintenance/report/:type ─────────────────────────────────────
// Quick report data endpoints for frontend report generation
router.get('/report/monthly', requireModule('maintenance'), (req, res) => {
  const { year, month } = req.query;
  if (!year||!month) return res.status(400).json({ error: 'year and month required' });
  const rows = all(
    `SELECT v.*, mp.client_name, mp.contract_ref, mp.emirate,
       mp.maintenance_type, mp.assigned_technician, mp.total_elevator_units as proj_units
     FROM maintenance_project_visits v
     LEFT JOIN maintenance_projects mp ON mp.id=v.maintenance_project_id
     WHERE v.visit_year=? AND v.visit_month=?
     ORDER BY mp.client_name ASC`,
    [parseInt(year), parseInt(month)]
  );
  res.json(rows);
});

router.get('/report/amc-status', requireModule('maintenance'), (req, res) => {
  const { status='' } = req.query;
  const where = ['mp.is_deleted=0'];
  const params = [];
  if (status) { where.push('mp.maintenance_status=?'); params.push(status); }
  const rows = all(
    `SELECT mp.*,
       (SELECT COUNT(*) FROM maintenance_project_visits v WHERE v.maintenance_project_id=mp.id AND v.visit_status='Completed') completed_visits,
       (SELECT COUNT(*) FROM maintenance_project_visits v WHERE v.maintenance_project_id=mp.id) total_visits
     FROM maintenance_projects mp WHERE ${where.join(' AND ')}
     ORDER BY mp.end_date ASC`,
    params
  );
  res.json(rows);
});

router.get('/report/technician-performance', requireModule('maintenance'), (req, res) => {
  const { year } = req.query;
  const where = ['v.visit_status IS NOT NULL'];
  const params = [];
  if (year) { where.push('v.visit_year=?'); params.push(parseInt(year)); }
  const rows = all(
    `SELECT v.technicians, v.visit_status, v.visit_year, v.visit_month, v.visit_type,
       v.units_serviced, v.units_not_serviced, v.checklist_completed,
       mp.client_name, mp.maintenance_type
     FROM maintenance_project_visits v
     LEFT JOIN maintenance_projects mp ON mp.id=v.maintenance_project_id
     WHERE ${where.join(' AND ')}
     ORDER BY v.visit_year DESC, v.visit_month DESC`,
    params
  );
  res.json(rows);
});

router.get('/report/cancelled-amc', requireModule('maintenance'), (req, res) => {
  const rows = all(
    `SELECT * FROM maintenance_projects WHERE is_deleted=0 AND maintenance_status='Cancelled'
     ORDER BY cancellation_date DESC`
  );
  res.json(rows);
});

router.get('/report/renewal-status', requireModule('maintenance'), (req, res) => {
  const today = new Date().toISOString().slice(0,10);
  const in90  = new Date(Date.now()+90*864e5).toISOString().slice(0,10);
  const rows = all(
    `SELECT mp.*,
       CASE
         WHEN mp.end_date < ? THEN 'Expired'
         WHEN mp.end_date <= ? THEN 'Expiring Soon'
         ELSE 'Current'
       END renewal_flag
     FROM maintenance_projects mp
     WHERE mp.is_deleted=0 AND mp.maintenance_status IN ('Active','Under Renewal')
       AND ${refNotCancelledSql('mp.contract_ref')}
     ORDER BY mp.end_date ASC`,
    [today, in90]
  );
  res.json(rows);
});

router.get('/report/visit-history', requireModule('maintenance'), (req, res) => {
  const { maintenance_id='', year='' } = req.query;
  const where = [];
  const params = [];
  if (maintenance_id) { where.push('v.maintenance_id=?'); params.push(maintenance_id); }
  if (year) { where.push('v.visit_year=?'); params.push(parseInt(year)); }
  const wSql = where.length ? 'WHERE '+where.join(' AND ') : '';
  const rows = all(
    `SELECT v.*, mp.client_name, mp.maintenance_type, mp.emirate
     FROM maintenance_project_visits v
     LEFT JOIN maintenance_projects mp ON mp.id=v.maintenance_project_id
     ${wSql}
     ORDER BY v.visit_year DESC, v.visit_month DESC`,
    params
  );
  res.json(rows);
});

module.exports = router;
