/* ========= CONFIG ========= */
// Ganti dengan URL Web App GAS kamu (…/exec). Contoh:
const API_BASE = 'https://script.google.com/macros/s/AKfycbwqwycLMS5k1vu51EzhpoXksdUOnkRoGsgtfpisbZfJcDHN62wMpaWS-18TVFONUTBAmg/exec';
// Kalau backend pakai HMAC_SECRET, isi sama string-nya. Kalau tidak, kosongkan.
const HMAC_SECRET = ''; // contoh: 'tokyo seimitsu hatsujo'

/* ========= HELPERS ========= */
const $ = (sel) => document.querySelector(sel);
const setText = (el, t) => { if (el) el.textContent = t; };

function hmacHex(secret, msg) {
  if (!secret) return '';
  // simple fallback HMAC (SubtleCrypto). Jika browser lama, biarkan kosong → backend bypass.
  if (!('crypto' in window) || !window.crypto.subtle) return '';
  const enc = new TextEncoder();
  return window.crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign'])
    .then(key => window.crypto.subtle.sign('HMAC', key, enc.encode(msg)))
    .then(buf => Array.from(new Uint8Array(buf)).map(b=>('0'+b.toString(16)).slice(-2)).join(''))
    .catch(()=> '');
}

async function postJSON(route, payload={}) {
  const body = JSON.stringify({ route, ...payload });
  const headers = { 'Content-Type':'application/json' };
  const sig = await hmacHex(HMAC_SECRET, body);
  if (sig) headers['x-sign'] = sig;

  const res = await fetch(API_BASE, { method:'POST', headers, body });
  const data = await res.json();
  if (!data.ok) throw new Error(data.message || 'API error');
  return data;
}

async function getJSON(query='action=ping') {
  const url = `${API_BASE}?${query}`;
  const res = await fetch(url);
  return res.json();
}

