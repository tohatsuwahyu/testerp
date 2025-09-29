// ====== CONFIG ======
const API_BASE = "https://script.google.com/macros/s/AKfycbwqwycLMS5k1vu51EzhpoXksdUOnkRoGsgtfpisbZfJcDHN62wMpaWS-18TVFONUTBAmg/exec"; // <- ganti
const POLL_MS = 5000;

// ====== STATE ======
let SESSION = JSON.parse(localStorage.getItem('SESSION')||'null'); // {token, user}
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function setSession(s){ SESSION=s; localStorage.setItem('SESSION', JSON.stringify(s)); }
function clearSession(){ SESSION=null; localStorage.removeItem('SESSION'); }

// ====== HTTP ======
async function apiGet(params={}){
  const url = new URL(API_BASE);
  url.searchParams.set('action', params.action || 'ping');
  if (SESSION?.token) url.searchParams.set('token', SESSION.token);
  Object.entries(params).forEach(([k,v]) => { if(!['action'].includes(k)) url.searchParams.set(k,v); });
  const res = await fetch(url.toString(), { method:'GET' });
  const js = await res.json();
  if (!js.ok) throw new Error(js.error||'API error');
  return js;
}
async function apiPost(action, body={}){
  const res = await fetch(API_BASE, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ action, ...(SESSION?.token?{token:SESSION.token}:{}) , ...body })
  });
  const js = await res.json();
  if (!js.ok) throw new Error(js.error||'API error');
  return js;
}

// ====== AUTH UI ======
function applyRoleUI(){
  if (!SESSION?.user) return;
  const role = SESSION.user.role;
  // tighten buttons visibility
  $$('.btn-create').forEach(el => el.classList.toggle('hidden', !(role==='admin' || role==='生産管理部')));
  $$('.btn-ship').forEach(el => el.classList.toggle('hidden', !(role==='admin' || role==='生産管理部')));
  $$('.btn-manufacturing').forEach(el => el.classList.toggle('hidden', (role==='生産管理部')));
  $$('.btn-inspection').forEach(el => el.classList.toggle('hidden', (role==='生産管理部')));
}

// ====== LOGIN PAGE ======
async function initLogin(){
  const f = $('#login-form');
  $('#login-user').focus();
  f.addEventListener('submit', async (e)=>{
    e.preventDefault();
    try{
      const username = $('#login-user').value.trim();
      const password = $('#login-pass').value.trim();
      const res = await apiPost('login', { username, password });
      setSession({ token: res.token, user: res.user });
      location.href = './index.html';
    }catch(err){ $('#err').textContent = err.message; }
  });
  // Enter to login already handled by <form> submit
}

// ====== COMMON NAV ======
function initCommon(){
  // show user
  if (SESSION?.user) {
    $('#who').textContent = `${SESSION.user.fullName} (${SESSION.user.role})`;
  }
  // dark mode toggle
  const saved = localStorage.getItem('dark')==='1';
  document.documentElement.classList.toggle('dark', saved);
  $('#dark').checked = saved;
  $('#dark').addEventListener('change',()=>{
    const on = $('#dark').checked;
    document.documentElement.classList.toggle('dark', on);
    localStorage.setItem('dark', on?'1':'0');
  });
  // logout
  $('#logout').addEventListener('click', ()=>{ clearSession(); location.href='./index.html'; });
}

