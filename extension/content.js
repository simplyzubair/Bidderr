// PPH Bidderr on PeoplePerHour job pages: when the proposal box opens, read the whole job page,
// write the proposal (in background.js) and put it in the box. It never presses Send.
(() => {
  // PPH job page (checked 2026-11-11): the proposal form sits at the bottom of the job page.
  const PPH_BOX = '#stream-message-box textarea';
  const PPH_JOB = '.main-content.controller-job';
  const MAX_CHARS = 8000; // PPH refuses longer proposals
  const written = new WeakSet(); // boxes already filled, so we never overwrite the user's edits
  let running = false;
  let badge = null;

  // Small status box in the bottom-right corner. Only textContent, never page HTML.
  function status(text, kind = 'working') {
    if (!badge) {
      badge = document.createElement('div');
      badge.setAttribute('role', 'status');
      Object.assign(badge.style, {
        position: 'fixed', right: '16px', bottom: '16px', zIndex: 2147483647, maxWidth: '320px',
        padding: '10px 14px', borderRadius: '12px', font: '14px/1.4 system-ui, sans-serif',
        color: '#fff', boxShadow: '0 6px 24px rgba(0,0,0,.25)', cursor: 'pointer',
      });
      badge.title = 'PPH Bidderr: click to hide';
      badge.addEventListener('click', () => { badge.style.display = 'none'; });
      document.documentElement.append(badge);
    }
    badge.style.display = 'block';
    badge.style.background = { working: '#1f6feb', ok: '#1a7f37', error: '#cf222e' }[kind];
    badge.textContent = `PPH Bidderr: ${text}`;
  }

  const usable = (el) => el && el.offsetParent !== null && el.getBoundingClientRect().height > 30
    && !el.disabled && !el.readOnly;

  // The proposal box once it is open. guess: also take any open text box on the job page
  // (shortcut: only when the user presses the popup button, never in auto mode, in case PPH renames it).
  function findBox({ guess = false } = {}) {
    const box = document.querySelector(PPH_BOX);
    if (usable(box)) return box;
    return guess ? [...document.querySelectorAll('textarea')].find(usable) || null : null;
  }

  // "Copy all page": the whole job part of the page (title, description, budget, skills,
  // client info), or the whole page if PPH changes its layout.
  function pageText() {
    const main = document.querySelector(PPH_JOB) || document.querySelector('main') || document.body;
    return main.innerText.replace(/\n{3,}/g, '\n\n').trim();
  }

  // Native setter (works for React too) plus the events PPH's jQuery form listens to.
  function fill(el, text) {
    el.focus();
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, text);
    for (const type of ['input', 'keyup', 'change']) el.dispatchEvent(new Event(type, { bubbles: true }));
  }

  // The "Proposal Breakdown" boxes: ITEM gets the job title, AMOUNT the price from the proposal
  // (the proposal only has one when the job states a fixed budget). Boxes the user already
  // filled are left alone. Deposit stays the user's choice.
  function fillBreakdown(box, proposal) {
    const form = box.closest('form') || document;
    const empty = (selector) => {
      const el = form.querySelector(selector);
      return el && el.offsetParent !== null && !el.disabled && !el.readOnly && !el.value.trim() ? el : null;
    };
    const item = empty('input.fixed-description, input[placeholder="enter description"]');
    const title = document.querySelector('h1')?.innerText.trim();
    if (item && title) fill(item, title.slice(0, item.maxLength > 0 ? item.maxLength : 40));
    // NFKC turns the proposal's Unicode-bold "Price: $50" back into plain letters and digits.
    const price = proposal.normalize('NFKC').match(/Price:\s*[$£€]\s*(\d+(?:\.\d{1,2})?)/i)?.[1];
    const amount = empty('input.fixed-cost');
    if (amount && price) fill(amount, price);
  }

  function write(box) {
    if (running) return Promise.resolve({ ok: false, text: 'Already writing, wait a moment.' });
    running = true;
    written.add(box);
    status('Writing your proposal...');
    return new Promise((resolve) => {
      const port = chrome.runtime.connect({ name: 'write' });
      const finish = (result) => {
        running = false;
        port.disconnect();
        resolve(result);
      };
      port.onMessage.addListener(({ progress, proposal, error }) => {
        if (progress) status(`Writing... ${progress.split(/\s+/).length} words`);
        if (proposal) {
          fill(box, proposal.slice(0, MAX_CHARS));
          fillBreakdown(box, proposal);
          status('Proposal ready. Check the text, item and amount, then press Send yourself.', 'ok');
          finish({ ok: true, text: 'Proposal written into the box.' });
        }
        if (error) {
          written.delete(box);
          status(`${error} Click the extension icon to fix it.`, 'error');
          finish({ ok: false, text: error });
        }
      });
      port.onDisconnect.addListener(() => {
        if (running) finish({ ok: false, text: 'Stopped.' });
      });
      port.postMessage({ job: pageText() });
    });
  }

  // Auto mode: write once for each newly opened, empty proposal box.
  async function check() {
    if (running) return;
    const box = findBox();
    if (!box || written.has(box) || box.value.trim()) return;
    const { auto = true } = await chrome.storage.local.get('auto');
    if (auto) write(box);
  }

  // The form opens in place (no page load) when the user clicks "Send Proposal". One cheap
  // look per second catches it however PPH shows it.
  setInterval(check, 1000);

  // The popup's "Write proposal on this page" button: write again even if the box has text.
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg?.type !== 'write-now' || sender.id !== chrome.runtime.id) return false;
    const box = findBox({ guess: true });
    if (!box) {
      reply({ ok: false, text: 'No proposal box yet. Click "Send Proposal" on the job first.' });
      return false;
    }
    write(box).then(reply);
    return true; // the reply comes later
  });
})();