function requireLogin() {
  const raw = localStorage.getItem('session');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function saveSession(user) { localStorage.setItem('session', JSON.stringify(user)); }
function clearSession() { localStorage.removeItem('session'); }

/* ========= PAGE BOOT ========= */
document.addEventListener('DOMContentLoaded', async () => {
  // elemen umum (jika ada)
  const who = $('#whoami');
  const logoutBtn = $('#logoutBtn');
  if (logoutBtn) logoutBtn.onclick = () => { clearSession(); location.href = './index.html'; };

  const user = requireLogin();
  if (who && user) setText(who, `ようこそ, ${user.fullName} 様 (${user.role})`);

  // routing sederhana berdasar halaman
  const path = location.pathname;

  if (path.endsWith('/index.html') || path.endsWith('/')) {
    await bootIndex(user);
  } else if (path.endsWith('/charts.html')) {
    if (!user) return location.href='./index.html';
    await bootCharts(user);
  } else if (path.endsWith('/delivery.html')) {
    if (!user) return location.href='./index.html';
    await bootDelivery(user);
  } else if (path.endsWith('/tickets.html')) {
    if (!user) return location.href='./index.html';
    await bootTickets(user);
  }
});

/* ========= INDEX (Dashboard + Login) ========= */
async function bootIndex(user) {
  const loginCard = $('#loginCard');
  const dash = $('#dashboard');
  const msg = $('#loginMsg');
  const u = $('#username'), p = $('#password'), btn = $('#loginBtn');

  // tombol enter → login
  if (p) p.addEventListener('keydown', (e)=>{ if (e.key==='Enter') btn.click(); });

  // cek API
  try {
    await getJSON('action=ping');
    if (msg) setText(msg, '');
  } catch {
    if (msg) setText(msg, 'Tidak dapat terhubung ke API. Cek API_BASE & deployment.');
  }

  if (!user) {
    if (loginCard) loginCard.classList.remove('hidden');
    if (dash) dash.classList.add('hidden');
  } else {
    if (loginCard) loginCard.classList.add('hidden');
    if (dash) dash.classList.remove('hidden');
    loadDashboard();
  }

  if (btn) btn.onclick = async () => {
    try {
      const resp = await postJSON('login', { username: u.value.trim(), password: p.value.trim() });
      saveSession(resp.user);
      location.reload();
    } catch(err) {
      if (msg) setText(msg, err.message);
    }
  };
}

async function loadDashboard() {
  try {
    const prod = await postJSON('get_production', {});
    const table = $('#prodTable tbody');
    if (table) {
      table.innerHTML = '';
      (prod.data || []).forEach(row => {
        const tr = document.createElement('tr');
        // [id, customer, prodNo, prodName, partNo, drawNo, startDate, status, updateInfo, shipDate, qty]
        tr.innerHTML = `<td>${row[1]}</td><td>${row[2]}</td><td>${row[3]}</td><td>${row[10]||''}</td>
                        <td>${row[6]||''}</td><td>${row[7]||''}</td><td>${row[8]||''}</td>`;
        table.appendChild(tr);
      });
    }
    const chart = await postJSON('get_chart',{});
    const stockEl = $('#stockNumber');
    if (stockEl) setText(stockEl, chart.stock ?? 0);
  } catch(err) {
    console.error(err);
  }
}

/* ========= CHARTS ========= */
async function bootCharts() {
  const st = await postJSON('get_chart',{});
  const stockEl = $('#stockNumber');
  if (stockEl) setText(stockEl, st.stock ?? 0);

  const m = st.monthly || {};
  const c = st.customer || {};

  const monthlyCtx = document.getElementById('monthly').getContext('2d');
  new Chart(monthlyCtx, {
    type:'bar',
    data:{ labels:Object.keys(m), datasets:[{ label:'月別出荷数', data:Object.values(m) }] },
    options:{ responsive:true, scales:{ y:{ beginAtZero:true } } }
  });

  const custCtx = document.getElementById('customer').getContext('2d');
  new Chart(custCtx, {
    type:'pie',
    data:{ labels:Object.keys(c), datasets:[{ data:Object.values(c) }] },
    options:{ responsive:true }
  });
}

/* ========= DELIVERY ========= */
async function bootDelivery() {
  const input = $('#shipDate');
  const btn = $('#loadDelivery');
  const today = new Date();
  input.value = new Date(today.getTime()-today.getTimezoneOffset()*60000).toISOString().split('T')[0];

  const load = async () => {
    const data = await postJSON('get_delivery', { date: input.value });
    const tbody = $('#deliveryTable tbody');
    tbody.innerHTML = '';
    (data.data || []).forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td>`;
      tbody.appendChild(tr);
    });
  };
  if (btn) btn.onclick = load;
  load();
}

/* ========= TICKETS ========= */
async function bootTickets() {
  const btn = $('#makeTicket');
  const idInput = $('#ticketId');
  if (btn) btn.onclick = async () => {
    if (!idInput.value.trim()) return alert('ID kosong');
    const resp = await postJSON('get_order', { id: idInput.value.trim() });
    openTicketPrint(resp.data);
  };
}

function openTicketPrint(order) {
  // QR payload: JSON lengkap (sesuai permintaan)
  const payload = {
    id: order.id,
    customer: order.customer,
    prodNo: order.prodNo,
    prodName: order.prodName,
    qty: order.quantity
  };
  // vCard-like sekalian (opsional)
  const vcard = `BEGIN:VCARD
VERSION:3.0
N:${order.prodName}
NOTE:Customer=${order.customer};ProdNo=${order.prodNo};Qty=${order.quantity}
END:VCARD`;

  // generate QR (qrcode-generator lib)
  const qr = qrcode(4,'L'); // vers 4, L
  qr.addData(JSON.stringify(payload));
  qr.make();
  const imgTag = qr.createImgTag(4,4); // <img ...>

  const html = `
  <html><head><title>現品票 ${order.prodNo}</title>
  <style>
    @page{size:A4;margin:10mm}
    body{font-family:'MS Gothic',system-ui}
    table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #000;padding:6px}
    .watermark{position:fixed;top:45%;left:20%;font-size:72px;color:#0002;transform:rotate(-25deg)}
    .sig{position:fixed;right:10mm;bottom:10mm;font-size:10px;color:#555}
  </style></head>
  <body>
    <div class="watermark">TOKYO SEIMITSU HATSUJO</div>
    <h1 style="text-align:center">生産現品票</h1>
    <table>
      <tr><th style="width:20%">品番</th><td style="width:30%">${order.partNo||''}</td>
          <th style="width:20%">品名</th><td style="width:30%">${order.prodName||''}</td></tr>
      <tr><th>製番</th><td>${order.prodNo||''}</td>
          <th>数量</th><td>${order.quantity||''}</td></tr>
      <tr><th>得意先</th><td colspan="3">${order.customer||''}</td></tr>
    </table>
    <h3>QR</h3>
    <div>${imgTag}</div>
    <pre style="font-size:12px;border:1px dashed #999;padding:6px;margin-top:8px">${vcard}</pre>
    <div class="sig">digital-signature: TSH-${new Date().getTime()}</div>
    <script>window.onload=()=>{window.print();}</script>
  </body></html>`;

  const blob = new Blob([html], {type:'text/html'});
  const url = URL.createObjectURL(blob);
  const frame = document.getElementById('printFrame');
  if (frame) {
    frame.style.height = '900px';
    frame.src = url;
  } else {
    window.open(url, '_blank');
  }
}
