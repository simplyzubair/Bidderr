// Saved settings for both Android pages (app.js and writer.js), exposed as window.store.
// API keys are encrypted by Android (SecretStore.java, through window.Android); the rest
// (profile, prompts, recent proposals) lives in the WebView's localStorage.
(function () {
  const { PROFILES, DEFAULT_PROFILE, defaultPromptFor, addToHistory } = window.Bidderr;
  const android = window.Android;
  const secure = Boolean(android && android.getSecret);
  // Where older versions kept the keys. Moved to the encrypted store the first time they are read.
  const OLD = { key: 'bidderr.key', backupKey: 'bidderr.backupKey' };

  function getSecret(name) {
    const old = localStorage.getItem(OLD[name]);
    if (!secure) return old || '';
    if (old && android.setSecret(name, old)) localStorage.removeItem(OLD[name]);
    return android.getSecret(name) || localStorage.getItem(OLD[name]) || '';
  }

  function setSecret(name, value) {
    if (secure && android.setSecret(name, value)) localStorage.removeItem(OLD[name]);
    else if (value) localStorage.setItem(OLD[name], value); // no encrypted store: keep it as before
    else localStorage.removeItem(OLD[name]);
  }

  const isProfile = (id) => PROFILES.some((p) => p.id === id);

  function getPrompt(id) {
    let saved = localStorage.getItem(`bidderr.prompt.${id}`);
    // Older versions had one prompt; it belongs to the first profile (Vector Tracing).
    if (saved === null && id === DEFAULT_PROFILE) saved = localStorage.getItem('bidderr.prompt');
    return saved || defaultPromptFor(id);
  }

  function readHistory() {
    try {
      const list = JSON.parse(localStorage.getItem('bidderr.history') || '[]');
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  window.store = {
    get key() { return getSecret('key'); },
    set key(v) { setSecret('key', v); },
    get backupKey() { return getSecret('backupKey'); },
    set backupKey(v) { setSecret('backupKey', v); },

    get profile() {
      const id = localStorage.getItem('bidderr.profile');
      return isProfile(id) ? id : DEFAULT_PROFILE;
    },
    set profile(id) {
      if (isProfile(id)) localStorage.setItem('bidderr.profile', id);
    },
    prompt: getPrompt,
    // Saving the default text (or nothing) means "use the default".
    savePrompt(id, text) {
      const value = String(text || '').trim();
      localStorage.setItem(`bidderr.prompt.${id}`, value === defaultPromptFor(id) ? '' : value);
      if (id === DEFAULT_PROFILE) localStorage.removeItem('bidderr.prompt');
    },

    get history() { return readHistory(); },
    remember(job, proposal, profileId) {
      localStorage.setItem('bidderr.history', JSON.stringify(addToHistory(readHistory(), job, proposal, profileId)));
    },
    clearHistory() { localStorage.removeItem('bidderr.history'); },
  };
})();
