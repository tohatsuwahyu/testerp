/* ========= CONFIG ========= */
const API_BASE = "https://script.google.com/macros/s/AKfycbwqwycLMS5k1vu51EzhpoXksdUOnkRoGsgtfpisbZfJcDHN62wMpaWS-18TVFONUTBAmg/exec"; // <- Ganti dgn URL Web App GAS
const ALL_STATUSES = ["材料準備","レーザ工程","曲げ工程","外枠組立工程","シャッター組立工程","シャッター溶接工程","コーキング工程","外枠塗装工程","組立工程（組立中）","組立工程（組立済）","外注","検査工程","検査済","検査保留","出荷準備","出荷済"];
const PERMISSIONS = {
  "生産管理部": { canCreate: true,  allowedStatuses: ["出荷準備","出荷済"] },
  "製造部":     { canCreate: false, allowedStatuses: ["材料準備","レーザ工程","曲げ工程","外枠組立工程","シャッター組立工程","シャッター溶接工程","コーキング工程","外枠塗装工程","組立工程（組立中）","組立工程（組立済）","外注"] },
  "検査部":     { canCreate: false, allowedStatuses: ["検査工程","検査済","検査保留"] },
  "admin":      { canCreate: true,  allowedStatuses: ALL_STATUSES }
};

/* ========= STATE ========= */
let currentUser = null;
let lastTs = 0;
let realtimeHandle = null;
let monthlyChart = null;
let customerChart = null;
let html5QrCode = null;
let isScanForSearch = false;
let orderIdToUpdateViaScan = null;

/* ========= UTIL ========= */
function $(id){ return document.getElementById(id); }
function toast(msg){ alert(msg); }
function setDark(on){
  if (on) document.documentElement.classList.add('dark'); else document.documentElement.classList.remove('dark');
  localStorage.setItem('dark', on?'1':'0');
}
(function initDark(){
  const saved = localStorage.getItem('dark'); if (saved){ setDark(saved==='1'); }
})();

/* ========= API ========= */
async function apiPost(action, payload={}){
  const res = await fetch(API_BASE, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({action, ...payload}) });
  return res.json();
}
const api = {
  login: (username,password)=>apiPost('login',{username,password}),
  getMaster: ()=>apiPost('getMaster'),
  getProduction: ()=>apiPost('getProduction'),
  getStock: ()=>apiPost('getStock'),
  getCharts: ()=>apiPost('getCharts'),
  getDelivery: (date)=>apiPost('getDelivery',{date}),
  getOrder: (id)=>apiPost('getOrder',{id}),
  getHistory: (id)=>apiPost('getHistory',{id}),
  createOrder: (order)=>apiPost('createOrder',{order}),
  updateOrder: (order)=>apiPost('updateOrder',{order}),
  deleteOrder: (id)=>apiPost('deleteOrder',{id}),
  updateStatus: (args)=>apiPost('updateStatus',args),
  getIfChanged: (sinceTs)=>apiPost('getIfChanged',{sinceTs})
};
async function apiGetOrderAndHistory(id){
  const [o,h] = await Promise.all([api.getOrder(id), api.getHistory(id)]);
  return {order:o, history:h};
}

