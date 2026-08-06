const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // ===== SQLite Direct Bridge =====
  sqlite: {
    getAll: (table) => ipcRenderer.invoke('sqlite:getAll', table),
    getById: (table, id) => ipcRenderer.invoke('sqlite:getById', table, id),
    insert: (table, record) => ipcRenderer.invoke('sqlite:insert', table, record),
    update: (table, id, changes) => ipcRenderer.invoke('sqlite:update', table, id, changes),
    delete: (table, id) => ipcRenderer.invoke('sqlite:delete', table, id),
    bulkInsert: (table, records) => ipcRenderer.invoke('sqlite:bulkInsert', table, records),
    searchCustomer: (term) => ipcRenderer.invoke('sqlite:searchCustomer', term),
    getTimeline: (customerId) => ipcRenderer.invoke('sqlite:getTimeline', customerId),
    getCustomerByMobile: (mobile) => ipcRenderer.invoke('sqlite:getCustomerByMobile', mobile),
    backup: () => ipcRenderer.invoke('sqlite:backup'),
    exportJSON: () => ipcRenderer.invoke('sqlite:exportJSON'),
    restoreFromDialog: () => ipcRenderer.invoke('sqlite:restoreFromDialog'),
  },

  // ===== Backup & Export =====
  saveBackup: (dataString) => ipcRenderer.invoke('save-backup-data', dataString),
  restoreBackupDialog: () => ipcRenderer.invoke('restore-backup-dialog'),
  saveExportedExcel: (filename, base64Data) => ipcRenderer.invoke('save-exported-excel', { filename, base64Data }),
  saveInvoicePDF: (filename, base64Data) => ipcRenderer.invoke('save-invoice-pdf', { filename, base64Data }),

  // ===== Notifications =====
  showNotification: (title, body) => ipcRenderer.send('show-desktop-notification', { title, body }),

  // ===== Backup List & Verification =====
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupVerify: (filePath) => ipcRenderer.invoke('backup:verify', filePath),

  // ===== Metadata =====
  getPaths: () => ipcRenderer.invoke('app:getPaths'),
});
