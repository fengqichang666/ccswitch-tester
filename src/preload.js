const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ccswitch', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  loadProviders: () => ipcRenderer.invoke('load-providers'),
  loadState: () => ipcRenderer.invoke('load-state'),
  saveState: (state) => ipcRenderer.invoke('save-state', state),
  runTests: (providerKeys) => ipcRenderer.invoke('run-tests', providerKeys),
  syncPreview: () => ipcRenderer.invoke('sync-preview'),
  syncToDesktop: (providerIds) => ipcRenderer.invoke('sync-desktop', providerIds),
  onTestProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('test-progress', listener);
    return () => ipcRenderer.removeListener('test-progress', listener);
  },
  showError: (message) => ipcRenderer.invoke('show-error', message),
});
