const { app, BrowserWindow, ipcMain, Notification, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const sqlite = require('./database.js');

// ===== Define base directories =====
const BASE_CRM_DIR = path.join(app.getPath('documents'), 'AvnideepCRM');
const BACKUP_DIR = path.join(BASE_CRM_DIR, 'backups');
const EXPORTS_DIR = path.join(BASE_CRM_DIR, 'exports');
const INVOICES_DIR = path.join(BASE_CRM_DIR, 'invoices');
const LOGS_DIR = path.join(BASE_CRM_DIR, 'logs');

// Auto-create folders
[BASE_CRM_DIR, BACKUP_DIR, EXPORTS_DIR, INVOICES_DIR, LOGS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

let mainWindow;

function createWindow() {
  const isDev = process.env.NODE_ENV === 'development';

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: isDev,
    },
    icon: path.join(__dirname, 'icon.png'),
    title: 'AVNIDEEP CRM PRO',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f8fafc',
  });

  // Completely remove the native menu bar (File, Edit, View, Window, Help)
  mainWindow.setMenuBarVisibility(false);
  Menu.setApplicationMenu(null);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.webContents.on('console-message', (event, level, message) => {
    if (level === 3) {
      console.error('[Renderer Error]', message);
    }
  });
  mainWindow.webContents.on('crashed', () => {
    console.error('[Renderer] Process crashed');
  });
  mainWindow.on('unresponsive', () => {
    console.warn('[Renderer] Unresponsive');
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    console.log('[App] Loading:', indexPath);
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ===== Enhanced Auto Backup System with Integrity Check =====
function runAutoBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `crm-${timestamp}.sqlite`);

  try {
    try {
      const integrityResult = sqlite.runIntegrityCheck ? sqlite.runIntegrityCheck() : null;
    } catch (e) {
      console.warn('[Backup] Integrity check skipped:', e.message);
    }
    try {
      sqlite.backupToFile(backupPath);
      const fileSize = fs.statSync(backupPath).size;
      console.log(`[Backup] SQLite snapshot saved: ${backupPath} (${(fileSize / 1024).toFixed(1)} KB)`);
    } catch (e) {
      console.error('[Backup] SQLite backup failed:', e.message);
    }
    try {
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => (f.endsWith('.sqlite') || f.endsWith('.json')) && f.startsWith('crm-'))
        .map(file => ({ name: file, time: fs.statSync(path.join(BACKUP_DIR, file)).mtime.getTime() }))
        .sort((a, b) => a.time - b.time);
      if (files.length > 20) {
        for (let i = 0; i < files.length - 20; i++) {
          fs.unlinkSync(path.join(BACKUP_DIR, files[i].name));
        }
      }
    } catch (e) {
      console.error('[Backup] Rotation failed:', e.message);
    }
  } catch (err) {
    console.error('[Backup] Auto backup error:', err);
  }
}

function verifyBackupIntegrity(backupPath) {
  const result = { valid: false, size: 0, issues: [] };
  try {
    if (!fs.existsSync(backupPath)) { result.issues.push('File does not exist'); return result; }
    const stats = fs.statSync(backupPath);
    result.size = stats.size;
    if (stats.size === 0) { result.issues.push('Backup file is empty'); return result; }
    const fd = fs.openSync(backupPath, 'r');
    const buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    const header = buffer.toString('utf8', 0, 16);
    if (header.startsWith('SQLite format 3')) {
      result.valid = true;
    } else {
      try { const content = fs.readFileSync(backupPath, 'utf-8'); JSON.parse(content); result.valid = true; }
      catch { result.issues.push('Invalid file format'); }
    }
    return result;
  } catch (e) { result.issues.push(e.message); return result; }
}

