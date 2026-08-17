const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ccswitch', {
  loadProviders: () => ipcRenderer.invoke('load-providers'),
  loadState: () => ipcRenderer.invoke('load-state'),
  saveState: (state) => ipcRenderer.invoke('save-state', state),
  runTests: (providerIds) => ipcRenderer.invoke('run-tests', providerIds),
  onTestProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('test-progress', listener);
    return () => ipcRenderer.removeListener('test-progress', listener);
  },
  showError: (message) => ipcRenderer.invoke('show-error', message),
});
