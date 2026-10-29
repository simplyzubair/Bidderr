// Small UI helpers shared by both apps (plain script, exposes window.ui).
(function () {
  let toastEl = null;
  let timer = null;

  // ui.toast('New API key saved', 'ok' | 'error' | 'warn')
  function toast(message, kind = 'ok') {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.className = `toast ${kind}`;
    toastEl.replaceChildren();
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.textContent = kind === 'ok' ? '✓' : '!';
    const text = document.createElement('span');
    text.textContent = message;
    toastEl.append(dot, text);
    requestAnimationFrame(() => toastEl.classList.add('show'));
    clearTimeout(timer);
    timer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  // Sets a .note or .pill element's text and colour.
  function setNote(el, text, kind = '') {
    el.textContent = text;
    el.className = `${el.classList.contains('pill') ? 'pill' : 'note'} ${kind}`.trim();
  }

  // Puts a spinner + label on a button while work runs.
  function busyButton(button, label) {
    const old = button.textContent;
    button.disabled = true;
    button.replaceChildren();
    const spin = document.createElement('span');
    spin.className = 'spinner';
    button.append(spin, document.createTextNode(label));
    return () => {
      button.disabled = false;
      button.textContent = old;
    };
  }

  // Sounds live next to this script: shared/sounds/<name>.wav.
  const soundBase = new URL('sounds/', document.currentScript.src).href;
  const sounds = {};

  // ui.sound('writing') or ui.sound('done'). Never throws; a muted device just stays quiet.
  function sound(name) {
    try {
      sounds[name] = sounds[name] || new Audio(`${soundBase}${name}.wav`);
      sounds[name].currentTime = 0;
      sounds[name].play().catch(() => {});
    } catch {
      // no audio available
    }
  }

  // Updates a bubble (see shared/bubble.css): state is offer | writing | paste | done | error.
  function setBubble(el, state, label, sub = '') {
    el.className = `bubble ${state}`;
    el.querySelector('.label').textContent = label;
    el.querySelector('.sub').textContent = sub;
    el.setAttribute('aria-label', sub ? `${label}. ${sub}` : label);
  }

  // Radio buttons for the work profiles. profiles: [{ id, name }]. onPick(id) when one is chosen.
  function renderProfiles(container, profiles, current, onPick) {
    container.replaceChildren(...profiles.map(({ id, name }) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'profile';
      input.value = id;
      input.checked = id === current;
      input.addEventListener('change', () => input.checked && onPick(id));
      label.append(input, document.createTextNode(name));
      return label;
    }));
  }

  // The recent proposals list. entries: [{ time, profile, job, proposal }]. onCopy(text) on Copy.
  function renderHistory(list, entries, profiles, onCopy) {
    const names = Object.fromEntries(profiles.map((p) => [p.id, p.name]));
    list.replaceChildren(...entries.map((entry) => {
      const li = document.createElement('li');
      const what = document.createElement('div');
      what.className = 'what';
      const when = document.createElement('div');
      when.className = 'when';
      when.textContent = `${new Date(entry.time).toLocaleString()} · ${names[entry.profile] || ''}`;
      const job = document.createElement('div');
      job.className = 'job';
      job.textContent = entry.job || '(no job text)';
      job.title = entry.proposal;
      what.append(when, job);
      const copy = document.createElement('button');
      copy.className = 'btn ghost sm';
      copy.textContent = 'Copy';
      copy.addEventListener('click', () => onCopy(entry.proposal));
      li.append(what, copy);
      return li;
    }));
  }

  // Turns a key press into a shortcut like "Ctrl+Alt+B" ('' while only Ctrl/Alt/Shift are held).
  function shortcutFromKey(e) {
    let key = '';
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
    else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)) key = e.code;
    if (!key) return '';
    return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', key].filter(Boolean).join('+');
  }

  window.ui = { toast, setNote, busyButton, sound, setBubble, renderProfiles, renderHistory, shortcutFromKey };
})();