app.whenReady().then(() => {
  sqlite.initDatabase();
  createWindow();
  setTimeout(runAutoBackup, 10000);
  setInterval(runAutoBackup, 24 * 60 * 60 * 1000);
  app.on('browser-window-focus', () => {
    const backupFiles = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.sqlite') || f.endsWith('.json'));
    if (backupFiles.length === 0) runAutoBackup();
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ===================== IPC BRIDGE =====================

ipcMain.handle('sqlite:getAll', async (e, tableName) => { try { return { ok: true, data: sqlite.getAll(tableName) }; } catch (err) { return { ok: false, error: err.message }; } });
ipcMain.handle('sqlite:getById', async (e, tableName, id) => { try { return { ok: true, data: sqlite.getById(tableName, id) }; } catch (err) { return { ok: false, error: err.message }; } });
ipcMain.handle('sqlite:insert', async (e, tableName, record) => { try { return { ok: true, data: sqlite.insert(tableName, record) }; } catch (err) { return { ok: false, error: err.message }; } });
ipcMain.handle('sqlite:update', async (e, tableName, id, changes) => { try { return { ok: true, data: sqlite.update(tableName, id, changes) }; } catch (err) { return { ok: false, error: err.message }; } });
ipcMain.handle('sqlite:delete', async (e, tableName, id) => { try { return { ok: true, data: sqlite.deleteById(tableName, id) }; } catch (err) { return { ok: false, error: err.message }; } });
ipcMain.handle('sqlite:bulkInsert', async (e, tableName, records) => { try { return { ok: true, data: sqlite.bulkInsert(tableName, records) }; } catch (err) { return { ok: false, error: err.message }; } });
ipcMain.handle('sqlite:searchCustomer', async (e, term) => { try { return { ok: true, data: sqlite.globalSearch(term) }; } catch (err) { return { ok: false, error: err.message }; } });
ipcMain.handle('sqlite:getTimeline', async (e, customerId) => { try { return { ok: true, data: sqlite.getCustomerTimeline(customerId) }; } catch (err) { return { ok: false, error: err.message }; } });
ipcMain.handle('sqlite:getCustomerByMobile', async (e, mobile) => { try { return { ok: true, data: sqlite.getCustomerByMobile(mobile) }; } catch (err) { return { ok: false, error: err.message }; } });

ipcMain.handle('sqlite:backup', async () => {
  try { const ts = new Date().toISOString().replace(/[:.]/g, '-'); const p = path.join(BACKUP_DIR, `crm-manual-${ts}.sqlite`); sqlite.backupToFile(p); return { ok: true, path: p }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('sqlite:exportJSON', async () => {
  try { const d = sqlite.exportAllAsJSON(); const ts = new Date().toISOString().replace(/[:.]/g, '-'); const p = path.join(EXPORTS_DIR, `crm-export-${ts}.json`); fs.writeFileSync(p, JSON.stringify(d, null, 2)); return { ok: true, path: p, data: d }; }
  catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('sqlite:restoreFromDialog', async () => {
  try {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Backup Files', extensions: ['json', 'sqlite'] }] });
    if (r.canceled || r.filePaths.length === 0) return { ok: false, error: 'Cancelled' };
    const fp = r.filePaths[0];
    if (fp.endsWith('.json')) { const raw = fs.readFileSync(fp, 'utf-8'); const j = JSON.parse(raw); sqlite.restoreFromJSON(j); return { ok: true, data: j }; }
    else { fs.copyFileSync(fp, sqlite.DB_PATH); return { ok: true, path: fp }; }
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('save-exported-excel', async (e, { filename, base64Data }) => {
  try { const fp = path.join(EXPORTS_DIR, filename); fs.writeFileSync(fp, Buffer.from(base64Data, 'base64')); return { success: true, path: fp }; }
  catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('save-invoice-pdf', async (e, { filename, base64Data }) => {
  try { const fp = path.join(INVOICES_DIR, filename); fs.writeFileSync(fp, Buffer.from(base64Data, 'base64')); return { success: true, path: fp }; }
  catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('save-backup-data', async (e, dataString) => {
  try { const ts = new Date().toISOString().replace(/[:.]/g, '-'); const fp = path.join(BACKUP_DIR, `backup-${ts}.json`); fs.writeFileSync(fp, dataString, 'utf-8'); return { success: true, path: fp }; }
  catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('restore-backup-dialog', async () => {
  try { const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON Backups', extensions: ['json'] }] }); if (r.canceled || r.filePaths.length === 0) return { success: false, error: 'Cancelled' }; return { success: true, data: fs.readFileSync(r.filePaths[0], 'utf-8') }; }
  catch (err) { return { success: false, error: err.message }; }
});

ipcMain.on('show-desktop-notification', (e, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body }).show();
});

ipcMain.handle('backup:verify', async (e, filePath) => verifyBackupIntegrity(filePath));

ipcMain.handle('backup:list', async () => {
  try { return fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.sqlite') || f.endsWith('.json')).map(f => { const s = fs.statSync(path.join(BACKUP_DIR, f)); return { name: f, date: s.mtime.toISOString(), size: s.size, valid: verifyBackupIntegrity(path.join(BACKUP_DIR, f)).valid }; }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); }
  catch (e) { return []; }
});

ipcMain.handle('app:getPaths', () => ({
  base: BASE_CRM_DIR, database: sqlite.DB_PATH, backups: BACKUP_DIR,
  exports: EXPORTS_DIR, invoices: INVOICES_DIR, logs: LOGS_DIR,
}));
