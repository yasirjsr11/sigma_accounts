'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// SALES FOLLOW-UP SERVICE (2026-10-01) — single source for the Sales Follow-Up
// tab, its exports and the Sales & Quotations reports.
//
//   Sales Quotation (master, unchanged) ──Quote Ref.──► many follow-up rows
//
// Last Follow-Up  = MAX(followup_date) of non-void follow-ups (calculated, never stored)
// Next Follow-Up  = next_followup_date of the LATEST non-void follow-up only, so an old
//                   planned date stops alerting once a newer contact is logged
// Quotation Status stays authoritative on the quotation; each follow-up row stores
// the status at that time.
// Alert:
//   Approved / Lost  → Completed, unless the latest follow-up still plans a future
//                      (today or later) date — then Upcoming / Due Today. Never Overdue.
//   Actionable (Quoted / Follow Up / Negotiation / Tender):
//     no follow-up yet → No Follow-Up
//     next date < today → Overdue · = today → Due Today · > today → Upcoming
//     follow-ups but no next date → Not Scheduled
// ══════════════════════════════════════════════════════════════════════════════
const { all, get } = require('./db.js');

const STATUS = [['quoted', 'Quoted'], ['follow_up', 'Follow Up'], ['negotiation', 'Negotiation'], ['approved', 'Approved'], ['lost', 'Lost'], ['tender', 'Tender']];
const STATUS_LABEL = Object.fromEntries(STATUS);
const CLOSED = new Set(['approved', 'lost']);
const METHODS = ['Phone Call', 'WhatsApp', 'E-mail', 'Meeting', 'Office Visit', 'Site Visit', 'Other'];
const RESULTS = ['Contacted', 'No Answer', 'Call Back Requested', 'Waiting for Client', 'Waiting for Consultant', 'Price Discussion',
  'Technical Clarification', 'Negotiation', 'Revised Quotation Required', 'Meeting Required', 'Follow Up Later', 'Approved', 'Lost', 'Other'];
const ALERTS = ['Overdue', 'Due Today', 'Upcoming', 'No Follow-Up', 'Not Scheduled', 'Completed'];
const ALERT_RANK = { 'Overdue': 0, 'Due Today': 1, 'Upcoming': 2, 'No Follow-Up': 3, 'Not Scheduled': 4, 'Completed': 5 };

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);

function alertFor(status, lastFu, nextFu, today) {
  const closed = CLOSED.has(status);
  if (nextFu && (!closed || nextFu >= today)) return nextFu < today ? 'Overdue' : nextFu === today ? 'Due Today' : 'Upcoming';
  if (closed) return 'Completed';
  if (!lastFu) return 'No Follow-Up';
  return 'Not Scheduled';
}

// Latest non-void follow-up per quotation — ONE aggregated query (no per-row lookups)
const LATEST_CTE = `WITH fu AS (
    SELECT f.*, ROW_NUMBER() OVER (PARTITION BY f.quotation_id ORDER BY f.followup_date DESC, f.id DESC) rn,
           COUNT(*) OVER (PARTITION BY f.quotation_id) cnt
    FROM sales_quotation_followups f WHERE f.is_void = 0)`;

/**
 * Follow-up register.
 * f: { search, salesperson, status, alert, year, month, client, due_from, due_to, sort, dir }
 * Returns { rows (all, sorted), kpis (all filters except alert), today }.
 */
