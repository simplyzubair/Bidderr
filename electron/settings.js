const $ = (id) => document.getElementById(id);
const { toast, setNote, busyButton, renderProfiles, renderHistory, shortcutFromKey } = window.ui;

let hasBackupKey = false;

function showKey({ hasKey, maskedKey }) {
  setNote($('key-pill'), hasKey ? `Saved: ${maskedKey}` : 'No key', hasKey ? 'ok' : 'error');
  const ready = hasKey || hasBackupKey;
  setNote($('ready-pill'), ready ? 'Ready' : 'Setup needed', ready ? 'ok' : 'warn');
  $('key-card').open = !hasKey;
  $('key-card').classList.toggle('highlight', !hasKey);
}

// ---------- API key ----------

$('toggle-key').addEventListener('click', () => {
  const show = $('key').type === 'password';
  $('key').type = show ? 'text' : 'password';
  $('toggle-key').textContent = show ? 'Hide' : 'Show';
});

async function saveKey() {
  const key = $('key').value.trim();
  if (!key) {
    setNote($('key-note'), 'Paste your API key in the box first.', 'error');
    $('key').focus();
    return;
  }
  const done = busyButton($('save'), 'Checking with Google...');
  const result = await window.bidderr.saveKey(key);
  done();
  if (result.state === 'invalid') {
    setNote($('key-note'), 'Google says this key does not work. It was NOT saved. Copy it again and retry.', 'error');
    toast('This API key does not work', 'error');
    return;
  }
  if (result.state === 'error') {
    setNote($('key-note'), result.message, 'error');
    toast('Could not save the key', 'error');
    return;
  }
  $('key').value = '';
  showKey(result);
  if (result.state === 'offline') {
    setNote($('key-note'), `Saved (${result.maskedKey}), but Google could not be reached to test it.`, 'warn');
    toast('Key saved (not tested, no internet)', 'warn');
  } else {
    setNote($('key-note'), `New API key saved and working: ${result.maskedKey}`, 'ok');
    toast('New API key saved and working');
  }
}
$('save').addEventListener('click', saveKey);
$('key').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveKey();
});

// ---------- backup key (OpenRouter) ----------

function showBackup({ hasBackupKey: has, maskedBackupKey }) {
  hasBackupKey = has;
  setNote($('backup-pill'), has ? `Saved: ${maskedBackupKey}` : 'Off', has ? 'ok' : '');
  $('remove-backup').disabled = !has;
}

$('toggle-backup').addEventListener('click', () => {
  const show = $('backup-key').type === 'password';
  $('backup-key').type = show ? 'text' : 'password';
  $('toggle-backup').textContent = show ? 'Hide' : 'Show';
});

$('save-backup').addEventListener('click', async () => {
  const key = $('backup-key').value.trim();
  if (!key) {
    setNote($('backup-note'), 'Paste your OpenRouter key in the box first.', 'error');
    return;
  }
  const done = busyButton($('save-backup'), 'Checking with OpenRouter...');
  const result = await window.bidderr.saveBackupKey(key);
  done();
  if (result.state === 'invalid') {
    setNote($('backup-note'), 'OpenRouter says this key does not work. It was NOT saved.', 'error');
    return;
  }
  if (result.state === 'error') {
    setNote($('backup-note'), result.message, 'error');
    return;
  }
  $('backup-key').value = '';
  showBackup(result);
  const offline = result.state === 'offline';
  setNote($('backup-note'), offline
    ? 'Saved, but OpenRouter could not be reached to test it.'
    : 'Backup key saved and working. It is used only when Google fails.', offline ? 'warn' : 'ok');
  toast('Backup key saved');
});

$('remove-backup').addEventListener('click', async () => {
  if (!confirm('Remove the OpenRouter backup key?')) return;
  showBackup(await window.bidderr.removeBackupKey());
  setNote($('backup-note'), 'Backup key removed.', '');
});

// ---------- proposals ----------

function showStatus({ kind, text, lastProposal }) {
  setNote($('status'), text, kind);
  const working = kind === 'working';
  $('write').disabled = working;
  $('write').setAttribute('aria-busy', String(working));
  if (working) {
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    $('write').replaceChildren(spinner, document.createTextNode('Writing proposal…'));
  } else {
    $('write').textContent = 'Write from copied job';
  }
  if (lastProposal) $('last').value = lastProposal;
}
window.bidderr.onStatus(showStatus);
// The proposal shows up bit by bit while it is written.
window.bidderr.onProgress((text) => {
  $('last').value = text;
});

$('write').addEventListener('click', () => window.bidderr.writeNow());
$('copy-last').addEventListener('click', async () => {
  if (!$('last').value) return;
  await window.bidderr.copyText($('last').value);
  toast('Proposal copied');
});

// ---------- work profiles and their prompts ----------

let profiles = { profile: '', list: [] };
const currentProfile = () => profiles.list.find((p) => p.id === profiles.profile) || profiles.list[0];

function showProfiles(view) {
  profiles = view;
  renderProfiles($('profiles'), view.list, view.profile, async (id) => {
    showProfiles(await window.bidderr.setProfile(id));
    toast(`Writing as: ${currentProfile().name}`);
  });
  $('prompt').value = currentProfile().prompt;
  $('prompt-profile').textContent = currentProfile().name;
}

