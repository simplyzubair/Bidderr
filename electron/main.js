// Bidderr for Windows: lives in the tray. Select a job post and click the "Write proposal"
// bubble (or press Ctrl+Shift+1): the proposal lands in the clipboard and the bubble turns
// into "Paste proposal". A status box in the screen corner shows start-up, update and hotkey
// messages (it works even when Windows notifications are turned off).
const { app, BrowserWindow, globalShortcut, ipcMain, clipboard, Tray, Menu, safeStorage, shell, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const {
  generateProposal, checkApiKey, checkBackupKey, maskKey, addToHistory, PROFILES, DEFAULT_PROFILE, defaultPromptFor,
} = require('../shared/proposal.js');
const { copySelection, pasteClipboard } = require('./copySelection.js');
const { startSelectionWatch } = require('./selectionWatch.js');

const DEFAULT_HOTKEY = 'Ctrl+Shift+1';
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
let hudKind = '';
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

function decrypt(saved) {
  if (!saved) return '';
  try {
    return safeStorage.decryptString(Buffer.from(saved, 'base64'));
  } catch {
    return '';
  }
}

const encrypt = (key) => safeStorage.encryptString(key).toString('base64');

function getApiKey() {
  const { apiKey } = loadSettings();
  if (!apiKey) return DEV ? process.env.BIDDERR_API_KEY || '' : '';
  return decrypt(apiKey);
}

function saveApiKey(key) {
  saveSettings({ apiKey: encrypt(key) });
}

// Optional OpenRouter key, used when Google fails. Encrypted the same way.
const getBackupKey = () => decrypt(loadSettings().backupKey);

// ---------- work profiles (Vector Tracing, Embroidery Digitizing, General Design) ----------
// Each profile has its own prompt. An empty saved prompt means "use that profile's default".

function getProfile() {
  const { profile } = loadSettings();
  return PROFILES.some((p) => p.id === profile) ? profile : DEFAULT_PROFILE;
}

function savedPrompts() {
  const { prompts, prompt } = loadSettings();
  // Older versions had one prompt; it belongs to the first profile (Vector Tracing).
  return { [DEFAULT_PROFILE]: prompt || '', ...(prompts || {}) };
}

const getPrompt = (id = getProfile()) => savedPrompts()[id] || defaultPromptFor(id);

function profilesView() {
  return {
    profile: getProfile(),
    list: PROFILES.map(({ id, name }) => ({ id, name, prompt: getPrompt(id), defaultPrompt: defaultPromptFor(id) })),
  };
}

// ---------- history of recent proposals (on this PC only) ----------

const historyFile = () => path.join(app.getPath('userData'), 'history.json');

function loadHistory() {
  try {
    const list = JSON.parse(fs.readFileSync(historyFile(), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function remember(job, proposal) {
  try {
    fs.writeFileSync(historyFile(), JSON.stringify(addToHistory(loadHistory(), job, proposal, getProfile())));
    settingsWindow?.webContents.send('history', loadHistory());
  } catch (e) {
    log(`[history] could not save: ${e.message}`);
  }
}

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

// kind: working | ok | error | update. Finished states hide by themselves.
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
  hudKind = kind;
  const hideAfter = { ok: 5000, error: 9000, update: 15000 }[kind];
  if (hideAfter) hudTimer = setTimeout(() => hudWindow?.hide(), hideAfter);
}

// ---------- the floating bubble next to the mouse ----------
// offer ("Write proposal") -> writing (sound 1) -> paste (sound 2, "Paste proposal") -> done.
// It never takes the keyboard focus, so the page under it keeps its selection / text box.

let bubbleWindow = null;
let bubbleState = '';
let bubbleTimer = null;
let bubbleHovered = false;

function createBubble() {
  bubbleWindow = new BrowserWindow({
    width: 72,
    height: 72,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  bubbleWindow.setAlwaysOnTop(true, 'screen-saver');
  bubbleWindow.loadFile(path.join(__dirname, 'bubble.html'));
}

const BUBBLE_HIDE_AFTER = { offer: 4500, done: 1500, error: 8000, paste: 3 * 60 * 1000 };

function scheduleBubbleHide() {
  clearTimeout(bubbleTimer);
  const ms = BUBBLE_HIDE_AFTER[bubbleState];
  if (ms && !bubbleHovered) bubbleTimer = setTimeout(hideBubble, ms);
}

function hideBubble() {
  clearTimeout(bubbleTimer);
  bubbleState = '';
  if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.hide();
}

// at: screen point to show the bubble next to; without it the bubble stays where it is.
function showBubble(state, label, sub = '', { sound = '', at = null } = {}) {
  log(`[bubble] ${state}: ${label}${sub ? ` - ${sub}` : ''}`);
  bubbleState = state;
  tray?.setToolTip(`Bidderr - ${label}`);
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return;
  if (at || !bubbleWindow.isVisible()) {
    const point = at || screen.getCursorScreenPoint();
    const { workArea } = screen.getDisplayNearestPoint(point);
    const [w, h] = bubbleWindow.getSize();
    bubbleWindow.setPosition(
      Math.round(Math.min(Math.max(point.x + 14, workArea.x), workArea.x + workArea.width - w)),
      Math.round(Math.min(Math.max(point.y + 14, workArea.y), workArea.y + workArea.height - h)),
    );
  }
  bubbleWindow.webContents.send('bubble', { state, label, sub, sound });
  bubbleWindow.showInactive(); // never steal focus from the page the user is on
  scheduleBubbleHide();
}

// ---------- the main action ----------

// From the hotkey or the bubble: copy the selected job text first. From the tray or the main
// window: use the text already in the clipboard.
async function writeProposal({ fromSelection = false, at = null } = {}) {
  if (busy) return;
  busy = true;
  log(`[action] write proposal (fromSelection=${fromSelection})`);
  settingsWindow?.webContents.send('status', {
    kind: 'working',
    text: 'Writing proposal… wait for “Proposal ready” before pasting.',
    lastProposal,
  });
  try {
    if (!getApiKey() && !getBackupKey()) throw new Error('No API key yet. Click here to add your free Google key.');
    showBubble('writing', 'Writing proposal...', 'Reading the job', { sound: 'writing', at });
    let job = clipboard.readText();
    if (fromSelection) {
      const result = await copySelection();
      job = result.text;
      log(`[copy] selection copied=${result.copied}, ${job.length} chars, ${result.info}`);
    }
    showBubble('writing', 'Writing proposal...', 'A few seconds');
    // While the window is open, the proposal shows up there as it is written.
    const onProgress = settingsWindow ? (text) => settingsWindow?.webContents.send('progress', text) : undefined;
    lastProposal = await generateProposal(job, getApiKey(), {
      prompt: getPrompt(), apiBase: API_BASE, backupKey: getBackupKey(), onProgress, log,
    });
    clipboard.writeText(lastProposal);
    remember(job, lastProposal);
    settingsWindow?.webContents.send('status', { kind: 'ok', text: 'Proposal ready. It is copied—paste it into the job form.', lastProposal });
    showBubble('paste', 'Paste proposal', 'Click the proposal box, then here', { sound: 'done' });
    showHud('ok', 'Proposal ready to paste', 'Your proposal is copied. Paste it into the job form.');
  } catch (e) {
    const detail = `${e.message}\nNo new proposal was copied. Check this message before pasting.`;
    settingsWindow?.webContents.send('status', { kind: 'error', text: detail, lastProposal });
    showBubble('error', 'Proposal not ready', e.message);
    // The bubble is icon-only, so the reason goes in the corner box too.
    showHud('error', 'Could not write the proposal', detail);
    if (/API key/.test(e.message)) openSettings();
  } finally {
    busy = false;
  }
}

async function pasteProposal() {
  // Always paste the proposal itself, even if something else was copied meanwhile.
  if (lastProposal) clipboard.writeText(lastProposal);
  const { sent, window } = await pasteClipboard();
  log(`[paste] sent=${sent}/4 window="${window}"`);
  showBubble('done', 'Pasted', 'Good luck with the job!');
}

function onBubbleClicked() {
  if (bubbleState === 'offer') {
    const [x, y] = bubbleWindow.getPosition();
    writeProposal({ fromSelection: true, at: { x: x - 14, y: y - 14 } });
  } else if (bubbleState === 'paste') {
    pasteProposal();
  } else if (bubbleState === 'error') {
    hideBubble();
    openSettings();
  }
}

// The user selected a block of text: offer to write a proposal from it.
// A new selection replaces an old "Paste" bubble; only a proposal being written blocks it.
function onTextSelected(at, reason) {
  if (busy || bubbleState === 'writing') return;
  log(`[select] ${reason}`);
  showBubble('offer', 'Write proposal', 'From the selected text', { at });
}

const selectionBubbleOn = () => loadSettings().selectionBubble !== false;
// Optional: only offer the bubble in web browsers (fewer pop-ups in other apps).
const browsersOnlyOn = () => loadSettings().browsersOnly === true;

// ---------- the keyboard shortcut (Ctrl+Shift+1 unless the user picked another one) ----------

let hotkey = '';
let hotkeyOk = false;

const onHotkey = () => writeProposal({ fromSelection: true, at: screen.getCursorScreenPoint() });

function tryRegister(accelerator) {
  try {
    return globalShortcut.register(accelerator, onHotkey);
  } catch {
    return false; // not a shortcut Electron understands
  }
}

// Switches to a new shortcut. If it is taken, the old one stays. Returns true when it worked.
function setHotkey(accelerator) {
  const old = hotkey;
  if (old) globalShortcut.unregister(old);
  if (tryRegister(accelerator)) {
    hotkey = accelerator;
    hotkeyOk = true;
    return true;
  }
  hotkeyOk = old ? tryRegister(old) : false;
  return false;
}

// "Ctrl+Alt+B": one or more of Ctrl/Alt/Shift (Ctrl or Alt required), then one key.
function isValidHotkey(text) {
  const parts = String(text || '').split('+');
  const key = parts.pop();
  const mods = new Set(parts);
  return parts.length >= 1 && mods.size === parts.length
    && parts.every((m) => ['Ctrl', 'Alt', 'Shift'].includes(m))
    && (mods.has('Ctrl') || mods.has('Alt'))
    && /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4]))$/.test(key);
}

// ---------- updates (from the newest GitHub release) ----------
// New versions download in the background. The user installs them with the "Update now"
// button (main window, tray menu or the status box). If they never press it, the update
// installs the next time Bidderr quits.

// state: idle | checking | downloading | ready | latest | error
let update = { state: 'idle', version: '', percent: 0 };

function setUpdate(changes) {
  update = { ...update, ...changes };
  settingsWindow?.webContents.send('update', update);
  tray?.setContextMenu(buildTrayMenu());
}

function checkForUpdates({ manual = false } = {}) {
  if (DEV) {
    setUpdate({ state: 'latest' });
    return;
  }
  if (update.state === 'downloading' || update.state === 'ready') return;
  setUpdate({ state: 'checking', manual });
  autoUpdater.checkForUpdates().catch(() => setUpdate({ state: 'error' }));
}

function installUpdate() {
  if (update.state !== 'ready' || busy) return; // never restart in the middle of a proposal
  autoUpdater.quitAndInstall(true, true); // silent install, then start Bidderr again
}

function setupAutoUpdates() {
  if (DEV) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', ({ version }) => setUpdate({ state: 'downloading', version, percent: 0 }));
  autoUpdater.on('download-progress', ({ percent }) => setUpdate({ state: 'downloading', percent: Math.round(percent) }));
  autoUpdater.on('update-not-available', () => setUpdate({ state: 'latest' }));
  autoUpdater.on('update-downloaded', ({ version }) => {
    setUpdate({ state: 'ready', version });
    showHud('update', `Update ${version} is ready`, 'Click here to install it (takes a few seconds)');
  });
  autoUpdater.on('error', () => setUpdate({ state: 'error' })); // offline or GitHub down
  checkForUpdates();
  setInterval(checkForUpdates, 60 * 60 * 1000);
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
  // Links open in the normal browser, and only the Google and OpenRouter key pages are allowed.
  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://aistudio.google.com/') || url.startsWith('https://openrouter.ai/')) shell.openExternal(url);
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
    update.state === 'ready'
      ? { label: `Update now to ${update.version}`, click: installUpdate }
      : { label: 'Check for updates', click: () => checkForUpdates({ manual: true }) },
    {
      label: 'Show bubble when I select text',
      type: 'checkbox',
      checked: selectionBubbleOn(),
      click: (item) => {
        saveSettings({ selectionBubble: item.checked });
        settingsWindow?.webContents.send('selection-bubble', item.checked);
      },
    },
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
const backupState = () => ({ hasBackupKey: Boolean(getBackupKey()), maskedBackupKey: maskKey(getBackupKey()) });

ipcMain.handle('get-state', () => ({
  ...keyState(),
  hotkeyOk,
  hotkey,
  defaultHotkey: DEFAULT_HOTKEY,
  browsersOnly: browsersOnlyOn(),
  history: loadHistory(),
  ...backupState(),
  lastProposal,
  version: app.getVersion(),
  update,
  selectionBubble: selectionBubbleOn(),
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
ipcMain.handle('get-profiles', () => profilesView());
ipcMain.handle('set-profile', (_e, id) => {
  if (PROFILES.some((p) => p.id === id)) saveSettings({ profile: id });
  return profilesView();
});
ipcMain.handle('save-prompt', (_e, id, prompt) => {
  if (!PROFILES.some((p) => p.id === id)) return profilesView();
  const text = String(prompt || '').trim().slice(0, 20000);
  // A saved prompt is kept exactly as saved, through every update. Only an empty one (Reset)
  // follows Bidderr's built-in default.
  const prompts = { ...savedPrompts(), [id]: text };
  saveSettings({ prompts, prompt: '' });
  return profilesView();
});

// Same rules as the Google key: tested first, never saved if OpenRouter rejects it.
ipcMain.handle('save-backup-key', async (_e, key) => {
  const newKey = String(key || '').trim().slice(0, 200);
  if (!newKey) return { state: 'invalid', ...backupState() };
  const check = await checkBackupKey(newKey);
  log(`[backup-key] check=${check}`);
  if (check === 'invalid') return { state: 'invalid', ...backupState() };
  try {
    saveSettings({ backupKey: encrypt(newKey) });
  } catch (e) {
    return { state: 'error', message: `Could not save the key: ${e.message}`, ...backupState() };
  }
  return { state: check, ...backupState() };
});
ipcMain.handle('remove-backup-key', () => {
  saveSettings({ backupKey: '' });
  return backupState();
});

ipcMain.handle('set-hotkey', (_e, text) => {
  const wanted = String(text || '');
  if (!isValidHotkey(wanted)) return { ok: false, hotkey, message: 'Use Ctrl or Alt, plus a letter, number or F-key.' };
  if (wanted === hotkey) return { ok: true, hotkey };
  if (!setHotkey(wanted)) return { ok: false, hotkey, message: `${wanted} is taken by another app. Try another one.` };
  saveSettings({ hotkey: wanted });
  tray?.setToolTip(`Bidderr - select a job, click the bubble or press ${hotkey}`);
  log(`[hotkey] now ${hotkey}`);
  return { ok: true, hotkey };
});

ipcMain.handle('clear-history', () => {
  try {
    fs.rmSync(historyFile(), { force: true });
  } catch {
    // nothing to clear
  }
  return [];
});
ipcMain.handle('set-browsers-only', (_e, on) => {
  saveSettings({ browsersOnly: Boolean(on) });
  return browsersOnlyOn();
});
ipcMain.on('hud-clicked', () => {
  hudWindow?.hide();
  if (hudKind === 'update') installUpdate();
  else openSettings();
});
ipcMain.handle('update-check', () => checkForUpdates({ manual: true }));
ipcMain.handle('update-install', () => installUpdate());
ipcMain.on('bubble-clicked', onBubbleClicked);
ipcMain.on('bubble-hover', (_e, inside) => {
  bubbleHovered = Boolean(inside);
  if (bubbleHovered) clearTimeout(bubbleTimer);
  else scheduleBubbleHide();
});
ipcMain.on('bubble-size', (_e, width, height) => {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return;
  const w = Math.min(Math.max(Math.round(width) || 0, 56), 420);
  const h = Math.min(Math.max(Math.round(height) || 0, 56), 140);
  const [x, y] = bubbleWindow.getPosition();
  bubbleWindow.setBounds({ x, y, width: w, height: h });
  if (DEV) {
    // Screen pixels of the pill, for the end-to-end test to click on.
    const r = screen.dipToScreenRect(bubbleWindow, bubbleWindow.getBounds());
    log(`[bubble] bounds ${bubbleState} ${r.x},${r.y},${r.width},${r.height}`);
  }
});
ipcMain.handle('set-selection-bubble', (_e, on) => {
  saveSettings({ selectionBubble: Boolean(on) });
  tray?.setContextMenu(buildTrayMenu());
  return selectionBubbleOn();
});

// ---------- start ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', openSettings);

  app.whenReady().then(() => {
    app.setAppUserModelId('com.bidderr.app');
    tray = new Tray(TRAY_ICON);
    // The saved shortcut, or Ctrl+Shift+1. A saved one that no longer works falls back to the default.
    const saved = loadSettings().hotkey;
    if (!(isValidHotkey(saved) && setHotkey(saved))) setHotkey(DEFAULT_HOTKEY);
    tray.setToolTip(`Bidderr - select a job, click the bubble or press ${hotkey || DEFAULT_HOTKEY}`);
    tray.on('click', openSettings);
    createHud();
    createBubble();

    const stopWatch = startSelectionWatch({
      onSelection: onTextSelected, isEnabled: selectionBubbleOn, browsersOnly: browsersOnlyOn, log,
    });
    app.on('will-quit', stopWatch);
    log(`[start] version ${app.getVersion()}, hotkey registered=${hotkeyOk}, selection bubble=${selectionBubbleOn()}`);

    // CI check of the packaged app: it started, loaded its Windows helpers and got the hotkey.
    const smoke = process.argv.find((a) => a.startsWith('--smoke-test='));
    if (smoke) {
      fs.writeFileSync(smoke.slice('--smoke-test='.length), JSON.stringify({ version: app.getVersion(), hotkeyOk, bubble: Boolean(bubbleWindow) }));
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
        showHud('error', `${hotkey || DEFAULT_HOTKEY} is taken by another app`, 'Pick another shortcut in Bidderr, or use the bubble'));
    }
    if ((!getApiKey() && !getBackupKey()) || !hotkeyOk) openSettings();
    else {
      hudWindow.webContents.once('did-finish-load', () =>
        showHud('ok', 'Bidderr is running', 'Select a job post, then click the Write bubble'));
    }
    setupAutoUpdates();
  });

  // Keep running in the tray when the main window is closed.
  app.on('window-all-closed', () => {});
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