/* ========= HEADER (shared) ========= */
function renderHeader(active){
  const user = JSON.parse(localStorage.getItem('currentUser')||'null');
  currentUser = user;
  const canCreate = user && PERMISSIONS[user.role]?.canCreate;

  const nav = [
    {href:'index.html',    label:'ダッシュボード', key:'dashboard'},
    {href:'charts.html',   label:'チャート', key:'charts'},
    {href:'delivery.html', label:'出荷予定', key:'delivery'},
    {href:'tickets.html',  label:'生産現品票', key:'tickets'}
  ].map(x=>`<a href="${x.href}" class="px-3 py-2 rounded-lg ${x.key===active?'bg-[var(--brand)] text-white':'border'}">${x.label}</a>`).join('');

  $('app-header').innerHTML = `
    <div class="card px-4 py-3 flex items-center justify-between gap-3 no-print">
      <div class="flex items-center gap-3">
        <img class="w-8 h-8" src="https://i.ibb.co/L1L150F/company-logo-placeholder.png" alt="logo">
        <strong>生産管理</strong>
        <span id="user-info" class="ml-2 text-sm text-[var(--muted)]">${user?`ようこそ, ${user.fullName} 様 (${user.role})`:'未ログイン'}</span>
      </div>
      <nav class="flex gap-2">${nav}</nav>
      <div class="flex items-center gap-2">
        <button class="btn-outline" onclick="toggleDark()">🌓</button>
        ${canCreate? `<a class="btn-outline" href="#" onclick="openNewOrderModal();return false;">+ 新規計画</a>`:''}
        ${user? `<button class="btn-outline" onclick="logout()">ログアウト</button>`:`<a class="btn-outline" href="login.html">ログイン</a>`}
      </div>
    </div>`;
}
function toggleDark(){ const isDark = !document.documentElement.classList.contains('dark'); setDark(isDark); }

/* ========= AUTH ========= */
async function handleLogin(){
  const username = $('username').value.trim();
  const password = $('password').value.trim();
  const out = await api.login(username,password);
  if (out.success){
    localStorage.setItem('currentUser', JSON.stringify(out.user));
    location.href = 'index.html';
  }else{
    $('login-error').textContent = out.message || 'ログイン失敗';
  }
}
function logout(){ localStorage.removeItem('currentUser'); location.href = 'login.html'; }

/* ========= REALTIME ========= */
function startRealtime(onChange){
  stopRealtime();
  const tick = async ()=>{
    const out = await api.getIfChanged(lastTs);
    if (out.changed){
      lastTs = out.ts || Date.now();
      onChange && onChange(out);
    }
  };
  tick();
  realtimeHandle = setInterval(tick, 2000);
}
function stopRealtime(){ if (realtimeHandle){ clearInterval(realtimeHandle); realtimeHandle = null; } }

/* ========= DASHBOARD / STOCK ========= */
function renderProductionTable(data){
  const tbody = $('productionTableBody'); if (!tbody) return;
  tbody.innerHTML = '';
  data.forEach(row=>{
    const orderId = row[0], status=row[7];
    const isShip = ["出荷準備","出荷済"].includes(status);
    const isFinished = ["組立済","検査済","出荷準備","出荷済"].includes(status);
    const tr = document.createElement('tr');
    tr.className = "hover:bg-indigo-50/40";
    tr.innerHTML = `
      <td>${row[1]}</td><td>${row[2]}</td><td>${row[3]}</td><td>${row[10]}</td>
      <td>${row[6]||''}</td><td>${row[7]}</td><td>${row[8]}</td>
      <td>
        <div class="flex flex-wrap gap-2">
          <button class="px-2 py-1 rounded bg-amber-500 text-white" onclick="initiateStationScan('${orderId}')">スキャン更新</button>
          <button class="px-2 py-1 rounded bg-indigo-600 text-white" onclick="openUpdateStatusModal('${orderId}','${row[2]}')">手動更新</button>
          <button class="px-2 py-1 rounded bg-green-600 text-white" onclick="openEditModal('${orderId}')">編集</button>
          <button class="px-2 py-1 rounded bg-red-600 text-white" onclick="deleteOrder('${orderId}')">削除</button>
          <button class="px-2 py-1 rounded bg-gray-600 text-white" onclick="exportItemHistory('${orderId}','${row[2]}')">履歴</button>
        </div>
      </td>
      <td>
        <button class="px-2 py-1 rounded border" onclick="printGenpin('${orderId}')" ${!isFinished?'disabled':''}>現品票</button>
        <button class="px-2 py-1 rounded border" onclick="printShukka('${orderId}')" ${!isShip?'disabled':''}>出荷確認書</button>
      </td>`;
    tbody.appendChild(tr);
  });
}
async function loadProductionData(){
  const out = await api.getProduction();
  renderProductionTable(out.data || []);
}
function renderCharts(data){
  const stockEl = $('stock-display'); if (stockEl) stockEl.textContent = data.stock;
  const mctx = $('monthlyShipmentsChart'); const cctx = $('customerShipmentsChart');
  if (mctx){
    if (monthlyChart) monthlyChart.destroy();
    monthlyChart = new Chart(mctx, { type:'bar', data:{
      labels:Object.keys(data.monthly),
      datasets:[{label:'月別出荷数', data:Object.values(data.monthly), backgroundColor:'rgba(106,103,243,.7)'}]
    }, options:{responsive:true, scales:{y:{beginAtZero:true}}}});
  }
  if (cctx){
    if (customerChart) customerChart.destroy();
    customerChart = new Chart(cctx, { type:'pie', data:{
      labels:Object.keys(data.customer),
      datasets:[{ data:Object.values(data.customer), backgroundColor:['#6A67F3','#8B88F5','#A9A7F7','#C8C6F9','#E6E5FB']}]
    }, options:{responsive:true}});
  }
}
async function loadChartData(){ renderCharts(await api.getCharts()); }

