const express = require('express');
const session = require('express-session');
const path = require('path');
const XLSX = require('xlsx');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'propertyagent-pro-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Admin auth middleware
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.redirect('/admin/login');
}

// ══════════════════════════════════════════════════════════════════════
// PUBLIC API ENDPOINTS (called by the frontend app)
// ══════════════════════════════════════════════════════════════════════

// Register a new user
app.post('/api/register', (req, res) => {
  try {
    const { name, email, phone } = req.body;
    if (!name || !email || !phone) return res.status(400).json({ error: 'All fields required' });
    const user = db.createUser({
      name, email, phone,
      ip_address: req.ip,
      user_agent: req.headers['user-agent']
    });
    req.session.userId = user.id;
    res.json({ success: true, user });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Record a payment
app.post('/api/payment', (req, res) => {
  try {
    const { user_id, amount, property_address, property_city, property_zip, offer_price } = req.body;
    if (!user_id || !amount) return res.status(400).json({ error: 'Missing required fields' });
    const payment = db.createPayment({ user_id, amount, property_address, property_city, property_zip, offer_price });
    res.json({ success: true, payment });
  } catch (err) {
    console.error('Payment error:', err);
    res.status(500).json({ error: 'Payment recording failed' });
  }
});

// Log a search
app.post('/api/search-log', (req, res) => {
  try {
    db.logSearch(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to log search' });
  }
});

// ══════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ══════════════════════════════════════════════════════════════════════

// Login page
app.get('/admin/login', (req, res) => {
  if (req.session && req.session.admin) return res.redirect('/admin');
  res.send(LOGIN_HTML);
});

// Login action
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.verifyAdmin(username, password);
  if (admin) {
    req.session.admin = admin;
    res.redirect('/admin');
  } else {
    res.send(LOGIN_HTML.replace('<!--ERROR-->', '<div style="background:#fee2e2;color:#991b1b;padding:12px;border-radius:8px;margin-bottom:16px;font-size:14px;text-align:center;">Invalid username or password</div>'));
  }
});

// Logout
app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// Dashboard page
app.get('/admin', requireAdmin, (req, res) => {
  res.send(DASHBOARD_HTML);
});

// ── ADMIN API ────────────────────────────────────────────────────────

app.get('/admin/api/stats', requireAdmin, (req, res) => {
  res.json(db.getStats());
});

app.get('/admin/api/users', requireAdmin, (req, res) => {
  const { page = 1, search = '' } = req.query;
  res.json(db.getUsers({ page: +page, search }));
});

app.get('/admin/api/payments', requireAdmin, (req, res) => {
  const { page = 1 } = req.query;
  res.json(db.getPayments({ page: +page }));
});

app.get('/admin/api/charts/signups', requireAdmin, (req, res) => {
  const days = +(req.query.days || 30);
  res.json(db.getSignupsByDay(days));
});

app.get('/admin/api/charts/revenue', requireAdmin, (req, res) => {
  const days = +(req.query.days || 30);
  res.json(db.getRevenueByDay(days));
});

app.get('/admin/api/charts/zipcodes', requireAdmin, (req, res) => {
  res.json(db.getTopZipCodes());
});

app.get('/admin/api/activity', requireAdmin, (req, res) => {
  res.json(db.getRecentActivity());
});

// Change password
app.post('/admin/api/change-password', requireAdmin, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  db.changeAdminPassword(req.session.admin.username, newPassword);
  res.json({ success: true });
});

// ── EXPORT ───────────────────────────────────────────────────────────
app.get('/admin/export/users', requireAdmin, (req, res) => {
  const format = req.query.format || 'xlsx';
  const users = db.getAllUsers();
  const data = users.map(u => ({
    'ID': u.id,
    'Name': u.name,
    'Email': u.email,
    'Phone': u.phone,
    'IP Address': u.ip_address || '',
    'Registered': u.created_at
  }));

  if (format === 'csv') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'csv' });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="propertyagent-users.csv"');
    res.send(buf);
  } else {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{ wch: 5 }, { wch: 25 }, { wch: 30 }, { wch: 18 }, { wch: 18 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="propertyagent-users.xlsx"');
    res.send(buf);
  }
});

