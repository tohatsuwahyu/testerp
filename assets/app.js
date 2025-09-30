/* ===========================
   TSH Frontend App — app.js
   =========================== */
const API_BASE = "https://script.google.com/macros/s/AKfycbwqwycLMS5k1vu51EzhpoXksdUOnkRoGsgtfpisbZfJcDHN62wMpaWS-18TVFONUTBAmg/exec"; // 

const REFRESH_MS = 15000;
const $ = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));

function saveAuth(a){ localStorage.setItem('auth', JSON.stringify(a)); }
function loadAuth(){ try{ return JSON.parse(localStorage.getItem('auth')||'{}'); }catch{ return {}; } }
function clearAuth(){ localStorage.removeItem('auth'); }

async function apiPost(action, payload={}){
  const auth = loadAuth();
  const body = { action, token: auth.token, ...payload };
  let j;
  try{
    const res = await fetch(API_BASE, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    j = await res.json();
  }catch(e){ throw new Error('Tidak dapat terhubung ke API. Cek API_BASE & deployment.'); }
  if(!j.ok) throw new Error(j.error||'Request failed');
  return j;
}
async function apiGet(action, params={}){
  const auth = loadAuth();
  const q = new URLSearchParams({ action, token: auth.token, ...params });
  let j;
  try{
    const res = await fetch(`${API_BASE}?${q.toString()}`);
    j = await res.json();
  }catch(e){ throw new Error('Tidak dapat terhubung ke API. Cek API_BASE & deployment.'); }
  if(!j.ok) throw new Error(j.error||'Request failed');
  return j;
}

function showLogin(){ $('#login-card')?.classList.remove('hidden'); $('#app')?.classList.add('hidden'); }
function showApp(){ $('#login-card')?.classList.add('hidden'); $('#app')?.classList.remove('hidden'); }
function setRoleVisibility(role){
  $$('[data-roles]').forEach(el=>{
    const allow = el.getAttribute('data-roles').split(',').map(s=>s.trim());
    el.style.display = (role==='admin' || allow.includes(role)) ? '' : 'none';
  });
}
function bindLogout(){
  ['#btn-logout','[data-action="logout"]'].forEach(sel=>{
    $$(sel).forEach(el=>{ el.onclick = (e)=>{ e.preventDefault(); logout(); }; });
  });
}

function showError(msg){ const el=$('#login-error'); if(el){ el.textContent=msg; } else alert(msg); }

async function doLogin(e){
  e?.preventDefault?.();
  const u = $('#username')?.value?.trim();
  const p = $('#password')?.value?.trim();
  if(!u||!p) return showError('Harap isi username & password');
  try{
    const { token, user } = await apiPost('login', { username:u, password:p });
    saveAuth({ token, user });
    location.href = 'index.html';
  }catch(err){ showError(err.message); }
}

function logout(){ try{ clearAuth(); }finally{ location.replace('index.html'); } }

/* ---------- DASHBOARD ---------- */
async function loadProductionTable(){
  const body = $('#table-body'); if(!body) return;
  body.innerHTML = `<tr><td colspan="8">Loading...</td></tr>`;
  const { rows } = await apiGet('production');
  body.innerHTML = '';
  rows.forEach(r=>{
    const [id,customer,prodNo,prodName,partNo,drawNo,startDate,status,lastUpd,shipDate,qty] = r;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${customer}</td><td>${prodNo}</td><td>${prodName}</td>
      <td class="right">${qty}</td><td>${startDate||''}</td>
      <td><span class="badge">${status}</span></td><td>${lastUpd||''}</td>
      <td class="actions">
        <a class="nav-btn" href="tickets.html?id=${encodeURIComponent(id)}">🧾</a>
        <button class="nav-btn danger" data-roles="admin" onclick="removeOrder('${id}')">🗑️</button>
      </td>`;
    body.appendChild(tr);
  });
  const role = loadAuth()?.user?.role;
  setRoleVisibility(role);
}

async function loadMasters(){ /* optional untuk modal – tidak wajib di contoh minimal */ }

async function loadDashboard(){
  bindLogout();
  // enter to login
  $('#password')?.addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(e); });
  $('#login-form')?.addEventListener('submit',doLogin);

  // nav
  $('#nav-dashboard')?.addEventListener('click',()=>location.href='index.html');
  $('#nav-charts')?.addEventListener('click',()=>location.href='charts.html');
  $('#nav-delivery')?.addEventListener('click',()=>location.href='delivery.html');
  $('#nav-tickets')?.addEventListener('click',()=>location.href='tickets.html');

  const auth = loadAuth();
  if(!auth.token){ showLogin(); return; }

  try{
    showApp();
    $('#user-info') && ($('#user-info').textContent = `${auth.user.fullName}（${auth.user.role}）`);
    await loadProductionTable();
    setInterval(loadProductionTable, REFRESH_MS);
    $('#btn-export')?.addEventListener('click', exportCSV);
    $('#btn-print')?.addEventListener('click', ()=>window.print());
  }catch(err){
    console.warn(err);
    showError('Sesi kadaluarsa / API error. Silakan login ulang.');
    clearAuth(); showLogin();
  }
}

async function exportCSV(){
  const { rows } = await apiGet('production');
  let csv = "ID,得意先,製番号,品名,品番,図番,生産開始日,ステータス,最終更新,出荷予定日,数量\n";
  rows.forEach(r=>{ csv += r.map(x=>`"${String(x??'').replace(/"/g,'""')}"`).join(",") + "\r\n"; });
  const a = document.createElement('a');
  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  a.download = "data_produksi.csv"; document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- CHARTS ---------- */
async function loadChartsPage(){
  bindLogout();
  const auth = loadAuth(); if(!auth.token) return location.href='index.html';
  $('#who').textContent = `${auth.user.fullName}（${auth.user.role}）`;
  const { stock, monthly, customer } = await apiGet('charts');
  $('#stock-display').textContent = stock;
  const mctx = $('#monthlyShipmentsChart').getContext('2d');
  new Chart(mctx,{type:'bar',data:{labels:Object.keys(monthly),datasets:[{label:'月別出荷数',data:Object.values(monthly)}]},options:{scales:{y:{beginAtZero:true}}}});
  const cctx = $('#customerShipmentsChart').getContext('2d');
  new Chart(cctx,{type:'pie',data:{labels:Object.keys(customer),datasets:[{data:Object.values(customer)}]}});
}

/* ---------- DELIVERY ---------- */
function fmtDateISO(d){ const dt=new Date(d||Date.now()); const o=dt.getTimezoneOffset(); return new Date(dt.getTime()-o*60000).toISOString().slice(0,10); }
async function loadDeliveryPage(){
  bindLogout();
  const auth = loadAuth(); if(!auth.token) return location.href='index.html';
  $('#who').textContent = `${auth.user.fullName}（${auth.user.role}）`;
  const dateInput = $('#delivery-date'); if(!dateInput.value) dateInput.value = fmtDateISO();
  async function refresh(){
    const { rows } = await apiGet('delivery', { date: dateInput.value });
    const body = $('#delivery-body'); body.innerHTML='';
    rows.forEach(row=>{
      const tr=document.createElement('tr');
      tr.dataset.customer=row[1]; tr.dataset.prodNo=row[2]; tr.dataset.prodName=row[3]; tr.dataset.partNo=row[4];
      tr.innerHTML = `<td><input type="checkbox" class="pick"/></td><td>${row[1]}</td><td>${row[2]}</td><td>${row[3]}</td><td>${row[4]}</td>`;
      body.appendChild(tr);
    });
  }
  $('#btn-filter').addEventListener('click',refresh);
  $('#btn-print-list').addEventListener('click',()=>{
    const picked=[]; $$('.pick:checked').forEach(cb=>picked.push(cb.closest('tr').dataset));
    if(!picked.length) return alert('選択してください。');
    const w=window.open('','_blank'); const rows=picked.map(x=>`<tr><td>${x.prodNo}</td><td>${x.customer}</td><td>${x.partNo}</td><td>${x.prodName}</td><td>1</td><td></td></tr>`).join('');
    w.document.write(`<html><head><title>出荷予定リスト</title><style>body{font-family:sans-serif;width:190mm}h1,h3{text-align:center}table{width:100%;border-collapse:collapse;border:1px solid #000}th,td{border:1px solid #000;padding:8px;text-align:center}th{background:#f2f2f2}</style></head><body><h1>出荷予定リスト</h1><h3>出荷日: ${dateInput.value}</h3><table><thead><tr><th>管理番号</th><th>得意先</th><th>品番</th><th>品名</th><th>数量</th><th>備考</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=function(){window.print();window.close();}</script></body></html>`); w.document.close();
  });
  refresh();
}

/* ---------- TICKETS ---------- */
async function loadTicketsPage(){
  bindLogout();
  const auth = loadAuth(); if(!auth.token) return location.href='index.html';
  $('#who').textContent = `${auth.user.fullName}（${auth.user.role}）`;
  const url = new URL(location.href); const id = url.searchParams.get('id');
  if(!id){ document.body.insertAdjacentHTML('beforeend','<p style="padding:16px">ID がありません。</p>'); return; }
  const { order, history } = await apiGet('ticket', { id });
  $('#t-customer').textContent = order.customer;
  $('#t-prodNo').textContent = order.prodNo;
  $('#t-prodName').textContent = order.prodName;
  $('#t-partNo').textContent = order.partNo;
  $('#t-qty').textContent = order.quantity;
  $('#t-start').textContent = order.startDate||'';

  const payload = { id:order.id, customer:order.customer, prodNo:order.prodNo, prodName:order.prodName, partNo:order.partNo, qty:order.quantity };
  const qr = qrcode(4,'L'); qr.addData(JSON.stringify(payload)); qr.make();
  $('#qrcode').innerHTML = qr.createImgTag(4,8);
  $('#sig').textContent = `sig:${String(order.id).slice(-6)}-${String(order.quantity).padStart(2,'0')}`;

  const ALL = ["材料準備","レーザ工程","曲げ工程","外枠組立工程","シャッター組立工程","シャッター溶接工程","コーキング工程","外枠塗装工程","組立工程（組立中）","組立工程（組立済）","外注","検査工程","検査済","検査保留","出荷準備","出荷済"];
  const map = new Map(history.map(h=>[h.status,h]));
  const body = $('#t-history'); body.innerHTML='';
  ALL.forEach(st=>{
    const h = map.get(st);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${st}</td><td>${h?h.user:''}</td><td>${h?h.timestamp:''}</td><td></td>`;
    body.appendChild(tr);
  });
  $('#btn-print-ticket')?.addEventListener('click',()=>window.print());
}

/* ---------- Delete order (dashboard) ---------- */
window.removeOrder = async function(id){
  if(!confirm('このオーダーを削除しますか？')) return;
  try{ const r = await apiPost('delete', { id }); alert(r.message||'Deleted'); loadProductionTable(); }
  catch(e){ alert(e.message); }
};

/* ---------- Boot ---------- */
function bootstrap(){
  // nav hooks agar selalu hidup, terlepas dari halaman
  $('#nav-dashboard')?.addEventListener('click',()=>location.href='index.html');
  $('#nav-charts')?.addEventListener('click',()=>location.href='charts.html');
  $('#nav-delivery')?.addEventListener('click',()=>location.href='delivery.html');
  $('#nav-tickets')?.addEventListener('click',()=>location.href='tickets.html');

  const page = document.body.getAttribute('data-page')||'dashboard';
  if(page==='dashboard') return loadDashboard();
  if(page==='charts')    return loadChartsPage();
  if(page==='delivery')  return loadDeliveryPage();
  if(page==='tickets')   return loadTicketsPage();
}
document.addEventListener('DOMContentLoaded', bootstrap);
