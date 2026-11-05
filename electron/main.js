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
// Shows / hides the bubble. Three modifiers, so it does not clash with other apps.
const BUBBLE_HOTKEY = 'Ctrl+Alt+Shift+B';
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
let stopController = null; // aborts the proposal being written (the ring's Stop button)

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

const BUBBLE_HIDE_AFTER = { idle: 4500, offer: 4500, done: 1500, stopped: 1500, error: 8000, paste: 3 * 60 * 1000 };

// A pinned bubble stays in one spot (window x,y) and never goes away; otherwise it follows the mouse.
function pinnedAt() {
  const pin = loadSettings().bubblePin;
  return pin && Number.isFinite(pin.x) && Number.isFinite(pin.y) ? pin : null;
}

// "Pause 30 min" in the ring: no bubble until then (only in memory, a restart ends it).
let snoozeUntil = 0;
let snoozeTimer = null;
const bubbleAllowed = () => selectionBubbleOn() && Date.now() >= snoozeUntil;

function scheduleBubbleHide() {
  clearTimeout(bubbleTimer);
  if (ring || (bubbleState === 'idle' && pinnedAt())) return;
  const ms = BUBBLE_HIDE_AFTER[bubbleState];
  if (ms && !bubbleHovered) bubbleTimer = setTimeout(hideBubble, ms);
}

// Timed hide: a pinned bubble goes back to its resting look instead of disappearing.
function hideBubble() {
  if (pinnedAt() && bubbleAllowed()) showIdle();
  else closeBubble();
}

function closeBubble() {
  clearTimeout(bubbleTimer);
  bubbleState = '';
  if (ring) closeRing();
  if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.hide();
}

const showIdle = () => showBubble('idle', 'Bidderr', 'Select a job post, then click here. Right-click for more.');

let lastBubbleMessage = null;

// at: screen point to show the bubble next to; without it the bubble stays where it is.
function showBubble(state, label, sub = '', { sound = '', at = null } = {}) {
  log(`[bubble] ${state}: ${label}${sub ? ` - ${sub}` : ''}`);
  bubbleState = state;
  tray?.setToolTip(`Bidderr - ${label}`);
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return;
  const pin = pinnedAt();
  if (ring && !pin && at) closeRing(); // a new selection somewhere else
  if (!ring && (pin || at || !bubbleWindow.isVisible())) {
    const [w, h] = bubbleWindow.getSize();
    const point = pin || at || screen.getCursorScreenPoint();
    const gap = pin ? 0 : 14;
    const { workArea } = screen.getDisplayNearestPoint(point);
    bubbleWindow.setPosition(
      Math.round(Math.min(Math.max(point.x + gap, workArea.x), workArea.x + workArea.width - w)),
      Math.round(Math.min(Math.max(point.y + gap, workArea.y), workArea.y + workArea.height - h)),
    );
  }
  lastBubbleMessage = { state, label, sub };
  if (!ring) bubbleWindow.webContents.send('bubble', { state, label, sub, sound });
  else if (sound) bubbleWindow.webContents.send('bubble-sound', sound);
  bubbleWindow.showInactive(); // never steal focus from the page the user is on
  scheduleBubbleHide();
}

// ---------- the action ring (right-click on the bubble) ----------
// The bubble window grows into a ring of round buttons around the bubble's centre.

const RING_SIZE = 236;
let ring = null; // the bubble's bounds before the ring opened, while it is open

function ringState() {
  return {
    busy,
    pinned: Boolean(pinnedAt()),
    snoozed: Date.now() < snoozeUntil,
    hasProposal: Boolean(lastProposal),
    bubbleHotkey: BUBBLE_HOTKEY,
  };
}

function openRing() {
  if (ring || !bubbleWindow || bubbleWindow.isDestroyed() || !bubbleWindow.isVisible()) return;
  clearTimeout(bubbleTimer);
  ring = bubbleWindow.getBounds();
  const cx = ring.x + ring.width / 2;
  const cy = ring.y + ring.height / 2;
  const { workArea } = screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) });
  bubbleWindow.setBounds({
    x: Math.round(Math.min(Math.max(cx - RING_SIZE / 2, workArea.x), workArea.x + workArea.width - RING_SIZE)),
    y: Math.round(Math.min(Math.max(cy - RING_SIZE / 2, workArea.y), workArea.y + workArea.height - RING_SIZE)),
    width: RING_SIZE,
    height: RING_SIZE,
  });
  bubbleWindow.webContents.send('ring', { open: true, ...ringState() });
  // Screen pixels of the ring, for the end-to-end test to click on.
  const r = DEV ? screen.dipToScreenRect(bubbleWindow, bubbleWindow.getBounds()) : {};
  log(`[ring] open ${r.x},${r.y},${r.width},${r.height}`);
}

