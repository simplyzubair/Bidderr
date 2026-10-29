const bubble = document.getElementById('bubble');

// The main process tells the bubble what to show; sounds play here (the bubble has audio).
window.bidderr.onBubble(({ state, label, sub, sound }) => {
  window.ui.setBubble(bubble, state, label, sub);
  if (sound) window.ui.sound(sound);
  // Tell the main process our size, so the window fits the pill exactly.
  requestAnimationFrame(() => {
    const r = bubble.getBoundingClientRect();
    window.bidderr.bubbleSize(Math.ceil(r.width) + 20, Math.ceil(r.height) + 20);
  });
});

bubble.addEventListener('click', () => window.bidderr.bubbleClicked());
bubble.addEventListener('mouseenter', () => window.bidderr.bubbleHover(true));
bubble.addEventListener('mouseleave', () => window.bidderr.bubbleHover(false));
