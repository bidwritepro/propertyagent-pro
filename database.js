const initSqlJs = require('sql.js');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Simple password hashing using Node built-in crypto
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === check;
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'propertyagent.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let db = null;

// Save database to disk periodically
function saveToDisk() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Helper: run a query that returns rows
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// Helper: run a query that returns one row
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Helper: run a statement (INSERT/UPDATE/DELETE)
function run(sql, params = []) {
  db.run(sql, params);
  saveToDisk();
  return { lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] || 0 };
}

// Initialize database
async function init() {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      property_address TEXT,
      property_city TEXT,
      property_zip TEXT,
      offer_price REAL,
      status TEXT DEFAULT 'completed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      property_type TEXT,
      city TEXT,
      zip TEXT,
      max_price REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed default admin
  const ADMIN_USER = process.env.ADMIN_USER || 'david';
  const ADMIN_PASS = process.env.ADMIN_PASS || 'PropAgent2026!';
  const existingAdmin = get('SELECT id FROM admins WHERE username = ?', [ADMIN_USER]);
  if (!existingAdmin) {
    const hash = hashPassword(ADMIN_PASS);
    run('INSERT INTO admins (username, password_hash) VALUES (?, ?)', [ADMIN_USER, hash]);
    console.log(`Admin user '${ADMIN_USER}' created.`);
  }

  saveToDisk();
  console.log('Database initialized.');
  return module.exports;
}

module.exports = {
  init,

  verifyAdmin(username, password) {
    const admin = get('SELECT * FROM admins WHERE username = ?', [username]);
    if (!admin) return null;
    if (!verifyPassword(password, admin.password_hash)) return null;
    return { id: admin.id, username: admin.username };
  },

  changeAdminPassword(username, newPassword) {
    const hash = hashPassword(newPassword);
    run('UPDATE admins SET password_hash = ? WHERE username = ?', [hash, username]);
  },

  createUser({ name, email, phone, ip_address, user_agent }) {
    const info = run(
      'INSERT INTO users (name, email, phone, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
      [name, email, phone, ip_address || null, user_agent || null]
    );
    return { id: info.lastInsertRowid, name, email, phone };
  },

  getUsers({ page = 1, limit = 50, search = '' } = {}) {
    const offset = (page - 1) * limit;
    let where = '';
    let params = [];
    if (search) {
      where = "WHERE name LIKE ? OR email LIKE ? OR phone LIKE ?";
      const s = `%${search}%`;
      params = [s, s, s];
    }
    const total = get(`SELECT COUNT(*) as c FROM users ${where}`, params).c;
    const rows = all(`SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { users: rows, total, page, pages: Math.ceil(total / limit) };
  },

  getAllUsers() {
    return all('SELECT * FROM users ORDER BY created_at DESC');
  },

  createPayment({ user_id, amount, property_address, property_city, property_zip, offer_price }) {
    const info = run(
      'INSERT INTO payments (user_id, amount, property_address, property_city, property_zip, offer_price) VALUES (?, ?, ?, ?, ?, ?)',
      [user_id, amount, property_address || null, property_city || null, property_zip || null, offer_price || null]
    );
    return { id: info.lastInsertRowid };
  },

  getPayments({ page = 1, limit = 50 } = {}) {
    const offset = (page - 1) * limit;
    const total = get('SELECT COUNT(*) as c FROM payments').c;
    const rows = all(`
      SELECT p.*, u.name as user_name, u.email as user_email
      FROM payments p LEFT JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC LIMIT ? OFFSET ?
    `, [limit, offset]);
    return { payments: rows, total, page, pages: Math.ceil(total / limit) };
  },

  getAllPayments() {
    return all(`
      SELECT p.*, u.name as user_name, u.email as user_email
      FROM payments p LEFT JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
    `);
  },

  logSearch({ user_id, property_type, city, zip, max_price }) {
    run(
      'INSERT INTO searches (user_id, property_type, city, zip, max_price) VALUES (?, ?, ?, ?, ?)',
      [user_id || null, property_type, city, zip, max_price]
    );
  },

  getStats() {
    const totalUsers = get('SELECT COUNT(*) as c FROM users').c;
    const totalPayments = get('SELECT COUNT(*) as c FROM payments').c;
    const totalRevenue = get('SELECT COALESCE(SUM(amount),0) as s FROM payments').s;
    const todayUsers = get("SELECT COUNT(*) as c FROM users WHERE date(created_at)=date('now')").c;
    const todayRevenue = get("SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE date(created_at)=date('now')").s;
    const weekUsers = get("SELECT COUNT(*) as c FROM users WHERE created_at >= datetime('now','-7 days')").c;
    const weekRevenue = get("SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE created_at >= datetime('now','-7 days')").s;
    const conversionRate = totalUsers > 0 ? ((totalPayments / totalUsers) * 100).toFixed(1) : '0.0';
    return { totalUsers, totalPayments, totalRevenue, todayUsers, todayRevenue, weekUsers, weekRevenue, conversionRate };
  },

  getSignupsByDay(days = 30) {
    return all(`
      SELECT date(created_at) as day, COUNT(*) as count
      FROM users WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY date(created_at) ORDER BY day
    `, [days]);
  },

  getRevenueByDay(days = 30) {
    return all(`
      SELECT date(created_at) as day, SUM(amount) as total, COUNT(*) as count
      FROM payments WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY date(created_at) ORDER BY day
    `, [days]);
  },

  getTopZipCodes(lim = 10) {
    return all(`
      SELECT property_zip as zip, COUNT(*) as count, SUM(amount) as revenue
      FROM payments WHERE property_zip IS NOT NULL AND property_zip != ''
      GROUP BY property_zip ORDER BY count DESC LIMIT ?
    `, [lim]);
  },

  getRecentActivity(lim = 20) {
    const users = all("SELECT 'signup' as type, name as detail, created_at FROM users ORDER BY created_at DESC LIMIT ?", [lim]);
    const payments = all(`
      SELECT 'payment' as type, u.name || ' - $' || p.amount || ' - ' || COALESCE(p.property_address,'') as detail, p.created_at
      FROM payments p LEFT JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC LIMIT ?
    `, [lim]);
    return [...users, ...payments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, lim);
  }
};
