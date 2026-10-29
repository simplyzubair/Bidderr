import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generateProposal, formatProposal, toUnicodeBold, MODELS, DEFAULT_PROMPT, checkApiKey, maskKey } = require('../shared/proposal.js');

const JOB = 'Hi, I am Sarah. I need my blurry logo redrawn as a clean vector file for print. Budget $40.';

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), key: init.headers['x-goog-api-key'] });
    const { status = 200, body } = responses.shift();
    return { ok: status < 400, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

const answer = (text) => ({ body: { candidates: [{ content: { parts: [{ text }] } }] } });

test('toUnicodeBold converts letters and digits only', () => {
  assert.equal(toUnicodeBold('Ab 6$'), '𝐀𝐛 𝟔$');
});

test('formatProposal bolds ** lines, strips headings and em dashes', () => {
  const out = formatProposal('## Hello Sarah,\n\n\n\nI can help — fast.\n5. **Delivery Time: 6 hours**');
  assert.equal(out, 'Hello Sarah,\n\nI can help, fast.\n5. 𝐃𝐞𝐥𝐢𝐯𝐞𝐫𝐲 𝐓𝐢𝐦𝐞: 𝟔 𝐡𝐨𝐮𝐫𝐬');
});

test('generateProposal sends the prompt and job to Gemini', async () => {
  const f = fakeFetch([answer('Hello Sarah,\n\nBest,\nKhan')]);
  const out = await generateProposal(JOB, 'KEY', { fetchImpl: f });
  assert.equal(out, 'Hello Sarah,\n\nBest,\nKhan');
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, new RegExp(MODELS[0]));
  assert.equal(f.calls[0].key, 'KEY');
  assert.match(f.calls[0].body.systemInstruction.parts[0].text, /Offer Summary/);
  assert.match(f.calls[0].body.contents[0].parts[0].text, /blurry logo/);
  assert.equal(f.calls[0].body.generationConfig.thinkingConfig?.thinkingLevel, 'minimal');
});

test('generateProposal disables thinking on 2.5 models for immediate generation', async () => {
  const f = fakeFetch([answer('Hello,\n\nBest,\nKhan')]);
  await generateProposal(JOB, 'KEY', { fetchImpl: f, models: ['gemini-2.5-flash'] });
  assert.equal(f.calls[0].body.generationConfig.thinkingConfig?.thinkingBudget, 0);
});

test('generateProposal asks Gemini 3 Flash to think at "low" for speed', async () => {
  const f = fakeFetch([answer('Hello,\n\nBest,\nKhan')]);
  await generateProposal(JOB, 'KEY', { fetchImpl: f, models: ['gemini-3.8-flash'] });
  assert.equal(f.calls[0].body.generationConfig.thinkingConfig?.thinkingLevel, 'low');
});

test('generateProposal retries without thinkingConfig if model rejects thinking', async () => {
  const thinkingErr = { status: 400, body: { error: { message: 'thinkingConfig is only supported for models with thinking' } } };
  const f = fakeFetch([thinkingErr, answer('Hello,\n\nBest,\nKhan')]);
  const out = await generateProposal(JOB, 'KEY', { fetchImpl: f, models: ['gemini-2.5-flash'] });
  assert.equal(out, 'Hello,\n\nBest,\nKhan');
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].body.generationConfig.thinkingConfig, undefined);
});

test('generateProposal uses the edited prompt, and the default when it is blank', async () => {
  const f = fakeFetch([answer('one'), answer('two')]);
  await generateProposal(JOB, 'KEY', { fetchImpl: f, prompt: 'My own prompt' });
  await generateProposal(JOB, 'KEY', { fetchImpl: f, prompt: '   ' });
  assert.equal(f.calls[0].body.systemInstruction.parts[0].text, 'My own prompt');
  assert.equal(f.calls[1].body.systemInstruction.parts[0].text, DEFAULT_PROMPT);
});

test('generateProposal falls back to the next model on quota errors', async () => {
  const f = fakeFetch([{ status: 429, body: { error: { message: 'quota' } } }, answer('ok text here')]);
  assert.equal(await generateProposal(JOB, 'KEY', { fetchImpl: f }), 'ok text here');
  assert.match(f.calls[1].url, new RegExp(MODELS[1]));
});

test('generateProposal skips thinking parts and tries the next model on an empty answer', async () => {
  const thinkingOnly = { body: { candidates: [{ content: { parts: [{ text: 'hmm', thought: true }] } }] } };
  const mixed = { body: { candidates: [{ content: { parts: [{ text: 'plan', thought: true }, { text: 'Hello,\n\nBest,\nKhan' }] } }] } };
  const f = fakeFetch([thinkingOnly, mixed]);
  assert.equal(await generateProposal(JOB, 'KEY', { fetchImpl: f }), 'Hello,\n\nBest,\nKhan');
  assert.equal(f.calls.length, 2);
});

test('a 400 that is not about the key tries the next model; a bad key stops at once', async () => {
  const notKey = fakeFetch([{ status: 400, body: { error: { message: 'Model does not support this' } } }, answer('worked fine')]);
  assert.equal(await generateProposal(JOB, 'KEY', { fetchImpl: notKey }), 'worked fine');
  const badKey = fakeFetch([{ status: 400, body: { error: { message: 'API key not valid. Please pass a valid API key.' } } }]);
  await assert.rejects(generateProposal(JOB, 'KEY', { fetchImpl: badKey }), /did not accept the API key/);
  assert.equal(badKey.calls.length, 1);
});

