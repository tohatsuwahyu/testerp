/* ===========================
   TSH Frontend App — app.js
   =========================== */

/** ===========================
 *  CONFIG
 *  =========================== */
const API_BASE = "https://script.google.com/macros/s/AKfycbwqwycLMS5k1vu51EzhpoXksdUOnkRoGsgtfpisbZfJcDHN62wMpaWS-18TVFONUTBAmg/exec"; // <-- ganti dengan WebApp URL kamu
const REFRESH_MS = 15000; // auto refresh dashboard

// Optional: ikon lucu untuk UI
const ICONS = {
  dashboard: "🏭",
  charts: "📊",
  delivery: "📦",
  tickets: "🧾",
  edit: "✏️",
  delete: "🗑️",
  update: "🛠️",
  history: "🕘",
  print: "🖨️",
  export: "📄",
  scan: "📷",
  logout: "🚪",
};

/** ===========================
 *  UTIL
 *  =========================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $all = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const on = (idOrEl, ev, fn) => {
  const el = typeof idOrEl === "string" ? $(idOrEl) : idOrEl;
  if (el) el.addEventListener(ev, fn);
};

function fmtDateISO(d) {
  if (!d) return "";
  const dt = new Date(d);
  const off = dt.getTimezoneOffset();
  const loc = new Date(dt.getTime() - off * 60000);
  return loc.toISOString().slice(0, 10);
}

/** ===========================
 *  AUTH STORAGE
 *  =========================== */
function saveAuth(auth) {
  localStorage.setItem("auth", JSON.stringify(auth));
}
function loadAuth() {
  try {
    return JSON.parse(localStorage.getItem("auth") || "{}");
  } catch {
    return {};
  }
}
function clearAuth() {
  localStorage.removeItem("auth");
}

/** ===========================
 *  API WRAPPERS
 *  =========================== */
async function apiPost(action, payload = {}) {
  const auth = loadAuth();
  const body = { action, token: auth.token, ...payload };
  let j;
  try {
    const res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    j = await res.json();
  } catch (e) {
    throw new Error("Tidak dapat terhubung ke API. Cek API_BASE & deployment Web App.");
  }
  if (!j.ok) throw new Error(j.error || "Request failed");
  return j;
}

async function apiGet(action, params = {}) {
  const auth = loadAuth();
  const q = new URLSearchParams({ action, token: auth.token, ...params });
  let j;
  try {
    const res = await fetch(`${API_BASE}?${q.toString()}`);
    j = await res.json();
  } catch (e) {
    throw new Error("Tidak dapat terhubung ke API. Cek API_BASE & deployment Web App.");
  }
  if (!j.ok) throw new Error(j.error || "Request failed");
  return j;
}

/** ===========================
 *  RBAC: sembunyikan elemen by role
 *  data-roles="生産管理部,検査部,製造部,admin"
 *  =========================== */
function setRoleVisibility(role) {
  $all("[data-roles]").forEach((el) => {
    const allow = el
      .getAttribute("data-roles")
      .split(",")
      .map((s) => s.trim());
    el.style.display = role === "admin" || allow.includes(role) ? "" : "none";
  });
}

/** ===========================
 *  LOGIN / LOGOUT
 *  =========================== */
function showLogin() {
  $("#login-card")?.classList.remove("hidden");
  $("#app")?.classList.add("hidden");
}
function showApp() {
  $("#login-card")?.classList.add("hidden");
  $("#app")?.classList.remove("hidden");
}
function showError(msg) {
  const el = $("#login-error");
  if (!el) return alert(msg);
  el.textContent = msg;
  el.classList.add("shake");
  setTimeout(() => el.classList.remove("shake"), 600);
}

async function doLogin(e) {
  e?.preventDefault?.();
  const username = $("#username")?.value?.trim();
  const password = $("#password")?.value?.trim();
  if (!username || !password) return showError("Harap isi username & password");
  try {
    const { token, user } = await apiPost("login", { username, password });
    saveAuth({ token, user });
    location.href = "index.html"; // kembali ke dashboard
  } catch (err) {
    showError(err.message);
  }
}

function logout() {
  try {
    clearAuth();
  } finally {
    location.replace("index.html");
  }
}

/** ===========================
 *  DASHBOARD
 *  =========================== */
