// Bidderr for Windows: lives in the tray. Select a job post, press Ctrl+Shift+1, and the
// proposal lands in the clipboard ready to paste. A small status box in the screen corner
// shows what is happening (it works even when Windows notifications are turned off).
const { app, BrowserWindow, globalShortcut, ipcMain, clipboard, Tray, Menu, safeStorage, shell, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { generateProposal, checkApiKey, maskKey, DEFAULT_PROMPT } = require('../shared/proposal.js');
const { copySelection } = require('./copySelection.js');

const HOTKEY = 'CommandOrControl+Shift+1';
const ICON = path.join(__dirname, '../public/icon.png');
const TRAY_ICON = path.join(__dirname, '../public/tray.png');

// Test hooks for developer runs only (npm start / the end-to-end test), never in the installed app.
const DEV = !app.isPackaged;
const API_BASE = (DEV && process.env.BIDDERR_API_BASE) || undefined;
const LOG_FILE = DEV ? process.env.BIDDERR_LOG : '';

let tray = null;
let settingsWindow = null;
let hudWindow = null;
let hudTimer = null;
let busy = false;
let lastProposal = '';

function log(message) {
  if (!DEV) return;
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  if (LOG_FILE) fs.appendFileSync(LOG_FILE, `${line}\n`);
}

// ---------- settings (API key is encrypted with Windows DPAPI via safeStorage) ----------

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(changes) {
  fs.writeFileSync(settingsFile(), JSON.stringify({ ...loadSettings(), ...changes }));
}

function getApiKey() {
  const { apiKey } = loadSettings();
  if (!apiKey) return DEV ? process.env.BIDDERR_API_KEY || '' : '';
  try {
    return safeStorage.decryptString(Buffer.from(apiKey, 'base64'));
  } catch {
    return '';
  }
}

function saveApiKey(key) {
  saveSettings({ apiKey: safeStorage.encryptString(key).toString('base64') });
}

// An empty saved prompt means "use the default prompt".
const getPrompt = () => loadSettings().prompt || DEFAULT_PROMPT;

// ---------- status box (HUD) in the corner of the screen ----------

function createHud() {
  hudWindow = new BrowserWindow({
    width: 360,
    height: 92,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  hudWindow.setAlwaysOnTop(true, 'screen-saver');
  hudWindow.loadFile(path.join(__dirname, 'hud.html'));
}

// kind: working | ok | error. Finished states hide by themselves.
function showHud(kind, title, detail = '') {
  log(`[hud] ${kind}: ${title}${detail ? ` - ${detail}` : ''}`);
  tray?.setToolTip(`Bidderr - ${title}`);
  settingsWindow?.webContents.send('status', { kind, text: `${title}${detail ? `. ${detail}` : ''}`, lastProposal });
  if (!hudWindow || hudWindow.isDestroyed()) return;

  // Bottom-right corner of the screen the mouse is on.
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const [w, h] = hudWindow.getSize();
  hudWindow.setPosition(workArea.x + workArea.width - w - 12, workArea.y + workArea.height - h - 12);
  hudWindow.webContents.send('hud', { kind, title, detail });
  hudWindow.showInactive(); // never steal focus from the page the user is on

  clearTimeout(hudTimer);
  if (kind !== 'working') hudTimer = setTimeout(() => hudWindow?.hide(), kind === 'ok' ? 5000 : 9000);
}

// ---------- the main action ----------

// From the hotkey: copy the selected job text first. From the tray or window: use the clipboard.
async function writeProposal({ fromSelection = false } = {}) {
  if (busy) return;
  busy = true;
  log(`[action] write proposal (fromSelection=${fromSelection})`);
  try {
    if (!getApiKey()) throw new Error('No API key yet. Click here to add your free Google key.');
    showHud('working', 'Reading the job...');
    let job = clipboard.readText();
    if (fromSelection) {
      const result = await copySelection();
      job = result.text;
      log(`[copy] selection copied=${result.copied}, ${job.length} chars, ${result.info}`);
    }
    showHud('working', 'Writing your proposal...', 'This takes a few seconds');
    lastProposal = await generateProposal(job, getApiKey(), { prompt: getPrompt(), apiBase: API_BASE });
    clipboard.writeText(lastProposal);
    showHud('ok', 'Proposal copied', 'Click the proposal box and press Ctrl+V');
  } catch (e) {
    showHud('error', 'Could not write the proposal', e.message);
    if (/API key/.test(e.message)) openSettings();
  } finally {
    busy = false;
    if (updateReady) installUpdate();
  }
}

// ---------- automatic updates (from the newest GitHub release) ----------

let updateReady = false;

function installUpdate() {
  if (busy) return; // never restart in the middle of writing a proposal
  autoUpdater.quitAndInstall(true, true); // silent install, then start Bidderr again
}

function setupAutoUpdates() {
  if (DEV) return;
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-downloaded', ({ version }) => {
    updateReady = true;
    showHud('ok', `Updating to ${version}`, 'Bidderr restarts by itself in a few seconds');
    setTimeout(installUpdate, 5000);
  });
  autoUpdater.on('error', () => {}); // offline or GitHub down: just try again later
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 3 * 60 * 60 * 1000);
}