function closeRing() {
  if (!ring) return;
  const before = ring;
  ring = null;
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.setBounds(before);
    bubbleWindow.webContents.send('ring', { open: false });
    if (lastBubbleMessage) bubbleWindow.webContents.send('bubble', lastBubbleMessage);
  }
  scheduleBubbleHide();
}

function stopWriting() {
  if (!busy || !stopController) return;
  log('[action] stop');
  stopController.abort();
}

// Hide / show the bubble (ring, Ctrl+Alt+Shift+B, tray menu, Bidderr window).
function setBubbleShown(on, { tell = true } = {}) {
  saveSettings({ selectionBubble: on });
  snoozeUntil = 0;
  clearTimeout(snoozeTimer);
  settingsWindow?.webContents.send('selection-bubble', on);
  tray?.setContextMenu(buildTrayMenu());
  if (on) {
    showIdle(); // shows where it is now: the pinned spot or next to the mouse
    if (tell) showHud('ok', 'Bubble is on', `Press ${BUBBLE_HOTKEY} to hide it`);
  } else {
    if (!busy) closeBubble();
    if (tell) showHud('ok', 'Bubble hidden', `Press ${BUBBLE_HOTKEY} to show it again`);
  }
}

function toggleSnooze() {
  clearTimeout(snoozeTimer);
  if (Date.now() < snoozeUntil) {
    snoozeUntil = 0;
    if (pinnedAt()) showIdle();
    showHud('ok', 'Bubble is back');
    return;
  }
  snoozeUntil = Date.now() + 30 * 60 * 1000;
  if (!busy) closeBubble();
  showHud('ok', 'Bubble paused for 30 minutes', `Press ${BUBBLE_HOTKEY} to bring it back now`);
  snoozeTimer = setTimeout(() => {
    snoozeUntil = 0;
    if (pinnedAt() && bubbleAllowed()) showIdle();
  }, 30 * 60 * 1000);
}

// Pins the bubble where it is now (before the ring opened), or lets it follow the mouse again.
function togglePin() {
  if (pinnedAt()) {
    saveSettings({ bubblePin: null });
    showHud('ok', 'Bubble unpinned', 'It shows next to the mouse again');
  } else {
    const { x, y } = ring || bubbleWindow.getBounds();
    saveSettings({ bubblePin: { x, y } });
    showHud('ok', 'Bubble pinned here', 'Drag it to move it. Right-click it to unpin.');
  }
  tray?.setContextMenu(buildTrayMenu());
}

function copyLastProposal() {
  if (!lastProposal) return;
  clipboard.writeText(lastProposal);
  showBubble('paste', 'Paste proposal', 'Copied again. Click the proposal box, then here');
}

function restartApp() {
  log('[action] restart');
  stopController?.abort();
  app.relaunch();
  app.quit();
}

// Every ring button. Anything else from the window is ignored.
const RING_ACTIONS = {
  stop: stopWriting,
  copy: copyLastProposal,
  settings: openSettings,
  pin: togglePin,
  restart: restartApp,
  quit: () => app.quit(),
  hide: () => setBubbleShown(false),
  snooze: toggleSnooze,
};

// Dragging the bubble moves it and pins it there.
let dragFrom = null;

function dragBubble(phase, x, y) {
  if (!bubbleWindow || bubbleWindow.isDestroyed() || ring) return;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (phase === 'start') {
    const [wx, wy] = bubbleWindow.getPosition();
    dragFrom = { dx: wx - x, dy: wy - y };
    clearTimeout(bubbleTimer);
  } else if (dragFrom) {
    const nx = Math.round(x + dragFrom.dx);
    const ny = Math.round(y + dragFrom.dy);
    bubbleWindow.setPosition(nx, ny);
    if (phase === 'end') {
      dragFrom = null;
      saveSettings({ bubblePin: { x: nx, y: ny } });
      tray?.setContextMenu(buildTrayMenu());
      log(`[bubble] pinned at ${nx},${ny}`);
      scheduleBubbleHide();
    }
  }
}

// ---------- the main action ----------

