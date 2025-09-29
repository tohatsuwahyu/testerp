// ---------- Konfigurasi ----------
const API_BASE = "https://script.google.com/macros/s/AKfycbwqwycLMS5k1vu51EzhpoXksdUOnkRoGsgtfpisbZfJcDHN62wMpaWS-18TVFONUTBAmg/exec"; // ← ganti

// ---------- Auth helpers ----------
function saveAuth(auth){ localStorage.setItem('auth', JSON.stringify(auth)); }
function loadAuth(){ try{ return JSON.parse(localStorage.getItem('auth')||'{}'); }catch{ return {}; } }
function clearAuth(){ localStorage.removeItem('auth'); }

async function apiPost(action, payload={}){
  const auth = loadAuth();
  const body = { action, token: auth.token, ...payload };
  const res  = await fetch(API_BASE, {
    method: 'POST', headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error||'Request failed');
  return j;
}
async function apiGet(action, params={}){
  const auth = loadAuth();
  const q = new URLSearchParams({ action, token: auth.token, ...params });
  const res = await fetch(`${API_BASE}?${q.toString()}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error||'Request failed');
  return j;
}

// ---------- UI helpers ----------
function $(sel, root=document){ return root.querySelector(sel); }
function $all(sel, root=document){ return [...root.querySelectorAll(sel)]; }
function on(id, ev, fn){ const el=(typeof id==='string')?$(id):id; if(el) el.addEventListener(ev,fn); }

function setRoleVisibility(role){
  // stricter role-based buttons via data-roles="admin,生産管理部"
  $all('[data-roles]').forEach(el=>{
    const allowed = el.getAttribute('data-roles').split(',').map(s=>s.trim());
    el.style.display = (role==='admin' || allowed.includes(role)) ? '' : 'none';
  });
}

// ---------- Login ----------
async function doLogin(e){
  e?.preventDefault?.();
  const username = $('#username')?.value?.trim();
  const password = $('#password')?.value?.trim();
  if (!username || !password){ return showError('Harap isi username & password'); }
  try{
    const { token, user } = await apiPost('login', { username, password });
    saveAuth({ token, user });
    window.location.href = 'index.html'; // kembali ke dashboard
  }catch(err){
    showError(err.message);
  }
}
function showError(msg){ const el=$('#login-error'); if(el){ el.textContent=msg; el.classList.add('shake'); setTimeout(()=>el.classList.remove('shake'),600); } }
function logout(){ clearAuth(); window.location.href='index.html'; }

// ---------- Dashboard ----------
async function loadDashboard(){
  const auth = loadAuth();
  if (!auth.token){ // belum login
    $('#login-card').style.display = '';
    $('#app').style.display = 'none';
    // Enter → login
    on('#password','keydown',e=>{ if(e.key==='Enter') doLogin(e); });
    on('#login-form','submit',doLogin);
    return;
  }
  $('#login-card').style.display = 'none';
  $('#app').style.display = '';
  $('#user-info').textContent = `${auth.user.fullName}（${auth.user.role}）`;
  setRoleVisibility(auth.user.role);
  await loadProductionTable();
  await loadMasters();
  // Live refresh 15s
  setInterval(loadProductionTable, 15000);
}
async function loadProductionTable(){
  const { rows } = await apiGet('production');
  const body = $('#table-body');
  body.innerHTML = '';
  rows.forEach(r=>{
    const [id, customer, prodNo, prodName, partNo, drawNo, startDate, status, lastUpd, shipDate, qty] = r;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${customer}</td>
      <td>${prodNo}</td>
      <td>${prodName}</td>
      <td class="right">${qty}</td>
      <td>${startDate||''}</td>
      <td><span class="badge">${status}</span></td>
      <td>${lastUpd||''}</td>
      <td class="actions">
        <button class="btn" data-roles="生産管理部,admin" onclick="openStatus('${id}','${prodNo}')">🛠️</button>
        <button class="btn" data-roles="admin" onclick="openEdit('${id}')">✏️</button>
        <button class="btn danger" data-roles="admin" onclick="removeOrder('${id}')">🗑️</button>
        <a class="btn" href="tickets.html?id=${encodeURIComponent(id)}">🧾</a>
      </td>`;
    body.appendChild(tr);
  });
  const role = loadAuth().user.role;
  setRoleVisibility(role);
}
async function loadMasters(){
  const { customers, drawings, products } = await apiGet('masters');
  fillSelect('#customer', customers, '得意先');
  fillSelect('#drawNo', drawings, '図番');
  fillSelect('#prodName', products, '品名');
}
function fillSelect(sel, arr, ph){
  const el = $(sel); el.innerHTML = `<option value="" disabled selected>${ph}</option>`;
  arr.forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v; el.appendChild(o); });
}

