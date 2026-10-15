// Accounts & Payments — frontend
// Tabs: Client Contract Payments | Factory Supplier Payments
//   Factory sub-tabs: Factory INS Payments | OTJ Payments | SEA Payments

const CLIENT_PAYMENT_TYPES = [
  'Advance','Second Payment','Delivery Payment','Mechanical Completion Payment',
  'Testing & Commissioning Payment','Final Payment','Partial Payment',
  'Full Payment','Variation Payment','Other'
];
const INS_PAYMENT_TYPES = ['Advance','Second Payment','Final Payment','Full Payment','Partial Payment','Other'];
const OTJ_PAYMENT_TYPES = ['Advance','Partial Payment','Final Payment','Full Payment','Other'];
const SEA_PAYMENT_TYPES = ['Shipping Payment','Clearance Payment','Advance','Partial Payment','Final Payment','Full Payment','Other'];
const PAYMENT_MODES = ['Cash','Bank Transfer','Cheque','Online Transfer','Other'];
const ACCT_PAYMENT_STATUS_OPTS = ['Unpaid','Partial Paid','Full Paid','Overpaid'];

const _acct = {
  client: { page:1,sort:'entry_date',dir:'desc',search:'',contract_ref:'',payment_type:'',payment_status:'',date_from:'',date_to:'' },
  ins:    { page:1,sort:'entry_date',dir:'desc',search:'',factory_ref:'',supplier:'',payment_type:'',payment_status:'',date_from:'',date_to:'' },
  otj:    { page:1,sort:'entry_date',dir:'desc',search:'',factory_ref:'',supplier:'',payment_type:'',payment_status:'',date_from:'',date_to:'' },
  sea:    { page:1,sort:'entry_date',dir:'desc',search:'',shipping_ref:'',supplier:'',payment_type:'',payment_status:'',date_from:'',date_to:'' },
  activeTab: 'client',
  activeFactoryTab: 'ins',
};

async function renderAccounts(root) {
  root.innerHTML = `
    <div class="tabs" id="acct-tabs">
      <div class="tab active" data-tab="client">Client Contract Payments</div>
      <div class="tab" data-tab="factory">Factory Supplier Payments</div>
    </div>
    <div id="acct-body"></div>
  `;
  root.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    root.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    _acct.activeTab = t.dataset.tab;
    if (t.dataset.tab === 'client') loadClientPayments();
    else renderFactorySection();
  }));
  await loadClientPayments();
}

// ════════════════════════════════════════════════════════════════════════════
// CLIENT CONTRACT PAYMENTS  (unchanged)
// ════════════════════════════════════════════════════════════════════════════