// From the hotkey or the bubble: copy the selected job text first. From the tray or the main
// window: use the text already in the clipboard.
async function writeProposal({ fromSelection = false, at = null } = {}) {
  if (busy) return;
  busy = true;
  const stop = new AbortController();
  stopController = stop;
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
    if (stop.signal.aborted) throw new Error('Stopped');
    showBubble('writing', 'Writing proposal...', 'A few seconds');
    // While the window is open, the proposal shows up there as it is written.
    const onProgress = settingsWindow ? (text) => settingsWindow?.webContents.send('progress', text) : undefined;
    // Every AI request gets the Stop signal, so Stop ends it at once.
    const fetchImpl = (url, options) => fetch(url, { ...options, signal: stop.signal });
    const proposal = await generateProposal(job, getApiKey(), {
      prompt: getPrompt(), apiBase: API_BASE, backupKey: getBackupKey(), onProgress, log, fetchImpl,
    });
    if (stop.signal.aborted) throw new Error('Stopped');
    lastProposal = proposal;
    clipboard.writeText(lastProposal);
    remember(job, lastProposal);
    settingsWindow?.webContents.send('status', { kind: 'ok', text: 'Proposal ready. It is copied—paste it into the job form.', lastProposal });
    showBubble('paste', 'Paste proposal', 'Click the proposal box, then here', { sound: 'done' });
    showHud('ok', 'Proposal ready to paste', 'Your proposal is copied. Paste it into the job form.');
  } catch (e) {
    if (stop.signal.aborted) {
      log('[action] stopped');
      settingsWindow?.webContents.send('status', { kind: 'ok', text: 'Stopped. No new proposal was copied.', lastProposal });
      showBubble('stopped', 'Stopped', 'No new proposal was copied');
      return;
    }
    const detail = `${e.message}\nNo new proposal was copied. Check this message before pasting.`;
    settingsWindow?.webContents.send('status', { kind: 'error', text: detail, lastProposal });
    showBubble('error', 'Proposal not ready', e.message);
    // The bubble is icon-only, so the reason goes in the corner box too.
    showHud('error', 'Could not write the proposal', detail);
    if (/API key/.test(e.message)) openSettings();
  } finally {
    busy = false;
    stopController = null;
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
  if (ring) return;
  if (bubbleState === 'offer' || bubbleState === 'idle') {
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
  if (busy || bubbleState === 'writing' || ring || !bubbleAllowed()) return;
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
      label: `Show bubble (${BUBBLE_HOTKEY} hides / shows it)`,
      type: 'checkbox',
      checked: selectionBubbleOn(),
      click: (item) => setBubbleShown(item.checked, { tell: false }),
    },
    ...(pinnedAt() ? [{ label: 'Unpin bubble (follow the mouse)', click: togglePin }] : []),
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
  if (wanted === BUBBLE_HOTKEY) return { ok: false, hotkey, message: `${wanted} already hides / shows the bubble. Try another one.` };
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
ipcMain.on('bubble-drag', (_e, phase, x, y) => {
  if (['start', 'move', 'end'].includes(phase)) dragBubble(phase, Number(x), Number(y));
});
ipcMain.on('ring-open', openRing);
ipcMain.on('ring-close', closeRing);
ipcMain.on('ring-action', (_e, action) => {
  if (!Object.hasOwn(RING_ACTIONS, action)) return;
  log(`[ring] ${action}`);
  closeRing();
  RING_ACTIONS[action]();
});
ipcMain.on('bubble-size', (_e, width, height) => {
  if (!bubbleWindow || bubbleWindow.isDestroyed() || ring) return;
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
  setBubbleShown(Boolean(on), { tell: false });
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
    let bubbleHotkeyOk = false;
    try {
      bubbleHotkeyOk = globalShortcut.register(BUBBLE_HOTKEY, () => setBubbleShown(!bubbleAllowed()));
    } catch {
      // stays false
    }
    createHud();
    createBubble();

    const stopWatch = startSelectionWatch({
      onSelection: onTextSelected, isEnabled: selectionBubbleOn, browsersOnly: browsersOnlyOn, log,
    });
    app.on('will-quit', stopWatch);
    log(`[start] version ${app.getVersion()}, hotkey registered=${hotkeyOk}, bubble hotkey=${bubbleHotkeyOk}, selection bubble=${selectionBubbleOn()}`);
    // A pinned bubble is always on screen, once its page has loaded.
    bubbleWindow.webContents.once('did-finish-load', () => {
      if (pinnedAt() && bubbleAllowed()) showIdle();
    });

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