$('save-prompt').addEventListener('click', async () => {
  showProfiles(await window.bidderr.savePrompt(profiles.profile, $('prompt').value));
  toast(`Prompt saved for ${currentProfile().name}.`);
});

$('reset-prompt').addEventListener('click', async () => {
  if (!confirm(`Replace the ${currentProfile().name} prompt with the default one?`)) return;
  showProfiles(await window.bidderr.savePrompt(profiles.profile, ''));
  toast('Default prompt restored');
});

// ---------- recent proposals ----------

function showHistory(list) {
  renderHistory($('history'), list, profiles.list, async (text) => {
    await window.bidderr.copyText(text);
    toast('Proposal copied');
  });
  $('history-pill').textContent = String(list.length);
}
window.bidderr.onHistory(showHistory);

$('clear-history').addEventListener('click', async () => {
  if (!confirm('Delete the list of recent proposals?')) return;
  showHistory(await window.bidderr.clearHistory());
});

// ---------- keyboard shortcut ----------

function showHotkey(hotkey) {
  $('hotkey').value = hotkey;
  const keys = (hotkey || 'Ctrl+Shift+1').split('+').map((k) => {
    const kbd = document.createElement('kbd');
    kbd.textContent = k;
    return kbd;
  });
  $('hotkey-keys').replaceChildren(...keys);
}

$('hotkey').addEventListener('keydown', (e) => {
  if (e.key === 'Tab') return;
  e.preventDefault();
  const shortcut = shortcutFromKey(e);
  if (shortcut) $('hotkey').value = shortcut;
});

async function saveHotkey(text) {
  const result = await window.bidderr.setHotkey(text);
  showHotkey(result.hotkey);
  if (result.ok) {
    setNote($('hotkey-note'), `Shortcut is now ${result.hotkey}.`, 'ok');
    $('hotkey-warning').classList.add('hidden');
    toast(`Shortcut: ${result.hotkey}`);
  } else {
    setNote($('hotkey-note'), result.message, 'error');
  }
}
$('save-hotkey').addEventListener('click', () => saveHotkey($('hotkey').value));
$('reset-hotkey').addEventListener('click', () => saveHotkey('Ctrl+Shift+1'));

// ---------- updates ----------

let currentVersion = '';

function showUpdate({ state, version, percent }) {
  const views = {
    idle: ['Up to date', '', `You have version ${currentVersion}.`, 'Check for updates', false],
    checking: ['Checking', '', 'Looking for a newer version...', 'Checking...', true],
    downloading: ['Downloading', 'warn', `Version ${version} is downloading (${percent || 0}%). The Update button appears when it is ready.`, 'Downloading...', true],
    ready: [`${version} ready`, 'ok', `Version ${version} is ready. Press Update now; Bidderr restarts in a few seconds.`, `Update now to ${version}`, false],
    latest: ['Up to date', 'ok', `You have the newest version (${currentVersion}).`, 'Check for updates', false],
    error: ['Offline', 'error', 'Could not reach the update server. Check your internet and try again.', 'Try again', false],
  };
  const [pill, kind, text, button, disabled] = views[state] || views.idle;
  setNote($('update-pill'), pill, kind);
  $('update-text').textContent = text;
  $('update-btn').textContent = button;
  $('update-btn').disabled = disabled;
  $('update-btn').className = state === 'ready' ? 'btn primary' : 'btn';
  $('update-card').classList.toggle('highlight', state === 'ready');
  $('update-btn').dataset.state = state;
}

$('update-btn').addEventListener('click', () => {
  if ($('update-btn').dataset.state === 'ready') window.bidderr.installUpdate();
  else window.bidderr.checkForUpdates();
});
window.bidderr.onUpdate(showUpdate);

// ---------- selection bubble on/off ----------

$('selection-bubble').addEventListener('change', async () => {
  const on = await window.bidderr.setSelectionBubble($('selection-bubble').checked);
  toast(on ? 'The bubble will show when you select text' : `Bubble off. Use ${$('hotkey').value || 'the shortcut'} instead.`);
});
$('browsers-only').addEventListener('change', async () => {
  const on = await window.bidderr.setBrowsersOnly($('browsers-only').checked);
  toast(on ? 'The bubble shows only in web browsers' : 'The bubble shows in all apps');
});
window.bidderr.onSelectionBubble((on) => {
  $('selection-bubble').checked = on;
});

// Profiles first, so the history list can show profile names.
Promise.all([window.bidderr.getProfiles(), window.bidderr.getState()]).then(([view, state]) => {
  showProfiles(view);
  currentVersion = state.version;
  $('selection-bubble').checked = state.selectionBubble;
  $('browsers-only').checked = state.browsersOnly;
  showUpdate(state.update);
  showBackup(state);
  showKey(state);
  showHotkey(state.hotkey);
  showHistory(state.history);
  $('hotkey-warning').classList.toggle('hidden', state.hotkeyOk);
  $('last').value = state.lastProposal;
  $('footer').textContent = `Bidderr ${state.version} · one-click updates`;
});