test('checkApiKey reports ok, invalid and offline', async () => {
  const status = (s) => async () => ({ ok: s < 400, status: s });
  assert.equal(await checkApiKey('KEY', { fetchImpl: status(200) }), 'ok');
  assert.equal(await checkApiKey('KEY', { fetchImpl: status(400) }), 'invalid');
  assert.equal(await checkApiKey('KEY', { fetchImpl: status(503) }), 'offline');
  assert.equal(await checkApiKey('KEY', { fetchImpl: async () => { throw new Error('no net'); } }), 'offline');
  assert.equal(await checkApiKey('  '), 'invalid');
});

test('maskKey hides the middle of the key', () => {
  assert.equal(maskKey('AIzaSyD1234567890x9Q2'), 'AIza••••x9Q2');
  assert.equal(maskKey(''), '');
});

test('generateProposal gives friendly errors', async () => {
  await assert.rejects(generateProposal(JOB, ''), /No API key/);
  await assert.rejects(generateProposal('short', 'KEY'), /Copy the job posting/);
  const bad = fakeFetch([{ status: 400, body: { error: { message: 'API key not valid' } } }]);
  await assert.rejects(generateProposal(JOB, 'KEY', { fetchImpl: bad }), /did not accept the API key/);
});

const { PROFILES, defaultPromptFor, checkBackupKey, addToHistory } = require('../shared/proposal.js');

// A fake streamed (server-sent events) answer made of the given JSON messages.
function sseBody(messages) {
  const text = messages.map((m) => `data: ${JSON.stringify(m)}\n\n`).join('') + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  return {
    getReader: () => ({
      read: async () => {
        if (sent) return { done: true };
        sent = true;
        return { done: false, value: bytes };
      },
    }),
  };
}

test('there are three profiles, each with its own Offer Summary', () => {
  assert.deepEqual(PROFILES.map((p) => p.name), ['Vector Tracing', 'Embroidery Digitizing', 'General Design']);
  assert.equal(defaultPromptFor('vector'), DEFAULT_PROMPT);
  assert.match(defaultPromptFor('embroidery'), /DST PES/);
  assert.match(defaultPromptFor('design'), /PSD/);
  assert.equal(defaultPromptFor('nope'), DEFAULT_PROMPT);
  for (const p of PROFILES) {
    assert.match(p.prompt, /\*\*Price: \$\*\*/);
    assert.match(p.prompt, /Answers:/); // screening questions
  }
});

test('with onProgress the proposal streams in, piece by piece', async () => {
  const seen = [];
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      body: sseBody([
        { candidates: [{ content: { parts: [{ text: 'Hello Sarah,\n\n' }] } }] },
        { candidates: [{ content: { parts: [{ text: '**Price: $40**' }] } }] },
      ]),
    };
  };
  const out = await generateProposal(JOB, 'KEY', { fetchImpl, onProgress: (t) => seen.push(t) });
  assert.match(calls[0], /:streamGenerateContent\?alt=sse$/);
  assert.equal(out, 'Hello Sarah,\n\n𝐏𝐫𝐢𝐜𝐞: $𝟒𝟎');
  assert.equal(seen.at(-1), out);
  assert.ok(seen.includes('Hello Sarah,'));
});

test('when Google fails, the OpenRouter backup key writes the proposal', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) });
    if (url.includes('googleapis')) return { ok: false, status: 429, json: async () => ({ error: { message: 'quota' } }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Hello from backup,\n\nBest,\nKhan' } }] }) };
  };
  const out = await generateProposal(JOB, 'KEY', { fetchImpl, models: ['gemini-x'], backupKey: 'sk-or-1' });
  assert.equal(out, 'Hello from backup,\n\nBest,\nKhan');
  const backup = calls.at(-1);
  assert.match(backup.url, /openrouter\.ai\/api\/v1\/chat\/completions$/);
  assert.equal(backup.auth, 'Bearer sk-or-1');
  assert.equal(backup.body.model, 'openrouter/free');
  assert.match(backup.body.messages[0].content, /Offer Summary/);
});

test('only a backup key is enough; both failing gives one clear message', async () => {
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Backup only works' } }] }) });
  assert.equal(await generateProposal(JOB, '', { fetchImpl: ok, backupKey: 'sk-or-1' }), 'Backup only works');
  const fail = async (url) => ({
    ok: false,
    status: url.includes('openrouter') ? 401 : 429,
    json: async () => ({ error: { message: 'no' } }),
  });
  await assert.rejects(
    generateProposal(JOB, 'KEY', { fetchImpl: fail, models: ['gemini-x'], backupKey: 'bad' }),
    /Free limit reached.*OpenRouter backup also failed: OpenRouter did not accept the backup key/,
  );
});

test('checkBackupKey reports ok and invalid', async () => {
  assert.equal(await checkBackupKey('sk', { fetchImpl: async () => ({ ok: true, status: 200 }) }), 'ok');
  assert.equal(await checkBackupKey('sk', { fetchImpl: async () => ({ ok: false, status: 401 }) }), 'invalid');
  assert.equal(await checkBackupKey(''), 'invalid');
});

test('addToHistory keeps the newest 30, newest first', () => {
  let h = [];
  for (let i = 0; i < 35; i++) h = addToHistory(h, `job   ${i}`, `proposal ${i}`, 'embroidery');
  assert.equal(h.length, 30);
  assert.equal(h[0].proposal, 'proposal 34');
  assert.equal(h[0].job, 'job 34');
  assert.equal(h[0].profile, 'embroidery');
  assert.deepEqual(addToHistory('broken', 'j', 'p').length, 1);
});