// Create/Update/Delete
async function submitOrder(){
  const d = {
    customer: $('#customer').value, drawNo: $('#drawNo').value, prodName: $('#prodName').value,
    prodNo: $('#prodNo').value, partNo: $('#partNo').value,
    quantity: Number($('#quantity').value||1), startDate: $('#startDate').value
  };
  if (!d.customer || !d.prodNo || !d.startDate || !d.quantity) return alert('必須項目を入力してください');
  const editId = $('#editId').value;
  if (editId){
    await apiPost('updateOrder',{ data: { ...d, id: editId } });
    alert('更新しました'); closeModal('#orderModal');
  }else{
    const r = await apiPost('createOrder',{ data: d });
    alert('作成しました'); closeModal('#orderModal');
    if (confirm('現品票を印刷しますか？')) window.open(`tickets.html?id=${encodeURIComponent(r.id)}`,'_blank');
  }
  await loadProductionTable();
}
async function removeOrder(id){
  if (!confirm('削除しますか？')) return;
  await apiPost('deleteOrder',{ id });
  await loadProductionTable();
}
function openEdit(id){
  apiGet('order',{ id }).then(({order})=>{
    $('#modal-title').textContent='生産計画の編集';
    $('#editId').value = order.id;
    $('#customer').value = order.customer;
    $('#drawNo').value   = order.drawNo;
    $('#prodName').value = order.prodName;
    $('#prodNo').value   = order.prodNo;
    $('#partNo').value   = order.partNo;
    $('#quantity').value = order.quantity;
    $('#startDate').value= order.startDate;
    openModal('#orderModal');
  });
}
function openNew(){
  $('#modal-title').textContent='新規生産計画';
  $('#editId').value=''; $('#orderForm').reset(); openModal('#orderModal');
}

// Status update
let updateId=null;
function openStatus(id, prodNo){
  updateId=id;
  $('#status-title').innerHTML = `ステータス更新 <small>${prodNo}</small>`;
  const role = loadAuth().user.role;
  const ALL = {
    '生産管理部':['出荷準備','出荷済'],
    '製造部':['材料準備','レーザ工程','曲げ工程','外枠組立工程','シャッター組立工程','シャッター溶接工程','コーキング工程','外枠塗装工程','組立工程（組立中）','組立工程（組立済）','外注'],
    '検査部':['検査工程','検査済','検査保留'],
    'admin':['材料準備','レーザ工程','曲げ工程','外枠組立工程','シャッター組立工程','シャッター溶接工程','コーキング工程','外枠塗装工程','組立工程（組立中）','組立工程（組立済）','外注','検査工程','検査済','検査保留','出荷準備','出荷済']
  };
  const allowed = role==='admin' ? ALL.admin : (ALL[role]||[]);
  const sel = $('#status-select'); sel.innerHTML='';
  allowed.forEach(s=>{ const o=document.createElement('option'); o.value=s; o.textContent=s; sel.appendChild(o); });
  $('#shipDateWrap').style.display='none';
  sel.onchange = ()=>{ $('#shipDateWrap').style.display = (sel.value==='出荷準備') ? '' : 'none'; };
  openModal('#statusModal');
}
async function submitStatus(){
  const newStatus = $('#status-select').value;
  let shippingDate = null;
  if (newStatus==='出荷準備'){
    shippingDate = $('#shipDate').value;
    if (!shippingDate) return alert('出荷予定日を入力してください');
  }
  await apiPost('updateStatus',{ id:updateId, newStatus, shippingDate });
  closeModal('#statusModal');
  await loadProductionTable();
}

