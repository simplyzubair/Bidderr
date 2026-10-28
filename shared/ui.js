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

  window.ui = { toast, setNote, busyButton };
})();