app.get('/admin/export/payments', requireAdmin, (req, res) => {
  const format = req.query.format || 'xlsx';
  const payments = db.getAllPayments();
  const data = payments.map(p => ({
    'ID': p.id,
    'User': p.user_name || '',
    'Email': p.user_email || '',
    'Amount': p.amount,
    'Property': p.property_address || '',
    'City': p.property_city || '',
    'ZIP': p.property_zip || '',
    'Offer Price': p.offer_price || '',
    'Status': p.status,
    'Date': p.created_at
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{ wch: 5 }, { wch: 25 }, { wch: 30 }, { wch: 10 }, { wch: 30 }, { wch: 15 }, { wch: 8 }, { wch: 14 }, { wch: 10 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Payments');
  const bookType = format === 'csv' ? 'csv' : 'xlsx';
  const buf = XLSX.write(wb, { type: 'buffer', bookType });
  const ext = format === 'csv' ? 'csv' : 'xlsx';
  res.setHeader('Content-Disposition', `attachment; filename="propertyagent-payments.${ext}"`);
  res.send(buf);
});

// ══════════════════════════════════════════════════════════════════════
// HTML TEMPLATES
// ══════════════════════════════════════════════════════════════════════

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Login — PropertyAgent Pro</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#0f172a,#1e293b);min-height:100vh;display:flex;align-items:center;justify-content:center}
  .login-card{background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.4);max-width:400px;width:90%;padding:40px}
  .logo{text-align:center;margin-bottom:28px}
  .logo-icon{background:linear-gradient(135deg,#2563eb,#1e40af);width:56px;height:56px;border-radius:14px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px}
  .logo-icon svg{width:28px;height:28px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  h1{font-size:22px;font-weight:700;color:#111827;margin-bottom:4px}
  .subtitle{font-size:13px;color:#6b7280;margin-bottom:24px}
  label{display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px}
  input{width:100%;border:1px solid #d1d5db;border-radius:8px;padding:11px 14px;font-size:14px;margin-bottom:16px;outline:none;transition:border-color .2s,box-shadow .2s}
  input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,0.2)}
  button{width:100%;padding:12px;border:none;border-radius:8px;background:linear-gradient(135deg,#2563eb,#1e40af);color:#fff;font-size:15px;font-weight:700;cursor:pointer;transition:opacity .2s}
  button:hover{opacity:0.9}
  .footer{text-align:center;margin-top:20px;font-size:11px;color:#9ca3af}
</style>
</head><body>
<div class="login-card">
  <div class="logo">
    <div class="logo-icon"><svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>
    <h1>PropertyAgent Pro</h1>
    <p class="subtitle">Admin Dashboard</p>
  </div>
  <!--ERROR-->
  <form method="POST" action="/admin/login">
    <label>Username</label>
    <input type="text" name="username" placeholder="Enter username" required autofocus>
    <label>Password</label>
    <input type="password" name="password" placeholder="Enter password" required>
    <button type="submit">Sign In</button>
  </form>
  <p class="footer">Authorized personnel only</p>
</div>
</body></html>`;


const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Dashboard — PropertyAgent Pro</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;color:#1e293b}
  .topbar{background:#1e293b;color:#fff;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
  .topbar h1{font-size:16px;font-weight:700;display:flex;align-items:center;gap:10px}
  .topbar .logo-sm{background:#2563eb;border-radius:8px;padding:5px;display:flex}
  .topbar .logo-sm svg{width:18px;height:18px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .topbar-right{display:flex;align-items:center;gap:16px}
  .topbar-right a{color:#94a3b8;text-decoration:none;font-size:13px;transition:color .2s}
  .topbar-right a:hover{color:#fff}
  .container{max-width:1200px;margin:0 auto;padding:24px}
  .stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}
  .stat-card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.06);border:1px solid #e2e8f0}
  .stat-label{font-size:12px;color:#64748b;font-weight:500;margin-bottom:4px}
  .stat-value{font-size:26px;font-weight:800;color:#0f172a}
  .stat-sub{font-size:11px;color:#94a3b8;margin-top:2px}
  .chart-grid{display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:24px}
  .card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.06);border:1px solid #e2e8f0;margin-bottom:16px}
  .card h2{font-size:14px;font-weight:700;color:#334155;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between}
  .tabs{display:flex;gap:0;margin-bottom:20px;border-bottom:2px solid #e2e8f0}
  .tab{padding:10px 20px;font-size:13px;font-weight:600;color:#64748b;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .2s}
  .tab.active{color:#2563eb;border-bottom-color:#2563eb}
  .tab:hover{color:#2563eb}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;padding:10px 12px;font-weight:600;color:#64748b;border-bottom:2px solid #e2e8f0;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
  td{padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#334155}
  tr:hover td{background:#f8fafc}
  .badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600}
  .badge-green{background:#dcfce7;color:#166534}
  .badge-blue{background:#dbeafe;color:#1e40af}
  .search-bar{display:flex;gap:8px;margin-bottom:16px}
  .search-bar input{flex:1;border:1px solid #d1d5db;border-radius:8px;padding:8px 12px;font-size:13px;outline:none}
  .search-bar input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.15)}
  .btn{padding:8px 16px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;transition:opacity .2s;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
  .btn:hover{opacity:0.85}
  .btn-blue{background:#2563eb;color:#fff}
  .btn-green{background:#16a34a;color:#fff}
  .btn-outline{background:#fff;color:#374151;border:1px solid #d1d5db}
  .pagination{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:16px}
  .pagination button{padding:6px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:12px}
  .pagination button.active{background:#2563eb;color:#fff;border-color:#2563eb}
  .pagination button:disabled{opacity:.4;cursor:default}
  .activity-item{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9}
  .activity-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
  .empty{text-align:center;padding:32px;color:#94a3b8;font-size:14px}
  .modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:999;display:none}
  .modal-overlay.active{display:flex}
  .modal{background:#fff;border-radius:12px;padding:28px;max-width:400px;width:90%}
  @media(max-width:768px){.stat-grid{grid-template-columns:repeat(2,1fr)}.chart-grid{grid-template-columns:1fr}}
</style>
</head><body>

<div class="topbar">
  <h1><span class="logo-sm"><svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></span> PropertyAgent Pro <span style="color:#64748b;font-weight:400;font-size:13px">Admin</span></h1>
  <div class="topbar-right">
    <a href="/" target="_blank">View Live Site</a>
    <a href="#" onclick="showPasswordModal()">Change Password</a>
    <a href="/admin/logout">Sign Out</a>
  </div>
</div>

<div class="container">
  <!-- STATS ROW -->
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-label">Total Users</div><div class="stat-value" id="s-users">—</div><div class="stat-sub" id="s-users-sub"></div></div>
    <div class="stat-card"><div class="stat-label">Total Revenue</div><div class="stat-value" id="s-revenue">—</div><div class="stat-sub" id="s-revenue-sub"></div></div>
    <div class="stat-card"><div class="stat-label">Offers Printed</div><div class="stat-value" id="s-payments">—</div><div class="stat-sub" id="s-payments-sub"></div></div>
    <div class="stat-card"><div class="stat-label">Conversion Rate</div><div class="stat-value" id="s-conversion">—</div><div class="stat-sub">Signups → Paid offers</div></div>
  </div>

  <!-- CHARTS ROW -->
  <div class="chart-grid">
    <div class="card">
      <h2>Signups & Revenue (30 days) <select id="chart-range" onchange="loadCharts()" style="font-size:12px;border:1px solid #d1d5db;border-radius:6px;padding:4px 8px"><option value="7">7 days</option><option value="30" selected>30 days</option><option value="90">90 days</option></select></h2>
      <canvas id="mainChart" height="100"></canvas>
    </div>
    <div class="card">
      <h2>Top ZIP Codes</h2>
      <canvas id="zipChart" height="160"></canvas>
    </div>
  </div>

  <!-- TABS -->
  <div class="tabs">
    <div class="tab active" onclick="switchTab('users',this)">Users</div>
    <div class="tab" onclick="switchTab('payments',this)">Payments</div>
    <div class="tab" onclick="switchTab('activity',this)">Recent Activity</div>
  </div>

  <!-- USERS TAB -->
  <div id="tab-users" class="card">
    <h2>Registered Users
      <div style="display:flex;gap:8px">
        <a href="/admin/export/users?format=xlsx" class="btn btn-green">⬇ Export .xlsx</a>
        <a href="/admin/export/users?format=csv" class="btn btn-outline">⬇ CSV</a>
      </div>
    </h2>
    <div class="search-bar"><input type="text" id="user-search" placeholder="Search by name, email, or phone..." oninput="searchUsers()"></div>
    <table><thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Phone</th><th>IP</th><th>Registered</th></tr></thead><tbody id="user-rows"></tbody></table>
    <div class="pagination" id="user-pagination"></div>
  </div>

  <!-- PAYMENTS TAB -->
  <div id="tab-payments" class="card" style="display:none">
    <h2>Payment Log
      <div style="display:flex;gap:8px">
        <a href="/admin/export/payments?format=xlsx" class="btn btn-green">⬇ Export .xlsx</a>
        <a href="/admin/export/payments?format=csv" class="btn btn-outline">⬇ CSV</a>
      </div>
    </h2>
    <table><thead><tr><th>ID</th><th>User</th><th>Email</th><th>Amount</th><th>Property</th><th>Offer Price</th><th>Status</th><th>Date</th></tr></thead><tbody id="pay-rows"></tbody></table>
    <div class="pagination" id="pay-pagination"></div>
  </div>

  <!-- ACTIVITY TAB -->
  <div id="tab-activity" class="card" style="display:none">
    <h2>Recent Activity</h2>
    <div id="activity-list"></div>
  </div>
</div>

<!-- Password modal -->
<div class="modal-overlay" id="pw-modal">
  <div class="modal">
    <h2 style="font-size:16px;font-weight:700;margin-bottom:16px">Change Admin Password</h2>
    <input type="password" id="new-pw" placeholder="New password (min 8 chars)" style="width:100%;border:1px solid #d1d5db;border-radius:8px;padding:10px;font-size:14px;margin-bottom:12px">
    <div style="display:flex;gap:8px">
      <button class="btn btn-blue" onclick="changePassword()" style="flex:1">Update Password</button>
      <button class="btn btn-outline" onclick="hidePasswordModal()" style="flex:1">Cancel</button>
    </div>
    <p id="pw-msg" style="font-size:12px;margin-top:8px;text-align:center;display:none"></p>
  </div>
</div>

<script>
let mainChart, zipChart;

// ── TAB SWITCHING ─────────────────────────────────────────────────
function switchTab(tab, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  ['users','payments','activity'].forEach(t => {
    document.getElementById('tab-'+t).style.display = t===tab ? 'block' : 'none';
  });
  if (tab==='payments') loadPayments();
  if (tab==='activity') loadActivity();
}

// ── LOAD STATS ────────────────────────────────────────────────────
async function loadStats() {
  const r = await fetch('/admin/api/stats');
  const s = await r.json();
  document.getElementById('s-users').textContent = s.totalUsers.toLocaleString();
  document.getElementById('s-users-sub').textContent = s.todayUsers+' today / '+s.weekUsers+' this week';
  document.getElementById('s-revenue').textContent = '$'+s.totalRevenue.toFixed(2);
  document.getElementById('s-revenue-sub').textContent = '$'+s.todayRevenue.toFixed(2)+' today / $'+s.weekRevenue.toFixed(2)+' this week';
  document.getElementById('s-payments').textContent = s.totalPayments.toLocaleString();
  document.getElementById('s-payments-sub').textContent = '$'+(s.totalPayments > 0 ? (s.totalRevenue/s.totalPayments).toFixed(2) : '0')+' avg per offer';
  document.getElementById('s-conversion').textContent = s.conversionRate+'%';
}

// ── LOAD CHARTS ───────────────────────────────────────────────────
async function loadCharts() {
  const days = document.getElementById('chart-range').value;
  const [signups, revenue, zips] = await Promise.all([
    fetch('/admin/api/charts/signups?days='+days).then(r=>r.json()),
    fetch('/admin/api/charts/revenue?days='+days).then(r=>r.json()),
    fetch('/admin/api/charts/zipcodes').then(r=>r.json())
  ]);

  // Main chart
  const labels = signups.map(s => s.day.slice(5));
  const revMap = {};
  revenue.forEach(r => revMap[r.day.slice(5)] = r.total);

  if (mainChart) mainChart.destroy();
  mainChart = new Chart(document.getElementById('mainChart'), {
    type:'bar',
    data:{
      labels,
      datasets:[
        { label:'Signups', data:signups.map(s=>s.count), backgroundColor:'rgba(37,99,235,0.7)', yAxisID:'y', borderRadius:4 },
        { label:'Revenue ($)', data:labels.map(l=>revMap[l]||0), type:'line', borderColor:'#16a34a', backgroundColor:'rgba(22,163,74,0.1)', yAxisID:'y1', tension:0.3, fill:true, pointRadius:3 }
      ]
    },
    options:{
      responsive:true,
      interaction:{mode:'index',intersect:false},
      scales:{
        y:{position:'left',beginAtZero:true,ticks:{stepSize:1},title:{display:true,text:'Signups'}},
        y1:{position:'right',beginAtZero:true,grid:{drawOnChartArea:false},title:{display:true,text:'Revenue ($)'}}
      }
    }
  });

  // Zip chart
  if (zipChart) zipChart.destroy();
  if (zips.length > 0) {
    zipChart = new Chart(document.getElementById('zipChart'), {
      type:'doughnut',
      data:{
        labels:zips.map(z=>z.zip),
        datasets:[{data:zips.map(z=>z.count),backgroundColor:['#2563eb','#16a34a','#eab308','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#64748b']}]
      },
      options:{responsive:true,plugins:{legend:{position:'right',labels:{font:{size:11}}}}}
    });
  }
}

// ── LOAD USERS ────────────────────────────────────────────────────
let userPage = 1;
async function loadUsers(page) {
  userPage = page || 1;
  const search = document.getElementById('user-search').value;
  const r = await fetch('/admin/api/users?page='+userPage+'&search='+encodeURIComponent(search));
  const d = await r.json();
  const tbody = document.getElementById('user-rows');
  if (d.users.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty">No users found</td></tr>'; }
  else {
    tbody.innerHTML = d.users.map(u =>
      '<tr><td>'+u.id+'</td><td><strong>'+esc(u.name)+'</strong></td><td>'+esc(u.email)+'</td><td>'+esc(u.phone)+'</td><td style="font-size:11px;color:#94a3b8">'+(u.ip_address||'—')+'</td><td style="font-size:12px">'+fmtDate(u.created_at)+'</td></tr>'
    ).join('');
  }
  renderPagination('user-pagination', d.page, d.pages, (p)=>loadUsers(p));
}
let searchTimer;
function searchUsers() { clearTimeout(searchTimer); searchTimer = setTimeout(()=>loadUsers(1), 300); }

// ── LOAD PAYMENTS ─────────────────────────────────────────────────
let payPage = 1;
async function loadPayments(page) {
  payPage = page || 1;
  const r = await fetch('/admin/api/payments?page='+payPage);
  const d = await r.json();
  const tbody = document.getElementById('pay-rows');
  if (d.payments.length === 0) { tbody.innerHTML = '<tr><td colspan="8" class="empty">No payments yet</td></tr>'; }
  else {
    tbody.innerHTML = d.payments.map(p =>
      '<tr><td>'+p.id+'</td><td><strong>'+esc(p.user_name||'—')+'</strong></td><td>'+esc(p.user_email||'—')+'</td><td style="font-weight:700;color:#16a34a">$'+p.amount.toFixed(2)+'</td><td>'+esc(p.property_address||'—')+'</td><td>'+(p.offer_price?'$'+p.offer_price.toLocaleString():'—')+'</td><td><span class="badge badge-green">'+p.status+'</span></td><td style="font-size:12px">'+fmtDate(p.created_at)+'</td></tr>'
    ).join('');
  }
  renderPagination('pay-pagination', d.page, d.pages, (p)=>loadPayments(p));
}

// ── LOAD ACTIVITY ─────────────────────────────────────────────────
async function loadActivity() {
  const r = await fetch('/admin/api/activity');
  const items = await r.json();
  const el = document.getElementById('activity-list');
  if (items.length === 0) { el.innerHTML = '<div class="empty">No activity yet</div>'; return; }
  el.innerHTML = items.map(a =>
    '<div class="activity-item"><div class="activity-dot" style="background:'+(a.type==='signup'?'#2563eb':'#16a34a')+'"></div><div><div style="font-size:13px"><span class="badge '+(a.type==='signup'?'badge-blue':'badge-green')+'">'+a.type+'</span> '+esc(a.detail)+'</div><div style="font-size:11px;color:#94a3b8">'+fmtDate(a.created_at)+'</div></div></div>'
  ).join('');
}

// ── PASSWORD ──────────────────────────────────────────────────────
function showPasswordModal() { document.getElementById('pw-modal').classList.add('active'); }
function hidePasswordModal() { document.getElementById('pw-modal').classList.remove('active'); }
async function changePassword() {
  const pw = document.getElementById('new-pw').value;
  const msg = document.getElementById('pw-msg');
  const r = await fetch('/admin/api/change-password', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({newPassword:pw}) });
  const d = await r.json();
  msg.style.display='block';
  if (d.success) { msg.style.color='#16a34a'; msg.textContent='Password updated!'; setTimeout(hidePasswordModal,1500); }
  else { msg.style.color='#dc2626'; msg.textContent=d.error; }
}

// ── HELPERS ───────────────────────────────────────────────────────
function esc(s) { const d=document.createElement('div');d.textContent=s||'';return d.innerHTML; }
function fmtDate(s) { if(!s)return'—';const d=new Date(s+'Z');return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+' '+d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}); }
function renderPagination(elId, current, total, fn) {
  const el=document.getElementById(elId);
  if(total<=1){el.innerHTML='';return;}
  let h='<button '+(current<=1?'disabled':'')+' onclick="('+fn+')('+(current-1)+')">← Prev</button>';
  for(let i=1;i<=total;i++) h+='<button class="'+(i===current?'active':'')+'" onclick="('+fn+')('+i+')">'+i+'</button>';
  h+='<button '+(current>=total?'disabled':'')+' onclick="('+fn+')('+(current+1)+')">Next →</button>';
  el.innerHTML=h;
}

// ── INIT ──────────────────────────────────────────────────────────
loadStats();
loadCharts();
loadUsers(1);
setInterval(loadStats, 30000); // refresh stats every 30s
</script>
</body></html>`;


// ══════════════════════════════════════════════════════════════════════
// START SERVER (async to wait for database init)
// ══════════════════════════════════════════════════════════════════════
db.init().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('  PropertyAgent Pro — Server Running');
    console.log('  App:    http://localhost:' + PORT);
    console.log('  Admin:  http://localhost:' + PORT + '/admin');
    console.log('');
  });
}).catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
