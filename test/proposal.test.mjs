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
  assert.equal(f.calls[0].body.generationConfig.thinkingConfig, undefined);
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
