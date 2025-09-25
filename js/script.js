// Memastikan gapi.client dimuat sebelum digunakan
function loadGoogleAPI() {
    return new Promise((resolve) => {
        gapi.load('client', () => {
            gapi.client.init({
                apiKey: CONFIG.API_KEY,
                discoveryDocs: ["https://sheets.googleapis.com/$discovery/rest?version=v4"]
            }).then(() => {
                resolve();
            });
        });
    });
}

// Data pengguna simulasi
const USERS = {
    "ppic@example.com": { password: "123", role: "PPIC" },
    "produksi@example.com": { password: "123", role: "Produksi" },
    "kensa@example.com": { password: "123", role: "Inspeksi" }
};

let productionOrders = [];
let shippingPlans = [];
let loggedInUser = null;
let userRole = null;

const productionStages = [
    'レーザ工程', '曲げ工程', '外枠組立工程', 'シャッター組立工程', 
    'シャッター溶接工程', 'コーキング工程', '外枠塗装工程', '組立工程',
    '検査工程', '検査保留', '修正中', '出荷準備', '出荷済'
];

// --- FUNGSI UTAMA UNTUK MENGAMBIL DAN MENYIMPAN DATA KE GOOGLE SHEETS ---

async function fetchData(sheetId, range) {
    const response = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: range,
    });
    const rows = response.result.values;
    if (rows && rows.length > 1) {
        const headers = rows[0];
        const data = rows.slice(1).map(row => {
            let obj = {};
            headers.forEach((header, i) => {
                obj[header] = row[i];
            });
            return obj;
        });
        return data;
    }
    return [];
}

async function appendData(sheetId, data) {
    await gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'Sheet1',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: {
            values: [data]
        }
    });
}

async function updateData(sheetId, range, data) {
    await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: range,
        valueInputOption: 'USER_ENTERED',
        resource: {
            values: [data]
        }
    });
}

// --- LOGIKA PROGRAM UNTUK SETIAP HALAMAN ---

