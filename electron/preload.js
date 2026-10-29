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
  setSelectionBubble: (on) => ipcRenderer.invoke('set-selection-bubble', Boolean(on)),
  onSelectionBubble: (callback) => ipcRenderer.on('selection-bubble', (_e, on) => callback(on)),
  onBubble: (callback) => ipcRenderer.on('bubble', (_e, data) => callback(data)),
  bubbleClicked: () => ipcRenderer.send('bubble-clicked'),
  bubbleHover: (inside) => ipcRenderer.send('bubble-hover', Boolean(inside)),
  bubbleSize: (width, height) => ipcRenderer.send('bubble-size', Number(width), Number(height)),
  onUpdate: (callback) => ipcRenderer.on('update', (_e, data) => callback(data)),
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
});
