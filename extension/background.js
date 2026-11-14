// PPH Bidderr background worker. It asks Bidderr for Windows to write the proposal (that app's
// API key, work profile and writing instructions; see electron/extensionServer.js). If the app
// is not running, it writes here with the key saved in the popup, if there is one.
// Nothing runs on the PPH page itself, so the page never sees an API key.
importScripts('proposal.js');
const { generateProposal, defaultPromptFor } = self.Bidderr;
const APP = 'http://127.0.0.1:47615';

// The proposal from Bidderr for Windows. Throws; error.fromApp is true when the app answered.
async function writeWithApp(job, signal) {
  const reply = await (await fetch(`${APP}/write`, { method: 'POST', body: JSON.stringify({ job }), signal })).json();
  if (reply.proposal) return reply.proposal;
  throw Object.assign(new Error(reply.error || 'Bidderr for Windows did not answer.'), { fromApp: true });
}

// content.js opens a "write" port, sends { job }, and gets { progress } ... then { proposal } or { error }.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'write' || port.sender?.id !== chrome.runtime.id) return;
  const stop = new AbortController();
  port.onDisconnect.addListener(() => stop.abort()); // tab closed or moved on: stop the AI call
  port.onMessage.addListener(async ({ job }) => {
    const { key = '', backupKey = '', profile = '' } = await chrome.storage.local.get(['key', 'backupKey', 'profile']);
    const send = (msg) => { if (!stop.signal.aborted) port.postMessage(msg); };
    try {
      const proposal = await writeWithApp(String(job || ''), stop.signal).catch((appError) => {
        if (key || backupKey) return null; // use the popup's own key below
        if (appError.fromApp) throw appError;
        throw new Error('Bidderr for Windows is not running. Start it (it shares its API key), or add a key here.');
      }) ?? await generateProposal(String(job || ''), key, {
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