// Logika halaman index.html
if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/') {
    const loginModal = document.getElementById('loginModal');
    const loginForm = document.getElementById('loginForm');
    const orderModal = document.getElementById('orderModal');
    const orderForm = document.getElementById('orderForm');
    const ngModal = document.getElementById('ngModal');
    const ngForm = document.getElementById('ngForm');

    async function initializeDashboard() {
        await loadGoogleAPI();
        loggedInUser = localStorage.getItem('loggedInUser');
        userRole = localStorage.getItem('userRole');

        if (loggedInUser && userRole) {
            document.getElementById('userName').textContent = loggedInUser;
            document.getElementById('userRole').textContent = userRole;
            await loadProductionData();
            renderTables();
        } else {
            loginModal.style.display = 'block';
        }
    }

    async function loadProductionData() {
        productionOrders = await fetchData(CONFIG.PRODUCTION_SHEET_ID, 'Sheet1!A:L');
    }

    async function renderTables() {
        const productionTableBody = document.querySelector('#productionTable tbody');
        productionTableBody.innerHTML = '';
        
        let stockCount = 0;
        productionOrders.forEach(order => {
            if (order.status === '出荷済') {
                stockCount++;
            } else {
                const row = document.createElement('tr');
                let optionsHtml = '';
                const currentStageIndex = productionStages.indexOf(order.status);
                productionStages.forEach((stage, index) => {
                    // Cek izin peran untuk status
                    let isAllowed = true;
                    if ((stage === '検査工程' || stage === '検査保留') && userRole !== 'Inspeksi') {
                        isAllowed = false;
                    }
                    if ((stage === '出荷準備' || stage === '出荷済') && userRole !== 'PPIC') {
                        isAllowed = false;
                    }
                    
                    if (index >= currentStageIndex && isAllowed) {
                        const selected = stage === order.status ? 'selected' : '';
                        optionsHtml += `<option value="${stage}" ${selected}>${stage}</option>`;
                    }
                });

                const lastUpdate = order.updatedAt ? new Date(order.updatedAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : 'N/A';
                row.innerHTML = `
                    <td>${order.prodNumber}</td>
                    <td>${order.customerName}</td>
                    <td>${order.itemName}</td>
                    <td class="status-cell">
                        <span class="status-badge" data-status="${order.status}">${order.status}</span>
                        <span class="status-info">Update: ${lastUpdate} oleh ${order.updatedBy || 'N/A'}</span>
                    </td>
                    <td>
                        <select class="action-select" data-id="${order.id}">
                            ${optionsHtml}
                        </select>
                    </td>
                `;
                productionTableBody.appendChild(row);
            }
        });
        document.getElementById('stockCount').textContent = stockCount;
        document.querySelectorAll('.action-select').forEach(select => {
            select.addEventListener('change', updateStatus);
        });
    }

    async function updateStatus(event) {
        const orderId = event.target.dataset.id;
        const newStatus = event.target.value;
        const order = productionOrders.find(o => o.id === orderId);

        if (order) {
            if (newStatus === '検査保留') {
                document.getElementById('ngForm').dataset.orderId = orderId;
                ngModal.style.display = 'block';
            } else {
                order.status = newStatus;
                order.updatedAt = new Date().toISOString();
                order.updatedBy = loggedInUser;
                const rowId = productionOrders.findIndex(o => o.id === orderId) + 2;
                await updateData(CONFIG.PRODUCTION_SHEET_ID, `Sheet1!G${rowId}:I${rowId}`, [order.status, order.updatedAt, order.updatedBy]);
                renderTables();
            }
        }
    }
    
    ngForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const orderId = this.dataset.orderId;
        const order = productionOrders.find(o => o.id === orderId);
        const ngReason = document.getElementById('ngReason').value;
        const ngDisposition = document.querySelector('input[name="ngDisposition"]:checked').value;
        const ngCorrection = document.getElementById('ngCorrection').value;

        order.ngReason = ngReason;
        order.ngDisposition = ngDisposition;
        order.ngCorrection = ngCorrection;
        order.updatedAt = new Date().toISOString();
        order.updatedBy = loggedInUser;

        const rowId = productionOrders.findIndex(o => o.id === orderId) + 2;
        
        if (ngDisposition === '修正') {
            order.status = '修正中';
            await updateData(CONFIG.PRODUCTION_SHEET_ID, `Sheet1!G${rowId}:L${rowId}`, [order.status, order.updatedAt, order.updatedBy, ngReason, ngDisposition, ngCorrection]);
        } else if (ngDisposition === '新品を追加投入') {
            order.status = '検査保留'; // Tetap di status NG
            await updateData(CONFIG.PRODUCTION_SHEET_ID, `Sheet1!G${rowId}:L${rowId}`, [order.status, order.updatedAt, order.updatedBy, ngReason, ngDisposition, ngCorrection]);
            const newOrder = {
                id: `new-${Date.now()}`,
                prodNumber: `${order.prodNumber}-R`,
                customerName: order.customerName,
                itemName: order.itemName,
                itemNumber: order.itemNumber,
                startDate: new Date().toISOString().split('T')[0],
                status: 'レーザ工程',
                updatedAt: new Date().toISOString(),
                updatedBy: loggedInUser,
                ngReason: '', ngDisposition: '', ngCorrection: ''
            };
            const newRow = Object.values(newOrder);
            await appendData(CONFIG.PRODUCTION_SHEET_ID, newRow);
        }
        ngModal.style.display = 'none';
        await loadProductionData();
        renderTables();
    });

    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;

        if (USERS[email] && USERS[email].password === password) {
            loggedInUser = email;
            userRole = USERS[email].role;
            localStorage.setItem('loggedInUser', loggedInUser);
            localStorage.setItem('userRole', userRole);

            document.getElementById('userName').textContent = loggedInUser;
            document.getElementById('userRole').textContent = userRole;
            loginModal.style.display = 'none';

            await loadProductionData();
            renderTables();
        } else {
            alert('Email atau kata sandi salah.');
        }
    });

    document.getElementById('addOrderBtn').onclick = () => {
        if (userRole === 'PPIC') {
            orderModal.style.display = 'block';
        } else {
            alert('Hanya PPIC yang dapat menambahkan rencana produksi.');
        }
    };
    document.querySelectorAll('.close-button').forEach(btn => btn.onclick = () => btn.closest('.modal').style.display = 'none');
    window.onclick = (event) => {
        if (event.target.classList.contains('modal')) {
            event.target.style.display = 'none';
        }
    };

    initializeDashboard();

} else if (window.location.pathname.endsWith('shipping_plan.html')) {
    // Logika halaman shipping_plan.html
    async function initializeShipping() {
        await loadGoogleAPI();
        shippingPlans = await fetchData(CONFIG.SHIPPING_SHEET_ID, 'Sheet1!A:H');
        renderShippingTable();
    }
    
    function renderShippingTable() {
        const tableBody = document.querySelector('#shippingTable tbody');
        tableBody.innerHTML = '';
        shippingPlans.forEach(plan => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${plan['得意先'] || ''}</td>
                <td>${plan['図番'] || ''}</td>
                <td>${plan['機種'] || ''}</td>
                <td>${plan['商品名'] || ''}</td>
                <td>${plan['数量'] || ''}</td>
                <td>${plan['送り先'] || ''}</td>
                <td>${plan['注番'] || ''}</td>
                <td>${plan['備考'] || ''}</td>
            `;
            tableBody.appendChild(row);
        });
    }

    document.addEventListener('DOMContentLoaded', initializeShipping);
} else if (window.location.pathname.endsWith('charts.html')) {
    // Logika halaman charts.html
    async function initializeCharts() {
        await loadGoogleAPI();
        productionOrders = await fetchData(CONFIG.PRODUCTION_SHEET_ID, 'Sheet1!A:L');
        renderStockChart();
        renderShippingChart();
        renderNGChart();
    }
    
    function renderStockChart() {
        const ctx = document.getElementById('stockChart').getContext('2d');
        const labels = ['Stok Barang Jadi'];
        const data = [productionOrders.filter(o => o.status === '出荷済').length];
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Jumlah Unit',
                    data: data,
                    backgroundColor: ['#5cb85c']
                }]
            },
            options: { plugins: { title: { display: true, text: 'Stok Barang Jadi' } } }
        });
    }
    
    function renderShippingChart() {
        const ctx = document.getElementById('shippingChart').getContext('2d');
        const shippedOrders = productionOrders.filter(o => o.status === '出荷済');
        const customers = shippedOrders.map(o => o.customerName);
        const customerCounts = customers.reduce((acc, customer) => {
            acc[customer] = (acc[customer] || 0) + 1;
            return acc;
        }, {});
        new Chart(ctx, {
            type: 'pie',
            data: {
                labels: Object.keys(customerCounts),
                datasets: [{
                    data: Object.values(customerCounts),
                    backgroundColor: ['#4a90e2', '#7ED321', '#F5A623', '#bd10e0', '#50e3c2']
                }]
            },
            options: { plugins: { title: { display: true, text: 'Pengiriman Berdasarkan Pelanggan' } } }
        });
    }

    function renderNGChart() {
        const ctx = document.getElementById('ngChart').getContext('2d');
        const ngOrders = productionOrders.filter(o => o.ngReason);
        const ngReasons = ngOrders.map(o => o.ngReason);
        const ngCounts = ngReasons.reduce((acc, reason) => {
            acc[reason] = (acc[reason] || 0) + 1;
            return acc;
        }, {});
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: Object.keys(ngCounts),
                datasets: [{
                    label: 'Jumlah NG',
                    data: Object.values(ngCounts),
                    backgroundColor: ['#d9534f']
                }]
            },
            options: { plugins: { title: { display: true, text: 'Tingkat NG Berdasarkan Alasan' } } }
        });
    }

    document.addEventListener('DOMContentLoaded', initializeCharts);
}
