// Lets the PPH Bidderr browser extension write with this app's API key, so the extension needs
// no key of its own. The key never leaves the app: the extension sends the job text and gets
// the proposal back. Only this PC (127.0.0.1) and only that extension (Origin check) may ask;
// a web page that tries gets 403.
const http = require('http');

const PORT = 47615;
// The extension's ID is fixed by "key" in extension/manifest.json.
const EXTENSION_ORIGIN = 'chrome-extension://hmebapdnoenfmnlfabhmmbhoiamipgbp';
const MAX_BODY = 100 * 1024;

// write(job, signal) -> proposal text (throws with a message for the user). hasKey() -> boolean.
function startExtensionServer({ write, hasKey, log = () => {}, port = PORT }) {
  const server = http.createServer((req, res) => {
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.headers.origin !== EXTENSION_ORIGIN || req.method !== 'POST') {
      send(403, { error: 'Not allowed' });
      return;
    }
    if (req.url === '/ping') {
      send(200, { ok: true, hasKey: hasKey() });
      return;
    }
    if (req.url !== '/write') {
      send(404, { error: 'Not found' });
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on('end', async () => {
      const stop = new AbortController();
      res.on('close', () => stop.abort()); // the tab was closed: stop the AI call
      try {
        const job = String(JSON.parse(body).job || '');
        log(`[extension] write, ${job.length} chars`);
        send(200, { proposal: await write(job, stop.signal) });
      } catch (e) {
        send(200, { error: String(e?.message || e) });
      }
    });
  });
  // Port taken (or no network stack): the extension then uses its own key, if it has one.
  server.on('error', (e) => log(`[extension] server off: ${e.message}`));
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { startExtensionServer, PORT, EXTENSION_ORIGIN };