async function loadStockData(){
  const res = await api.getStock();
  if ($('stock-total')) $('stock-total').textContent = res.summary.total;
  if ($('stock-rakit')) $('stock-rakit').textContent = res.summary["組立済"];
  if ($('stock-inspeksi')) $('stock-inspeksi').textContent = res.summary["検査済"];
  if ($('stock-siap-kirim')) $('stock-siap-kirim').textContent = res.summary["出荷準備"];
  const tb = $('stockTableBody'); if (!tb) return; tb.innerHTML='';
  res.details.forEach(r=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `<td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[7]}</td>`;
    tb.appendChild(tr);
  });
}

/* ========= DELIVERY ========= */
async function loadDeliveryData(){
  const input = $('delivery-date-filter'); if (!input) return;
  if (!input.value){
    const today = new Date(); const off=today.getTimezoneOffset();
    input.value = new Date(today.getTime()-off*60000).toISOString().split('T')[0];
  }
  const out = await api.getDelivery(input.value);
  const tb = $('deliveryTableBody'); if (!tb) return; tb.innerHTML='';
  out.data.forEach(r=>{
    const tr=document.createElement('tr'); tr.dataset.customer=r[1]; tr.dataset.prodNo=r[2]; tr.dataset.prodName=r[3]; tr.dataset.partNo=r[4];
    tr.innerHTML = `<td><input type="checkbox" class="delivery-checkbox"></td>
    <td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td>`;
    tb.appendChild(tr);
  });
}
function toggleAllCheckboxes(master){ document.querySelectorAll('.delivery-checkbox').forEach(cb=>cb.checked = master.checked); }
function printDeliveryList(){
  const items = [];
  document.querySelectorAll('.delivery-checkbox:checked').forEach(cb=> items.push(cb.closest('tr').dataset));
  if (!items.length) return toast("印刷する項目を選択してください。");
  const rows = items.map(it=>`<tr><td>${it.prodNo}</td><td>${it.customer}</td><td>${it.partNo}</td><td>${it.prodName}</td><td>1</td><td></td></tr>`).join('');
  const win = window.open('', '_blank');
  win.document.write(`<html><head><title>出荷リスト</title><style>
    body{font-family:'MS Gothic',sans-serif;width:190mm}
    h1,h3{text-align:center}
    table{width:100%;border-collapse:collapse;border:1px solid #000}
    th,td{border:1px solid #000;padding:8px;text-align:center}
    th{background:#f2f2f2}
  </style></head><body>
    <h1>出荷予定リスト</h1>
    <h3>出荷日: ${$('delivery-date-filter').value}</h3>
    <table><thead><tr><th>管理番号</th><th>得意先</th><th>品番</th><th>品名</th><th>数量</th><th>備考</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <script>window.onload=function(){window.print();window.close();}<\/script>
  </body></html>`);
  win.document.close();
}