async function loadDashboard() {
  // Hook Enter pada login
  on("#password", "keydown", (e) => {
    if (e.key === "Enter") doLogin(e);
  });
  on("#login-form", "submit", doLogin);
  on("#btn-logout", "click", logout);

  const auth = loadAuth();
  if (!auth.token) {
    showLogin();
    return;
  }

  try {
    showApp();
    $("#user-info").textContent = `${auth.user.fullName}（${auth.user.role}）`;
    setRoleVisibility(auth.user.role);

    // tombol nav
    on("#nav-dashboard", "click", () => (location.href = "index.html"));
    on("#nav-charts", "click", () => (location.href = "charts.html"));
    on("#nav-delivery", "click", () => (location.href = "delivery.html"));
    on("#nav-tickets", "click", () => (location.href = "tickets.html"));

    await Promise.all([loadProductionTable(), loadMasters()]);
    // auto refresh
    setInterval(loadProductionTable, REFRESH_MS);

    // aksi toolbar
    on("#btn-export", "click", exportCSV);
    on("#btn-print", "click", () => window.print());
  } catch (err) {
    console.warn("Load dashboard gagal:", err);
    showError("Sesi kadaluarsa atau API gagal. Silakan login ulang.");
    clearAuth();
    showLogin();
  }
}

async function loadProductionTable() {
  const body = $("#table-body");
  if (!body) return;
  body.innerHTML = `<tr><td colspan="9">Loading...</td></tr>`;
  const { rows } = await apiGet("production");
  body.innerHTML = "";
  rows.forEach((r) => {
    const [
      id,
      customer,
      prodNo,
      prodName,
      partNo,
      drawNo,
      startDate,
      status,
      lastUpd,
      shipDate,
      qty,
    ] = r;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${customer}</td>
      <td>${prodNo}</td>
      <td>${prodName}</td>
      <td class="right">${qty}</td>
      <td>${startDate || ""}</td>
      <td><span class="badge">${status}</span></td>
      <td>${lastUpd || ""}</td>
      <td class="actions">
        <button class="btn" title="Update" data-roles="生産管理部,検査部,製造部,admin" onclick="openStatus('${id}','${prodNo}')">${ICONS.update}</button>
        <button class="btn" title="Edit" data-roles="admin" onclick="openEdit('${id}')">${ICONS.edit}</button>
        <button class="btn danger" title="Hapus" data-roles="admin" onclick="removeOrder('${id}')">${ICONS.delete}</button>
        <a class="btn" title="現品票" href="tickets.html?id=${encodeURIComponent(id)}">${ICONS.tickets}</a>
      </td>
    `;
    body.appendChild(tr);
  });
  const role = loadAuth()?.user?.role;
  setRoleVisibility(role);
}

async function loadMasters() {
  // contoh memuat master untuk dropdown modal
  const el = $("#customer-select");
  if (!el) return;
  const { customers, drawingNumbers, productNames } = await apiGet("masters");
  el.innerHTML = customers.map((c) => `<option>${c}</option>`).join("");
  $("#drawno-select").innerHTML = drawingNumbers.map((c) => `<option>${c}</option>`).join("");
  $("#prodname-select").innerHTML = productNames.map((c) => `<option>${c}</option>`).join("");
}

async function exportCSV() {
  const { rows } = await apiGet("production");
  let csv = "ID,得意先,製番号,品名,品番,図番,生産開始日,ステータス,最終更新,出荷予定日,数量\n";
  rows.forEach((r) => {
    csv += r
      .map((x) => `"${(x ?? "").toString().replace(/"/g, '""')}"`)
      .join(",") + "\r\n";
  });
  const uri = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  const a = document.createElement("a");
  a.href = uri;
  a.download = "data_produksi.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** ===========================
 *  CHARTS PAGE
 *  =========================== */
