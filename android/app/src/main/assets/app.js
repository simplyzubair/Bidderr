// Bidderr Android page. window.Bidderr is the shared engine (proposal.js), window.ui the shared
// UI helpers (ui.js), window.Android the bridge from MainActivity.java.
const $ = (id) => document.getElementById(id);
const { generateProposal, checkApiKey, maskKey, DEFAULT_PROMPT } = window.Bidderr;
const { toast, setNote, busyButton } = window.ui;

const store = {
  get key() { return localStorage.getItem('bidderr.key') || ''; },
  set key(v) { localStorage.setItem('bidderr.key', v); },
  get prompt() { return localStorage.getItem('bidderr.prompt') || DEFAULT_PROMPT; },
  set prompt(v) { localStorage.setItem('bidderr.prompt', v === DEFAULT_PROMPT ? '' : v); },
};

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
  setNote($('ready-pill'), has ? 'Ready' : 'Add API key', has ? 'ok' : 'warn');
  if (!has) $('key-card').open = true;
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
  if (check === 'offline') {
    setNote($('key-note'), `Saved (${maskKey(key)}), but Google could not be reached to test it.`, 'warn');
    toast('Key saved (not tested, no internet)', 'warn');
  } else {
    setNote($('key-note'), `New API key saved and working: ${maskKey(key)}`, 'ok');
    toast('New API key saved and working');
  }
});

// ---------- writing proposals ----------

let busy = false;
async function write(jobText) {
  if (busy) return false;
  busy = true;
  const done = busyButton($('paste-write'), 'Writing your proposal...');
  setNote($('status'), '');
  try {
    $('job').value = jobText;
    const proposal = await generateProposal(jobText, store.key, { prompt: store.prompt });
    $('result').value = proposal;
    copyText(proposal);
    setNote($('status'), 'Done! The proposal is copied. Go back and paste it.', 'ok');
    toast('Proposal copied');
    return true;
  } catch (e) {
    setNote($('status'), e.message, 'error');
    toast(e.message, 'error');
    if (!store.key || /API key/.test(e.message)) $('key-card').open = true;
    return false;
  } finally {
    busy = false;
    done();
  }
}

// Called by MainActivity when text comes from the bubble, "Write proposal" or Share.
// From the bubble, go straight back to the job page once the proposal is copied.
window.onJobText = async (text, fromBubble) => {
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
  store.prompt = $('prompt').value.trim();
  $('prompt').value = store.prompt;
  toast('Prompt saved. The next proposal uses it.');
});
$('reset-prompt').addEventListener('click', () => {
  if (!confirm('Replace your prompt with the default one?')) return;
  store.prompt = DEFAULT_PROMPT;
  $('prompt').value = DEFAULT_PROMPT;
  toast('Default prompt restored');
});

// ---------- floating bubble ----------

function refreshBubbleCard() {
  const supported = Boolean(window.Android?.isBubbleOn);
  $('bubble-card').classList.toggle('hidden', !supported || window.Android.isBubbleOn());
}
$('bubble-settings').addEventListener('click', () => window.Android?.openBubbleSettings());
window.onAppResumed = refreshBubbleCard;

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
  if (!installedVersion) return;
  try {
    const release = await (await fetch(RELEASES_API)).json();
    const latest = String(release.tag_name || '').replace(/^v/, '');
    const apk = (release.assets || []).find((a) => a.name.endsWith('.apk'));
    if (!latest || !apk || !isNewer(latest, installedVersion)) return;
    updateUrl = apk.browser_download_url;
    $('update-title').textContent = `Update available: ${latest}`;
    $('update-card').classList.remove('hidden');
  } catch {
    // Offline: try again next time the app opens.
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
$('update').addEventListener('click', () => window.Android?.installUpdate(updateUrl));

// ---------- start ----------

$('prompt').value = store.prompt;
$('version').textContent = installedVersion ? `Bidderr ${installedVersion} · updates from bidderr.skillsgeek.com` : 'Bidderr';
showKey();
refreshBubbleCard();
checkForUpdate();