/* ========= SEARCH & EXPORT ========= */
function filterTableOnEnter(e){ if (e.key==='Enter') filterTable(); }
function filterTable(){
  const q = $('searchInput') ? $('searchInput').value.toUpperCase() : '';
  document.querySelectorAll('#productionTableBody tr').forEach(tr=>{
    tr.style.display = tr.textContent.toUpperCase().includes(q) ? '' : 'none';
  });
}
async function exportData(){
  const out = await api.getProduction();
  const rows = out.data || [];
  let csv = "IDUnik,得意先,製番号,品名,品番,図番,生産開始日,Status,最終更新,出荷予定日,数量\n";
  rows.forEach(a=>{ csv += a.map(x=>`"${x}"`).join(",") + "\r\n"; });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  link.download = "data_produksi.csv"; link.click();
}
function printDashboard(){ window.print(); }

/* ========= ORDER CRUD ========= */
async function openEditModal(id){
  const res = await api.getOrder(id);
  if (!res.success) return toast(res.message||'NG');
  openNewOrderModal(res.data);
}
function openNewOrderModal(prefill){
  const user = JSON.parse(localStorage.getItem('currentUser')||'null');
  if (!user) return location.href='login.html';
  if (!PERMISSIONS[user.role]?.canCreate) return toast("この役割では新規計画を作成できません。");

  // build modal
  const modal = $('newOrderModal'); if (!modal) return;
  modal.innerHTML = `
    <div class="panel">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-semibold">${prefill?'生産計画の編集':'新規生産計画'}</h3>
        <button class="btn-outline" onclick="closeNewOrderModal()">✕</button>
      </div>
      <input type="hidden" id="edit-mode-id" value="${prefill?prefill.id:''}">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <div><div class="label">得意先</div><select id="customer" class="input"></select></div>
        <div><div class="label">図番</div><select id="drawNo" class="input"></select></div>
        <div><div class="label">品名</div><select id="prodName" class="input"></select></div>
        <div><div class="label">製番号</div><input id="prodNo" class="input"></div>
        <div><div class="label">品番</div><input id="partNo" class="input"></div>
        <div><div class="label">数量</div><input type="number" min="1" value="1" id="quantity" class="input"></div>
        <div><div class="label">生産開始日</div><input type="date" id="startDate" class="input"></div>
      </div>
      <div class="mt-4 flex justify-end">
        <button class="btn" onclick="submitOrder()">${prefill?'更新':'作成'}</button>
      </div>
    </div>`;
  // load master
  api.getMaster().then(res=>{
    if (res.success){
      const fill = (id, arr, ph)=>{ $(id).innerHTML = `<option value="" disabled ${prefill?'':'selected'}>${ph}</option>` + arr.map(v=>`<option>${v}</option>`).join(''); };
      fill('customer', res.customers, '得意先を選択…');
      fill('drawNo', res.drawingNumbers, '図番を選択…');
      fill('prodName', res.productNames, '品名を選択…');
      if (prefill){
        $('customer').value = prefill.customer;
        $('drawNo').value  = prefill.drawNo;
        $('prodName').value= prefill.prodName;
        $('prodNo').value  = prefill.prodNo;
        $('partNo').value  = prefill.partNo;
        $('quantity').value= prefill.quantity;
        $('startDate').value= prefill.startDate;
      }
    }
  });
  modal.classList.add('show');
}
function closeNewOrderModal(){ const m=$('newOrderModal'); if (m) m.classList.remove('show'); }
async function submitOrder(){
  const editId = $('edit-mode-id').value;
  const user = JSON.parse(localStorage.getItem('currentUser')||'null');
  const order = {
    id: editId,
    customer: $('customer').value,
    drawNo: $('drawNo').value,
    prodName: $('prodName').value,
    prodNo: $('prodNo').value,
    partNo: $('partNo').value,
    quantity: $('quantity').value,
    startDate: $('startDate').value,
    user: user.fullName
  };
  if (!order.customer || !order.prodNo || !order.startDate || !order.quantity) return toast("得意先、製番号、数量、生産開始日は必須項目です。");
  const res = editId ? await api.updateOrder(order) : await api.createOrder(order);
  toast(res.message || (res.success?'OK':'NG'));
  if (res.success){ closeNewOrderModal(); loadProductionData(); }
}
async function deleteOrder(id){
  if (!confirm("このオーダーを本当に削除しますか？")) return;
  const res = await api.deleteOrder(id); toast(res.message||'削除');
  if (res.success) loadProductionData();
}

