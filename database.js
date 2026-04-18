const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

// Simple password hashing using Node built-in crypto (no bcryptjs dependency needed)
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

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── CREATE TABLES ────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

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
  );

  CREATE TABLE IF NOT EXISTS searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    property_type TEXT,
    city TEXT,
    zip TEXT,
    max_price REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── SEED DEFAULT ADMIN ───────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || 'david';
const ADMIN_PASS = process.env.ADMIN_PASS || 'PropAgent2026!';

const existingAdmin = db.prepare('SELECT id FROM admins WHERE username = ?').get(ADMIN_USER);
if (!existingAdmin) {
  const hash = hashPassword(ADMIN_PASS);
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(ADMIN_USER, hash);
  console.log(`Admin user '${ADMIN_USER}' created.`);
}

// ── QUERY HELPERS ────────────────────────────────────────────────────
module.exports = {
  db,

  // Admin auth
  verifyAdmin(username, password) {
    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    if (!admin) return null;
    if (!verifyPassword(password, admin.password_hash)) return null;
    return { id: admin.id, username: admin.username };
  },

  changeAdminPassword(username, newPassword) {
    const hash = hashPassword(newPassword);
    db.prepare('UPDATE admins SET password_hash = ? WHERE username = ?').run(hash, username);
  },

  // Users
  createUser({ name, email, phone, ip_address, user_agent }) {
    const info = db.prepare(
      'INSERT INTO users (name, email, phone, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)'
    ).run(name, email, phone, ip_address || null, user_agent || null);
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
    const total = db.prepare(`SELECT COUNT(*) as c FROM users ${where}`).get(...params).c;
    const rows = db.prepare(`SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return { users: rows, total, page, pages: Math.ceil(total / limit) };
  },

  getAllUsers() {
    return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  },

  // Payments
  createPayment({ user_id, amount, property_address, property_city, property_zip, offer_price }) {
    const info = db.prepare(
      'INSERT INTO payments (user_id, amount, property_address, property_city, property_zip, offer_price) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(user_id, amount, property_address || null, property_city || null, property_zip || null, offer_price || null);
    return { id: info.lastInsertRowid };
  },

  getPayments({ page = 1, limit = 50 } = {}) {
    const offset = (page - 1) * limit;
    const total = db.prepare('SELECT COUNT(*) as c FROM payments').get().c;
    const rows = db.prepare(`
      SELECT p.*, u.name as user_name, u.email as user_email
      FROM payments p LEFT JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset);
    return { payments: rows, total, page, pages: Math.ceil(total / limit) };
  },

  getAllPayments() {
    return db.prepare(`
      SELECT p.*, u.name as user_name, u.email as user_email
      FROM payments p LEFT JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
    `).all();
  },

  // Searches
  logSearch({ user_id, property_type, city, zip, max_price }) {
    db.prepare(
      'INSERT INTO searches (user_id, property_type, city, zip, max_price) VALUES (?, ?, ?, ?, ?)'
    ).run(user_id || null, property_type, city, zip, max_price);
  },

  // ── ANALYTICS ────────────────────────────────────────────────────────
  getStats() {
    const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const totalPayments = db.prepare('SELECT COUNT(*) as c FROM payments').get().c;
    const totalRevenue = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM payments').get().s;
    const todayUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE date(created_at)=date('now')").get().c;
    const todayRevenue = db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE date(created_at)=date('now')").get().s;
    const weekUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= datetime('now','-7 days')").get().c;
    const weekRevenue = db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE created_at >= datetime('now','-7 days')").get().s;
    const conversionRate = totalUsers > 0 ? ((totalPayments / totalUsers) * 100).toFixed(1) : '0.0';
    return { totalUsers, totalPayments, totalRevenue, todayUsers, todayRevenue, weekUsers, weekRevenue, conversionRate };
  },

  getSignupsByDay(days = 30) {
    return db.prepare(`
      SELECT date(created_at) as day, COUNT(*) as count
      FROM users WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY date(created_at) ORDER BY day
    `).all();
  },

  getRevenueByDay(days = 30) {
    return db.prepare(`
      SELECT date(created_at) as day, SUM(amount) as total, COUNT(*) as count
      FROM payments WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY date(created_at) ORDER BY day
    `).all();
  },

  getTopZipCodes(limit = 10) {
    return db.prepare(`
      SELECT property_zip as zip, COUNT(*) as count, SUM(amount) as revenue
      FROM payments WHERE property_zip IS NOT NULL AND property_zip != ''
      GROUP BY property_zip ORDER BY count DESC LIMIT ?
    `).all(limit);
  },

  getRecentActivity(limit = 20) {
    const users = db.prepare("SELECT 'signup' as type, name as detail, created_at FROM users ORDER BY created_at DESC LIMIT ?").all(limit);
    const payments = db.prepare(`
      SELECT 'payment' as type, u.name || ' — $' || p.amount || ' — ' || COALESCE(p.property_address,'') as detail, p.created_at
      FROM payments p LEFT JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC LIMIT ?
    `).all(limit);
    return [...users, ...payments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
  }
};