// ---------- main window and tray ----------

function openSettings() {
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 540,
    height: 760,
    minWidth: 420,
    title: 'Bidderr',
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: '#0a0f1c',
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
    { label: `Bidderr ${app.getVersion()}`, enabled: false },
    { label: 'Open Bidderr', click: openSettings },
    { label: 'Write proposal from copied text', click: () => writeProposal() },
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

// ---------- messages from the windows ----------

const keyState = () => ({ hasKey: Boolean(getApiKey()), maskedKey: maskKey(getApiKey()) });

ipcMain.handle('get-state', () => ({
  ...keyState(),
  hotkeyOk: globalShortcut.isRegistered(HOTKEY),
  lastProposal,
  version: app.getVersion(),
}));

// Tests the key with Google first. A key Google rejects is never saved, and an empty box
// never wipes the saved key. Returns state: ok | offline (saved, untested) | invalid | error.
ipcMain.handle('save-key', async (_e, key) => {
  const newKey = String(key || '').trim().slice(0, 200);
  if (!newKey) return { state: 'invalid', ...keyState() };
  const check = await checkApiKey(newKey, { apiBase: API_BASE });
  log(`[key] check=${check}`);
  if (check === 'invalid') return { state: 'invalid', ...keyState() };
  try {
    saveApiKey(newKey);
  } catch (e) {
    return { state: 'error', message: `Could not save the key: ${e.message}`, ...keyState() };
  }
  if (getApiKey() !== newKey) return { state: 'error', message: 'The key did not save. Please try again.', ...keyState() };
  return { state: check, ...keyState() };
});
ipcMain.handle('copy-text', (_e, text) => clipboard.writeText(String(text || '')));
ipcMain.handle('write-now', () => writeProposal());
ipcMain.handle('get-prompt', () => ({ prompt: getPrompt(), defaultPrompt: DEFAULT_PROMPT }));
ipcMain.handle('save-prompt', (_e, prompt) => {
  const text = String(prompt || '').trim().slice(0, 20000);
  saveSettings({ prompt: text === DEFAULT_PROMPT ? '' : text });
  return getPrompt();
});
ipcMain.on('hud-clicked', () => {
  hudWindow?.hide();
  openSettings();
});

// ---------- start ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', openSettings);

  app.whenReady().then(() => {
    app.setAppUserModelId('com.bidderr.app');
    tray = new Tray(TRAY_ICON);
    tray.setToolTip('Bidderr - select a job, press Ctrl+Shift+1');
    tray.on('click', openSettings);
    createHud();

    const hotkeyOk = globalShortcut.register(HOTKEY, () => writeProposal({ fromSelection: true }));
    log(`[start] version ${app.getVersion()}, hotkey registered=${hotkeyOk}`);

    // CI check of the packaged app: it started, loaded its Windows helper and got the hotkey.
    const smoke = process.argv.find((a) => a.startsWith('--smoke-test='));
    if (smoke) {
      fs.writeFileSync(smoke.slice('--smoke-test='.length), JSON.stringify({ version: app.getVersion(), hotkeyOk }));
      app.quit();
      return;
    }

    // First run of the installed app: start with Windows (can be turned off in the tray menu).
    if (!DEV && !loadSettings().startupSet) {
      app.setLoginItemSettings({ openAtLogin: true });
      saveSettings({ startupSet: true });
    }
    tray.setContextMenu(buildTrayMenu());

    if (!hotkeyOk) {
      hudWindow.webContents.once('did-finish-load', () =>
        showHud('error', 'Ctrl+Shift+1 is taken by another app', 'Close that app, then restart Bidderr'));
    }
    if (!getApiKey() || !hotkeyOk) openSettings();
    else {
      hudWindow.webContents.once('did-finish-load', () =>
        showHud('ok', 'Bidderr is running', 'Select a job post and press Ctrl+Shift+1'));
    }
    setupAutoUpdates();
  });

  // Keep running in the tray when the main window is closed.
  app.on('window-all-closed', () => {});
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
