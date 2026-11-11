// PPH Bidderr background worker: writes the proposal with the shared Bidderr engine.
// The AI call runs here (not on the PPH page) so the page never sees the API key.
importScripts('proposal.js');
const { generateProposal, defaultPromptFor } = self.Bidderr;

// content.js opens a "write" port, sends { job }, and gets { progress } ... then { proposal } or { error }.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'write' || port.sender?.id !== chrome.runtime.id) return;
  const stop = new AbortController();
  port.onDisconnect.addListener(() => stop.abort()); // tab closed or moved on: stop the AI call
  port.onMessage.addListener(async ({ job }) => {
    const { key = '', backupKey = '', profile = '' } = await chrome.storage.local.get(['key', 'backupKey', 'profile']);
    const send = (msg) => { if (!stop.signal.aborted) port.postMessage(msg); };
    try {
      const proposal = await generateProposal(String(job || ''), key, {
        prompt: defaultPromptFor(profile),
        backupKey,
        onProgress: (text) => send({ progress: text }),
        fetchImpl: (url, options) => fetch(url, {
          ...options, signal: options?.signal ? AbortSignal.any([stop.signal, options.signal]) : stop.signal,
        }),
      });
      send({ proposal });
    } catch (e) {
      send({ error: String(e?.message || e) });
    }
  });
});