/* ========= STATUS ========= */
function openUpdateStatusModal(id, prodNo){
  const modal = $('updateStatusModal'); if (!modal) return;
  const allowed = PERMISSIONS[(JSON.parse(localStorage.getItem('currentUser'))||{}).role]?.allowedStatuses || [];
  modal.innerHTML = `
    <div class="panel">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-semibold">ステータス更新: <span class="font-normal">${prodNo}</span></h3>
        <button class="btn-outline" onclick="closeUpdateStatusModal()">✕</button>
      </div>
      <input type="hidden" id="update-id" value="${id}">
      <div class="mt-3"><select id="status-select" class="input">${allowed.map(s=>`<option>${s}</option>`).join('')}</select></div>
      <div id="shipping-date-container" class="mt-3 hidden"><div class="label">出荷予定日</div><input type="date" id="shipping-date" class="input"></div>
      <div class="mt-4 flex justify-end"><button class="btn" onclick="submitStatusUpdate()">更新</button></div>
    </div>`;
  $('status-select').onchange = ()=>{
    if ($('status-select').value==='出荷準備') $('shipping-date-container').classList.remove('hidden');
    else $('shipping-date-container').classList.add('hidden');
  };
  modal.classList.add('show');
}
function closeUpdateStatusModal(){ const m=$('updateStatusModal'); if (m) m.classList.remove('show'); }
async function submitStatusUpdate(){
  const id = $('update-id').value, newStatus = $('status-select').value;
  let shippingDate = null;
  if (newStatus==='出荷準備'){
    shippingDate = $('shipping-date').value; if (!shippingDate) return toast("出荷予定日を入力してください。");
  }
  const user = JSON.parse(localStorage.getItem('currentUser')||'null');
  const res = await api.updateStatus({id,newStatus,user:user.fullName, role:user.role, shippingDate});
  toast(res.message||'OK'); if (res.success){ closeUpdateStatusModal(); loadProductionData(); loadChartData(); }
}

/* ========= HISTORY CSV ========= */
async function exportItemHistory(id, prodNo){
  const res = await api.getHistory(id); const rows = res.data || [];
  if (!rows.length) return toast("履歴なし");
  let csv = "日時,ステータス,担当者\n";
  rows.forEach(l=> csv += `"${l.timestamp}","${l.status}","${l.user}"\n`);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  link.download = `history_${prodNo}_${id}.csv`; link.click();
}

/* ========= PRINT (placeholders keeping parity) ========= */
async function printGenpin(id){ toast("現品票の完全カスタム印刷は tickets.html で読み込んでから印刷してください。"); }
async function printShukka(id){ toast("出荷確認書の印刷は tickets.html にも追加できます。"); }

