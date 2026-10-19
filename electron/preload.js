const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  writeClipboard: (text) => ipcRenderer.invoke('write-clipboard', text),
  triggerCopySelection: () => ipcRenderer.invoke('trigger-copy-selection'),
  triggerPasteSelection: () => ipcRenderer.invoke('trigger-paste-selection'),
  toggleAlwaysOnTop: (flag) => ipcRenderer.invoke('toggle-always-on-top', flag),
  updateShortcuts: (shortcutsObj) => ipcRenderer.invoke('update-shortcuts', shortcutsObj),
  updateHotkey: (shortcutKey) => ipcRenderer.invoke('update-hotkey', shortcutKey),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  closeApp: () => ipcRenderer.invoke('close-app'),

  onHotkeyAction: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('hotkey-action', subscription);
    return () => {
      ipcRenderer.removeListener('hotkey-action', subscription);
    };
  },

  onHotkeyTriggered: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('hotkey-triggered', subscription);
    return () => {
      ipcRenderer.removeListener('hotkey-triggered', subscription);
    };
  },
});