// ====== DASHBOARD ======
let pollTimer=null;
async function loadProduction(){
  const res = await apiGet({ action:'production' });
  const tb = $('#prod-body'); tb.innerHTML='';
  res.rows.forEach(r=>{
    const [id,cust,prodNo,prodName,partNo,drawNo,start,status,upd,shipDate,qty] = r;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${cust}</td><td>${prodNo}</td><td>${prodName}</td>
      <td>${qty}</td><td>${start||''}</td>
      <td><span class="badge">${status}</span></td>
      <td>${upd||''}</td>
      <td class="no-print">
        <button class="btn btn-sm btn-manufacturing" data-act="scan" data-id="${id}">工程</button>
        <button class="btn btn-sm" data-act="upd" data-id="${id}">更新</button>
        <button class="btn btn-sm" data-act="edit" data-id="${id}">編集</button>
        <button class="btn btn-sm danger" data-act="del" data-id="${id}">削除</button>
        <a class="btn btn-sm" href="tickets.html?id=${encodeURIComponent(id)}" target="_blank">現品票</a>
      </td>
    `;
    tb.appendChild(tr);
  });
  applyRoleUI();
}
function startPolling(){
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async ()=>{
    try{ await loadProduction(); }catch(e){}
  }, POLL_MS);
}

// ====== CHARTS ======
async function loadCharts(){
  const res = await apiGet({ action:'charts' });
  // simple draw with Chart.js (via CDN in charts.html)
  const monthlyLabels = Object.keys(res.monthly);
  const monthlyData = Object.values(res.monthly);
  const customerLabels = Object.keys(res.customer);
  const customerData = Object.values(res.customer);

  const mctx = $('#monthly').getContext('2d');
  new Chart(mctx,{type:'bar',data:{labels:monthlyLabels,datasets:[{label:'月別出荷数',data:monthlyData}]}, options:{responsive:true}});

  const cctx = $('#customer').getContext('2d');
  new Chart(cctx,{type:'pie',data:{labels:customerLabels,datasets:[{data:customerData}]}, options:{responsive:true}});
  $('#stock').textContent = res.stock;
}

// ====== DELIVERY ======
async function loadDelivery(){
  if (!$('#date').value){
    const d = new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
    $('#date').value = d.toISOString().split('T')[0];
  }
  const res = await apiGet({ action:'delivery', date: $('#date').value });
  const tb = $('#del-body'); tb.innerHTML='';
  res.rows.forEach(r=>{
    const [id,cust,prodNo,prodName,partNo] = r;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="checkbox"></td><td>${cust}</td><td>${prodNo}</td><td>${prodName}</td><td>${partNo}</td>`;
    tb.appendChild(tr);
  });
}

// ====== TICKETS ======
async function loadTicket(){
  const id = new URLSearchParams(location.search).get('id');
  const res = await apiGet({ action:'order', id });
  const o = res.order;

  $('#t-id').textContent = o.id;
  $('#t-cust').textContent = o.customer;
  $('#t-prodno').textContent = o.prodNo;
  $('#t-prodname').textContent = o.prodName;
  $('#t-partno').textContent = o.partNo;
  $('#t-qty').textContent = o.quantity;
  $('#t-date').textContent = o.startDate;

  const vcard =
`BEGIN:VCARD
VERSION:3.0
N:${o.customer}
NOTE:ProdNo=${o.prodNo};Qty=${o.quantity}
END:VCARD`;

  const payload = {
    id:o.id, customer:o.customer, prodNo:o.prodNo, prodName:o.prodName,
    partNo:o.partNo, qty:o.quantity
  };

  // combine vCard + JSON
  const qrText = vcard + '\n' + JSON.stringify(payload);

  // qrcode-generator
  const qr = qrcode(4,'L'); // typeNumber, errorCorrection
  qr.addData(qrText); qr.make();
  $('#qrcode').innerHTML = qr.createImgTag(4,8); // cell size, margin

  // mini signature
  $('#sig-mini').textContent = `sig: ${o.id.slice(-6)} • ${new Date().toISOString().slice(0,10)}`;

  // history table
  const h = await apiGet({ action:'history', id });
  const tb = $('#hist'); tb.innerHTML='';
  h.history.forEach(x=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `<td>${x.status}</td><td>${x.user}</td><td>${x.timestamp}</td><td></td>`;
    tb.appendChild(tr);
  });

  // auto print? uncomment:
  // window.print();
}

// ====== PAGE ENTRY POINTS ======
document.addEventListener('DOMContentLoaded', async ()=>{
  const page = document.body.dataset.page; // set in each html
  if (page==='login') { initLogin(); return; }

  // guard: need login
  if (!SESSION?.token){
    location.href='./index.html';
    return;
  }
  initCommon();

  if (page==='dashboard'){
    await loadProduction();
    startPolling();
    // create order modal (very minimal)
    $('#create').addEventListener('click', async ()=>{
      const customer = prompt('得意先?'); if(!customer)return;
      const prodNo = prompt('製番号?'); if(!prodNo)return;
      const prodName = prompt('品名?')||'';
      const partNo = prompt('品番?')||'';
      const drawNo = prompt('図番?')||'';
      const quantity = Number(prompt('数量?', '1')||'1');
      const startDate = prompt('生産開始日 (YYYY-MM-DD)?') || new Date().toISOString().slice(0,10);
      await apiPost('createOrder',{ data:{customer,prodNo,prodName,partNo,drawNo,quantity,startDate} });
      await loadProduction();
    });
  }

  if (page==='charts'){
    await loadCharts();
  }

  if (page==='delivery'){
    await loadDelivery();
    $('#date').addEventListener('change', loadDelivery);
  }

  if (page==='tickets'){
    await loadTicket();
  }

  applyRoleUI();
});
