// Floating writer (WriterActivity). Same engine, key and prompt as the main app page.
const { generateProposal, DEFAULT_PROMPT } = window.Bidderr;
const { setBubble, sound } = window.ui;
const bubble = document.getElementById('bubble');
const android = window.Android;

const store = {
  key: () => localStorage.getItem('bidderr.key') || '',
  prompt: () => localStorage.getItem('bidderr.prompt') || DEFAULT_PROMPT,
};

let state = 'writing';
let closeTimer = null;

function closeIn(ms) {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => android?.close(), ms);
}

function show(newState, label, sub) {
  state = newState;
  setBubble(bubble, newState, label, sub);
}

// Called by WriterActivity with the selected (or screen) text.
window.startWriting = async (text) => {
  clearTimeout(closeTimer);
  const job = String(text || '').trim();
  document.getElementById('read').textContent = job ? `Read: ${job.replace(/\s+/g, ' ').slice(0, 70)}` : '';
  show('writing', 'Writing proposal...', 'A few seconds');
  sound('writing');
  android?.bubble('writing', '');
  try {
    const proposal = await generateProposal(job, store.key(), { prompt: store.prompt() });
    android?.copy(proposal);
    sound('done');
    android?.bubble('ready', proposal);
    const hint = android?.isBubbleOn() ? 'Tap the proposal box, then the Paste bubble' : 'Long-press the proposal box, then Paste';
    show('paste', 'Proposal copied', hint);
    closeIn(3500);
  } catch (e) {
    android?.bubble('idle', '');
    show('error', 'Could not write it', e.message);
    closeIn(10000);
  }
};

// Tap: on an API key problem open the app to fix it; otherwise just close the bubble.
bubble.addEventListener('click', () => {
  if (state === 'writing') return;
  if (state === 'error' && /API key/.test(bubble.querySelector('.sub').textContent)) android?.openApp();
  else android?.close();
});
