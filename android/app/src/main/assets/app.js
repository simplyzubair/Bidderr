// Bidderr Android page. window.Bidderr is the shared engine (proposal.js),
// window.Android is the clipboard bridge from MainActivity.java.
const $ = (id) => document.getElementById(id);
const { generateProposal, DEFAULT_PROMPT } = window.Bidderr;
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

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = `status ${kind}`;
}

function showKeyCard(show) {
  $('key-card').classList.toggle('hidden', !show);
  $('key-state').textContent = store.key ? 'Key saved.' : 'No key saved yet.';
  $('key-state').className = `status ${store.key ? 'ok' : 'error'}`;
}

let busy = false;
async function write(jobText) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  setStatus('Writing your proposal...');
  try {
    $('job').value = jobText;
    const proposal = await generateProposal(jobText, store.key, { prompt: store.prompt });
    $('result').value = proposal;
    copyText(proposal);
    setStatus('Done! The proposal is copied. Go back and paste it.', 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
    if (!store.key || /API key/.test(e.message)) showKeyCard(true);
  } finally {
    busy = false;
    document.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  }
}

// Called by MainActivity when text comes from "Write proposal" or Share.
window.onJobText = (text) => write(text);

$('paste-write').addEventListener('click', async () => write(await readClipboard()));
$('write').addEventListener('click', () => write($('job').value));
$('again').addEventListener('click', () => write($('job').value));
$('copy').addEventListener('click', () => {
  copyText($('result').value);
  setStatus('Copied.', 'ok');
});

$('save-key').addEventListener('click', () => {
  store.key = $('key').value.trim();
  $('key').value = '';
  showKeyCard(!store.key);
  setStatus(store.key ? 'Key saved. You are ready.' : 'Please paste a key.', store.key ? 'ok' : 'error');
});
$('change-key').addEventListener('click', () => {
  showKeyCard(true);
  $('key').focus();
});

$('save-prompt').addEventListener('click', () => {
  store.prompt = $('prompt').value.trim();
  $('prompt').value = store.prompt;
  $('prompt-status').textContent = 'Prompt saved. The next proposal will use it.';
  $('prompt-status').className = 'status ok';
});
$('reset-prompt').addEventListener('click', () => {
  if (!confirm('Replace your prompt with the default one?')) return;
  store.prompt = DEFAULT_PROMPT;
  $('prompt').value = DEFAULT_PROMPT;
  $('prompt-status').textContent = 'Default prompt restored.';
  $('prompt-status').className = 'status ok';
});

$('prompt').value = store.prompt;
showKeyCard(!store.key);
