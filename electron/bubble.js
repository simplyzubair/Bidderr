const bubble = document.getElementById('bubble');
const ring = document.getElementById('ring');
const ringLabel = document.getElementById('ring-label');

// The main process tells the bubble what to show; sounds play here (the bubble has audio).
// Only the icon is visible; the words become the hover tooltip.
window.bidderr.onBubble(({ state, label, sub, sound }) => {
  bubble.className = `mini ${state}`;
  bubble.title = sub ? `${label}\n${sub}` : label;
  bubble.setAttribute('aria-label', bubble.title);
  if (sound) window.ui.sound(sound);
  // Tell the main process our size, so the window fits the icon exactly.
  requestAnimationFrame(() => {
    const r = bubble.getBoundingClientRect();
    window.bidderr.bubbleSize(Math.ceil(r.width) + 24, Math.ceil(r.height) + 24);
  });
});
window.bidderr.onBubbleSound((sound) => window.ui.sound(sound));

// A drag (more than a few pixels) moves the bubble and pins it there; a plain click is a click.
let drag = null;
let skipClick = false;

bubble.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  drag = { x: e.screenX, y: e.screenY, moving: false };
  bubble.setPointerCapture(e.pointerId);
});
bubble.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moving && Math.hypot(e.screenX - drag.x, e.screenY - drag.y) > 5) {
    drag.moving = true;
    window.bidderr.bubbleDrag('start', drag.x, drag.y);
  }
  if (drag.moving) window.bidderr.bubbleDrag('move', e.screenX, e.screenY);
});
bubble.addEventListener('pointerup', (e) => {
  if (drag?.moving) {
    window.bidderr.bubbleDrag('end', e.screenX, e.screenY);
    skipClick = true;
  }
  drag = null;
});

bubble.addEventListener('click', () => {
  if (skipClick) {
    skipClick = false;
    return;
  }
  window.bidderr.bubbleClicked();
});
bubble.addEventListener('mouseenter', () => window.bidderr.bubbleHover(true));
bubble.addEventListener('mouseleave', () => window.bidderr.bubbleHover(false));

// ---------- the action ring (right-click) ----------

bubble.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.bidderr.ringOpen();
});

// Name of each button, from what is going on right now. Off buttons stay visible but greyed.
function ringButtons({ busy, pinned, snoozed, hasProposal, bubbleHotkey }) {
  return {
    stop: { label: busy ? 'Stop writing' : 'Stop (nothing is being written)', short: 'Stop', off: !busy },
    copy: { label: hasProposal ? 'Copy the last proposal again' : 'No proposal yet', short: 'Copy again', off: !hasProposal },
    settings: { label: 'Open Bidderr', short: 'Open' },
    pin: pinned
      ? { label: 'Unpin: show it next to the mouse again', short: 'Unpin', icon: 'unpin' }
      : { label: 'Pin the bubble here (or drag it)', short: 'Pin here', icon: 'pin' },
    restart: { label: 'Restart Bidderr', short: 'Restart' },
    quit: { label: 'Quit Bidderr', short: 'Quit' },
    hide: { label: `Hide the bubble (${bubbleHotkey} shows it again)`, short: 'Hide' },
    snooze: snoozed
      ? { label: 'Bring the bubble back now', short: 'Resume' }
      : { label: 'Pause the bubble for 30 minutes', short: 'Pause 30m' },
  };
}

let closeTimer = null;

window.bidderr.onRing((data) => {
  clearTimeout(closeTimer);
  ringLabel.textContent = '';
  if (!data.open) {
    ring.hidden = true;
    document.body.classList.remove('ring-open');
    return;
  }
  const buttons = ringButtons(data);
  for (const el of ring.querySelectorAll('button[data-action]')) {
    const info = buttons[el.dataset.action];
    el.title = info.label;
    el.setAttribute('aria-label', info.label);
    el.dataset.short = info.short;
    el.classList.toggle('off', Boolean(info.off));
    el.setAttribute('aria-disabled', String(Boolean(info.off)));
    if (info.icon) el.firstElementChild.className = `ico ico-${info.icon}`;
  }
  document.body.classList.add('ring-open');
  ring.hidden = false;
});

ring.addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (!button) return;
  if (button.id === 'ring-close') window.bidderr.ringClose();
  else if (!button.classList.contains('off')) window.bidderr.ringAction(button.dataset.action);
});
ring.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.bidderr.ringClose();
});
ring.addEventListener('mouseover', (e) => {
  const button = e.target.closest('button');
  ringLabel.textContent = button ? button.dataset.short || 'Close' : '';
});

// The ring closes a moment after the mouse leaves it.
document.documentElement.addEventListener('mouseleave', () => {
  if (ring.hidden) return;
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => window.bidderr.ringClose(), 600);
});
document.documentElement.addEventListener('mouseenter', () => clearTimeout(closeTimer));
