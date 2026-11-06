import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  generateProposal, formatProposal, toUnicodeBold, MODELS, DEFAULT_PROMPT, checkApiKey, maskKey, forgetFailedModels,
} = require('../shared/proposal.js');

beforeEach(() => forgetFailedModels());

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

test('generateProposal asks 3.5-flash-lite to think at "minimal"', async () => {
  const f = fakeFetch([answer('Hello,\n\nBest,\nKhan')]);
  await generateProposal(JOB, 'KEY', { fetchImpl: f, models: ['gemini-3.5-flash-lite'] });
  assert.equal(f.calls[0].body.generationConfig.thinkingConfig?.thinkingLevel, 'minimal');
});

test('generateProposal disables thinking on 2.5 models for immediate generation', async () => {
  const f = fakeFetch([answer('Hello,\n\nBest,\nKhan')]);
  await generateProposal(JOB, 'KEY', { fetchImpl: f, models: ['gemini-2.5-flash'] });
  assert.equal(f.calls[0].body.generationConfig.thinkingConfig?.thinkingBudget, 0);
});

test('generateProposal asks 3.6-flash for "minimal" thinking and 3.8-flash (no minimal) for "low"', async () => {
  for (const [model, level] of [['gemini-3.6-flash', 'minimal'], ['gemini-3.8-flash', 'low']]) {
    const f = fakeFetch([answer('Hello,\n\nBest,\nKhan')]);
    await generateProposal(JOB, 'KEY', { fetchImpl: f, models: [model] });
    assert.equal(f.calls[0].body.generationConfig.thinkingConfig?.thinkingLevel, level, model);
  }
});

test('the two fast models are tried first', () => {
  assert.deepEqual(MODELS.slice(0, 2), ['gemini-3.6-flash', 'gemini-3.5-flash-lite']);
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

test('a model that just failed is tried last next time, so it costs no extra wait', async () => {
  const f = fakeFetch([{ status: 429, body: { error: { message: 'quota' } } }, answer('first'), answer('second')]);
  await generateProposal(JOB, 'KEY', { fetchImpl: f });
  await generateProposal(JOB, 'KEY', { fetchImpl: f });
  assert.equal(f.calls.length, 3);
  assert.match(f.calls[2].url, new RegExp(MODELS[1]));
});

test('a model that refused the thinking setting is asked without it next time', async () => {
  const thinkingErr = { status: 400, body: { error: { message: 'thinking is not supported' } } };
  const f = fakeFetch([thinkingErr, answer('one'), answer('two')]);
  await generateProposal(JOB, 'KEY', { fetchImpl: f, models: ['gemini-2.5-flash'] });
  await generateProposal(JOB, 'KEY', { fetchImpl: f, models: ['gemini-2.5-flash'] });
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[2].body.generationConfig.thinkingConfig, undefined);
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

test('a Groq backup key (gsk_) uses Groq, and its second model when the first is busy', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, auth: init.headers.Authorization, body });
    if (url.includes('googleapis')) return { ok: false, status: 503, json: async () => ({ error: { message: 'busy' } }) };
    if (body.model === 'openai/gpt-oss-120b') return { ok: false, status: 429, json: async () => ({ error: { message: 'rate' } }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Hello from Groq' } }] }) };
  };
  const logs = [];
  const out = await generateProposal(JOB, 'KEY', { fetchImpl, models: ['gemini-x'], backupKey: 'gsk_1', log: (l) => logs.push(l) });
  assert.equal(out, 'Hello from Groq');
  const groq = calls.filter((c) => c.url.includes('api.groq.com'));
  assert.deepEqual(groq.map((c) => c.body.model), ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
  assert.match(groq[0].url, /api\.groq\.com\/openai\/v1\/chat\/completions$/);
  assert.equal(groq[0].auth, 'Bearer gsk_1');
  assert.equal(groq[0].body.reasoning_effort, 'low');
  assert.equal(groq[0].body.include_reasoning, false);
  assert.equal(groq[0].body.reasoning, undefined); // OpenRouter-only setting
  assert.ok(logs.some((l) => /Groq openai\/gpt-oss-20b answered/.test(l)));
});

test('a bad Groq key names Groq in the message', async () => {
  const fail = async (url) => ({ ok: false, status: url.includes('groq') ? 401 : 429, json: async () => ({ error: { message: 'no' } }) });
  await assert.rejects(
    generateProposal(JOB, 'KEY', { fetchImpl: fail, models: ['gemini-x'], backupKey: 'gsk_bad' }),
    /Groq backup also failed: Groq did not accept the backup key/,
  );
});

test('checkBackupKey tests a Groq key with Groq, an OpenRouter key with OpenRouter', async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return { ok: true, status: 200 }; };
  assert.equal(await checkBackupKey('gsk_1', { fetchImpl }), 'ok');
  assert.equal(await checkBackupKey('sk-or-1', { fetchImpl }), 'ok');
  assert.deepEqual(urls, ['https://api.groq.com/openai/v1/models', 'https://openrouter.ai/api/v1/key']);
});

test('a used-up daily quota rests the model longer than a per-minute limit', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes('daily-model')) return { ok: false, status: 429, json: async () => ({ error: { message: 'Quota exceeded: GenerateRequestsPerDayPerProjectPerModel-FreeTier' } }) };
    return { ok: true, status: 200, json: async () => answer('Hi').body };
  };
  await generateProposal(JOB, 'KEY', { fetchImpl, models: ['daily-model', 'other-model'] });
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 5 * 60e3; // 5 minutes later: a per-minute limit would be over
    urls.length = 0;
    await generateProposal(JOB, 'KEY', { fetchImpl, models: ['daily-model', 'other-model'] });
    assert.match(urls[0], /other-model/);
  } finally {
    Date.now = realNow;
  }
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

test('a model that shows no words in time is dropped for the next one', async () => {
  const urls = [];
  const fetchImpl = (url, init) => {
    urls.push(url);
    if (url.includes('slow-model')) {
      // never answers until aborted
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => answer('Fast answer').body });
  };
  const logs = [];
  const out = await generateProposal(JOB, 'KEY', {
    fetchImpl, models: ['slow-model', 'fast-model'], firstWordMs: 30, log: (l) => logs.push(l),
  });
  assert.equal(out, 'Fast answer');
  assert.equal(urls.length, 2);
  assert.match(logs[0], /slow-model failed .* 408/);
  // the slow model rests, so the next proposal starts with the fast one
  urls.length = 0;
  await generateProposal(JOB, 'KEY', { fetchImpl, models: ['slow-model', 'fast-model'], firstWordMs: 30 });
  assert.match(urls[0], /fast-model/);
});

test('the last model left has no time limit, so a slow answer still arrives', async () => {
  const fetchImpl = () => new Promise((resolve) => setTimeout(
    () => resolve({ ok: true, status: 200, json: async () => answer('Slow but here').body }), 60));
  const out = await generateProposal(JOB, 'KEY', { fetchImpl, models: ['only-model'], firstWordMs: 10 });
  assert.equal(out, 'Slow but here');
});

test('the newest models think as little as they allow; 2.5-flash-lite gets no thinking setting', async () => {
  const f = fakeFetch(MODELS.map(() => ({ status: 503, body: {} })));
  await assert.rejects(generateProposal(JOB, 'KEY', { fetchImpl: f }));
  const levels = f.calls.map((c) => c.body.generationConfig.thinkingConfig?.thinkingLevel ?? 'none');
  assert.deepEqual(levels, ['minimal', 'minimal', 'low', 'none']);
});