async function loadChartsPage() {
  const auth = loadAuth();
  if (!auth.token) return (location.href = "index.html");
  $("#who").textContent = `${auth.user.fullName}（${auth.user.role}）`;
  on("#btn-logout", "click", logout);

  const { stock, monthly, customer } = await apiGet("charts");
  $("#stock-display").textContent = stock;

  // chart.js instances (pastikan <script src="https://cdn.jsdelivr.net/npm/chart.js"></script> di HTML)
  const monthlyCtx = $("#monthlyShipmentsChart").getContext("2d");
  new Chart(monthlyCtx, {
    type: "bar",
    data: {
      labels: Object.keys(monthly),
      datasets: [{ label: "月別出荷数", data: Object.values(monthly) }],
    },
    options: { scales: { y: { beginAtZero: true } } },
  });

  const customerCtx = $("#customerShipmentsChart").getContext("2d");
  new Chart(customerCtx, {
    type: "pie",
    data: {
      labels: Object.keys(customer),
      datasets: [{ data: Object.values(customer) }],
    },
  });
}

/** ===========================
 *  DELIVERY PAGE
 *  =========================== */
async function loadDeliveryPage() {
  const auth = loadAuth();
  if (!auth.token) return (location.href = "index.html");
  $("#who").textContent = `${auth.user.fullName}（${auth.user.role}）`;
  on("#btn-logout", "click", logout);

  const dateInput = $("#delivery-date");
  if (!dateInput.value) dateInput.value = fmtDateISO(new Date());

  async function refresh() {
    const { rows } = await apiGet("delivery", { date: dateInput.value });
    const body = $("#delivery-body");
    body.innerHTML = "";
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.dataset.customer = row[1];
      tr.dataset.prodNo = row[2];
      tr.dataset.prodName = row[3];
      tr.dataset.partNo = row[4];
      tr.innerHTML = `
        <td><input type="checkbox" class="pick"></td>
        <td>${row[1]}</td>
        <td>${row[2]}</td>
        <td>${row[3]}</td>
        <td>${row[4]}</td>
      `;
      body.appendChild(tr);
    });
  }

  on("#btn-filter", "click", refresh);
  on("#btn-print-list", "click", () => {
    const picked = [];
    $all(".pick:checked").forEach((cb) => picked.push(cb.closest("tr").dataset));
    if (!picked.length) return alert("Pilih minimal satu item.");
    const win = window.open("", "_blank");
    const rows = picked
      .map(
        (x) =>
          `<tr><td>${x.prodNo}</td><td>${x.customer}</td><td>${x.partNo}</td><td>${x.prodName}</td><td>1</td><td></td></tr>`
      )
      .join("");
    win.document.write(`
      <html><head><title>出荷予定リスト</title>
      <style>
        body{font-family:sans-serif;width:190mm}
        h1,h3{text-align:center}
        table{width:100%;border-collapse:collapse;border:1px solid #000}
        th,td{border:1px solid #000;padding:8px;text-align:center}
        th{background:#f2f2f2}
        .wm::after{content:'TSH';position:fixed;inset:0;color:#0003;font-size:120px;transform:rotate(-30deg);display:flex;justify-content:center;align-items:center;pointer-events:none}
      </style></head>
      <body class="wm">
        <h1>出荷予定リスト</h1>
        <h3>出荷日: ${dateInput.value}</h3>
        <table><thead>
        <tr><th>管理番号</th><th>得意先</th><th>品番</th><th>品名</th><th>数量</th><th>備考</th></tr>
        </thead><tbody>${rows}</tbody></table>
        <script>window.onload=function(){window.print();window.close();}</script>
      </body></html>
    `);
    win.document.close();
  });

  refresh();
}

/** ===========================
 *  TICKETS PAGE (現品票)
 *  =========================== */
async function loadTicketsPage() {
  const auth = loadAuth();
  if (!auth.token) return (location.href = "index.html");
  $("#who").textContent = `${auth.user.fullName}（${auth.user.role}）`;
  on("#btn-logout", "click", logout);

  const url = new URL(location.href);
  const id = url.searchParams.get("id");
  if (!id) {
    $("#ticket").innerHTML = "<p>選択されたIDがありません。</p>";
    return;
  }
  const { order, history } = await apiGet("ticket", { id });

  // render detail
  $("#t-customer").textContent = order.customer;
  $("#t-prodNo").textContent = order.prodNo;
  $("#t-prodName").textContent = order.prodName;
  $("#t-partNo").textContent = order.partNo;
  $("#t-qty").textContent = order.quantity;
  $("#t-start").textContent = order.startDate || "";

  // QR payload: JSON lengkap
  const payload = {
    id: order.id,
    customer: order.customer,
    prodNo: order.prodNo,
   
