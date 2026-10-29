// Bidderr Android page. window.Bidderr is the shared engine (proposal.js), window.ui the shared
// UI helpers (ui.js), window.store the saved settings (store.js), window.Android the bridge
// from MainActivity.java.
const $ = (id) => document.getElementById(id);
const { generateProposal, checkApiKey, checkBackupKey, maskKey, PROFILES } = window.Bidderr;
const { toast, setNote, busyButton, renderProfiles, renderHistory } = window.ui;
const { store } = window;

function copyText(text) {
  if (window.Android) window.Android.copy(text);
  else navigator.clipboard?.writeText(text);
}

async function readClipboard() {
  if (window.Android) return window.Android.paste();
  return navigator.clipboard ? navigator.clipboard.readText() : '';
}

// ---------- API key ----------

function showKey() {
  const has = Boolean(store.key);
  setNote($('key-pill'), has ? maskKey(store.key) : 'No key', has ? 'ok' : 'error');
  const ready = has || Boolean(store.backupKey);
  setNote($('ready-pill'), ready ? 'Ready' : 'Setup needed', ready ? 'ok' : 'warn');
  if (!has) $('key-card').open = true;
  $('key-card').classList.toggle('highlight', !has);
}

$('toggle-key').addEventListener('click', () => {
  const show = $('key').type === 'password';
  $('key').type = show ? 'text' : 'password';
  $('toggle-key').textContent = show ? 'Hide' : 'Show';
});

$('save-key').addEventListener('click', async () => {
  const key = $('key').value.trim();
  if (!key) {
    setNote($('key-note'), 'Paste your API key in the box first.', 'error');
    return;
  }
  const done = busyButton($('save-key'), 'Checking with Google...');
  const check = await checkApiKey(key);
  done();
  if (check === 'invalid') {
    setNote($('key-note'), 'Google says this key does not work. It was NOT saved. Copy it again and retry.', 'error');
    toast('This API key does not work', 'error');
    return;
  }
  store.key = key;
  $('key').value = '';
  showKey();
  $('key-card').open = false;
  if (check === 'offline') {
    setNote($('key-note'), `Saved (${maskKey(key)}), but Google could not be reached to test it.`, 'warn');
    toast('Key saved (not tested, no internet)', 'warn');
  } else {
    setNote($('key-note'), `New API key saved and working: ${maskKey(key)}`, 'ok');
    toast('New API key saved and working');
  }
});

// ---------- backup key (OpenRouter) ----------

function showBackup() {
  const key = store.backupKey;
  setNote($('backup-pill'), key ? maskKey(key) : 'Off', key ? 'ok' : '');
  $('remove-backup').disabled = !key;
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
  const check = await checkBackupKey(key);
  done();
  if (check === 'invalid') {
    setNote($('backup-note'), 'OpenRouter says this key does not work. It was NOT saved.', 'error');
    return;
  }
  store.backupKey = key;
  $('backup-key').value = '';
  showBackup();
  showKey();
  setNote($('backup-note'), check === 'offline'
    ? 'Saved, but OpenRouter could not be reached to test it.'
    : 'Backup key saved and working. It is used only when Google fails.', check === 'offline' ? 'warn' : 'ok');
  toast('Backup key saved');
});

$('remove-backup').addEventListener('click', () => {
  if (!confirm('Remove the OpenRouter backup key?')) return;
  store.backupKey = '';
  showBackup();
  showKey();
  setNote($('backup-note'), 'Backup key removed.', '');
});

// ---------- work profiles and their prompts ----------

const profileName = (id) => PROFILES.find((p) => p.id === id).name;

function showProfiles() {
  renderProfiles($('profiles'), PROFILES, store.profile, (id) => {
    store.profile = id;
    showProfiles();
    toast(`Writing as: ${profileName(id)}`);
  });
  $('prompt').value = store.prompt(store.profile);
  $('prompt-profile').textContent = profileName(store.profile);
}

// ---------- recent proposals ----------

function showHistory() {
  const list = store.history;
  renderHistory($('history'), list, PROFILES, (text) => {
    copyText(text);
    toast('Proposal copied');
  });
  $('history-pill').textContent = String(list.length);
}

$('clear-history').addEventListener('click', () => {
  if (!confirm('Delete the list of recent proposals?')) return;
  store.clearHistory();
  showHistory();
});

// ---------- writing proposals ----------

let busy = false;
async function write(jobText) {
  if (busy) return false;
  busy = true;
  const done = busyButton($('paste-write'), 'Writing proposal…');
  setNote($('status'), 'Writing… wait for “Proposal ready” before pasting.', 'working');
  try {
    const job = String(jobText || '').trim();
    if (!job && (store.key || store.backupKey)) throw new Error('No job post found in the clipboard. Copy the job post first, then try again.');
    $('job').value = job;
    const proposal = await generateProposal(job, store.key, {
      prompt: store.prompt(store.profile),
      backupKey: store.backupKey,
      onProgress: (text) => { $('result').value = text; }, // shows the proposal while it is written
    });
    $('result').value = proposal;
    copyText(proposal);
    store.remember(job, proposal, store.profile);
    showHistory();
    setNote($('status'), 'Proposal ready. It is copied—return to the job and paste it.', 'ok');
    toast('Proposal copied');
    return true;
  } catch (e) {
    const message = String(e?.message || 'Unknown error').trim();
    setNote($('status'), `Could not create a proposal: ${message}\nNo new proposal was copied. Check this message before pasting.`, 'error');
    toast(message, 'error');
    if (!store.key || /API key/i.test(message)) $('key-card').open = true;
    return false;
  } finally {
    busy = false;
    done();
  }
}

