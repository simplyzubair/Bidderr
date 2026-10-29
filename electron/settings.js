const $ = (id) => document.getElementById(id);
const { toast, setNote, busyButton } = window.ui;

function showKey({ hasKey, maskedKey }) {
  setNote($('key-pill'), hasKey ? `Saved: ${maskedKey}` : 'No key', hasKey ? 'ok' : 'error');
  setNote($('ready-pill'), hasKey ? 'Ready' : 'Setup needed', hasKey ? 'ok' : 'warn');
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

$('write').addEventListener('click', () => window.bidderr.writeNow());
$('copy-last').addEventListener('click', async () => {
  if (!$('last').value) return;
  await window.bidderr.copyText($('last').value);
  toast('Proposal copied');
});

// ---------- prompt ----------

let defaultPrompt = '';

$('save-prompt').addEventListener('click', async () => {
  $('prompt').value = await window.bidderr.savePrompt($('prompt').value);
  toast('Prompt saved. The next proposal uses it.');
});

$('reset-prompt').addEventListener('click', async () => {
  if (!confirm('Replace your prompt with the default one?')) return;
  $('prompt').value = await window.bidderr.savePrompt(defaultPrompt);
  toast('Default prompt restored');
});

window.bidderr.getPrompt().then(({ prompt, defaultPrompt: d }) => {
  defaultPrompt = d;
  $('prompt').value = prompt;
});

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
  toast(on ? 'The bubble will show when you select text' : 'Bubble off. Use Ctrl+Shift+1 instead.');
});
window.bidderr.onSelectionBubble((on) => {
  $('selection-bubble').checked = on;
});

window.bidderr.getState().then((state) => {
  currentVersion = state.version;
  $('selection-bubble').checked = state.selectionBubble;
  showUpdate(state.update);
  showKey(state);
  $('hotkey-warning').classList.toggle('hidden', state.hotkeyOk);
  $('last').value = state.lastProposal;
  $('footer').textContent = `Bidderr ${state.version} · one-click updates`;
});