function followupRegister(f = {}) {
  const today = localToday();
  const w = ['q.is_deleted = 0'], p = [];
  if (f.search) {
    w.push(`(q.quote_ref LIKE ? OR q.client_name LIKE ? OR q.project_name LIKE ? OR q.attn_name LIKE ? OR q.mobile LIKE ? OR q.phone LIKE ? OR q.email LIKE ?)`);
    for (let i = 0; i < 7; i++) p.push(`%${f.search}%`);
  }
  if (f.client) { w.push('q.client_name LIKE ?'); p.push(`%${f.client}%`); }
  if (f.salesperson) { w.push('q.salesperson = ?'); p.push(f.salesperson); }
  if (f.status) { w.push('q.status = ?'); p.push(f.status); }
  if (f.year) {
    const mm = f.month ? String(parseInt(f.month, 10)).padStart(2, '0') : null;
    w.push(mm ? 'substr(q.quotation_date,1,7) = ?' : 'substr(q.quotation_date,1,4) = ?'); p.push(mm ? `${f.year}-${mm}` : String(f.year));
  }
  const rows = all(`${LATEST_CTE}
    SELECT q.id, q.quote_ref, q.client_name, q.project_name, q.location, q.attn_name, q.mobile, q.phone, q.email, q.salesperson,
           substr(q.quotation_date,1,10) quotation_date, q.status, q.remarks AS quotation_remarks,
           fu.followup_date last_followup, fu.next_followup_date next_followup, fu.remarks last_remarks, fu.result last_result,
           fu.method last_method, COALESCE(fu.cnt,0) followup_count
    FROM quotations q LEFT JOIN fu ON fu.quotation_id = q.id AND fu.rn = 1
    WHERE ${w.join(' AND ')}`, p).map(r => {
      const alert = alertFor(r.status, r.last_followup, r.next_followup, today);
      return { ...r, status_label: STATUS_LABEL[r.status] || r.status, alert,
        days_since_followup: r.last_followup ? daysBetween(r.last_followup, today) : null,
        quotation_age_days: r.quotation_date && ISO.test(r.quotation_date) ? daysBetween(r.quotation_date, today) : null };
    });
  let scoped = rows;
  if (f.due_from) scoped = scoped.filter(r => r.next_followup && r.next_followup >= f.due_from);
  if (f.due_to) scoped = scoped.filter(r => r.next_followup && r.next_followup <= f.due_to);
  const thisMonth = today.slice(0, 7);
  // Approved this month = status changed to Approved this month (quotation edits AND follow-ups both log to status_history)
  const approvedThisMonth = get(`SELECT COUNT(DISTINCT sh.entity_id) n FROM status_history sh
      WHERE sh.entity_type = 'project' AND sh.field_name = 'status' AND sh.new_value = 'approved' AND substr(sh.changed_at,1,7) = ?
        AND sh.entity_id IN (SELECT q.id FROM quotations q WHERE ${w.join(' AND ')} AND q.status = 'approved')`, [thisMonth, ...p]).n;
  const c = a => scoped.filter(r => r.alert === a).length;
  const kpis = {
    open: scoped.filter(r => !CLOSED.has(r.status)).length,
    due_today: c('Due Today'), overdue: c('Overdue'), upcoming: c('Upcoming'),
    no_followup: c('No Follow-Up'), not_scheduled: c('Not Scheduled'),
    negotiation: scoped.filter(r => r.status === 'negotiation').length,
    approved_this_month: approvedThisMonth,
    scheduled: scoped.filter(r => r.next_followup).length,
    total: scoped.length,
  };
  let out = f.alert ? scoped.filter(r => r.alert === f.alert) : scoped;
  const dir = String(f.dir || 'asc').toLowerCase() === 'desc' ? -1 : 1;
  const key = { next_followup: 'next_followup', last_followup: 'last_followup', quotation_date: 'quotation_date',
    quote_ref: 'quote_ref', client_name: 'client_name', salesperson: 'salesperson', status: 'status_label' }[f.sort];
  out = [...out].sort((a, b) => {
    if (key) {
      const x = a[key] || '', y = b[key] || '';
      if (!x !== !y) return x ? -1 : 1;                       // blanks last
      return String(x).localeCompare(String(y), undefined, { numeric: true }) * dir || String(b.quotation_date || '').localeCompare(String(a.quotation_date || ''));
    }
    // default: Overdue → Due Today → Upcoming (soonest first) → No Follow-Up → Not Scheduled → Completed
    return (ALERT_RANK[a.alert] - ALERT_RANK[b.alert]) || String(a.next_followup || '9999').localeCompare(String(b.next_followup || '9999'))
      || String(b.quotation_date || '').localeCompare(String(a.quotation_date || '')) || String(b.quote_ref).localeCompare(String(a.quote_ref), undefined, { numeric: true });
  });
  return { rows: out, kpis, today };
}

function followupHistory(quotationId, order = 'desc') {
  return all(`SELECT * FROM sales_quotation_followups WHERE quotation_id = ?
    ORDER BY followup_date ${order === 'asc' ? 'ASC' : 'DESC'}, id ${order === 'asc' ? 'ASC' : 'DESC'}`, [quotationId])
    .map(h => ({ ...h, quotation_status_label: STATUS_LABEL[h.quotation_status] || h.quotation_status || '' }));
}

/** Activity counts for reporting (follow-ups logged in a period). */
function followupActivity(year, month, salesperson) {
  const p = [String(year)];
  let w = 'f.is_void = 0 AND substr(f.followup_date,1,4) = ?';
  if (month) { w = 'f.is_void = 0 AND substr(f.followup_date,1,7) = ?'; p[0] = `${year}-${String(month).padStart(2, '0')}`; }
  if (salesperson) { w += ' AND q.salesperson = ?'; p.push(salesperson); }
  return all(`SELECT f.*, q.salesperson FROM sales_quotation_followups f JOIN quotations q ON q.id = f.quotation_id WHERE ${w}`, p);
}

module.exports = { STATUS, STATUS_LABEL, METHODS, RESULTS, ALERTS, CLOSED, localToday, alertFor, followupRegister, followupHistory, followupActivity };
