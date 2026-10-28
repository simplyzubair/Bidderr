const $ = (id) => document.getElementById(id);

window.bidderr.onHud(({ kind, title, detail }) => {
  $('hud').className = `hud ${kind}`;
  $('title').textContent = title;
  $('detail').textContent = detail || '';
});

// Clicking an error opens the Bidderr window so the user can fix it (for example add a key).
$('hud').addEventListener('click', () => window.bidderr.hudClicked());
