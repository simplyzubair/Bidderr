const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bidderr', {
  getState: () => ipcRenderer.invoke('get-state'),
  saveKey: (key) => ipcRenderer.invoke('save-key', key),
  writeNow: () => ipcRenderer.invoke('write-now'),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  getPrompt: () => ipcRenderer.invoke('get-prompt'),
  savePrompt: (prompt) => ipcRenderer.invoke('save-prompt', prompt),
  onStatus: (callback) => ipcRenderer.on('status', (_e, data) => callback(data)),
  onHud: (callback) => ipcRenderer.on('hud', (_e, data) => callback(data)),
  hudClicked: () => ipcRenderer.send('hud-clicked'),
  onUpdate: (callback) => ipcRenderer.on('update', (_e, data) => callback(data)),
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
});
