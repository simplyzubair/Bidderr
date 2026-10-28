const $ = (id) => document.getElementById(id);
const { toast, setNote, busyButton } = window.ui;

function showKey({ hasKey, maskedKey }) {
  setNote($('key-pill'), hasKey ? `Saved: ${maskedKey}` : 'No key', hasKey ? 'ok' : 'error');
  setNote($('ready-pill'), hasKey ? 'Ready' : 'Add API key', hasKey ? 'ok' : 'warn');
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

function showStatus({ text, lastProposal }) {
  const writing = /writing/.test(text);
  setNote($('status'), text, /copied/.test(text) ? 'ok' : writing ? '' : 'error');
  $('write').disabled = writing;
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

window.bidderr.getState().then((state) => {
  showKey(state);
  $('hotkey-warning').classList.toggle('hidden', state.hotkeyOk);
  $('last').value = state.lastProposal;
  $('footer').textContent = `Bidderr ${state.version} · updates install automatically`;
});