async function loadClientPayments(page) {
  if (page) _acct.client.page = page;
  const s = _acct.client;
  const params = new URLSearchParams({ page:s.page,pageSize:50,sort:s.sort,dir:s.dir });
  if (s.search) params.set('search',s.search);
  if (s.contract_ref) params.set('contract_ref',s.contract_ref);
  if (s.payment_type) params.set('payment_type',s.payment_type);
  if (s.payment_status) params.set('payment_status',s.payment_status);
  if (s.date_from) params.set('date_from',s.date_from);
  if (s.date_to) params.set('date_to',s.date_to);
  const [data,summary] = await Promise.all([
    API.get(`/api/accounts/client-payments?${params}`),
    API.get('/api/accounts/client-payments/summary'),
  ]);
  const isAdmin = APP.user&&APP.user.role==='admin';
  const canManage = APP.user&&['admin','accounts'].includes(APP.user.role);
  const totalPages = Math.ceil(data.total/50)||1;
  document.getElementById('acct-body').innerHTML = `
    <div class="kpi-grid" style="margin-bottom:14px">
      <div class="kpi-card good"><div class="num">AED ${fmtAmt(summary.total_receivable)}</div><div class="label">Total Receivable</div></div>
      <div class="kpi-card good"><div class="num">AED ${fmtAmt(summary.total_received)}</div><div class="label">Total Received</div></div>
      <div class="kpi-card warn"><div class="num">AED ${fmtAmt(summary.total_balance)}</div><div class="label">Total Balance</div></div>
    </div>
    <div class="toolbar">
      <input type="text" id="cp-search" placeholder="Search ref / contract / client…" value="${esc(s.search)}" style="width:240px">
      <input type="text" id="cp-contract" placeholder="Contract Ref." value="${esc(s.contract_ref)}" style="width:120px">
      <select id="cp-ptype"><option value="">All Types</option>${CLIENT_PAYMENT_TYPES.map(t=>`<option value="${esc(t)}" ${s.payment_type===t?'selected':''}>${esc(t)}</option>`).join('')}</select>
      <select id="cp-pstatus"><option value="">All Status</option>${ACCT_PAYMENT_STATUS_OPTS.map(t=>`<option value="${esc(t)}" ${s.payment_status===t?'selected':''}>${esc(t)}</option>`).join('')}</select>
      <input type="date" id="cp-dfrom" value="${esc(s.date_from)}" title="Date From">
      <input type="date" id="cp-dto" value="${esc(s.date_to)}" title="Date To">
      <select id="cp-sort">
        <option value="entry_date"      ${s.sort==='entry_date'?'selected':''}>Sort: Date</option>
        <option value="payment_ref"     ${s.sort==='payment_ref'?'selected':''}>Sort: Payment Ref.</option>
        <option value="contract_ref"    ${s.sort==='contract_ref'?'selected':''}>Sort: Contract Ref.</option>
        <option value="client_name"     ${s.sort==='client_name'?'selected':''}>Sort: Client Name</option>
        <option value="contract_value"  ${s.sort==='contract_value'?'selected':''}>Sort: Contract Value</option>
        <option value="received_amount" ${s.sort==='received_amount'?'selected':''}>Sort: Received</option>
        <option value="total_received"  ${s.sort==='total_received'?'selected':''}>Sort: Total Received</option>
        <option value="balance"         ${s.sort==='balance'?'selected':''}>Sort: Balance</option>
        <option value="status"          ${s.sort==='status'?'selected':''}>Sort: Status</option>
      </select>
      <select id="cp-dir">
        <option value="desc" ${s.dir==='desc'?'selected':''}>↓ Desc</option>
        <option value="asc" ${s.dir==='asc'?'selected':''}>↑ Asc</option>
      </select>
      <span class="spacer"></span>
      ${canManage?`<button class="btn" id="cp-add">+ New Payment</button>`:''}
      <button class="btn secondary" id="cp-excel">Export Excel</button>
      <button class="btn secondary" id="cp-print">Print</button>
      ${canManage?`<button class="btn secondary" id="cp-reconcile" style="border-color:#1a7f5a;color:#1a7f5a" title="Import Excel and reconcile payments">⚡ Import & Reconcile</button>`:''}

    </div>
    <div class="table-wrap">
      <table class="data-table accounts-payments-table">
        <thead><tr>
          <th class="acol-ref">Payment Ref.</th><th class="acol-date">Date</th><th class="acol-contract">Contract Ref.</th><th class="acol-client">Client Name</th>
          <th class="acol-cvalue">Contract Value</th><th class="acol-received">Received</th>
          <th class="acol-total">Total Received</th><th class="acol-balance">Balance</th><th class="acol-status">Status</th>
          <th class="acol-type">Type</th><th class="acol-mode">Mode</th><th class="acol-by">Received By</th><th class="acol-remarks">Remarks</th>
          ${canManage?'<th class="acol-action"></th>':''}
        </tr></thead>
        <tbody>
        ${data.rows.length===0?`<tr><td colspan="${canManage?14:13}" class="empty-state">No payments found.</td></tr>`:data.rows.map(r=>`
          <tr>
            <td class="acol-ref" style="font-weight:600">${esc(r.payment_ref)}</td>
            <td class="acol-date">${esc(r.entry_date||'')}</td>
            <td class="acol-contract" style="font-weight:600;color:#0f2a47">${esc(r.contract_ref)}</td>
            <td class="acol-client" title="${esc(r.client_name||'')}">${esc(r.client_name||'')}</td>
            <td class="acol-cvalue">AED ${fmtAmt(r.contract_value)}</td>
            <td class="acol-received" style="font-weight:600">AED ${fmtAmt(r.received_amount)}</td>
            <td class="acol-total">AED ${fmtAmt(r.total_received)}</td>
            <td class="acol-balance" style="color:${(r.contract_balance||0)>0?'#d68910':'#1f7a5c'}">AED ${fmtAmt(r.contract_balance)}</td>
            <td class="acol-status">${payStatusBadge(r.contract_payment_status)}</td>
            <td class="acol-type">${esc(r.payment_type||'')}</td>
            <td class="acol-mode">${esc(r.payment_mode||'')}</td>
            <td class="acol-by">${esc(r.received_by||'')}</td>
            <td class="acol-remarks" title="${esc(r.remarks||'')}">${esc(r.remarks||'')}</td>
            ${canManage?`<td class="acol-action" style="display:flex;gap:5px">
              <button class="btn small secondary" data-cp-edit="${r.id}">Edit</button>
              ${isAdmin?`<button class="btn small danger" data-cp-del="${r.id}" data-cp-ref="${esc(r.payment_ref)}">Del</button>`:''}
            </td>`:''}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="pagination" style="margin-top:10px">
      <button class="btn small secondary" id="cp-prev" ${s.page<=1?'disabled':''}>← Prev</button>
      <span style="font-size:13px;color:#66758a">Page ${s.page} / ${totalPages} &nbsp;(${data.total} records)</span>
      <button class="btn small secondary" id="cp-next" ${s.page>=totalPages?'disabled':''}>Next →</button>
    </div>
  `;
  const bind=(id,ev,fn)=>{const el=document.getElementById(id);if(el)el.addEventListener(ev,fn);};
  bind('cp-search','input',e=>{_acct.client.search=e.target.value;loadClientPayments(1);});
  bind('cp-contract','input',e=>{_acct.client.contract_ref=e.target.value;loadClientPayments(1);});
  bind('cp-ptype','change',e=>{_acct.client.payment_type=e.target.value;loadClientPayments(1);});
  bind('cp-pstatus','change',e=>{_acct.client.payment_status=e.target.value;loadClientPayments(1);});
  bind('cp-dfrom','change',e=>{_acct.client.date_from=e.target.value;loadClientPayments(1);});
  bind('cp-dto','change',e=>{_acct.client.date_to=e.target.value;loadClientPayments(1);});
  bind('cp-sort','change',e=>{_acct.client.sort=e.target.value;loadClientPayments(1);});
  bind('cp-dir','change',e=>{_acct.client.dir=e.target.value;loadClientPayments(1);});
  bind('cp-prev','click',()=>loadClientPayments(s.page-1));
  bind('cp-next','click',()=>loadClientPayments(s.page+1));
  bind('cp-add','click',()=>openClientPaymentModal(null));
  bind('cp-excel','click',()=>{
    // Pass current sort/dir and filters so export matches on-screen order (2026-09-21)
    const ep=new URLSearchParams({sort:s.sort,dir:s.dir});
    if(s.search)          ep.set('search',s.search);
    if(s.contract_ref)    ep.set('contract_ref',s.contract_ref);
    if(s.payment_type)    ep.set('payment_type',s.payment_type);
    if(s.payment_status)  ep.set('payment_status',s.payment_status);
    if(s.date_from)       ep.set('date_from',s.date_from);
    if(s.date_to)         ep.set('date_to',s.date_to);
    window.open('/api/accounts/client-payments/export-excel?'+ep.toString(),'_blank');
  });
  bind('cp-reconcile','click',()=>openReconcileModal());
  bind('cp-print','click',()=>{
    const tbl=document.querySelector('#view-root .table-wrap table');
    const s=_acct.client;
    shPrint({title:'Client Payments',contentEl:tbl,filters:{
      Search:s.search||'',Contract:s.contract_ref||'',Type:s.payment_type||'',
      Status:s.payment_status||'','Date From':s.date_from||'','Date To':s.date_to||'',
    }});
  });
  document.querySelectorAll('[data-cp-edit]').forEach(btn=>{
    const row=data.rows.find(r=>r.id==btn.dataset.cpEdit);
    btn.addEventListener('click',()=>openClientPaymentModal(row));
  });
  document.querySelectorAll('[data-cp-del]').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      if(!await confirmDelete({title:'Delete Payment',message:`Delete payment "${btn.dataset.cpRef}"? This will recalculate the contract balance.`}))return;
      try{await API.del(`/api/accounts/client-payments/${btn.dataset.cpDel}`);toast('Payment deleted');loadClientPayments();}
      catch(e){toast(e.message,true);}
    });
  });
}

function openClientPaymentModal(rec) {
  const isNew=!rec;
  openModal(`
    <h2>${isNew?'New Client Payment':'Edit Payment — '+esc(rec.payment_ref)}</h2>
    <form id="cp-form">
      <div class="form-grid">
        <div class="form-field span2">
          <label>Contract Ref. *</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="text" id="cp-f-contract" value="${esc(rec?.contract_ref||'')}" placeholder="Search contract ref…" style="flex:1" required>
            <button type="button" class="btn small secondary" id="cp-lookup-btn">Lookup</button>
          </div>
          <div id="cp-contract-info" style="font-size:12px;color:#1f7a5c;margin-top:4px"></div>
        </div>
        ${formField('Entry Date','entry_date',rec?.entry_date||new Date().toISOString().slice(0,10),{type:'date'})}
        ${formField('Client Name','client_name',rec?.client_name||'')}
        ${formField('Project Name','project_name',rec?.project_name||'')}
        ${formField('Contract Value (AED)','contract_value',rec?.contract_value||'',{type:'number'})}
        ${formField('Received Amount (AED) *','received_amount',rec?.received_amount||'',{type:'number'})}
        ${formField('Payment Type','payment_type',rec?.payment_type||'',{select:CLIENT_PAYMENT_TYPES})}
        ${formField('Payment Mode','payment_mode',rec?.payment_mode||'',{select:PAYMENT_MODES})}
        ${formField('Received By','received_by',rec?.received_by||'')}
        <div class="form-field span2">${formField('Remarks','remarks',rec?.remarks||'',{textarea:true})}</div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn secondary" id="cancel-modal">Cancel</button>
        <button type="submit" class="btn">${isNew?'Add Payment':'Save Changes'}</button>
      </div>
    </form>
  `);
  document.getElementById('cancel-modal').addEventListener('click',closeModal);
  const contractInput=document.getElementById('cp-f-contract');
  const infoDiv=document.getElementById('cp-contract-info');
  const populateContractInfo=async(val)=>{
    if(!val){infoDiv.textContent='';return;}
    try{const d=await API.get(`/api/accounts/contract-lookup?q=${encodeURIComponent(val)}`);
      const c=d.rows.find(r=>r.contract_ref===val);
      if(c){infoDiv.innerHTML=`<b>${esc(c.client_name||'')}</b> | ${esc(c.project_description||'')} | Contract Value: AED ${fmtAmt(c.contract_value)} | Status: ${payStatusBadge(c.payment_status)}`;
        const cvField=document.querySelector('#cp-form [name=contract_value]');
        const cnField=document.querySelector('#cp-form [name=client_name]');
        const pnField=document.querySelector('#cp-form [name=project_name]');
        if(cvField&&!rec)cvField.value=c.contract_value||'';
        if(cnField&&!rec)cnField.value=c.client_name||'';
        if(pnField&&!rec)pnField.value=c.project_description||'';
      }else{infoDiv.textContent=val?'Contract not found':'';}}catch(_){}
  };
  if(rec)populateContractInfo(rec.contract_ref);
  contractInput.addEventListener('blur',e=>populateContractInfo(e.target.value.trim()));
  document.getElementById('cp-lookup-btn').addEventListener('click',async()=>{
    const q=contractInput.value.trim();
    try{const d=await API.get(`/api/accounts/contract-lookup?q=${encodeURIComponent(q)}`);
      if(d.rows.length===0){toast('No contracts found',true);return;}
      if(d.rows.length===1){contractInput.value=d.rows[0].contract_ref;populateContractInfo(d.rows[0].contract_ref);return;}
      openModal(`<h2>Select Contract</h2><div class="table-wrap" style="max-height:340px"><table class="data-table"><thead><tr><th>Contract Ref.</th><th>Client</th><th>Value</th><th>Status</th><th></th></tr></thead><tbody>${d.rows.map(c=>`<tr><td>${esc(c.contract_ref)}</td><td>${esc(c.client_name||'')}</td><td>AED ${fmtAmt(c.contract_value)}</td><td>${payStatusBadge(c.payment_status)}</td><td><button class="btn small" data-pick-contract="${esc(c.contract_ref)}">Select</button></td></tr>`).join('')}</tbody></table></div>`);
      document.querySelectorAll('[data-pick-contract]').forEach(btn=>btn.addEventListener('click',()=>{closeModal();const cloneRec=rec?{...rec}:{};cloneRec.contract_ref=btn.dataset.pickContract;openClientPaymentModal(cloneRec);}));
    }catch(e){toast(e.message,true);}
  });
  document.getElementById('cp-form').addEventListener('submit',async e=>{
    e.preventDefault();const fd=readForm(e.target);fd.contract_ref=contractInput.value.trim();
    try{if(isNew)await API.post('/api/accounts/client-payments',fd);else await API.patch(`/api/accounts/client-payments/${rec.id}`,fd);toast(isNew?'Payment added':'Payment updated');closeModal();loadClientPayments();}
    catch(err){toast(err.message,true);}
  });
}

// ════════════════════════════════════════════════════════════════════════════
// FACTORY SUPPLIER PAYMENTS — container with 3 sub-tabs
// ════════════════════════════════════════════════════════════════════════════

function renderFactorySection() {
  const body = document.getElementById('acct-body');
  body.innerHTML = `
    <div class="tabs" id="factory-subtabs" style="margin-bottom:0;border-bottom:1px solid #dde3ea">
      <div class="tab ${_acct.activeFactoryTab==='ins'?'active':''}" data-ftab="ins" style="font-size:13px">Factory INS Payments</div>
      <div class="tab ${_acct.activeFactoryTab==='otj'?'active':''}" data-ftab="otj" style="font-size:13px">OTJ Payments</div>
      <div class="tab ${_acct.activeFactoryTab==='sea'?'active':''}" data-ftab="sea" style="font-size:13px">SEA Payments</div>
    </div>
    <div id="factory-sub-body"></div>
  `;
  body.querySelectorAll('[data-ftab]').forEach(t=>t.addEventListener('click',()=>{
    body.querySelectorAll('[data-ftab]').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    _acct.activeFactoryTab=t.dataset.ftab;
    loadFactorySubTab(_acct.activeFactoryTab);
  }));
  loadFactorySubTab(_acct.activeFactoryTab);
}

function loadFactorySubTab(tab) {
  if (tab==='ins') loadInsPayments();
  else if (tab==='otj') loadOtjPayments();
  else loadSeaPayments();
}

// ── Shared highlight badge ──────────────────────────────────────────────────
function highlightBadge(h, id, section) {
  if (!h) return '';
  const isAdmin = APP.user && APP.user.role === 'admin';
  const map = { green:'#d4edda', yellow:'#fff3cd', red:'#f8d7da' };
  const label = { green:'New', yellow:'Updated', red:'Review' };
  const bg = map[h]||'#eee';
  const clearBtn = isAdmin ? `<button class="btn small" style="padding:1px 5px;font-size:10px;margin-left:4px" data-clear-hl="${id}" data-hl-section="${section}" title="Mark as reviewed">✓</button>` : '';
  return `<span class="badge" style="background:${bg};color:#333;font-size:10px">${label[h]||h}</span>${clearBtn}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY INS PAYMENTS
// ─────────────────────────────────────────────────────────────────────────────
async function loadInsPayments(page) {
  if (page) _acct.ins.page=page;
  const s=_acct.ins;
  const params=new URLSearchParams({page:s.page,pageSize:50,sort:s.sort,dir:s.dir});
  if(s.search)params.set('search',s.search);
  if(s.factory_ref)params.set('factory_ref',s.factory_ref);
  if(s.supplier)params.set('supplier',s.supplier);
  if(s.payment_type)params.set('payment_type',s.payment_type);
  if(s.payment_status)params.set('payment_status',s.payment_status);
  if(s.date_from)params.set('date_from',s.date_from);
  if(s.date_to)params.set('date_to',s.date_to);
  const [data,summary]=await Promise.all([
    API.get(`/api/accounts/factory/ins?${params}`),
    API.get('/api/accounts/factory/ins/summary'),
  ]);
  const isAdmin=APP.user&&APP.user.role==='admin';
  const canManage=APP.user&&['admin','accounts'].includes(APP.user.role);
  const totalPages=Math.ceil(data.total/50)||1;
  document.getElementById('factory-sub-body').innerHTML=`
    <div class="kpi-grid" style="margin:14px 0">
      <div class="kpi-card danger"><div class="num">USD ${fmtAmt(summary.total_payable)}</div><div class="label">Total INS Payable</div></div>
      <div class="kpi-card good"><div class="num">USD ${fmtAmt(summary.total_paid)}</div><div class="label">Total INS Paid</div></div>
      <div class="kpi-card warn"><div class="num">USD ${fmtAmt(summary.total_balance)}</div><div class="label">Total INS Balance</div></div>
    </div>
    <div class="toolbar">
      <input type="text" id="ins-search" placeholder="Search ref / factory ref / supplier…" value="${esc(s.search)}" style="width:240px">
      <input type="text" id="ins-factoryref" placeholder="Factory Ref." value="${esc(s.factory_ref)}" style="width:110px">
      <input type="text" id="ins-supplier" placeholder="Supplier…" value="${esc(s.supplier)}" style="width:130px">
      <select id="ins-ptype"><option value="">All Types</option>${INS_PAYMENT_TYPES.map(t=>`<option value="${esc(t)}" ${s.payment_type===t?'selected':''}>${esc(t)}</option>`).join('')}</select>
      <select id="ins-pstatus"><option value="">All Status</option>${ACCT_PAYMENT_STATUS_OPTS.map(t=>`<option value="${esc(t)}" ${s.payment_status===t?'selected':''}>${esc(t)}</option>`).join('')}</select>
      <input type="date" id="ins-dfrom" value="${esc(s.date_from)}" title="Date From">
      <input type="date" id="ins-dto" value="${esc(s.date_to)}" title="Date To">
      <select id="ins-sort">
        <option value="entry_date" ${s.sort==='entry_date'?'selected':''}>Sort: Date</option>
        <option value="payment_date" ${s.sort==='payment_date'?'selected':''}>Sort: Pay Date</option>
        <option value="factory_ref" ${s.sort==='factory_ref'?'selected':''}>Sort: Factory Ref.</option>
        <option value="paid_amount" ${s.sort==='paid_amount'?'selected':''}>Sort: Paid</option>
        <option value="payment_status" ${s.sort==='payment_status'?'selected':''}>Sort: Status</option>
      </select>
      <select id="ins-dir">
        <option value="desc" ${s.dir==='desc'?'selected':''}>↓ Desc</option>
        <option value="asc" ${s.dir==='asc'?'selected':''}>↑ Asc</option>
      </select>
      <span class="spacer"></span>
      ${canManage?`<button class="btn" id="ins-add">+ New Payment</button>`:''}
      <button class="btn secondary" id="ins-excel">Export Excel</button>
      <button class="btn secondary" id="ins-print">Print</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th></th><th>Payment Ref.</th><th>Entry Date</th><th>Payment Date</th>
          <th>Our Ref.</th><th>Factory Ref.</th><th>Supplier / Factory</th><th>Client / Project</th>
          <th>Total Amount</th><th>Paid Amount</th><th>Balance</th>
          <th>Status</th><th>Type</th><th>Mode</th><th>Remarks</th><th>Last Updated</th>
          <th>PDF</th>${canManage?'<th></th>':''}
        </tr></thead>
        <tbody>
        ${data.rows.length===0?`<tr><td colspan="${canManage?18:17}" class="empty-state">No INS payments found.</td></tr>`:data.rows.map(r=>`
          <tr ${r.highlight_status==='red'?'style="background:#fff5f5"':r.highlight_status==='green'?'style="background:#f4fdf7"':r.highlight_status==='yellow'?'style="background:#fffdf0"':''}>
            <td>${highlightBadge(r.highlight_status,r.id,'ins')}</td>
            <td style="font-weight:600">${esc(r.payment_ref)}</td>
            <td>${esc(r.entry_date||'')}</td>
            <td>${esc(r.payment_date||'')}</td>
            <td>${esc(r.our_ref||'')}</td>
            <td style="font-weight:600;color:#0f2a47">${esc(r.factory_ref||'')}</td>
            <td>${esc(r.supplier_name||'')}</td>
            <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis" title="${esc(r.project_client_name||'')}">${esc(r.project_client_name||'')}</td>
            <td>USD ${fmtAmt(r.total_amount)}</td>
            <td style="font-weight:600">USD ${fmtAmt(r.paid_amount)}</td>
            <td style="color:${(r.balance_amount||0)>0?'#d68910':'#1f7a5c'}">USD ${fmtAmt(r.balance_amount)}</td>
            <td>${payStatusBadge(r.payment_status)}</td>
            <td>${esc(r.payment_type||'')}</td>
            <td>${esc(r.payment_mode||'')}</td>
            <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis" title="${esc(r.remarks||'')}">${esc(r.remarks||'')}</td>
            <td style="font-size:11px;color:#99a">${esc((r.updated_at||'').slice(0,10))}</td>
            <td><button class="btn small secondary" data-ins-pdf="${r.id}" title="Payment Advice PDF">PDF</button></td>
            ${canManage?`<td style="display:flex;gap:4px">
              <button class="btn small secondary" data-ins-edit="${r.id}">Edit</button>
              ${isAdmin?`<button class="btn small danger" data-ins-del="${r.id}" data-ins-ref="${esc(r.payment_ref)}">Del</button>`:''}
            </td>`:''}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="pagination" style="margin-top:10px">
      <button class="btn small secondary" id="ins-prev" ${s.page<=1?'disabled':''}>← Prev</button>
      <span style="font-size:13px;color:#66758a">Page ${s.page} / ${totalPages} &nbsp;(${data.total} records)</span>
      <button class="btn small secondary" id="ins-next" ${s.page>=totalPages?'disabled':''}>Next →</button>
    </div>
  `;
  wireFactorySection('ins', data, ()=>loadInsPayments(), ()=>loadInsPayments(s.page-1), ()=>loadInsPayments(s.page+1), openInsPaymentModal, '/api/accounts/factory/ins');
}

// ── Factory INS Payments — two-step new payment flow ─────────────────────────
function openInsPaymentModal(rec) {
  if (!rec) openInsSelectModal();       // New: factory selection first
  else openInsPaymentForm(null, rec);   // Edit: straight to form
}

async function openInsSelectModal() {
  openModal(`
    <h2>Select Factory INS Record</h2>
    <p style="color:#66758a;font-size:13px;margin-bottom:10px">Select the Factory INS record to create a payment against.</p>
    <div style="margin-bottom:10px">
      <input type="text" id="ins-sel-q" placeholder="Search factory ref / supplier / our ref…" style="width:100%;max-width:380px">
    </div>
    <div id="ins-sel-body"><div style="padding:20px;text-align:center;color:#66758a">Loading…</div></div>
  `);
  async function loadRecs(q) {
    const body = document.getElementById('ins-sel-body');
    if (!body) return;
    body.innerHTML = '<div style="padding:20px;text-align:center;color:#66758a">Loading…</div>';
    try {
      const d = await API.get('/api/accounts/factory/ins-records?q=' + encodeURIComponent(q||''));
      body.innerHTML = `
        <div class="table-wrap" style="max-height:400px;overflow-y:auto">
          <table class="data-table" style="font-size:12px">
            <thead><tr>
              <th>Factory Ref.</th><th>Our Ref.</th><th>Supplier</th>
              <th>Client / Project</th><th>Total Amount</th>
              <th>Total Paid</th><th>Balance</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              ${d.rows.length===0
                ? '<tr><td colspan="9" class="empty-state">No INS records found.</td></tr>'
                : d.rows.map((r,i)=>`
                  <tr>
                    <td style="font-weight:600">${esc(r.factory_ref)}</td>
                    <td>${esc(r.our_ref||'—')}</td>
                    <td>${esc(r.supplier_name||'')}</td>
                    <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis">${esc(r.client_name||r.project_description||'')}</td>
                    <td>USD ${fmtAmt(r.total_amount)}</td>
                    <td>USD ${fmtAmt(r.total_paid)}</td>
                    <td style="color:${r.balance>0?'#d68910':'#1f7a5c'}">USD ${fmtAmt(r.balance)}</td>
                    <td>${payStatusBadge(r.payment_status)}</td>
                    <td><button class="btn small" data-ins-si="${i}">Select</button></td>
                  </tr>`).join('')
              }
            </tbody>
          </table>
        </div>
        <div style="margin-top:12px;text-align:right">
          <button class="btn secondary" id="ins-sel-cancel">Cancel</button>
        </div>
      `;
      document.getElementById('ins-sel-cancel')?.addEventListener('click', closeModal);
      document.querySelectorAll('[data-ins-si]').forEach(btn => {
        const r = d.rows[parseInt(btn.dataset.insSi)];
        btn.addEventListener('click', () => { closeModal(); setTimeout(() => openInsPaymentForm(r, null), 60); });
      });
    } catch(e) {
      if (body) body.innerHTML = '<div style="padding:20px;color:#c0392b">Unable to load Factory Records. Please refresh and try again.<br><small>' + esc(e.message) + '</small></div>';
    }
  }
  await loadRecs('');
  document.getElementById('ins-sel-q')?.addEventListener('input', e => loadRecs(e.target.value));
}

function openInsPaymentForm(factoryRec, existingPayment) {
  const isNew = !existingPayment;
  const fr = factoryRec || {};
  const ep = existingPayment || {};
  openModal(`
    <h2>${isNew ? 'New Factory INS Payment' : 'Edit INS Payment — ' + esc(ep.payment_ref)}</h2>
    ${isNew && factoryRec ? `
      <div style="background:#f0f7ff;border:1px solid #cce0f5;padding:10px 16px;border-radius:6px;margin-bottom:14px;font-size:13px">
        <div style="font-weight:600;color:#0f2a47;margin-bottom:5px">Selected Factory Record</div>
        <div style="display:flex;gap:20px;flex-wrap:wrap">
          <span><span style="color:#66758a">Factory Ref:</span> <b>${esc(fr.factory_ref)}</b></span>
          <span><span style="color:#66758a">Our Ref:</span> <b>${esc(fr.our_ref||'—')}</b></span>
          <span><span style="color:#66758a">Supplier:</span> ${esc(fr.supplier_name||'—')}</span>
          <span><span style="color:#66758a">Total:</span> USD ${fmtAmt(fr.total_amount)}</span>
          <span><span style="color:#66758a">Paid:</span> USD ${fmtAmt(fr.total_paid)}</span>
          <span><span style="color:#66758a">Balance:</span> <b style="color:${fr.balance>0?'#d68910':'#1f7a5c'}">USD ${fmtAmt(fr.balance)}</b></span>
          <span>${payStatusBadge(fr.payment_status)}</span>
        </div>
      </div>
    ` : ''}
    <form id="ins-pay-form">
      <div class="form-grid">
        ${formField('Entry Date','entry_date',ep.entry_date||new Date().toISOString().slice(0,10),{type:'date'})}
        ${formField('Payment Date *','payment_date',ep.payment_date||'',{type:'date'})}
        ${!isNew ? formField('Our Ref.','our_ref',ep.our_ref||'') : ''}
        ${!isNew ? formField('Factory Ref.','factory_ref',ep.factory_ref||'') : ''}
        ${!isNew ? formField('Supplier / Factory','supplier_name',ep.supplier_name||'') : ''}
        ${!isNew ? formField('Client / Project','project_client_name',ep.project_client_name||'') : ''}
        ${!isNew ? formField('Total Amount (USD)','total_amount',ep.total_amount||'',{type:'number'}) : ''}
        ${formField('Paid Amount (USD) *','paid_amount',ep.paid_amount||'',{type:'number'})}
        ${formField('Payment Type','payment_type',ep.payment_type||'',{select:INS_PAYMENT_TYPES})}
        ${formField('Payment Mode','payment_mode',ep.payment_mode||'',{select:PAYMENT_MODES})}
        <div class="form-field span2">${formField('Remarks','remarks',ep.remarks||'',{textarea:true})}</div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn secondary" id="ins-form-cancel">Cancel</button>
        <button type="submit" class="btn">${isNew ? 'Save Payment' : 'Save Changes'}</button>
      </div>
    </form>
  `);
  document.getElementById('ins-form-cancel')?.addEventListener('click', closeModal);
  document.getElementById('ins-pay-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = readForm(e.target);
    if (!fd.paid_amount || parseFloat(fd.paid_amount) <= 0) { toast('Paid Amount must be greater than 0', true); return; }
    if (isNew && factoryRec) {
      fd.factory_ref        = factoryRec.factory_ref || '';
      fd.our_ref            = factoryRec.our_ref || '';
      fd.supplier_name      = factoryRec.supplier_name || '';
      fd.project_client_name = factoryRec.client_name || factoryRec.project_description || '';
      fd.total_amount       = factoryRec.total_amount || 0;
    }
    try {
      if (isNew) await API.post('/api/accounts/factory/ins', fd);
      else await API.patch('/api/accounts/factory/ins/' + ep.id, fd);
      toast(isNew ? 'Payment saved successfully' : 'Payment updated');
      closeModal();
      loadInsPayments();
    } catch(err) { toast(err.message, true); }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY OTJ PAYMENTS
// ─────────────────────────────────────────────────────────────────────────────
async function loadOtjPayments(page) {
  if (page) _acct.otj.page=page;
  const s=_acct.otj;
  const params=new URLSearchParams({page:s.page,pageSize:50,sort:s.sort,dir:s.dir});
  if(s.search)params.set('search',s.search);
  if(s.factory_ref)params.set('factory_ref',s.factory_ref);
  if(s.supplier)params.set('supplier',s.supplier);
  if(s.payment_type)params.set('payment_type',s.payment_type);
  if(s.payment_status)params.set('payment_status',s.payment_status);
  if(s.date_from)params.set('date_from',s.date_from);
  if(s.date_to)params.set('date_to',s.date_to);
  const [data,summary]=await Promise.all([
    API.get(`/api/accounts/factory/otj?${params}`),
    API.get('/api/accounts/factory/otj/summary'),
  ]);
  const isAdmin=APP.user&&APP.user.role==='admin';
  const canManage=APP.user&&['admin','accounts'].includes(APP.user.role);
  const totalPages=Math.ceil(data.total/50)||1;
  document.getElementById('factory-sub-body').innerHTML=`
    <div class="kpi-grid" style="margin:14px 0">
      <div class="kpi-card danger"><div class="num">USD ${fmtAmt(summary.total_payable)}</div><div class="label">Total OTJ Payable</div></div>
      <div class="kpi-card good"><div class="num">USD ${fmtAmt(summary.total_paid)}</div><div class="label">Total OTJ Paid</div></div>
      <div class="kpi-card warn"><div class="num">USD ${fmtAmt(summary.total_balance)}</div><div class="label">Total OTJ Balance</div></div>
    </div>
    <div class="toolbar">
      <input type="text" id="otj-search" placeholder="Search ref / factory ref / supplier…" value="${esc(s.search)}" style="width:240px">
      <input type="text" id="otj-factoryref" placeholder="Factory Ref." value="${esc(s.factory_ref)}" style="width:110px">
      <input type="text" id="otj-supplier" placeholder="Supplier…" value="${esc(s.supplier)}" style="width:130px">
      <select id="otj-ptype"><option value="">All Types</option>${OTJ_PAYMENT_TYPES.map(t=>`<option value="${esc(t)}" ${s.payment_type===t?'selected':''}>${esc(t)}</option>`).join('')}</select>
      <select id="otj-pstatus"><option value="">All Status</option>${ACCT_PAYMENT_STATUS_OPTS.map(t=>`<option value="${esc(t)}" ${s.payment_status===t?'selected':''}>${esc(t)}</option>`).join('')}</select>
      <input type="date" id="otj-dfrom" value="${esc(s.date_from)}" title="Date From">
      <input type="date" id="otj-dto" value="${esc(s.date_to)}" title="Date To">
      <select id="otj-sort">
        <option value="entry_date" ${s.sort==='entry_date'?'selected':''}>Sort: Date</option>
        <option value="payment_date" ${s.sort==='payment_date'?'selected':''}>Sort: Pay Date</option>
        <option value="factory_ref" ${s.sort==='factory_ref'?'selected':''}>Sort: Factory Ref.</option>
        <option value="paid_amount" ${s.sort==='paid_amount'?'selected':''}>Sort: Paid</option>
        <option value="payment_status" ${s.sort==='payment_status'?'selected':''}>Sort: Status</option>
      </select>
      <select id="otj-dir">
        <option value="desc" ${s.dir==='desc'?'selected':''}>↓ Desc</option>
        <option value="asc" ${s.dir==='asc'?'selected':''}>↑ Asc</option>
      </select>
      <span class="spacer"></span>
      ${canManage?`<button class="btn" id="otj-add">+ New Payment</button>`:''}
      <button class="btn secondary" id="otj-excel">Export Excel</button>
      <button class="btn secondary" id="otj-print">Print</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th></th><th>Payment Ref.</th><th>Entry Date</th><th>Payment Date</th>
          <th>Our Ref.</th><th>Factory Ref.</th><th>Supplier / Factory</th><th>Client / Project</th>
          <th>OTJ Total Amount</th><th>Paid Amount</th><th>Balance</th>
          <th>Status</th><th>Type</th><th>Mode</th><th>Remarks</th><th>Last Updated</th>
          <th>PDF</th>${canManage?'<th></th>':''}
        </tr></thead>
        <tbody>
        ${data.rows.length===0?`<tr><td colspan="${canManage?18:17}" class="empty-state">No OTJ payments found.</td></tr>`:data.rows.map(r=>`
          <tr ${r.highlight_status==='red'?'style="background:#fff5f5"':r.highlight_status==='green'?'style="background:#f4fdf7"':r.highlight_status==='yellow'?'style="background:#fffdf0"':''}>
            <td>${highlightBadge(r.highlight_status,r.id,'otj')}</td>
            <td style="font-weight:600">${esc(r.payment_ref)}</td>
            <td>${esc(r.entry_date||'')}</td>
            <td>${esc(r.payment_date||'')}</td>
            <td>${esc(r.our_ref||'')}</td>
            <td style="font-weight:600;color:#0f2a47">${esc(r.factory_ref||'')}</td>
            <td>${esc(r.supplier_name||'')}</td>
            <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis" title="${esc(r.project_client_name||'')}">${esc(r.project_client_name||'')}</td>
            <td>USD ${fmtAmt(r.total_amount)}</td>
            <td style="font-weight:600">USD ${fmtAmt(r.paid_amount)}</td>
            <td style="color:${(r.balance_amount||0)>0?'#d68910':'#1f7a5c'}">USD ${fmtAmt(r.balance_amount)}</td>
            <td>${payStatusBadge(r.payment_status)}</td>
            <td>${esc(r.payment_type||'')}</td>
            <td>${esc(r.payment_mode||'')}</td>
            <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis" title="${esc(r.remarks||'')}">${esc(r.remarks||'')}</td>
            <td style="font-size:11px;color:#99a">${esc((r.updated_at||'').slice(0,10))}</td>
            <td><button class="btn small secondary" data-otj-pdf="${r.id}" title="Payment Advice PDF">PDF</button></td>
            ${canManage?`<td style="display:flex;gap:4px">
              <button class="btn small secondary" data-otj-edit="${r.id}">Edit</button>
              ${isAdmin?`<button class="btn small danger" data-otj-del="${r.id}" data-otj-ref="${esc(r.payment_ref)}">Del</button>`:''}
            </td>`:''}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="pagination" style="margin-top:10px">
      <button class="btn small secondary" id="otj-prev" ${s.page<=1?'disabled':''}>← Prev</button>
      <span style="font-size:13px;color:#66758a">Page ${s.page} / ${totalPages} &nbsp;(${data.total} records)</span>
      <button class="btn small secondary" id="otj-next" ${s.page>=totalPages?'disabled':''}>Next →</button>
    </div>
  `;
  wireFactorySection('otj', data, ()=>loadOtjPayments(), ()=>loadOtjPayments(s.page-1), ()=>loadOtjPayments(s.page+1), openOtjPaymentModal, '/api/accounts/factory/otj');
}

// ── OTJ Payments — two-step new payment flow ─────────────────────────────────
function openOtjPaymentModal(rec) {
  if (!rec) openOtjSelectModal();
  else openOtjPaymentForm(null, rec);
}

async function openOtjSelectModal() {
  openModal(`
    <h2>Select OTJ Record</h2>
    <p style="color:#66758a;font-size:13px;margin-bottom:10px">Select the OTJ record to create a payment against.</p>
    <div style="margin-bottom:10px">
      <input type="text" id="otj-sel-q" placeholder="Search factory ref / supplier / our ref…" style="width:100%;max-width:380px">
    </div>
    <div id="otj-sel-body"><div style="padding:20px;text-align:center;color:#66758a">Loading…</div></div>
  `);
  async function loadRecs(q) {
    const body = document.getElementById('otj-sel-body');
    if (!body) return;
    body.innerHTML = '<div style="padding:20px;text-align:center;color:#66758a">Loading…</div>';
    try {
      const d = await API.get('/api/accounts/factory/otj-records?q=' + encodeURIComponent(q||''));
      body.innerHTML = `
        <div class="table-wrap" style="max-height:400px;overflow-y:auto">
          <table class="data-table" style="font-size:12px">
            <thead><tr>
              <th>Factory Ref.</th><th>Our Ref.</th><th>Supplier</th>
              <th>Client / Project</th><th>Total Amount</th>
              <th>Total Paid</th><th>Balance</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              ${d.rows.length===0
                ? '<tr><td colspan="9" class="empty-state">No OTJ records found.</td></tr>'
                : d.rows.map((r,i)=>`
                  <tr>
                    <td style="font-weight:600">${esc(r.factory_ref)}</td>
                    <td>${esc(r.our_ref||'—')}</td>
                    <td>${esc(r.supplier_name||'')}</td>
                    <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis">${esc(r.client_name||r.project_description||'')}</td>
                    <td>USD ${fmtAmt(r.total_amount)}</td>
                    <td>USD ${fmtAmt(r.total_paid)}</td>
                    <td style="color:${r.balance>0?'#d68910':'#1f7a5c'}">USD ${fmtAmt(r.balance)}</td>
                    <td>${payStatusBadge(r.payment_status)}</td>
                    <td><button class="btn small" data-otj-si="${i}">Select</button></td>
                  </tr>`).join('')
              }
            </tbody>
          </table>
        </div>
        <div style="margin-top:12px;text-align:right">
          <button class="btn secondary" id="otj-sel-cancel">Cancel</button>
        </div>
      `;
      document.getElementById('otj-sel-cancel')?.addEventListener('click', closeModal);
      document.querySelectorAll('[data-otj-si]').forEach(btn => {
        const r = d.rows[parseInt(btn.dataset.otjSi)];
        btn.addEventListener('click', () => { closeModal(); setTimeout(() => openOtjPaymentForm(r, null), 60); });
      });
    } catch(e) {
      if (body) body.innerHTML = '<div style="padding:20px;color:#c0392b">Unable to load OTJ Records. Please refresh and try again.<br><small>' + esc(e.message) + '</small></div>';
    }
  }
  await loadRecs('');
  document.getElementById('otj-sel-q')?.addEventListener('input', e => loadRecs(e.target.value));
}

function openOtjPaymentForm(factoryRec, existingPayment) {
  const isNew = !existingPayment;
  const fr = factoryRec || {};
  const ep = existingPayment || {};
  openModal(`
    <h2>${isNew ? 'New OTJ Payment' : 'Edit OTJ Payment — ' + esc(ep.payment_ref)}</h2>
    ${isNew && factoryRec ? `
      <div style="background:#f0f7ff;border:1px solid #cce0f5;padding:10px 16px;border-radius:6px;margin-bottom:14px;font-size:13px">
        <div style="font-weight:600;color:#0f2a47;margin-bottom:5px">Selected OTJ Record</div>
        <div style="display:flex;gap:20px;flex-wrap:wrap">
          <span><span style="color:#66758a">Factory Ref:</span> <b>${esc(fr.factory_ref)}</b></span>
          <span><span style="color:#66758a">Our Ref:</span> <b>${esc(fr.our_ref||'—')}</b></span>
          <span><span style="color:#66758a">Supplier:</span> ${esc(fr.supplier_name||'—')}</span>
          <span><span style="color:#66758a">Total:</span> USD ${fmtAmt(fr.total_amount)}</span>
          <span><span style="color:#66758a">Paid:</span> USD ${fmtAmt(fr.total_paid)}</span>
          <span><span style="color:#66758a">Balance:</span> <b style="color:${fr.balance>0?'#d68910':'#1f7a5c'}">USD ${fmtAmt(fr.balance)}</b></span>
          <span>${payStatusBadge(fr.payment_status)}</span>
        </div>
      </div>
    ` : ''}
    <form id="otj-pay-form">
      <div class="form-grid">
        ${formField('Entry Date','entry_date',ep.entry_date||new Date().toISOString().slice(0,10),{type:'date'})}
        ${formField('Payment Date *','payment_date',ep.payment_date||'',{type:'date'})}
        ${!isNew ? formField('Our Ref.','our_ref',ep.our_ref||'') : ''}
        ${!isNew ? formField('Factory Ref.','factory_ref',ep.factory_ref||'') : ''}
        ${!isNew ? formField('Supplier / Factory','supplier_name',ep.supplier_name||'') : ''}
        ${!isNew ? formField('Client / Project','project_client_name',ep.project_client_name||'') : ''}
        ${!isNew ? formField('OTJ Total Amount (USD)','total_amount',ep.total_amount||'',{type:'number'}) : ''}
        ${formField('Paid Amount (USD) *','paid_amount',ep.paid_amount||'',{type:'number'})}
        ${formField('Payment Type','payment_type',ep.payment_type||'',{select:OTJ_PAYMENT_TYPES})}
        ${formField('Payment Mode','payment_mode',ep.payment_mode||'',{select:PAYMENT_MODES})}
        <div class="form-field span2">${formField('Remarks','remarks',ep.remarks||'',{textarea:true})}</div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn secondary" id="otj-form-cancel">Cancel</button>
        <button type="submit" class="btn">${isNew ? 'Save Payment' : 'Save Changes'}</button>
      </div>
    </form>
  `);
  document.getElementById('otj-form-cancel')?.addEventListener('click', closeModal);
  document.getElementById('otj-pay-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = readForm(e.target);
    if (!fd.paid_amount || parseFloat(fd.paid_amount) <= 0) { toast('Paid Amount must be greater than 0', true); return; }
    if (isNew && factoryRec) {
      fd.factory_ref        = factoryRec.factory_ref || '';
      fd.our_ref            = factoryRec.our_ref || '';
      fd.supplier_name      = factoryRec.supplier_name || '';
      fd.project_client_name = factoryRec.client_name || factoryRec.project_description || '';
      fd.total_amount       = factoryRec.total_amount || 0;
    }
    try {
      if (isNew) await API.post('/api/accounts/factory/otj', fd);
      else await API.patch('/api/accounts/factory/otj/' + ep.id, fd);
      toast(isNew ? 'Payment saved successfully' : 'Payment updated');
      closeModal();
      loadOtjPayments();
    } catch(err) { toast(err.message, true); }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SEA PAYMENTS
// ─────────────────────────────────────────────────────────────────────────────
async function loadSeaPayments(page) {
  if (page) _acct.sea.page=page;
  const s=_acct.sea;
  const params=new URLSearchParams({page:s.page,pageSize:50,sort:s.sort,dir:s.dir});
  if(s.search)params.set('search',s.search);
  if(s.shipping_ref)params.set('shipping_ref',s.shipping_ref);
  if(s.supplier)params.set('supplier',s.supplier);
  if(s.payment_type)params.set('payment_type',s.payment_type);
  if(s.payment_status)params.set('payment_status',s.payment_status);
  if(s.date_from)params.set('date_from',s.date_from);
  if(s.date_to)params.set('date_to',s.date_to);
  const [data,summary]=await Promise.all([
    API.get(`/api/accounts/factory/sea?${params}`),
    API.get('/api/accounts/factory/sea/summary'),
  ]);
  const isAdmin=APP.user&&APP.user.role==='admin';
  const canManage=APP.user&&['admin','accounts'].includes(APP.user.role);
  const totalPages=Math.ceil(data.total/50)||1;
  document.getElementById('factory-sub-body').innerHTML=`
    <div class="kpi-grid" style="margin:14px 0">
      <div class="kpi-card danger"><div class="num">USD ${fmtAmt(summary.total_payable)}</div><div class="label">Total Shipping Payable</div></div>
      <div class="kpi-card good"><div class="num">USD ${fmtAmt(summary.total_paid)}</div><div class="label">Total Shipping Paid</div></div>
      <div class="kpi-card warn"><div class="num">USD ${fmtAmt(summary.total_balance)}</div><div class="label">Total Shipping Balance</div></div>
    </div>
    <div class="toolbar">
      <input type="text" id="sea-search" placeholder="Search ref / shipping ref / supplier…" value="${esc(s.search)}" style="width:240px">
      <input type="text" id="sea-shippingref" placeholder="Shipping Ref." value="${esc(s.shipping_ref)}" style="width:110px">
      <input type="text" id="sea-supplier" placeholder="Supplier…" value="${esc(s.supplier)}" style="width:120px">
      <select id="sea-ptype"><option value="">All Types</option>${SEA_PAYMENT_TYPES.map(t=>`<option value="${esc(t)}" ${s.payment_type===t?'selected':''}>${esc(t)}</option>`).join('')}</select>
      <select id="sea-pstatus"><option value="">All Status</option>${ACCT_PAYMENT_STATUS_OPTS.map(t=>`<option value="${esc(t)}" ${s.payment_status===t?'selected':''}>${esc(t)}</option>`).join('')}</select>
      <input type="date" id="sea-dfrom" value="${esc(s.date_from)}" title="Date From">
      <input type="date" id="sea-dto" value="${esc(s.date_to)}" title="Date To">
      <select id="sea-sort">
        <option value="entry_date" ${s.sort==='entry_date'?'selected':''}>Sort: Date</option>
        <option value="payment_date" ${s.sort==='payment_date'?'selected':''}>Sort: Pay Date</option>
        <option value="shipping_ref" ${s.sort==='shipping_ref'?'selected':''}>Sort: Shipping Ref.</option>
        <option value="paid_amount" ${s.sort==='paid_amount'?'selected':''}>Sort: Paid</option>
        <option value="payment_status" ${s.sort==='payment_status'?'selected':''}>Sort: Status</option>
      </select>
      <select id="sea-dir">
        <option value="desc" ${s.dir==='desc'?'selected':''}>↓ Desc</option>
        <option value="asc" ${s.dir==='asc'?'selected':''}>↑ Asc</option>
      </select>
      <span class="spacer"></span>
      ${canManage?`<button class="btn" id="sea-add">+ New Payment</button>`:''}
      <button class="btn secondary" id="sea-excel">Export Excel</button>
      <button class="btn secondary" id="sea-print">Print</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th></th><th>Payment Ref.</th><th>Entry Date</th><th>Payment Date</th>
          <th>Shipping Ref.</th><th>BL No. &amp; ETD</th><th>ETA</th>
          <th>Shipping Cost</th><th>Clearance Cost</th><th>Total Payable</th>
          <th>Paid Amount</th><th>Balance</th>
          <th>Status</th><th>Type</th><th>Mode</th><th>Supplier / Co.</th><th>Remarks</th><th>Last Updated</th>
          <th>PDF</th>${canManage?'<th></th>':''}
        </tr></thead>
        <tbody>
        ${data.rows.length===0?`<tr><td colspan="${canManage?20:19}" class="empty-state">No SEA payments found.</td></tr>`:data.rows.map(r=>`
          <tr ${r.highlight_status==='red'?'style="background:#fff5f5"':r.highlight_status==='green'?'style="background:#f4fdf7"':r.highlight_status==='yellow'?'style="background:#fffdf0"':''}>
            <td>${highlightBadge(r.highlight_status,r.id,'sea')}</td>
            <td style="font-weight:600">${esc(r.payment_ref)}</td>
            <td>${esc(r.entry_date||'')}</td>
            <td>${esc(r.payment_date||'')}</td>
            <td style="font-weight:600;color:#0f2a47">${esc(r.shipping_ref||r.factory_ref||'')}</td>
            <td>${esc(r.bl_no||'')}</td>
            <td>${esc(r.eta||'')}</td>
            <td>USD ${fmtAmt(r.shipping_cost)}</td>
            <td>USD ${fmtAmt(r.clearance_cost)}</td>
            <td style="font-weight:600">USD ${fmtAmt(r.total_amount)}</td>
            <td style="font-weight:600">USD ${fmtAmt(r.paid_amount)}</td>
            <td style="color:${(r.balance_amount||0)>0?'#d68910':'#1f7a5c'}">USD ${fmtAmt(r.balance_amount)}</td>
            <td>${payStatusBadge(r.payment_status)}</td>
            <td>${esc(r.payment_type||'')}</td>
            <td>${esc(r.payment_mode||'')}</td>
            <td>${esc(r.supplier_name||'')}</td>
            <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis" title="${esc(r.remarks||'')}">${esc(r.remarks||'')}</td>
            <td style="font-size:11px;color:#99a">${esc((r.updated_at||'').slice(0,10))}</td>
            <td><button class="btn small secondary" data-sea-pdf="${r.id}" title="Payment Advice PDF">PDF</button></td>
            ${canManage?`<td style="display:flex;gap:4px">
              <button class="btn small secondary" data-sea-edit="${r.id}">Edit</button>
              ${isAdmin?`<button class="btn small danger" data-sea-del="${r.id}" data-sea-ref="${esc(r.payment_ref)}">Del</button>`:''}
            </td>`:''}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="pagination" style="margin-top:10px">
      <button class="btn small secondary" id="sea-prev" ${s.page<=1?'disabled':''}>← Prev</button>
      <span style="font-size:13px;color:#66758a">Page ${s.page} / ${totalPages} &nbsp;(${data.total} records)</span>
      <button class="btn small secondary" id="sea-next" ${s.page>=totalPages?'disabled':''}>Next →</button>
    </div>
  `;
  wireSeaSection(data, s);
}

function wireSeaSection(data, s) {
  const canManage=APP.user&&['admin','accounts'].includes(APP.user.role);
  const isAdmin=APP.user&&APP.user.role==='admin';
  const bind=(id,ev,fn)=>{const el=document.getElementById(id);if(el)el.addEventListener(ev,fn);};
  bind('sea-search','input',e=>{_acct.sea.search=e.target.value;loadSeaPayments(1);});
  bind('sea-shippingref','input',e=>{_acct.sea.shipping_ref=e.target.value;loadSeaPayments(1);});
  bind('sea-supplier','input',e=>{_acct.sea.supplier=e.target.value;loadSeaPayments(1);});
  bind('sea-ptype','change',e=>{_acct.sea.payment_type=e.target.value;loadSeaPayments(1);});
  bind('sea-pstatus','change',e=>{_acct.sea.payment_status=e.target.value;loadSeaPayments(1);});
  bind('sea-dfrom','change',e=>{_acct.sea.date_from=e.target.value;loadSeaPayments(1);});
  bind('sea-dto','change',e=>{_acct.sea.date_to=e.target.value;loadSeaPayments(1);});
  bind('sea-sort','change',e=>{_acct.sea.sort=e.target.value;loadSeaPayments(1);});
  bind('sea-dir','change',e=>{_acct.sea.dir=e.target.value;loadSeaPayments(1);});
  bind('sea-prev','click',()=>loadSeaPayments(s.page-1));
  bind('sea-next','click',()=>loadSeaPayments(s.page+1));
  bind('sea-add','click',()=>openSeaPaymentModal(null));
  bind('sea-excel','click',()=>window.open('/api/accounts/factory/sea/export-excel','_blank'));
  bind('sea-print','click',()=>{
    const tbl=document.querySelector('#view-root .table-wrap table');
    const s=_acct.sea;
    shPrint({title:'SEA Factory Payments',contentEl:tbl,landscape:true,filters:{
      Search:s.search||'',Ref:s.factory_ref||'',Supplier:s.supplier||'',
      Type:s.payment_type||'',Status:s.payment_status||'',
      'Date From':s.date_from||'','Date To':s.date_to||'',
    }});
  });
  document.querySelectorAll('[data-sea-pdf]').forEach(btn=>btn.addEventListener('click',()=>window.open(`/api/accounts/factory/sea/${btn.dataset.seaPdf}/pdf`,'_blank')));
  document.querySelectorAll('[data-sea-edit]').forEach(btn=>{const row=data.rows.find(r=>r.id==btn.dataset.seaEdit);btn.addEventListener('click',()=>openSeaPaymentModal(row));});
  document.querySelectorAll('[data-sea-del]').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      if(!await confirmDelete({title:'Delete SEA Payment',message:`Delete payment "${btn.dataset.seaRef}"?`}))return;
      try{await API.del(`/api/accounts/factory/sea/${btn.dataset.seaDel}`);toast('Payment deleted');loadSeaPayments();}catch(e){toast(e.message,true);}
    });
  });
  wireHighlightClear();
}

// ── SEA Payments — two-step new payment flow ─────────────────────────────────
function openSeaPaymentModal(rec) {
  if (!rec) openSeaSelectModal();
  else openSeaPaymentForm(null, rec);
}

async function openSeaSelectModal() {
  openModal(`
    <h2>Select SEA / Shipping Record</h2>
    <p style="color:#66758a;font-size:13px;margin-bottom:10px">Select the Shipping record to create a payment against.</p>
    <div style="margin-bottom:10px">
      <input type="text" id="sea-sel-q" placeholder="Search shipping ref / supplier / our ref…" style="width:100%;max-width:380px">
    </div>
    <div id="sea-sel-body"><div style="padding:20px;text-align:center;color:#66758a">Loading…</div></div>
  `);
  async function loadRecs(q) {
    const body = document.getElementById('sea-sel-body');
    if (!body) return;
    body.innerHTML = '<div style="padding:20px;text-align:center;color:#66758a">Loading…</div>';
    try {
      const d = await API.get('/api/accounts/factory/sea-records?q=' + encodeURIComponent(q||''));
      body.innerHTML = `
        <div class="table-wrap" style="max-height:400px;overflow-y:auto">
          <table class="data-table" style="font-size:12px">
            <thead><tr>
              <th>Shipping Ref.</th><th>Our Ref.</th><th>BL No.</th><th>Supplier</th>
              <th>Shipping Cost</th><th>Clearance Cost</th><th>Total Payable</th>
              <th>Total Paid</th><th>Balance</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              ${d.rows.length===0
                ? '<tr><td colspan="11" class="empty-state">No SEA records found.</td></tr>'
                : d.rows.map((r,i)=>`
                  <tr>
                    <td style="font-weight:600">${esc(r.shipping_ref)}</td>
                    <td>${esc(r.our_ref||'—')}</td>
                    <td>${esc(r.bl_no||'—')}</td>
                    <td>${esc(r.supplier_name||'')}</td>
                    <td>USD ${fmtAmt(r.shipping_cost)}</td>
                    <td>USD ${fmtAmt(r.clearance_cost)}</td>
                    <td style="font-weight:600">USD ${fmtAmt(r.total_amount)}</td>
                    <td>USD ${fmtAmt(r.total_paid)}</td>
                    <td style="color:${r.balance>0?'#d68910':'#1f7a5c'}">USD ${fmtAmt(r.balance)}</td>
                    <td>${payStatusBadge(r.payment_status)}</td>
                    <td><button class="btn small" data-sea-si="${i}">Select</button></td>
                  </tr>`).join('')
              }
            </tbody>
          </table>
        </div>
        <div style="margin-top:12px;text-align:right">
          <button class="btn secondary" id="sea-sel-cancel">Cancel</button>
        </div>
      `;
      document.getElementById('sea-sel-cancel')?.addEventListener('click', closeModal);
      document.querySelectorAll('[data-sea-si]').forEach(btn => {
        const r = d.rows[parseInt(btn.dataset.seaSi)];
        btn.addEventListener('click', () => { closeModal(); setTimeout(() => openSeaPaymentForm(r, null), 60); });
      });
    } catch(e) {
      if (body) body.innerHTML = '<div style="padding:20px;color:#c0392b">Unable to load SEA Records. Please refresh and try again.<br><small>' + esc(e.message) + '</small></div>';
    }
  }
  await loadRecs('');
  document.getElementById('sea-sel-q')?.addEventListener('input', e => loadRecs(e.target.value));
}

function openSeaPaymentForm(factoryRec, existingPayment) {
  const isNew = !existingPayment;
  const fr = factoryRec || {};
  const ep = existingPayment || {};
  const scVal = isNew ? (fr.shipping_cost||0) : (ep.shipping_cost||0);
  const ccVal = isNew ? (fr.clearance_cost||0) : (ep.clearance_cost||0);
  openModal(`
    <h2>${isNew ? 'New SEA Payment' : 'Edit SEA Payment — ' + esc(ep.payment_ref)}</h2>
    ${isNew && factoryRec ? `
      <div style="background:#f0f7ff;border:1px solid #cce0f5;padding:10px 16px;border-radius:6px;margin-bottom:14px;font-size:13px">
        <div style="font-weight:600;color:#0f2a47;margin-bottom:5px">Selected Shipping Record</div>
        <div style="display:flex;gap:20px;flex-wrap:wrap">
          <span><span style="color:#66758a">Shipping Ref:</span> <b>${esc(fr.shipping_ref)}</b></span>
          <span><span style="color:#66758a">BL No.:</span> ${esc(fr.bl_no||'—')}</span>
          <span><span style="color:#66758a">Supplier:</span> ${esc(fr.supplier_name||'—')}</span>
          <span><span style="color:#66758a">Total Payable:</span> USD ${fmtAmt(fr.total_amount)}</span>
          <span><span style="color:#66758a">Paid:</span> USD ${fmtAmt(fr.total_paid)}</span>
          <span><span style="color:#66758a">Balance:</span> <b style="color:${fr.balance>0?'#d68910':'#1f7a5c'}">USD ${fmtAmt(fr.balance)}</b></span>
          <span>${payStatusBadge(fr.payment_status)}</span>
        </div>
      </div>
    ` : ''}
    <form id="sea-pay-form">
      <div class="form-grid">
        ${formField('Entry Date','entry_date',ep.entry_date||new Date().toISOString().slice(0,10),{type:'date'})}
        ${formField('Payment Date *','payment_date',ep.payment_date||'',{type:'date'})}
        ${!isNew ? formField('Shipping Ref.','shipping_ref',ep.shipping_ref||ep.factory_ref||'') : ''}
        ${!isNew ? formField('BL No. & ETD','bl_no',ep.bl_no||'') : ''}
        ${!isNew ? formField('ETA','eta',ep.eta||'') : ''}
        ${!isNew ? formField('Supplier / Shipping Company','supplier_name',ep.supplier_name||'') : ''}
        ${!isNew ? formField('Shipping Cost (USD)','shipping_cost',ep.shipping_cost||'',{type:'number'}) : ''}
        ${!isNew ? formField('Clearance Cost (USD)','clearance_cost',ep.clearance_cost||'',{type:'number'}) : ''}
        ${!isNew ? `<div class="form-field"><label>Total Payable (USD)</label><input type="text" id="sea-total-disp" readonly style="background:#f5f7fa;color:#555" value="${fmtAmt(scVal+ccVal)}"></div>` : ''}
        ${formField('Paid Amount (USD) *','paid_amount',ep.paid_amount||'',{type:'number'})}
        ${formField('Payment Type','payment_type',ep.payment_type||'',{select:SEA_PAYMENT_TYPES})}
        ${formField('Payment Mode','payment_mode',ep.payment_mode||'',{select:PAYMENT_MODES})}
        <div class="form-field span2">${formField('Remarks','remarks',ep.remarks||'',{textarea:true})}</div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn secondary" id="sea-form-cancel">Cancel</button>
        <button type="submit" class="btn">${isNew ? 'Save Payment' : 'Save Changes'}</button>
      </div>
    </form>
  `);
  document.getElementById('sea-form-cancel')?.addEventListener('click', closeModal);
  // Auto-update total display on edit
  if (!isNew) {
    const updateTotal = () => {
      const sc = parseFloat(document.querySelector('#sea-pay-form [name=shipping_cost]')?.value)||0;
      const cc = parseFloat(document.querySelector('#sea-pay-form [name=clearance_cost]')?.value)||0;
      const td = document.getElementById('sea-total-disp');
      if (td) td.value = fmtAmt(sc+cc);
    };
    document.querySelector('#sea-pay-form [name=shipping_cost]')?.addEventListener('input', updateTotal);
    document.querySelector('#sea-pay-form [name=clearance_cost]')?.addEventListener('input', updateTotal);
  }
  document.getElementById('sea-pay-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = readForm(e.target);
    if (!fd.paid_amount || parseFloat(fd.paid_amount) <= 0) { toast('Paid Amount must be greater than 0', true); return; }
    if (isNew && factoryRec) {
      fd.factory_ref    = factoryRec.shipping_ref || '';
      fd.shipping_ref   = factoryRec.shipping_ref || '';
      fd.bl_no          = factoryRec.bl_no || '';
      fd.supplier_name  = factoryRec.supplier_name || '';
      fd.shipping_cost  = factoryRec.shipping_cost || 0;
      fd.clearance_cost = factoryRec.clearance_cost || 0;
      fd.project_client_name = factoryRec.client_name || factoryRec.project_description || '';
    }
    try {
      if (isNew) await API.post('/api/accounts/factory/sea', fd);
      else await API.patch('/api/accounts/factory/sea/' + ep.id, fd);
      toast(isNew ? 'Payment saved successfully' : 'Payment updated');
      closeModal();
      loadSeaPayments();
    } catch(err) { toast(err.message, true); }
  });
}

// ── Shared factory section wiring ─────────────────────────────────────────────
function wireFactorySection(pfx, data, reload, prev, next, openModal_, apiPath) {
  const canManage=APP.user&&['admin','accounts'].includes(APP.user.role);
  const isAdmin=APP.user&&APP.user.role==='admin';
  const bind=(id,ev,fn)=>{const el=document.getElementById(id);if(el)el.addEventListener(ev,fn);};
  bind(`${pfx}-search`,'input',e=>{_acct[pfx].search=e.target.value;reload(1)||loadFactorySubTab(pfx);});
  bind(`${pfx}-factoryref`,'input',e=>{_acct[pfx].factory_ref=e.target.value;loadFactorySubTab(pfx);});
  bind(`${pfx}-supplier`,'input',e=>{_acct[pfx].supplier=e.target.value;loadFactorySubTab(pfx);});
  bind(`${pfx}-ptype`,'change',e=>{_acct[pfx].payment_type=e.target.value;loadFactorySubTab(pfx);});
  bind(`${pfx}-pstatus`,'change',e=>{_acct[pfx].payment_status=e.target.value;loadFactorySubTab(pfx);});
  bind(`${pfx}-dfrom`,'change',e=>{_acct[pfx].date_from=e.target.value;loadFactorySubTab(pfx);});
  bind(`${pfx}-dto`,'change',e=>{_acct[pfx].date_to=e.target.value;loadFactorySubTab(pfx);});
  bind(`${pfx}-sort`,'change',e=>{_acct[pfx].sort=e.target.value;loadFactorySubTab(pfx);});
  bind(`${pfx}-dir`,'change',e=>{_acct[pfx].dir=e.target.value;loadFactorySubTab(pfx);});
  bind(`${pfx}-prev`,'click',prev);
  bind(`${pfx}-next`,'click',next);
  bind(`${pfx}-add`,'click',()=>openModal_(null));
  bind(`${pfx}-excel`,'click',()=>window.open(`${apiPath}/export-excel`,'_blank'));
  bind(`${pfx}-print`,'click',()=>{
    const tbl=document.querySelector('#view-root .table-wrap table');
    const s=_acct[pfx]||{};
    const titleMap={ins:'INS Factory Payments',otj:'OTJ Factory Payments'};
    shPrint({title:titleMap[pfx]||pfx.toUpperCase()+' Factory Payments',contentEl:tbl,landscape:true,filters:{
      Search:s.search||'',Ref:s.factory_ref||'',Supplier:s.supplier||'',
      Type:s.payment_type||'',Status:s.payment_status||'',
      'Date From':s.date_from||'','Date To':s.date_to||'',
    }});
  });
  document.querySelectorAll(`[data-${pfx}-pdf]`).forEach(btn=>btn.addEventListener('click',()=>window.open(`${apiPath}/${btn.dataset[pfx+'Pdf']}/pdf`,'_blank')));
  document.querySelectorAll(`[data-${pfx}-edit]`).forEach(btn=>{const row=data.rows.find(r=>r.id==btn.dataset[pfx+'Edit']);btn.addEventListener('click',()=>openModal_(row));});
  document.querySelectorAll(`[data-${pfx}-del]`).forEach(btn=>{
    btn.addEventListener('click',async()=>{
      if(!await confirmDelete({title:'Delete Payment',message:`Delete payment "${btn.dataset[pfx+'Ref']}"?`}))return;
      try{await API.del(`${apiPath}/${btn.dataset[pfx+'Del']}`);toast('Payment deleted');reload();}catch(e){toast(e.message,true);}
    });
  });
  wireHighlightClear();
}

// wireFactoryLookup removed — replaced by openXxxSelectModal / openXxxPaymentForm two-step flow

// ── Clear highlight handler ──────────────────────────────────────────────────
function wireHighlightClear() {
  document.querySelectorAll('[data-clear-hl]').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      const id=btn.dataset.clearHl, section=btn.dataset.hlSection;
      try{await API.patch(`/api/accounts/factory/${section}/${id}`,{highlight_status:''});
        loadFactorySubTab(section);}catch(e){toast(e.message,true);}
    });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtAmt(v) {
  if(v==null||v==='')return '0.00';
  return Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}

function payStatusBadge(s) {
  const map={'Unpaid':'background:#fde6e3;color:#c0392b','Partial Paid':'background:#fdf2dc;color:#d68910','Full Paid':'background:#e8f5ef;color:#1f7a5c','Overpaid':'background:#f3e8fd;color:#7e3ba8'};
  const style=map[s]||'background:#eef2f6;color:#66758a';
  return `<span class="badge" style="${style}">${esc(s||'Unpaid')}</span>`;
}

// ── Import & Reconcile modal ──────────────────────────────────────────────────
async function openReconcileModal() {
  const batchId = 'RECON-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fAED = n => n != null && !isNaN(n) ? 'AED ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

  openModal(`
    <div style="min-width:780px;max-width:1000px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h2 style="margin:0;font-size:17px;color:#0f2a47">⚡ Import & Reconcile — Client Contract Payments</h2>
        <button class="btn secondary small" onclick="closeModal()">✕</button>
      </div>

      <div style="background:#eef6ff;border:1px solid #c7ddf7;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#1e3a6e;line-height:1.6">
        <strong>How it works:</strong> Upload the payment summary file (<code>.xlsx</code> or <code>.md</code>) → Dry-run analysis shows exactly what will change → Commit adds only the missing payment differences as "Reconciliation Adjustment" entries.
        Existing payment records are never modified or deleted. Running the same file twice is safe — duplicates are prevented by batch ID.
      </div>

      <div id="rc-upload-sec">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <input type="file" id="rc-file" accept=".xlsx,.xls,.md" style="flex:1;font-size:13px">
          <button class="btn" id="rc-analyze" style="min-width:160px">🔍 Analyze (Dry Run)</button>
        </div>
        <div id="rc-status" style="font-size:13px;min-height:20px"></div>
      </div>

      <div id="rc-preview-sec" style="display:none">
        <div id="rc-summary-chips" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"></div>

        <div style="max-height:400px;overflow-y:auto;border:1px solid #dde3ec;border-radius:6px">
          <table class="data-table" style="font-size:12px">
            <thead><tr>
              <th>Contract Ref.</th><th>Client</th>
              <th style="text-align:right">Contract Value</th>
              <th style="text-align:right">Existing Recv.</th>
              <th style="text-align:right">Source Recv.</th>
              <th style="text-align:right">Adjustment</th>
              <th style="text-align:right">New Balance</th>
              <th>Status</th><th>Flags</th>
            </tr></thead>
            <tbody id="rc-tbody"></tbody>
          </table>
        </div>

        <div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div id="rc-commit-info" style="font-size:13px;color:#667"></div>
          <div style="display:flex;gap:8px">
            <button class="btn secondary" id="rc-reset">↩ New File</button>
            <button class="btn" id="rc-commit" style="background:#1a7f5a;min-width:180px">✅ Commit Adjustments</button>
          </div>
        </div>
      </div>

      <div id="rc-result-sec" style="display:none"></div>
    </div>
  `);

  const STATUS_COLOR = {
    new_payment_required: '#1a7f5a',
    already_up_to_date:   '#2563ad',
    system_higher:        '#d68910',
    missing_contract:     '#c0392b',
    grouped_ref:          '#7e3ba8',
    incomplete_source:    '#888',
  };
  const STATUS_LABEL = {
    new_payment_required: 'New Adjustment',
    already_up_to_date:   'Up to Date',
    system_higher:        'System Higher ⚠',
    missing_contract:     'Missing Contract',
    grouped_ref:          'Grouped Ref ℹ',
    incomplete_source:    'Incomplete Data',
  };

  let previewData = null;

  // ── Analyze click ───────────────────────────────────────────────────────────
  document.getElementById('rc-analyze').addEventListener('click', async () => {
    const fileInput = document.getElementById('rc-file');
    if (!fileInput || !fileInput.files[0]) {
      document.getElementById('rc-status').innerHTML = '<span style="color:#c0392b">Please select an Excel file (.xlsx) first.</span>';
      return;
    }
    const statusEl = document.getElementById('rc-status');
    statusEl.innerHTML = '<span style="color:#667">⏳ Analyzing… please wait</span>';
    document.getElementById('rc-analyze').disabled = true;

    try {
      const file = fileInput.files[0];
      const isMd = /\.md$/i.test(file.name);
      const endpoint = isMd
        ? '/api/accounts/client-payments/reconcile-md-preview'
        : '/api/accounts/client-payments/reconcile-preview';
      const fd = new FormData();
      fd.append('file', file);
      const resp = await fetch(endpoint, {
        method: 'POST', body: fd, credentials: 'same-origin',
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || 'Analysis failed');

      previewData = json;
      previewData.fileName = fileInput.files[0].name;
      _renderReconcilePreview(json, batchId, fAED, STATUS_COLOR, STATUS_LABEL);
      statusEl.innerHTML = '';
    } catch (e) {
      statusEl.innerHTML = `<span style="color:#c0392b">❌ ${esc(e.message)}</span>`;
    } finally {
      const btn = document.getElementById('rc-analyze');
      if (btn) btn.disabled = false;
    }
  });
}

function _renderReconcilePreview(data, batchId, fAED, STATUS_COLOR, STATUS_LABEL) {
  const { items, summary } = data;
  const uploadSec  = document.getElementById('rc-upload-sec');
  const previewSec = document.getElementById('rc-preview-sec');
  if (uploadSec)  uploadSec.style.display  = 'none';
  if (previewSec) previewSec.style.display = '';

  // Summary chips
  const chips = document.getElementById('rc-summary-chips');
  if (chips) {
    chips.innerHTML = [
      ['new_payment_required', summary.new_payment_required],
      ['already_up_to_date',   summary.already_up_to_date],
      ['system_higher',        summary.system_higher],
      ['missing_contract',     summary.missing_contract],
      ['grouped_ref',          summary.grouped_ref],
      ['incomplete_source',    summary.incomplete_source],
    ].filter(([, v]) => v > 0).map(([k, v]) =>
      `<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:14px;font-size:11px;font-weight:700;color:#fff;background:${STATUS_COLOR[k]}">
        ${STATUS_LABEL[k]}: ${v}
      </span>`
    ).join('');
  }

  // Rows
  const tbody = document.getElementById('rc-tbody');
  if (tbody) {
    tbody.innerHTML = items.map(item => {
      const sc = STATUS_COLOR[item.status] || '#888';
      const sl = STATUS_LABEL[item.status] || item.status;
      const flags = [];
      if (item.contract_value_flag) {
        const f = item.contract_value_flag;
        flags.push(`⚠ CV: Src ${fAED(f.source)} vs Sys ${fAED(f.system)} (Δ${fAED(f.diff)})`);
      }
      if (item.balance_discrepancy) {
        const b = item.balance_discrepancy;
        flags.push(`⚠ Bal: Expected ${fAED(b.expected)}, Source ${fAED(b.source)}`);
      }
      if (item.grouped_refs)  flags.push(`ℹ Grouped: ${item.grouped_refs.join(', ')}`);
      if (item.message && !item.grouped_refs) flags.push(esc(item.message));

      const adjColor = item.adjustment_amount > 0 ? '#1a7f5a' : '#aaa';
      const balColor = (item.new_balance || 0) > 0 ? '#d68910' : '#1f7a5c';

      return `<tr>
        <td style="font-weight:700;color:#0f2a47;white-space:nowrap">${esc(item.contract_ref)}</td>
        <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(item.client_name||'')}">
          <small>${esc(item.client_name||item.client_name_source||'—')}</small></td>
        <td style="text-align:right"><small>${fAED(item.contract_value_system)}</small></td>
        <td style="text-align:right"><small>${fAED(item.existing_received)}</small></td>
        <td style="text-align:right"><small>${fAED(item.source_received)}</small></td>
        <td style="text-align:right;font-weight:700;color:${adjColor}">${item.adjustment_amount > 0 ? fAED(item.adjustment_amount) : '—'}</td>
        <td style="text-align:right"><small style="color:${balColor}">${item.new_balance != null ? fAED(item.new_balance) : '—'}</small></td>
        <td><span style="padding:2px 8px;border-radius:10px;font-size:11px;color:#fff;background:${sc};white-space:nowrap">${sl}</span></td>
        <td style="font-size:11px;color:#888;max-width:180px;line-height:1.4">${flags.join('<br>')}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="9" class="empty-state">No rows found.</td></tr>`;
  }

  // Commit info
  const newAdj = items.filter(i => i.status === 'new_payment_required');
  const infoEl = document.getElementById('rc-commit-info');
  if (infoEl) {
    infoEl.innerHTML = `Source rows: <strong>${summary.total_source_rows}</strong> &nbsp;|&nbsp;
      Adjustments to commit: <strong>${newAdj.length}</strong> &nbsp;|&nbsp;
      Total: <strong style="color:#1a7f5a">${fAED(summary.total_adjustment)}</strong>`;
  }

  const commitBtn = document.getElementById('rc-commit');
  if (commitBtn && newAdj.length === 0) {
    commitBtn.disabled = true;
    commitBtn.textContent = 'Nothing to Commit';
    commitBtn.style.background = '#aaa';
  }

  // ── Reset ──────────────────────────────────────────────────────────────────
  const resetBtn = document.getElementById('rc-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      const us = document.getElementById('rc-upload-sec');
      const ps = document.getElementById('rc-preview-sec');
      if (us) us.style.display = '';
      if (ps) ps.style.display = 'none';
      const fi = document.getElementById('rc-file');
      if (fi) fi.value = '';
    });
  }

  // ── Commit ─────────────────────────────────────────────────────────────────
  if (commitBtn && newAdj.length > 0) {
    commitBtn.addEventListener('click', async () => {
      if (!confirm(`Commit ${newAdj.length} payment adjustment(s) totalling ${fAED(summary.total_adjustment)}?\n\nThis will create new payment records. Existing records are preserved. Batch ID: ${batchId}`)) return;

      commitBtn.disabled = true;
      commitBtn.textContent = '⏳ Committing…';

      try {
        const result = await API.post('/api/accounts/client-payments/reconcile-commit', {
          batch_id: batchId,
          source_file: data.source_file || data.fileName || 'unknown',
          adjustments: newAdj,
        });

        const previewSec = document.getElementById('rc-preview-sec');
        const resultSec  = document.getElementById('rc-result-sec');
        if (previewSec) previewSec.style.display = 'none';
        if (resultSec) {
          resultSec.style.display = '';
          resultSec.innerHTML = `
            <div style="text-align:center;padding:28px 20px">
              <div style="font-size:40px;margin-bottom:12px">✅</div>
              <h3 style="color:#1a7f5a;margin:0 0 6px">Reconciliation Complete</h3>
              <p style="color:#667;font-size:13px;margin:0 0 18px">Batch ID: <code style="background:#f4f6f9;padding:2px 6px;border-radius:4px">${esc(batchId)}</code></p>

              <div style="display:flex;gap:14px;justify-content:center;margin-bottom:18px;flex-wrap:wrap">
                <div class="kpi-card good" style="min-width:130px"><div class="num">${result.committed_count}</div><div class="label">Committed</div></div>
                <div class="kpi-card good" style="min-width:160px"><div class="num" style="font-size:14px">${fAED(result.total_adjustment)}</div><div class="label">Total Added</div></div>
                ${result.failed_count > 0 ? `<div class="kpi-card" style="min-width:130px;border-color:#c0392b"><div class="num" style="color:#c0392b">${result.failed_count}</div><div class="label">Skipped</div></div>` : ''}
              </div>

              ${result.backup_file ? `<p style="font-size:11px;color:#aaa;margin-bottom:8px">📦 Backup: ${esc(result.backup_file)}</p>` : ''}

              ${result.failed_count > 0 ? `
                <div style="text-align:left;background:#fff8e1;border:1px solid #ffe082;border-radius:6px;padding:12px;margin:0 0 16px;font-size:12px">
                  <strong>Skipped / requires manual review:</strong><br><br>
                  ${result.failed.map(f => `• <strong>${esc(f.contract_ref)}</strong>: ${esc(f.reason)}`).join('<br>')}
                </div>` : ''}

              ${result.committed_count > 0 ? `
                <div style="text-align:left;background:#f0f9f4;border:1px solid #b2dfcb;border-radius:6px;padding:12px;margin:0 0 16px;font-size:12px;max-height:160px;overflow-y:auto">
                  <strong>Committed adjustments:</strong><br><br>
                  ${result.committed.map(c => `• <strong>${esc(c.contract_ref)}</strong>: ${fAED(c.adjustment_amount)} → <code>${esc(c.payment_ref)}</code>`).join('<br>')}
                </div>` : ''}

              <button class="btn" id="rc-done-btn">Close & Refresh</button>
            </div>
          `;
          document.getElementById('rc-done-btn').addEventListener('click', () => {
            closeModal();
            loadClientPayments();
          });
        }
      } catch (err) {
        toast('Commit failed: ' + err.message, true);
        commitBtn.disabled = false;
        commitBtn.textContent = '✅ Commit Adjustments';
        commitBtn.style.background = '#1a7f5a';
      }
    });
  }
}
