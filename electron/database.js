// AVNIDEEP CRM PRO — True SQLite Database Layer (CommonJS)
// Uses better-sqlite3 for native, fast, synchronous SQLite operations
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let Database;
try {
  Database = require('better-sqlite3');
} catch (err) {
  console.error('[SQLite] better-sqlite3 module not loaded. Run: npm install better-sqlite3 && npx electron-rebuild');
}

// ===== Path Constants =====
const BASE_CRM_DIR = path.join(app.getPath('documents'), 'AvnideepCRM');
const DB_DIR = path.join(BASE_CRM_DIR, 'database');
const DB_PATH = path.join(DB_DIR, 'crm.sqlite');

// Ensure folder exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

let db = null;

function initDatabase() {
  if (!Database) {
    console.warn('[SQLite] Skipping init. better-sqlite3 unavailable.');
    return null;
  }
  
  try {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    
    runSchemaMigrations();
    console.log('[SQLite] Database initialized at:', DB_PATH);
    return db;
  } catch (err) {
    console.error('[SQLite] Initialization failed:', err);
    return null;
  }
}

function runSchemaMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT
    );
  `);

  const currentVersion = db.prepare('SELECT MAX(version) as v FROM schema_version').get().v || 0;

  if (currentVersion < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT, mobile TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
        alternateNumber TEXT, address TEXT, pincode TEXT, city TEXT, state TEXT,
        totalOrders INTEGER DEFAULT 0, delivered INTEGER DEFAULT 0, rto INTEGER DEFAULT 0,
        cancelled INTEGER DEFAULT 0, fakeCount INTEGER DEFAULT 0, totalSpend REAL DEFAULT 0,
        lastOrderDate TEXT, riskLevel TEXT DEFAULT 'Low', currentStatus TEXT DEFAULT 'New Lead',
        createdAt TEXT, updatedAt TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(mobile);
      CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
      CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(currentStatus);

      CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT, customerId INTEGER NOT NULL, product TEXT, source TEXT,
        expectedAmount REAL DEFAULT 0, priority TEXT DEFAULT 'Medium', status TEXT DEFAULT 'New Lead',
        assignedAgent TEXT, notes TEXT, followupDate TEXT, followupTime TEXT, createdAt TEXT, updatedAt TEXT,
        FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_leads_customer ON leads(customerId);
      CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
      CREATE INDEX IF NOT EXISTS idx_leads_followup ON leads(followupDate);

      CREATE TABLE IF NOT EXISTS followups (
        id INTEGER PRIMARY KEY AUTOINCREMENT, leadId INTEGER NOT NULL, customerId INTEGER NOT NULL,
        scheduledDate TEXT, scheduledTime TEXT, notes TEXT, outcome TEXT, agentName TEXT,
        completedAt TEXT, createdAt TEXT,
        FOREIGN KEY (leadId) REFERENCES leads(id) ON DELETE CASCADE,
        FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_followups_lead ON followups(leadId);

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT, orderId TEXT UNIQUE NOT NULL, leadId INTEGER,
        customerId INTEGER NOT NULL, product TEXT, qty INTEGER DEFAULT 1, codAmount REAL DEFAULT 0,
        courier TEXT, trackingId TEXT, status TEXT DEFAULT 'Order Booked', orderDate TEXT,
        shipmentDate TEXT, createdAt TEXT, updatedAt TEXT,
        FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE,
        FOREIGN KEY (leadId) REFERENCES leads(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_orders_orderid ON orders(orderId);
      CREATE INDEX IF NOT EXISTS idx_orders_lead ON orders(leadId);
      CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customerId);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_tracking ON orders(trackingId);

      CREATE TABLE IF NOT EXISTS logistics (
        id INTEGER PRIMARY KEY AUTOINCREMENT, orderId INTEGER NOT NULL, status TEXT,
        dispatchDate TEXT, lastUpdate TEXT, createdAt TEXT, updatedAt TEXT,
        FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_logistics_order ON logistics(orderId);
      CREATE INDEX IF NOT EXISTS idx_logistics_status ON logistics(status);

      CREATE TABLE IF NOT EXISTS ndr_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT, orderId INTEGER NOT NULL, customerId INTEGER NOT NULL,
        reason TEXT, status TEXT DEFAULT 'Pending', attemptCount INTEGER DEFAULT 0, agentName TEXT,
        retryDate TEXT, nextAction TEXT, riskLevel TEXT DEFAULT 'Medium', notes TEXT, attempts TEXT,
        createdAt TEXT, updatedAt TEXT,
        FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ndr_order ON ndr_cases(orderId);
      CREATE INDEX IF NOT EXISTS idx_ndr_customer ON ndr_cases(customerId);
      CREATE INDEX IF NOT EXISTS idx_ndr_status ON ndr_cases(status);

      CREATE TABLE IF NOT EXISTS timeline_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, customerId INTEGER NOT NULL, entityType TEXT,
        entityId INTEGER, action TEXT, statusFrom TEXT, statusTo TEXT, notes TEXT, agentName TEXT,
        createdAt TEXT,
        FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_timeline_customer ON timeline_logs(customerId);
      CREATE INDEX IF NOT EXISTS idx_timeline_created ON timeline_logs(createdAt);

      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, message TEXT, type TEXT DEFAULT 'info',
        isRead INTEGER DEFAULT 0, linkTo TEXT, createdAt TEXT
      );

      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updatedAt TEXT);
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(1, new Date().toISOString());
  }

  if (currentVersion < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT, invoiceNumber TEXT UNIQUE NOT NULL, orderId INTEGER NOT NULL,
        customerId INTEGER NOT NULL, customerName TEXT, customerMobile TEXT, billingAddress TEXT,
        shippingAddress TEXT, customerGSTIN TEXT, product TEXT, hsnCode TEXT, qty INTEGER DEFAULT 1,
        rate REAL DEFAULT 0, discount REAL DEFAULT 0, subtotal REAL DEFAULT 0, cgst REAL DEFAULT 0,
        sgst REAL DEFAULT 0, igst REAL DEFAULT 0, deliveryCharge REAL DEFAULT 0, codCharge REAL DEFAULT 0,
        roundOff REAL DEFAULT 0, total REAL DEFAULT 0, amountPaid REAL DEFAULT 0, balanceDue REAL DEFAULT 0,
        amountInWords TEXT, paymentStatus TEXT DEFAULT 'Pending', placeOfSupply TEXT, invoiceDate TEXT,
        status TEXT DEFAULT 'Active', notes TEXT, source TEXT DEFAULT 'auto', createdAt TEXT, updatedAt TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoiceNumber);
      CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(orderId);
      CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customerId);
      CREATE INDEX IF NOT EXISTS idx_invoices_payment ON invoices(paymentStatus);
      CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoiceDate);
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(2, new Date().toISOString());
  }

  if (currentVersion < 3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
        description TEXT, hsnCode TEXT, category TEXT, purchasePrice REAL DEFAULT 0,
        sellingPrice REAL DEFAULT 0, gstRate REAL DEFAULT 18, stockQty INTEGER DEFAULT 0,
        lowStockAlert INTEGER DEFAULT 5, unit TEXT DEFAULT 'PCS', isActive INTEGER DEFAULT 1,
        createdAt TEXT, updatedAt TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
      CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
      CREATE INDEX IF NOT EXISTS idx_products_active ON products(isActive);

      CREATE TABLE IF NOT EXISTS inventory_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, productId INTEGER NOT NULL, changeType TEXT,
        qtyChange INTEGER, qtyBefore INTEGER, qtyAfter INTEGER, reference TEXT, orderId INTEGER,
        notes TEXT, agentName TEXT, createdAt TEXT,
        FOREIGN KEY (productId) REFERENCES products(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_invlogs_product ON inventory_logs(productId);
      CREATE INDEX IF NOT EXISTS idx_invlogs_type ON inventory_logs(changeType);

      CREATE TABLE IF NOT EXISTS invoice_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, invoiceId INTEGER NOT NULL, productId INTEGER,
        productName TEXT, hsnCode TEXT, qty INTEGER DEFAULT 1, rate REAL DEFAULT 0, discount REAL DEFAULT 0,
        gstRate REAL DEFAULT 18, taxableAmount REAL DEFAULT 0, cgst REAL DEFAULT 0, sgst REAL DEFAULT 0,
        igst REAL DEFAULT 0, total REAL DEFAULT 0,
        FOREIGN KEY (invoiceId) REFERENCES invoices(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_items_invoice ON invoice_items(invoiceId);

      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, invoiceId INTEGER NOT NULL, customerId INTEGER NOT NULL,
        amount REAL DEFAULT 0, method TEXT, reference TEXT, paymentDate TEXT, notes TEXT, createdAt TEXT,
        FOREIGN KEY (invoiceId) REFERENCES invoices(id) ON DELETE CASCADE,
        FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoiceId);
      CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customerId);

      CREATE TABLE IF NOT EXISTS invoice_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, value TEXT, updatedAt TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_invsettings_key ON invoice_settings(key);
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(3, new Date().toISOString());
  }
}

const allowedTables = ['customers','leads','followups','orders','logistics','ndr_cases',
  'timeline_logs','notifications','settings','invoices',
  'products','inventory_logs','invoice_items','payments','invoice_settings'];

function getTable(tableName) {
  if (!allowedTables.includes(tableName)) throw new Error(`Table "${tableName}" is not permitted`);
  return tableName;
}

function getAll(tableName) { if (!db) return []; const t = getTable(tableName); return db.prepare(`SELECT * FROM ${t}`).all(); }
function getById(tableName, id) { if (!db) return null; const t = getTable(tableName); return db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(id); }

function insert(tableName, record) {
  if (!db) return null;
  const t = getTable(tableName);
  const keys = Object.keys(record);
  if (keys.length === 0) return null;
  const placeholders = keys.map(() => '?').join(', ');
  const stmt = db.prepare(`INSERT INTO ${t} (${keys.join(', ')}) VALUES (${placeholders})`);
  const result = stmt.run(...keys.map(k => normalizeValue(record[k])));
  return result.lastInsertRowid;
}

function update(tableName, id, changes) {
  if (!db) return null;
  const t = getTable(tableName);
  const keys = Object.keys(changes);
  if (keys.length === 0) return null;
  const setClause = keys.map(k => `${k} = ?`).join(', ');
  return db.prepare(`UPDATE ${t} SET ${setClause} WHERE id = ?`).run(...keys.map(k => normalizeValue(changes[k])), id).changes;
}

function deleteById(tableName, id) { if (!db) return null; const t = getTable(tableName); return db.prepare(`DELETE FROM ${t} WHERE id = ?`).run(id).changes; }

function bulkInsert(tableName, records) {
  if (!db || !records || records.length === 0) return 0;
  const t = getTable(tableName);
  const keys = Object.keys(records[0]);
  const placeholders = keys.map(() => '?').join(', ');
  const stmt = db.prepare(`INSERT OR REPLACE INTO ${t} (${keys.join(', ')}) VALUES (${placeholders})`);
  const tx = db.transaction((rows) => { let c = 0; for (const r of rows) { stmt.run(...keys.map(k => normalizeValue(r[k]))); c++; } return c; });
  return tx(records);
}

function clearTable(tableName) { if (!db) return null; const t = getTable(tableName); return db.prepare(`DELETE FROM ${t}`).run().changes; }

function globalSearch(term) {
  if (!db || !term || term.length < 2) return { customers: [], orders: [] };
  const like = `%${term}%`;
  const customers = db.prepare('SELECT * FROM customers WHERE mobile LIKE ? OR name LIKE ? LIMIT 20').all(like, like);
  const orders = db.prepare('SELECT * FROM orders WHERE orderId LIKE ? OR trackingId LIKE ? LIMIT 20').all(like, like);
  return { customers, orders };
}

function getCustomerTimeline(customerId) { if (!db) return []; return db.prepare('SELECT * FROM timeline_logs WHERE customerId = ? ORDER BY createdAt DESC').all(customerId); }
function getCustomerByMobile(mobile) { if (!db) return null; return db.prepare('SELECT * FROM customers WHERE mobile = ?').get(mobile); }
function backupToFile(backupPath) { if (!db) throw new Error('Database not initialized'); return db.backup(backupPath); }

function exportAllAsJSON() {
  if (!db) return {};
  const r = {};
  for (const t of allowedTables) r[t] = getAll(t);
  return r;
}

function restoreFromJSON(data) {
  if (!db || !data) return false;
  const tx = db.transaction(() => {
    const clearOrder = ['invoices','notifications','timeline_logs','ndr_cases','logistics','orders','followups','leads','customers','products','inventory_logs','invoice_items','payments','invoice_settings'];
    for (const t of clearOrder) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch (e) {} }
    const insertOrder = ['customers','leads','followups','orders','logistics','ndr_cases','timeline_logs','notifications','settings','invoices','products','inventory_logs','invoice_items','payments','invoice_settings'];
    for (const t of insertOrder) { const rows = data[t] || []; if (rows.length > 0) bulkInsert(t, rows); }
  });
  try { tx(); return true; } catch (err) { console.error('[SQLite] Restore failed:', err); return false; }
}

function runIntegrityCheck() { if (!db) return null; try { const r = db.prepare('PRAGMA integrity_check').get(); return r && r.integrity_check === 'ok'; } catch (e) { return false; } }
function normalizeValue(v) { if (v === undefined || v === null) return null; if (typeof v === 'boolean') return v ? 1 : 0; if (typeof v === 'object') return JSON.stringify(v); return v; }

module.exports = {
  initDatabase, DB_PATH, DB_DIR, getAll, getById, insert, update, deleteById,
  bulkInsert, clearTable, globalSearch, getCustomerTimeline, getCustomerByMobile,
  backupToFile, exportAllAsJSON, restoreFromJSON, runIntegrityCheck,
};
