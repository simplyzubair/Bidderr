// Closer content script: grabs the job text, shows the proposal panel, inserts into the cover letter box.
// Never clicks Submit. You always review and send yourself.
(() => {
  if (window.__closerLoaded) return;
  window.__closerLoaded = true;

  let host = null;
  let ui = null;
  let state = { mode: 'proposal', source: '', busy: false };
  let rememberedTarget = null;

  // ---------- reading the page ----------

  const JOB_SELECTORS = [
    '[data-test="Description"]',
    '[data-test="job-description-text"]',
    '[data-test="JobDescription"]',
    '.job-description',
    '[data-qa="job-description"]',
    '.project-details',
    '.project-description',
    '#project-description',
  ];

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  function getSelectionText() {
    const active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
      const { selectionStart: s, selectionEnd: e, value } = active;
      if (typeof s === 'number' && e > s) return value.slice(s, e);
    }
    return String(window.getSelection() || '').trim();
  }

  // No selection: find the job description on the page ourselves.
  function extractJobFromPage() {
    const scope = [...document.querySelectorAll('[role="dialog"], .air3-slider-content')].find(visible) || document;
    const parts = [];
    const title = scope.querySelector('h1, h2, [data-test="job-title"], header h4');
    if (title && visible(title)) parts.push(title.innerText.trim());
    for (const sel of JOB_SELECTORS) {
      const el = [...scope.querySelectorAll(sel)].find(visible);
      if (el && el.innerText.trim().length > 80) {
        parts.push(el.innerText.trim());
        const skills = scope.querySelector('[data-test="Skills"], .skills-list, [data-test="expertise"]');
        if (skills && visible(skills)) parts.push(`Skills:\n${skills.innerText.trim()}`);
        return parts.join('\n\n');
      }
    }
    const main = scope === document ? (document.querySelector('main, [role="main"]') || document.body) : scope;
    return main.innerText.trim().slice(0, 9000);
  }

  function isEditable(el) {
    return el && (el.tagName === 'TEXTAREA' || el.isContentEditable || (el.tagName === 'INPUT' && el.type === 'text'));
  }

  function findCoverLetterBox() {
    if (rememberedTarget && document.contains(rememberedTarget) && visible(rememberedTarget)) return rememberedTarget;
    const preferred = document.querySelector(
      'textarea[aria-labelledby*="cover" i], textarea[name*="cover" i], textarea[id*="cover" i], .cover-letter-area textarea, textarea[name*="proposal" i], textarea[name*="description" i]'
    );
    if (preferred && visible(preferred)) return preferred;
    // Otherwise the biggest visible textarea / editor outside our own panel.
    const candidates = [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter(visible);
    candidates.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
    return candidates[0] || null;
  }

  function insertInto(el, text) {
    if (!el) return false;
    el.focus();
    if (el.isContentEditable) {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
      return true;
    }
    // Set value through the native setter so React/Vue forms register the change.
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  // ---------- panel ----------

  const CSS = `
    :host { all: initial; }
    .panel { position: fixed; right: 18px; bottom: 18px; width: 420px; max-width: calc(100vw - 36px);
      background: #0f172a; color: #e2e8f0; border: 1px solid #334155; border-radius: 12px;
      box-shadow: 0 20px 50px rgba(0,0,0,.45); font: 13px/1.45 system-ui, -apple-system, Segoe UI, sans-serif;
      z-index: 2147483647; display: flex; flex-direction: column; overflow: hidden; }
    .head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: #111c33; border-bottom: 1px solid #1e293b; cursor: move; }
    .logo { font-weight: 700; color: #38bdf8; }
    .status { flex: 1; color: #94a3b8; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .x { background: none; border: 0; color: #94a3b8; font-size: 16px; cursor: pointer; padding: 0 4px; }
    .chips { display: flex; flex-wrap: wrap; gap: 5px; padding: 8px 12px 0; }
    .chip { font-size: 11px; padding: 2px 7px; border-radius: 99px; background: #1e293b; color: #cbd5e1; }
    .chip.warn { background: #422006; color: #fbbf24; }
    textarea { margin: 8px 12px; min-height: 210px; max-height: 50vh; resize: vertical; background: #020617; color: #f1f5f9;
      border: 1px solid #1e293b; border-radius: 8px; padding: 10px; font: 13.5px/1.5 system-ui, Segoe UI, sans-serif; outline: none; }
    textarea:focus { border-color: #38bdf8; }
    .meta { display: flex; justify-content: space-between; padding: 0 12px; color: #64748b; font-size: 11px; }
    .row { display: flex; gap: 6px; padding: 10px 12px 12px; flex-wrap: wrap; }
    button.b { flex: 1; min-width: 70px; border: 1px solid #334155; background: #1e293b; color: #e2e8f0; border-radius: 7px;
      padding: 7px 8px; font: 600 12px system-ui, Segoe UI, sans-serif; cursor: pointer; }
    button.b:hover { background: #273449; }
    button.b:disabled { opacity: .5; cursor: default; }
    button.primary { background: #0284c7; border-color: #0284c7; color: white; }
    button.primary:hover { background: #0369a1; }
    .err { color: #fca5a5; padding: 6px 12px 0; font-size: 12px; }
    .err a { color: #7dd3fc; cursor: pointer; text-decoration: underline; }
    .spin { display: inline-block; width: 10px; height: 10px; border: 2px solid #38bdf8; border-right-color: transparent; border-radius: 50%; animation: s .7s linear infinite; margin-right: 6px; vertical-align: -1px; }
    @keyframes s { to { transform: rotate(360deg); } }
    kbd { font: 10px ui-monospace, monospace; background: #1e293b; border-radius: 3px; padding: 0 3px; color: #94a3b8; }
  `;

  function ensurePanel() {
    if (host && document.contains(host)) return ui;
    host = document.createElement('closer-panel');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${CSS}</style>
      <div class="panel" part="panel">
        <div class="head"><span class="logo">Closer</span><span class="status"></span><button class="x" title="Close (Esc)">✕</button></div>
        <div class="chips"></div>
        <div class="err" hidden></div>
        <textarea spellcheck="true" placeholder="Your proposal will appear here..."></textarea>
        <div class="meta"><span class="words"></span><span><kbd>Ctrl+Enter</kbd> insert · <kbd>Esc</kbd> close</span></div>
        <div class="row">
          <button class="b primary" data-act="insert">Insert</button>
          <button class="b" data-act="copy">Copy</button>
          <button class="b" data-act="shorter">Shorter</button>
          <button class="b" data-act="different">New angle</button>
        </div>
      </div>`;
    document.documentElement.appendChild(host);

    const $ = (s) => root.querySelector(s);
    ui = {
      root, panel: $('.panel'), status: $('.status'), chips: $('.chips'), err: $('.err'),
      text: $('textarea'), words: $('.words'), buttons: [...root.querySelectorAll('button.b')],
    };

    $('.x').onclick = closePanel;
    ui.text.addEventListener('input', updateWords);
    ui.text.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePanel();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); act('insert'); }
      e.stopPropagation(); // keep the site's own hotkeys out of our textarea
    });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (b) act(b.dataset.act);
      if (e.target.matches('a[data-act="options"]')) chrome.runtime.sendMessage({ type: 'open-options' });
    });
    makeDraggable($('.head'), ui.panel);
    return ui;
  }

  function makeDraggable(handle, panel) {
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const r = panel.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (ev) => {
        panel.style.left = `${Math.max(0, ev.clientX - dx)}px`;
        panel.style.top = `${Math.max(0, ev.clientY - dy)}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    });
  }

  function closePanel() {
    host?.remove();
    host = null;
    ui = null;
  }

  function setStatus(html) { if (ui) ui.status.innerHTML = html; }
  function setBusy(b) {
    state.busy = b;
    ui?.buttons.forEach((x) => (x.disabled = b));
    if (ui) ui.text.disabled = b;
  }
  function updateWords() {
    const n = ui.text.value.trim() ? ui.text.value.trim().split(/\s+/).length : 0;
    ui.words.textContent = `${n} words · ${ui.text.value.length} chars`;
  }
  function showError(msg) {
    ui.err.hidden = false;
    ui.err.innerHTML = '';
    ui.err.append(msg + ' ');
    if (/api key|401|403|permission|invalid/i.test(msg)) {
      const a = document.createElement('a');
      a.dataset.act = 'options';
      a.textContent = 'Open settings';
      ui.err.append(a);
    }
  }

  function renderChips(a) {
    ui.chips.innerHTML = '';
    const add = (t, warn) => {
      const c = document.createElement('span');
      c.className = `chip${warn ? ' warn' : ''}`;
      c.textContent = t;
      ui.chips.append(c);
    };
    if (!a) return;
    if (a.platform !== 'generic') add(a.platform === 'upwork' ? 'Upwork' : 'PeopleperHour');
    if (a.mustFollow.length) add(`⚑ ${a.mustFollow.length} hidden instruction${a.mustFollow.length > 1 ? 's' : ''} followed`, true);
    if (a.questions.length) add(`${a.questions.length} question${a.questions.length > 1 ? 's' : ''} answered`);
    if (a.budgetHint) add(a.budgetHint.slice(0, 30));
  }

  // ---------- actions ----------

  async function generate(mode, sourceText, variant = '') {
    ensurePanel();
    ui.err.hidden = true;
    state.mode = mode;
    state.source = sourceText;
    setBusy(true);
    setStatus(`<span class="spin"></span>${variant ? 'Rewriting' : mode === 'reply' ? 'Writing reply' : 'Writing proposal'}...`);

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'generate', mode, text: sourceText, url: location.href, variant });
    } catch (e) {
      res = { ok: false, error: 'Extension was reloaded. Refresh this page and try again.' };
    }
    setBusy(false);
    if (!res?.ok) {
      setStatus('Failed');
      showError(res?.error || 'Unknown error');
      return;
    }

    ui.text.value = res.text;
    updateWords();
    renderChips(res.analysis);

    const notes = [];
    if (res.autoCopy && (await copy(res.text))) notes.push('copied');
    const box = mode === 'proposal' && res.autoInsert ? findCoverLetterBox() : null;
    if (box && insertInto(box, res.text)) notes.push('inserted into the form');
    setStatus(`Ready${notes.length ? ` · ${notes.join(', ')}` : ''}. Review, then submit yourself.`);
    ui.text.focus();
  }

  async function act(name) {
    if (!ui || state.busy) return;
    const text = ui.text.value;
    if (name === 'copy') {
      setStatus((await copy(text)) ? 'Copied to clipboard.' : 'Copy failed.');
    } else if (name === 'insert') {
      const box = findCoverLetterBox();
      if (box && insertInto(box, text)) setStatus('Inserted. Review it and submit yourself.');
      else { await copy(text); setStatus('No text box found on this page. Copied instead.'); }
    } else if (name === 'shorter' || name === 'different') {
      if (state.source) generate(state.mode, state.source, name);
    }
  }

  async function run(mode, givenText) {
    const active = document.activeElement;
    // If you're sitting in the cover letter box when you press the key, that's where it goes.
    if (isEditable(active) && !host?.contains(active)) rememberedTarget = active;

    let text = (givenText || getSelectionText()).trim();
    if (!text && mode === 'proposal') text = extractJobFromPage();
    if (!text) {
      ensurePanel();
      setStatus('Select the client message first, then press the shortcut.');
      return;
    }
    generate(mode, text);
  }

  async function insertLast() {
    const last = await chrome.runtime.sendMessage({ type: 'get-last' });
    ensurePanel();
    if (!last?.text) { setStatus('No proposal yet.'); return; }
    ui.text.value = last.text;
    updateWords();
    const box = findCoverLetterBox();
    setStatus(box && insertInto(box, last.text) ? 'Inserted last proposal. Review, then submit yourself.' : 'Loaded last proposal. No text box found.');
  }

  addEventListener('keydown', (e) => { if (e.key === 'Escape' && host) closePanel(); });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'run') run(msg.mode, msg.text);
    if (msg.type === 'insert-last') insertLast();
  });

  // On an Upwork / PPH proposal form, offer the proposal you just wrote on the job page.
  async function offerSavedProposal() {
    if (!/\/(proposals\/job|apply|bid|proposal)/i.test(location.pathname)) return;
    let last;
    try { last = await chrome.runtime.sendMessage({ type: 'get-last' }); } catch { return; }
    if (!last?.text || last.mode !== 'proposal' || Date.now() - last.at > 30 * 60 * 1000) return;
    setTimeout(() => {
      if (host) return;
      ensurePanel();
      ui.text.value = last.text;
      updateWords();
      setStatus('Your proposal from the job page. Press Insert.');
    }, 1500);
  }
  offerSavedProposal();
  // Upwork is a single-page app, so watch for in-app navigation too.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      offerSavedProposal();
    }
  }, 1000);
})();
