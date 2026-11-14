// The PPH Bidderr extension can't load files from outside its folder, so it keeps copies of the
// shared engine and UI. They must stay identical: run `cp shared/{proposal.js,ui.js,style.css} extension/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const { startExtensionServer, EXTENSION_ORIGIN } = createRequire(import.meta.url)('../electron/extensionServer.js');

// Chrome's rule: the ID is the first 32 hex digits of sha256(public key), written with a-p.
const extensionId = (key) => [...createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)]
  .map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');

test('the app writes for the extension only, never for a web page', async () => {
  const server = startExtensionServer({ port: 0, hasKey: () => true, write: async (job) => `PROPOSAL for ${job}` });
  await new Promise((resolve) => server.once('listening', resolve));
  const ask = (origin, path = '/write') => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: 'POST', headers: origin ? { Origin: origin } : {}, body: JSON.stringify({ job: 'a logo job' }),
  });
  try {
    assert.equal((await ask('https://evil.example')).status, 403);
    assert.equal((await ask('')).status, 403);
    assert.deepEqual(await (await ask(EXTENSION_ORIGIN)).json(), { proposal: 'PROPOSAL for a logo job' });
    assert.deepEqual(await (await ask(EXTENSION_ORIGIN, '/ping')).json(), { ok: true, hasKey: true });
  } finally {
    server.close();
  }
});

for (const file of ['proposal.js', 'ui.js', 'style.css']) {
  test(`extension/${file} matches shared/${file}`, () => {
    assert.equal(readFileSync(`extension/${file}`, 'utf8'), readFileSync(`shared/${file}`, 'utf8'));
  });
}

test('extension manifest is valid and never asks for broad permissions', () => {
  const m = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.permissions, ['storage']);
  assert.equal(extensionId(m.key), new URL(EXTENSION_ORIGIN).host);
  assert.deepEqual(m.content_scripts[0].matches, ['https://www.peopleperhour.com/freelance-jobs/*']);
});
