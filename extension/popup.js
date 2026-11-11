// PPH Bidderr settings popup: API keys, work profile, auto-write switch, and "write now".
const $ = (id) => document.getElementById(id);
const { checkApiKey, checkBackupKey, maskKey, PROFILES, DEFAULT_PROFILE } = window.Bidderr;
const { toast, setNote, busyButton, renderProfiles } = window.ui;
const store = chrome.storage.local;

async function show() {
  const { key = '', backupKey = '', profile = DEFAULT_PROFILE, auto = true } = await store.get(['key', 'backupKey', 'profile', 'auto']);
  setNote($('key-pill'), key ? maskKey(key) : 'No key', key ? 'ok' : 'error');
  setNote($('backup-pill'), backupKey ? maskKey(backupKey) : 'Off', backupKey ? 'ok' : '');
  $('key-card').open = !key && !backupKey;
  $('remove-backup').disabled = !backupKey;
  $('auto').checked = auto;
  renderProfiles($('profiles'), PROFILES, profile, async (id) => {
    await store.set({ profile: id });
    toast(`Writing as: ${PROFILES.find((p) => p.id === id).name}`);
  });
}

// Same rule as the apps: a key the service rejects is never saved.
async function saveKey(input, note, button, check, name) {
  const value = $(input).value.trim().slice(0, 200);
  if (!value) {
    setNote($(note), 'Paste the key in the box first.', 'error');
    return;
  }
  const done = busyButton($(button), 'Checking...');
  const result = await check(value);
  done();
  if (result === 'invalid') {
    setNote($(note), 'This key does not work. It was NOT saved.', 'error');
    return;
  }
  await store.set({ [name]: value });
  $(input).value = '';
  const offline = result === 'offline';
  setNote($(note), offline ? 'Saved, but not tested (no internet).' : 'Saved and working.', offline ? 'warn' : 'ok');
  show();
}

$('save-key').addEventListener('click', () => saveKey('key', 'key-note', 'save-key', checkApiKey, 'key'));
$('save-backup').addEventListener('click', () => saveKey('backup-key', 'backup-note', 'save-backup', checkBackupKey, 'backupKey'));
$('remove-backup').addEventListener('click', async () => {
  await store.remove('backupKey');
  setNote($('backup-note'), 'Backup key removed.', '');
  show();
});
$('auto').addEventListener('change', () => store.set({ auto: $('auto').checked }));

// Asks the PPH tab's content script to write now (even if it already wrote once).
$('write').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const reply = await chrome.tabs.sendMessage(tab.id, { type: 'write-now' });
    setNote($('status'), reply.text, reply.ok ? 'ok' : 'error');
  } catch {
    setNote($('status'), 'Open a PeoplePerHour job page first (reload it if it was already open).', 'error');
  }
});

show();