// Called by MainActivity when text comes from the bubble, "Write proposal" or Share.
// From the bubble, go straight back to the job page once the proposal is copied.
window.onJobText = async (text, fromBubble) => {
  $('job-card').open = true; // show what was read, so the user can check it
  const ok = await write(text);
  if (ok && fromBubble && window.Android) setTimeout(() => window.Android.backToJob(), 700);
};

$('paste-write').addEventListener('click', async () => write(await readClipboard()));
$('write').addEventListener('click', () => write($('job').value));
$('again').addEventListener('click', () => write($('job').value));
$('copy').addEventListener('click', () => {
  if (!$('result').value) return;
  copyText($('result').value);
  toast('Proposal copied');
});

// ---------- prompt ----------

$('save-prompt').addEventListener('click', () => {
  store.savePrompt(store.profile, $('prompt').value);
  $('prompt').value = store.prompt(store.profile);
  toast(`Prompt saved for ${profileName(store.profile)}.`);
});
$('reset-prompt').addEventListener('click', () => {
  if (!confirm(`Replace the ${profileName(store.profile)} prompt with the default one?`)) return;
  store.savePrompt(store.profile, '');
  $('prompt').value = store.prompt(store.profile);
  toast('Default prompt restored');
});

// ---------- floating bubble ----------

function refreshBubbleCard() {
  const supported = Boolean(window.Android?.isBubbleOn);
  if (!supported) {
    $('bubble-card')?.classList.add('hidden');
    return;
  }
  const on = window.Android.isBubbleOn();
  if ($('bubble-pill')) {
    setNote($('bubble-pill'), on ? 'Active' : 'Off', on ? 'ok' : '');
  }
}
$('bubble-settings').addEventListener('click', () => window.Android?.openBubbleSettings());
// Android 13+ blocks the bubble for apps not from the Play Store until this is allowed.
$('app-info').addEventListener('click', () => window.Android?.openAppInfo());
// Coming back to the app: refresh the bubble card and look for a new version.
window.onAppResumed = () => {
  refreshBubbleCard();
  if (!updateUrl) checkForUpdate();
};

// ---------- updates (newest release on GitHub) ----------

const RELEASES_API = 'https://api.github.com/repos/simplyzubair/Bidderr/releases/latest';
const installedVersion = window.Android?.version ? window.Android.version() : '';
let updateUrl = '';

function isNewer(latest, current) {
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

async function checkForUpdate() {
  const button = $('update');
  const title = $('update-title');
  const note = $('update-note');
  if (!installedVersion) {
    setNote(note, 'Could not read the installed version. Restart the app and try again.', 'error');
    return;
  }
  button.disabled = true;
  button.textContent = 'Checking...';
  setNote(note, '', '');
  try {
    const response = await fetch(RELEASES_API);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const release = await response.json();
    const latest = String(release.tag_name || '').replace(/^v/, '');
    const apk = (release.assets || []).find((a) => a.name.endsWith('.apk'));
    if (!latest || !apk) throw new Error('Release APK not found');
    if (!isNewer(latest, installedVersion)) {
      updateUrl = '';
      $('update-card').classList.remove('highlight');
      title.textContent = 'You\u2019re up to date';
      setNote(note, `Installed version ${installedVersion}. Latest version ${latest}.`, 'ok');
      button.textContent = 'Check again';
      return;
    }
    updateUrl = apk.browser_download_url;
    $('update-card').classList.add('highlight');
    title.textContent = `Update available: ${latest}`;
    setNote(note, `Installed version ${installedVersion}.`, '');
    button.textContent = 'Update now';
  } catch {
    title.textContent = 'Could not check for updates';
    setNote(note, 'Check your internet connection, then try again.', 'error');
    button.textContent = 'Try again';
  } finally {
    button.disabled = false;
  }
}

window.onUpdateStatus = (state) => {
  const messages = {
    downloading: ['Downloading the update...', ''],
    started: ['Tap Install on the next screen.', 'ok'],
    needs_permission: ['Turn on "Allow from this source", come back, then tap Update now again.', 'warn'],
    failed: ['The update did not download. Check your internet and try again.', 'error'],
  };
  const [text, kind] = messages[state] || ['', ''];
  setNote($('update-note'), text, kind);
  $('update').disabled = state === 'downloading';
};
$('update').addEventListener('click', () => {
  if (updateUrl) window.Android?.installUpdate(updateUrl);
  else checkForUpdate();
});

// ---------- start ----------

showProfiles();
showHistory();
showBackup();
$('version').textContent = installedVersion ? `Bidderr ${installedVersion} · updates from bidderr.skillsgeek.com` : 'Bidderr';
showKey();
refreshBubbleCard();
checkForUpdate();