// ---------- Charts page ----------
async function loadCharts(){
  const { stock, monthly, customer } = await apiGet('charts');
  $('#stock-number').textContent = stock;
  drawBar('#chart-monthly', Object.keys(monthly), Object.values(monthly));
  drawPie('#chart-customer', Object.keys(customer), Object.values(customer));
}
function drawBar(canvasSel, labels, data){
  const ctx = $(canvasSel).getContext('2d');
  // Chart.js via CDN:
  // new Chart(ctx,{type:'bar',data:{labels,datasets:[{label:'月別出荷数',data}]},options:{scales:{y:{beginAtZero:true}}}});
  // demi contoh tanpa Chart.js → render simple
  ctx.clearRect(0,0,800,300);
  const max = Math.max(1, ...data);
  const w = ctx.canvas.width, h=ctx.canvas.height, pad=30;
  data.forEach((v,i)=>{
    const x = pad + i*((w-pad*2)/data.length);
    const bh = (h-pad*2) * (v/max);
    ctx.fillRect(x, h-pad-bh, 20, bh);
  });
}
function drawPie(canvasSel, labels, values){
  const ctx = $(canvasSel).getContext('2d');
  const total = Math.max(1, values.reduce((a,b)=>a+b,0));
  let start=0;
  const cx=150, cy=120, r=100;
  ctx.clearRect(0,0,300,240);
  values.forEach(v=>{
    const ang = (v/total)*Math.PI*2;
    ctx.beginPath(); ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,r,start,start+ang); ctx.closePath(); ctx.fill(); start+=ang;
  });
}

// ---------- Delivery page ----------
async function loadDelivery(){
  const d = $('#delivery-date').value || new Date().toISOString().slice(0,10);
  const { rows } = await apiGet('delivery',{ date:d });
  const body = $('#delivery-body'); body.innerHTML='';
  rows.forEach(r=>{
    const [id,customer,prodNo,prodName,partNo] = r;
    const tr=document.createElement('tr');
    tr.innerHTML = `<td><input type="checkbox" class="pick"></td>
      <td>${customer}</td><td>${prodNo}</td><td>${prodName}</td><td>${partNo}</td>`;
    body.appendChild(tr);
  });
}
function printSelectedDelivery(){
  const d  = $('#delivery-date').value;
  const sel= $all('.pick:checked').map(cb=> cb.closest('tr'));
  if (sel.length===0) return alert('選択してください');
  const rows = sel.map(tr=>{
    const tds = tr.querySelectorAll('td');
    return `<tr><td>${tds[2].innerText}</td><td>${tds[1].innerText}</td><td>${tds[4].innerText}</td><td>${tds[3].innerText}</td><td>1</td><td></td></tr>`;
  }).join('');
  const w = window.open('', '_blank');
  w.document.write(`
    <html><head><title>出荷予定リスト</title>
      <link rel="stylesheet" href="assets/styles.css">
    </head><body class="print-sheet">
      <h1>出荷予定リスト</h1>
      <h3>出荷日: ${d}</h3>
      <table class="print-table">
        <thead><tr><th>管理番号</th><th>得意先</th><th>品番</th><th>品名</th><th>数量</th><th>備考</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <script>window.onload=()=>{window.print();window.close();}</script>
    </body></html>`);
  w.document.close();
}

// ---------- Tickets page (現品票 + QR + watermark/sign) ----------
async function loadTicket(){
  const id = new URLSearchParams(location.search).get('id');
  if (!id) return;
  const { order } = await apiGet('order',{ id });
  $('#t-prodNo').textContent  = order.prodNo;
  $('#t-partNo').textContent  = order.partNo;
  $('#t-prodName').textContent= order.prodName;
  $('#t-qty').textContent     = order.quantity;
  $('#t-customer').textContent= order.customer;

  // vCard/JSON lengkap untuk QR
  const payload = {
    id: order.id, customer: order.customer, prodNo: order.prodNo,
    prodName: order.prodName, partNo: order.partNo, qty: order.quantity
  };
  const qr = qrcode(4,'L'); // from qrcode-generator
  qr.addData(JSON.stringify(payload)); qr.make();
  $('#qrcode').innerHTML = qr.createImgTag(4,8);

  // Digital signature kecil di pojok (HMAC dari id)
  const sig = await hmacSmall(order.id);
  $('#tiny-sign').textContent = sig.slice(0,10);
}
async function hmacSmall(text){
  // client-side demo: bukan rahasia. Verifikasi tetap di server bila perlu.
  // (Opsional) cukup tampilkan checksum kecil untuk jejak digital.
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode('public-nonsecret'), {name:'HMAC', hash:'SHA-256'}, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// ---------- Modals ----------
function openModal(sel){ $(sel).classList.add('open'); }
function closeModal(sel){ $(sel).classList.remove('open'); }

// ---------- Theme ----------
function toggleTheme(){ document.documentElement.classList.toggle('dark'); }
