const bubble = document.getElementById('bubble');

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

bubble.addEventListener('click', () => window.bidderr.bubbleClicked());
bubble.addEventListener('mouseenter', () => window.bidderr.bubbleHover(true));
bubble.addEventListener('mouseleave', () => window.bidderr.bubbleHover(false));
