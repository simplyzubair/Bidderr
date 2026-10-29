/**
 * Bidderr proposal engine. Shared by the Windows app (electron/) and the Android app (android/).
 * Plain script: works with require() in Node/Electron and as a <script> tag in a browser/WebView
 * (exposed there as window.Bidderr). Only needs `fetch`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Bidderr = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Tried in order. If one is missing or out of free quota, the next one is used.
  // Checked against ai.google.dev/gemini-api/docs/models on 2026-10-29 (2.0 and 1.5 are shut down;
  // 2.5 is only open to people who used it before).
  // 3.5-flash-lite: fastest current model, thinks at "minimal" by default for near-instant responses.
  // 3.8-flash: smarter; we ask it to think at "low" to keep it quick.
  const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];

  // A model that just failed is skipped for a while, so it doesn't cost an extra round trip on
  // every proposal: a missing model (404) for a day, a busy or out-of-quota one for a minute.
  // Kept for the session, and in the WebView's localStorage on Android (the writer page reloads).
  const RESTING_KEY = 'bidderr.restingModels';
  const pageStorage = () => {
    try {
      return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
    } catch {
      return null;
    }
  };
  let resting = {}; // model -> time it may be tried again
  try {
    resting = JSON.parse(pageStorage()?.getItem(RESTING_KEY) || '{}') || {};
  } catch {
    resting = {};
  }
  function restModel(model, status) {
    if (status) resting[model] = Date.now() + (status === 404 ? 24 * 3600e3 : 60e3);
    else delete resting[model];
    try {
      pageStorage()?.setItem(RESTING_KEY, JSON.stringify(resting));
    } catch {
      // storage full or blocked: remembering for this session is enough
    }
  }
  // For tests: forget which models failed.
  function forgetFailedModels() {
    resting = {};
    noThinking.clear();
  }
  // Rested models go to the end of the list (still tried if all the others fail).
  function modelOrder(models) {
    const ready = (m) => !(resting[m] > Date.now());
    return [...models.filter(ready), ...models.filter((m) => !ready(m))];
  }

  // Models that refused our thinking setting; asked without it from then on (saves a retry).
  const noThinking = new Set();

  // How much each model may "think" before writing. Less thinking = faster answer.
  function thinkingConfigFor(model) {
    if (noThinking.has(model)) return null;
    if (model.startsWith('gemini-2.5') || model === 'gemini-flash-latest') return { thinkingBudget: 0 };
    if (model.includes('3.5-flash-lite')) return { thinkingLevel: 'minimal' };
    if (model.startsWith('gemini-3')) return { thinkingLevel: 'low' };
    return null;
  }

  // Builds one profile's default prompt. Only the kind of work and the Offer Summary differ.
  function makePrompt({ work, offer, delivery }) {
    const lines = [...offer, `**Delivery Time: ${delivery}**`, '**Price: $**'].map((l, i) => `${i + 1}. ${l}`);
    return `You write Upwork / PeoplePerHour proposals for a freelancer named Khan, who does ${work}.
Read the job posting and write a proposal with exactly these 5 sections, in this order.
The text you get may include other things from the web page (menus, buttons, ads, other jobs, the client's
history). Ignore all of that and use only the main job posting.
Sections 2 and 4 are one short paragraph each, written like a real human: short sentences, easy English.

SECTION 1 (greeting):
"Hello (buyer name)," using the buyer's first name if it is visible in the posting.
If the buyer's name is not visible, write just "Hello,".

SECTION 2 (one paragraph):
You are a professional freelancer with 10+ years of experience in this field.
Address the buyer's pain points like an expert, in very easy language, and give a hint of the solution
so the buyer knows they are in SAFE HANDS. Match the language of the job: if the posting is very technical,
you may use their technical terms; if it is a simple post, explain the solution in simple words.

SECTION 3 (copy this list exactly, only fill in the price):
Offer Summary:
${lines.join('\n')}

For the price line: if the posting clearly states a fixed budget, write it after the $ (for example "**Price: $50**").
Otherwise leave it exactly as "**Price: $**" so Khan can fill it in.

SECTION 4 (optional, one line or a very short paragraph):
Use this to win the job. Give an assurance or a one-liner that makes the buyer choose Khan.
If the buyer showed a lot of concern about the result or their expectations, say in one line that it will be handled.
If their main pain point is fast delivery, say Khan respects deadlines and they will get results on time.
Be creative. If the job is very general, skip this section completely.

SECTION 5 (sign-off, exactly):
Best,
Khan

SCREENING QUESTIONS (only if the posting has them):
If the posting asks the freelancer direct questions (for example "Which software do you use?" or
"Have you done this before?"), add them after the sign-off: one blank line, then "Answers:", then each
question on its own line followed by a short, honest answer. If you can't know the answer, write
"(fill in)" so Khan can add it. If the posting asks you to include a word or phrase in the proposal
(a test that you read the post), put it naturally in Section 2.

OUTPUT RULES:
- Output only the proposal text, ready to paste. No section labels, no headings, no notes before or after.
- Put one blank line between sections.
- Do not use markdown except the ** around the two bold lines in the Offer Summary.
- Do not use em dashes. Do not invent facts about the job that are not in the posting.`;
  }

  // The three work profiles the user picks from. Each prompt can be edited in the app; these are the
  // "Reset" values. Never rename an id: both apps save the user's own prompts under it, and every
  // new version must keep using those (only a profile never saved, or Reset, gets a new default).
  const PROFILES = [
    {
      id: 'vector',
      name: 'Vector Tracing',
      prompt: makePrompt({
        work: 'vector tracing and logo redraws',
        offer: [
          '100% Manual Careful Work No Auto Tools',
          'File Formats: AI EPS PDF SVG PNG (source file scalable with editable layers)',
          'Quick Revisions if needed',
          'Backup support of 90 days if any issues in the file',
        ],
        delivery: '6 hours',
      }),
    },
    {
      id: 'embroidery',
      name: 'Embroidery Digitizing',
      prompt: makePrompt({
        work: 'embroidery digitizing for all embroidery machines',
        offer: [
          '100% Manual Digitizing No Auto Tools',
          'File Formats: DST PES EXP JEF VP3 HUS XXX (any machine format you need)',
          'Clean stitch paths with the right density and underlay for your fabric',
          'Quick Revisions if needed',
          'Backup support of 90 days if any issues in the file',
        ],
        delivery: '6 hours',
      }),
    },
    {
      id: 'design',
      name: 'General Design',
      prompt: makePrompt({
        work: 'graphic design (logos, flyers, social media posts, print and branding)',
        offer: [
          '100% Custom Design No Templates',
          'File Formats: AI PSD PDF PNG JPG (editable source files included)',
          'Quick Revisions if needed',
          'Backup support of 90 days if any issues in the file',
        ],
        delivery: '24 hours',
      }),
    },
  ];

  const DEFAULT_PROFILE = PROFILES[0].id;
  const DEFAULT_PROMPT = PROFILES[0].prompt;

  // The default prompt of a profile (an unknown id gets the first profile).
  function defaultPromptFor(profileId) {
    return (PROFILES.find((p) => p.id === profileId) || PROFILES[0]).prompt;
  }

  // Turns **text** into Unicode bold letters, so it stays bold when pasted into plain text boxes
  // (Upwork and PeoplePerHour cover letters do not support formatting).
  function toUnicodeBold(text) {
    let out = '';
    for (const ch of text) {
      const c = ch.codePointAt(0);
      if (c >= 65 && c <= 90) out += String.fromCodePoint(0x1d400 + c - 65); // A-Z
      else if (c >= 97 && c <= 122) out += String.fromCodePoint(0x1d41a + c - 97); // a-z
      else if (c >= 48 && c <= 57) out += String.fromCodePoint(0x1d7ce + c - 48); // 0-9
      else out += ch;
    }
    return out;
  }

  function formatProposal(raw) {
    return String(raw || '')
      .replace(/\r\n/g, '\n')
      .replace(/^```[a-z]*\n?|```$/gim, '')
      .replace(/^#+\s*/gm, '')
      .replace(/\*\*([^*\n]+?)\*\*/g, (_, inner) => toUnicodeBold(inner))
      .replace(/\s*—\s*/g, ', ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  const GOOGLE_API = 'https://generativelanguage.googleapis.com';
  const OPENROUTER_API = 'https://openrouter.ai/api/v1';
  // OpenRouter's router that picks one of its free models (Llama, Gemma, DeepSeek...) for each request.
  const OPENROUTER_MODEL = 'openrouter/free';

  // Reads a "server-sent events" answer piece by piece and calls onData with each JSON message.
  async function readEvents(res, onData) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (!line.startsWith('data:')) continue; // blank lines and ": keep-alive" comments
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          onData(JSON.parse(data));
        } catch {
          // a broken piece is skipped; the empty-answer check still catches a failed answer
        }
      }
    }
  }

  // Throws an error with .status, so the caller can decide to try the next model.
  async function failWith(res, data) {
    const body = data || (await res.json().catch(() => ({})));
    const err = new Error(body?.error?.message || `The AI service returned error ${res.status}`);
    err.status = res.status;
    throw err;
  }

  function emptyAnswer() {
    // Empty or cut off: let the next model try (status 503 means "try another model").
    const err = new Error('The AI sent back an empty answer. Try again.');
    err.status = 503;
    return err;
  }

  // onProgress (optional) gets the proposal so far while it is being written.
  async function callGemini(model, apiKey, prompt, jobText, fetchImpl, apiBase, onProgress, allowThinking = true) {
    const stream = Boolean(onProgress);
    const url = `${apiBase}/v1beta/models/${model}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
    // Proposals are ~200-300 words (under 1000 tokens). Keeping maxOutputTokens tight speeds up model decoding.
    const genConfig = { temperature: 0.7, maxOutputTokens: 2048 };
    const thinking = allowThinking && thinkingConfigFor(model);
    if (thinking) genConfig.thinkingConfig = thinking;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt }] },
        contents: [{ role: 'user', parts: [{ text: `JOB POSTING:\n\n${jobText}` }] }],
        generationConfig: genConfig,
      }),
    });
    const textOf = (data) => (data?.candidates?.[0]?.content?.parts || [])
      .filter((p) => !p.thought).map((p) => p.text || '').join('');
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // If the model rejected thinkingConfig, retry once without it
      if (res.status === 400 && genConfig.thinkingConfig && /thinking/i.test(data?.error?.message || '')) {
        noThinking.add(model);
        return callGemini(model, apiKey, prompt, jobText, fetchImpl, apiBase, onProgress, false);
      }
      await failWith(res, data);
    }
    let text = '';
    if (stream && res.body?.getReader) {
      await readEvents(res, (data) => {
        text += textOf(data);
        if (text.trim()) onProgress(formatProposal(text));
      });
    } else {
      text = textOf(await res.json().catch(() => ({})));
    }
    if (!text.trim()) throw emptyAnswer();
    return text;
  }

  // The backup service: OpenRouter, which speaks the OpenAI chat format.
  async function callOpenRouter(apiKey, prompt, jobText, fetchImpl, apiBase, onProgress) {
    const stream = Boolean(onProgress);
    const res = await fetchImpl(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'X-Title': 'Bidderr' },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: `JOB POSTING:\n\n${jobText}` },
        ],
        temperature: 0.7,
        max_tokens: 2048,
        reasoning: { exclude: true },
        stream,
      }),
    });
    if (!res.ok) await failWith(res);
    let text = '';
    if (stream && res.body?.getReader) {
      await readEvents(res, (data) => {
        text += data?.choices?.[0]?.delta?.content || '';
        if (text.trim()) onProgress(formatProposal(text));
      });
    } else {
      const data = await res.json().catch(() => ({}));
      text = data?.choices?.[0]?.message?.content || '';
    }
    if (!text.trim()) throw emptyAnswer();
    return text;
  }

  // Errors where trying the next model can help: model not found, out of quota, overloaded.
  const RETRY_NEXT_MODEL = new Set([404, 429, 500, 503]);
  const isGoogleKeyProblem = (e) => e?.status === 403 || (e?.status === 400 && /api.?key/i.test(e.message));

  function friendlyGoogleError(e) {
    if (isGoogleKeyProblem(e)) return new Error('Google did not accept the API key. Please check it.');
    if (e?.status === 429) return new Error('Free limit reached for now. Wait a minute and try again.');
    return e;
  }

  function friendlyBackupError(e) {
    if (e?.status === 401 || e?.status === 403) return 'OpenRouter did not accept the backup key.';
    if (e?.status === 402) return 'OpenRouter says the account needs credit.';
    if (e?.status === 429) return 'OpenRouter free limit reached for now.';
    return String(e?.message || 'Unknown error');
  }

  // apiKey: Google key. backupKey (optional): OpenRouter key, used when Google fails or has no key.
  // onProgress (optional): called with the proposal so far, so the app can show it while it is written.
  async function generateProposal(jobText, apiKey, {
    prompt, fetchImpl = fetch, models = MODELS, apiBase = GOOGLE_API,
    backupKey = '', backupBase = OPENROUTER_API, onProgress, log = () => {},
  } = {}) {
    const job = String(jobText || '').trim();
    if (!apiKey && !backupKey) throw new Error('No API key yet. Open Settings and paste your free Google key.');
    if (job.length < 30) throw new Error('Copy the job posting first (the clipboard text is too short).');
    const systemPrompt = (prompt || '').trim() || DEFAULT_PROMPT;
    const jobPart = job.slice(0, 15000);

    let googleError = null;
    if (apiKey) {
      for (const model of modelOrder(models)) {
        const started = Date.now();
        try {
          onProgress?.(''); // a new attempt starts from an empty box
          const text = await callGemini(model, apiKey, systemPrompt, jobPart, fetchImpl, apiBase, onProgress);
          log(`[ai] ${model} answered in ${Date.now() - started} ms`);
          if (resting[model]) restModel(model, 0);
          return formatProposal(text);
        } catch (e) {
          log(`[ai] ${model} failed after ${Date.now() - started} ms: ${e.status || ''} ${e.message}`);
          if (RETRY_NEXT_MODEL.has(e.status)) restModel(model, e.status);
          googleError = e;
          // A bad key fails for every model, so stop. Other errors (model missing, busy, out of
          // free quota, model can't do this request) may work with the next model.
          if (isGoogleKeyProblem(e) || !(RETRY_NEXT_MODEL.has(e.status) || e.status === 400)) break;
        }
      }
      if (!backupKey) throw friendlyGoogleError(googleError);
    }

    const started = Date.now();
    try {
      onProgress?.('');
      const text = await callOpenRouter(backupKey, systemPrompt, jobPart, fetchImpl, backupBase, onProgress);
      log(`[ai] OpenRouter answered in ${Date.now() - started} ms`);
      return formatProposal(text);
    } catch (e) {
      log(`[ai] OpenRouter failed after ${Date.now() - started} ms: ${e.message}`);
      const backup = friendlyBackupError(e);
      if (!googleError) throw new Error(backup);
      throw new Error(`${friendlyGoogleError(googleError).message} The OpenRouter backup also failed: ${backup}`);
    }
  }

  // Asks Google if the key works (a free call that lists models). Returns 'ok', 'invalid' or 'offline'.
  async function checkApiKey(apiKey, { fetchImpl = fetch, apiBase = GOOGLE_API } = {}) {
    const key = String(apiKey || '').trim();
    if (!key) return 'invalid';
    try {
      const res = await fetchImpl(`${apiBase}/v1beta/models?pageSize=1`, {
        headers: { 'x-goog-api-key': key },
      });
      if (res.ok) return 'ok';
      return res.status === 400 || res.status === 401 || res.status === 403 ? 'invalid' : 'offline';
    } catch {
      return 'offline';
    }
  }

  // The same check for an OpenRouter backup key (a free call that describes the key).
  async function checkBackupKey(apiKey, { fetchImpl = fetch, apiBase = OPENROUTER_API } = {}) {
    const key = String(apiKey || '').trim();
    if (!key) return 'invalid';
    try {
      const res = await fetchImpl(`${apiBase}/key`, { headers: { Authorization: `Bearer ${key}` } });
      if (res.ok) return 'ok';
      return res.status === 400 || res.status === 401 || res.status === 403 ? 'invalid' : 'offline';
    } catch {
      return 'offline';
    }
  }

  // Recent proposals, newest first. Both apps keep this list on the device only.
  const HISTORY_SIZE = 30;
  function addToHistory(history, job, proposal, profileId) {
    const entry = {
      time: Date.now(),
      profile: profileId || DEFAULT_PROFILE,
      job: String(job || '').replace(/\s+/g, ' ').trim().slice(0, 140),
      proposal: String(proposal || ''),
    };
    return [entry, ...(Array.isArray(history) ? history : [])].slice(0, HISTORY_SIZE);
  }

  // "AIzaSyD...x9Q2" -> "AIza••••x9Q2", safe to show on screen.
  function maskKey(apiKey) {
    const key = String(apiKey || '').trim();
    if (!key) return '';
    if (key.length <= 10) return '••••';
    return `${key.slice(0, 4)}••••${key.slice(-4)}`;
  }

  return {
    MODELS, PROFILES, DEFAULT_PROFILE, DEFAULT_PROMPT, OPENROUTER_MODEL, defaultPromptFor,
    toUnicodeBold, formatProposal, generateProposal, checkApiKey, checkBackupKey, maskKey, addToHistory,
    forgetFailedModels,
  };
});
