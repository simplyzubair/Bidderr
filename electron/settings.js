const $ = (id) => document.getElementById(id);

function showKeyState(hasKey) {
  $('key-state').textContent = hasKey ? 'Key saved. You are ready.' : 'No key saved yet.';
  $('key-state').className = `status ${hasKey ? 'ok' : 'error'}`;
}

function showStatus({ text, lastProposal }) {
  $('status').textContent = text;
  $('status').className = `status ${/copied/.test(text) ? 'ok' : /writing/.test(text) ? '' : 'error'}`;
  $('write').disabled = /writing/.test(text);
  if (lastProposal) $('last').value = lastProposal;
}

$('save').addEventListener('click', async () => {
  showKeyState(await window.bidderr.saveKey($('key').value));
  $('key').value = '';
});

$('write').addEventListener('click', () => window.bidderr.writeNow());

window.bidderr.onStatus(showStatus);

let defaultPrompt = '';
function promptSaved(text) {
  $('prompt-status').textContent = text;
  $('prompt-status').className = 'status ok';
}

$('save-prompt').addEventListener('click', async () => {
  $('prompt').value = await window.bidderr.savePrompt($('prompt').value);
  promptSaved('Prompt saved. The next proposal will use it.');
});

$('reset-prompt').addEventListener('click', async () => {
  if (!confirm('Replace your prompt with the default one?')) return;
  $('prompt').value = await window.bidderr.savePrompt(defaultPrompt);
  promptSaved('Default prompt restored.');
});

window.bidderr.getPrompt().then(({ prompt, defaultPrompt: d }) => {
  defaultPrompt = d;
  $('prompt').value = prompt;
});

window.bidderr.getState().then(({ hasKey, hotkeyOk, lastProposal }) => {
  showKeyState(hasKey);
  $('hotkey-warning').classList.toggle('hidden', hotkeyOk);
  $('last').value = lastProposal;
});