/* ========= QR ========= */
function scannerOpen(onText){
  const modal = $('scannerModal'); if (!modal) return;
  modal.innerHTML = `<div class="panel"><div class="flex items-center justify-between mb-2"><h3 class="text-lg font-semibold">QRコードスキャン</h3><button class="btn-outline" onclick="scannerClose()">✕</button></div><div id="reader" style="width:100%"></div></div>`;
  modal.classList.add('show');
  html5QrCode = new Html5Qrcode("reader");
  html5QrCode.start({ facingMode:"environment" }, { fps:10, qrbox:{ width:250, height:250 } }, (text)=>{
    onText && onText(text); scannerClose();
  });
}
function scannerClose(){
  const modal = $('scannerModal');
  if (html5QrCode && html5QrCode.isScanning) html5QrCode.stop().catch(()=>{});
  modal.classList.remove('show');
}
function openScannerForSearch(){ isScanForSearch = true; scannerOpen((text)=>{ const si=$('searchInput'); if (si){ si.value=text; filterTable(); } }); }
function initiateStationScan(orderId){
  orderIdToUpdateViaScan = orderId; isScanForSearch=false;
  scannerOpen(async (text)=>{
    if (!ALL_STATUSES.includes(text)) return toast(`無効な工程QR: ${text}`);
    const user = JSON.parse(localStorage.getItem('currentUser')||'null');
    const res = await api.updateStatus({id:orderId, newStatus:text, user:user.fullName, role:user.role});
    toast(res.message||'OK'); if (res.success) loadProductionData();
  });
}

/* ========= TICKETS RENDER ========= */
function renderTicket({order, history}){
  const wrap = $('ticket-view'); if (!wrap) return;
  if (!order.success){ wrap.innerHTML = `<div class="label">オーダーが見つかりません。</div>`; return; }
  const o = order.order || order.data || order;
  const hist = (history && history.data) || [];
  const map = new Map(hist.map(x=>[x.status, x]));

  const rows = ALL_STATUSES.map(st=>{
    const log = map.get(st);
    return `<tr>
      <td style="font-weight:bold;width:150px">${st}</td>
      <td style="width:150px">${log?log.user:''}</td>
      <td style="width:200px">${log?log.timestamp:''}</td>
      <td></td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
  <style>
    .ticket table{width:100%; border-collapse:collapse}
    .ticket td,.ticket th{border:1px solid #000; padding:6px}
    .ticket h1{text-align:center}
  </style>
  <div class="ticket card p-4">
    <h1>生産現品票</h1>
    <table class="header-table">
      <tr><td style="width:20%">品番</td><td style="width:30%">${o.partNo||''}</td><td style="width:20%">品名</td><td style="width:30%">${o.prodName||''}</td></tr>
      <tr><td>製番</td><td>${o.prodNo||''}</td><td>数量</td><td>${o.quantity||''}</td></tr>
      <tr><td>得意先</td><td colspan="3">${o.customer||''}</td></tr>
    </table>
    <table style="margin-top:12px">
      <thead><tr><th>工程名</th><th>担当</th><th>日付</th><th>備考</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/* ========= PAGE BOOTSTRAP ========= */
async function bootstrapPage(pageKey){
  renderHeader(pageKey);

  // Guard: login required for app pages (kecuali login.html)
  const needsAuth = location.pathname.endsWith('login.html') ? false : true;
  if (needsAuth){
    const u = JSON.parse(localStorage.getItem('currentUser')||'null');
    if (!u){ location.href='login.html'; return; }
    currentUser = u;
  }

  if (pageKey==='dashboard'){
    await loadProductionData();
    await loadChartData();
    await loadStockData();
    startRealtime((out)=>{
      if (out.production) renderProductionTable(out.production);
      if (out.chart) renderCharts(out.chart);
    });
  }
  if (pageKey==='charts'){
    await loadChartData();
    startRealtime((out)=>{ if (out.chart) renderCharts(out.chart); });
  }
  if (pageKey==='delivery'){
    await loadDeliveryData();
  }
  if (pageKey==='tickets'){
    // halaman khusus tiket; realtime tidak wajib
  }
}

/* ========= LOGIN PAGE HOOK ========= */
if (location.pathname.endsWith('login.html')){
  window.addEventListener('DOMContentLoaded', ()=>{
    const pw = $('password'); if (pw) pw.addEventListener('keydown', (e)=>{ if (e.key==='Enter') handleLogin(); });
  });
}
