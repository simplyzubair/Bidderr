// Bidderr for Windows: lives in the tray. Copy a job posting, press Ctrl+Shift+1,
// and the proposal lands in the clipboard ready to paste.
const { app, BrowserWindow, globalShortcut, ipcMain, clipboard, Tray, Menu, Notification, safeStorage, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { generateProposal, DEFAULT_PROMPT } = require('../shared/proposal.js');

const HOTKEY = 'CommandOrControl+Shift+1';
const ICON = path.join(__dirname, '../public/icon.png');

let tray = null;
let settingsWindow = null;
let busy = false;
let lastProposal = '';

// ---------- settings (API key is encrypted with Windows DPAPI via safeStorage) ----------

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function getApiKey() {
  const { apiKey } = loadSettings();
  if (!apiKey) return '';
  try {
    return safeStorage.decryptString(Buffer.from(apiKey, 'base64'));
  } catch {
    return '';
  }
}

function saveSettings(changes) {
  fs.writeFileSync(settingsFile(), JSON.stringify({ ...loadSettings(), ...changes }));
}

function saveApiKey(key) {
  saveSettings({ apiKey: key ? safeStorage.encryptString(key).toString('base64') : '' });
}

// An empty saved prompt means "use the default prompt".
const getPrompt = () => loadSettings().prompt || DEFAULT_PROMPT;

// ---------- the main action ----------

function notify(title, body) {
  new Notification({ title, body, icon: ICON }).show();
}

function setStatus(text) {
  tray?.setToolTip(`Bidderr - ${text}`);
  settingsWindow?.webContents.send('status', { text, lastProposal });
}

async function writeProposalFromClipboard() {
  if (busy) return;
  busy = true;
  setStatus('writing proposal...');
  try {
    lastProposal = await generateProposal(clipboard.readText(), getApiKey(), { prompt: getPrompt() });
    clipboard.writeText(lastProposal);
    setStatus('proposal copied. Press Ctrl+V to paste.');
    notify('Proposal ready', 'Copied to clipboard. Press Ctrl+V to paste it.');
  } catch (e) {
    setStatus(e.message);
    notify('Bidderr could not write the proposal', e.message);
  } finally {
    busy = false;
  }
}

// ---------- windows and tray ----------

function openSettings() {
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 520,
    height: 640,
    title: 'Bidderr',
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  // Links open in the normal browser, and only the Google key page is allowed.
  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://aistudio.google.com/')) shell.openExternal(url);
    return { action: 'deny' };
  });
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Write proposal from clipboard (Ctrl+Shift+1)', click: writeProposalFromClipboard },
    { label: 'Settings', click: openSettings },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: 'Quit Bidderr', click: () => app.quit() },
  ]);
}

ipcMain.handle('get-state', () => ({ hasKey: Boolean(getApiKey()), hotkeyOk: globalShortcut.isRegistered(HOTKEY), lastProposal }));
ipcMain.handle('save-key', (_e, key) => {
  saveApiKey(String(key || '').trim());
  return Boolean(getApiKey());
});
ipcMain.handle('write-now', () => writeProposalFromClipboard());
ipcMain.handle('get-prompt', () => ({ prompt: getPrompt(), defaultPrompt: DEFAULT_PROMPT }));
ipcMain.handle('save-prompt', (_e, prompt) => {
  const text = String(prompt || '').trim().slice(0, 20000);
  saveSettings({ prompt: text === DEFAULT_PROMPT ? '' : text });
  return getPrompt();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', openSettings);

  app.whenReady().then(() => {
    app.setAppUserModelId('com.bidderr.app');
    tray = new Tray(ICON);
    tray.setToolTip('Bidderr - copy a job, press Ctrl+Shift+1');
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', openSettings);

    if (!globalShortcut.register(HOTKEY, writeProposalFromClipboard)) {
      notify('Bidderr', 'Ctrl+Shift+1 is used by another app. Use the tray menu instead.');
    }
    if (!getApiKey()) openSettings();
  });

  // Keep running in the tray when the settings window is closed.
  app.on('window-all-closed', () => {});
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
