const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bidderr', {
  getState: () => ipcRenderer.invoke('get-state'),
  saveKey: (key) => ipcRenderer.invoke('save-key', key),
  writeNow: () => ipcRenderer.invoke('write-now'),
  getPrompt: () => ipcRenderer.invoke('get-prompt'),
  savePrompt: (prompt) => ipcRenderer.invoke('save-prompt', prompt),
  onStatus: (callback) => ipcRenderer.on('status', (_e, data) => callback(data)),
});
