/**
 * Closer proposal engine, shared by the desktop app (src/) and the browser extension (extension/).
 * Pure ES module: no Node, no Electron, no DOM. Only `fetch`.
 *
 * Pipeline: analyzeJob() -> buildPrompts() -> callProvider() -> humanize()
 */

// ---------------------------------------------------------------------------
// Job analysis: pull out what matters before the model ever sees the post.
// ---------------------------------------------------------------------------

// Clients often hide an instruction in the post to filter out copy-paste bidders.
// Missing it means instant rejection, so we surface these to the model as hard rules.
const HIDDEN_INSTRUCTION_PATTERNS = [
  /(?:start|begin|open)\s+(?:your\s+)?(?:proposal|bid|application|cover\s*letter|reply|message)\s+with\s+[^.\n]{1,80}/gi,
  /(?:include|mention|write|use|put|type|add)\s+(?:the\s+)?(?:word|phrase|code|keyword)s?\s+["“'‘]?[^.\n]{1,60}/gi,
  /(?:to\s+show|so\s+i\s+know|to\s+prove)\s+(?:that\s+)?you(?:'ve|\s+have)?\s+read[^.\n]{0,120}/gi,
  /(?:answer|respond\s+to)\s+(?:the\s+following|these|this)\s+questions?[^.\n]{0,120}/gi,
  /(?:in\s+your\s+(?:proposal|bid|application|reply)),?\s+(?:please\s+)?(?:tell|include|share|explain|describe|list|mention)[^.\n]{1,160}/gi,
];

const QUESTION_LINE = /^[^\n]{8,220}\?\s*$/gm;

const SKILL_SECTION = /(?:skills?(?:\s+and\s+expertise)?|tags)\s*:?\s*\n([\s\S]{0,400})/i;

export function detectPlatform(text = '', url = '') {
  const hay = `${url} ${text}`.toLowerCase();
  if (hay.includes('peopleperhour')) return 'peopleperhour';
  if (hay.includes('upwork')) return 'upwork';
  return 'generic';
}

export function analyzeJob(rawText = '', { url = '' } = {}) {
  const text = cleanJobText(rawText);

  const mustFollow = new Set();
  for (const re of HIDDEN_INSTRUCTION_PATTERNS) {
    for (const m of text.matchAll(re)) mustFollow.add(m[0].trim().replace(/\s+/g, ' '));
  }

  const questions = [...new Set((text.match(QUESTION_LINE) || []).map((q) => q.trim()))].slice(0, 6);

  const budgetMatch = text.match(/(?:budget|fixed[- ]price|hourly(?: range)?|\$)\s*:?\s*\$?\s?(\d[\d,.]*(?:\s*[-–]\s*\$?\d[\d,.]*)?)/i);
  const skillsMatch = text.match(SKILL_SECTION);

  return {
    text,
    platform: detectPlatform(rawText, url),
    mustFollow: [...mustFollow].slice(0, 6),
    questions,
    budgetHint: budgetMatch ? budgetMatch[0].trim() : '',
    skills: skillsMatch ? skillsMatch[1].split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 12) : [],
    wordCount: text.split(/\s+/).filter(Boolean).length,
  };
}

// Strip page chrome that comes along when the whole job page is selected.
function cleanJobText(raw) {
  const noise = [
    /^(?:save job|flag as inappropriate|send a proposal for:.*|apply now|submit a proposal|view job posting|report this job)$/gim,
    /^(?:required connects to submit a proposal|available connects).*$/gim,
    /^(?:about the client|payment method verified|phone number verified).*$/gim,
  ];
  let t = String(raw || '').replace(/\r/g, '');
  for (const re of noise) t = t.replace(re, '');
  return t.replace(/\n{3,}/g, '\n\n').trim().slice(0, 9000);
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const PLATFORM_NOTES = {
  upwork: 'Platform: Upwork. The client sees only the first ~200 characters in the proposal list, so the first two sentences decide whether they open it.',
  peopleperhour: 'Platform: PeopleperHour. Clients compare many short pitches side by side; be the clearest and most specific one.',
  generic: '',
};

const HUMAN_WRITING_RULES = `HOW TO SOUND HUMAN (non-negotiable):
- Write like a busy, confident expert typing quickly to one person, not a cover letter template.
- Plain words. Short sentences. Contractions are fine (I'll, you're, it's).
- No em dashes, no semicolons, no bullet points, no bold, no headings, no emojis, no markdown.
- Never use these words or phrases: "I hope this message finds you well", "I came across your job", "I am excited", "I'm thrilled", "I would love to", "delve", "seamless", "leverage", "elevate", "tailored", "cutting-edge", "robust", "meticulous", "passionate", "look no further", "rest assured", "don't hesitate", "dear hiring manager", "as an AI", "in today's fast-paced".
- Don't restate the job post back to them. Show you understood it by naming the one detail that matters most.
- Don't list every skill you have. One relevant proof point beats five claims.`;

const PROPOSAL_STRUCTURE = `STRUCTURE:
1. Greeting line on its own (unless the client asked you to start with something specific).
2. Hook (1-2 sentences): name their specific problem or goal in your own words and say how you'd solve it. This is what shows in the preview, so it must be about THEM, not you.
3. Proof (1-2 sentences): one concrete, relevant reason to trust you (experience, a similar job, a portfolio link if provided). Never invent clients, numbers, or results.
4. Answers: if the post asks questions or gives an instruction, answer/follow each one briefly and directly.
5. Close: one short, easy-to-answer question about the project, or a simple next step.
6. Sign-off exactly as given.
Leave a blank line between paragraphs. Max 2-3 sentences per paragraph.`;

const LENGTHS = {
  short: 'Length: 50-80 words before the sign-off. Every sentence must earn its place.',
  medium: 'Length: 80-130 words before the sign-off.',
  detailed: 'Length: 130-200 words before the sign-off. Only use this room for real specifics, never filler.',
};

export function buildPrompts({ mode = 'proposal', jobText, analysis, profile = {}, history = '', variant = '' }) {
  const a = analysis || analyzeJob(jobText);
  const p = { ...DEFAULT_PROFILE, ...profile };

  const system = [
    `You write freelance ${mode === 'reply' ? 'chat replies' : 'proposals'} on behalf of ${p.name || 'the freelancer'}. Your only goal: get the client to reply.`,
    `ABOUT THE FREELANCER:\n${p.about}`,
    p.offer ? `WHAT THEY DELIVER (mention only what fits this job):\n${p.offer}` : '',
    p.portfolio ? `PORTFOLIO / PROOF LINKS (use at most one, only if relevant):\n${p.portfolio}` : '',
    `HARD RULES:
- Never invent facts, numbers, quantities, past clients or results that aren't given above.
- Never state a price, rate, or budget number. If pricing comes up, offer to discuss it.
- Never promise a specific deadline or turnaround time. "Quick turnaround" is fine.
- If the job clearly does not fit the freelancer's skills, still write the best honest reply you can and don't claim skills they don't have.`,
    HUMAN_WRITING_RULES,
    p.extraRules ? `EXTRA RULES FROM THE FREELANCER (follow these):\n${p.extraRules}` : '',
    p.playbook ? `PLAYBOOK (if the message matches one of these situations, follow it):\n${p.playbook}` : '',
    mode === 'reply' && p.chatStyle ? `THE FREELANCER'S REAL CHAT STYLE (match tone and length):\n${p.chatStyle}` : '',
  ].filter(Boolean).join('\n\n');

  let user;
  if (mode === 'reply') {
    user = [
      history ? `EARLIER CONVERSATION (context only, don't repeat it):\n"""\n${history.slice(-3000)}\n"""` : '',
      `CLIENT'S LATEST MESSAGE:\n"""\n${a.text}\n"""`,
      `Write the reply. 1-4 short sentences, chat style, answer exactly what they asked. No greeting or sign-off unless the conversation is just starting. Output only the reply text.`,
    ].filter(Boolean).join('\n\n');
  } else {
    const startRule = a.mustFollow.find((m) => /^(start|begin|open)/i.test(m));
    const hard = [
      ...a.mustFollow.map((m) => `- The client wrote: "${m}". Follow this exactly; it's a test to see who reads the post.`),
      ...(startRule ? ['- Put the required opening word/phrase as the very first word(s) of the proposal, then flow straight into a natural first sentence (e.g. "Croissant! I can..."). No separate greeting line in that case.'] : []),
      ...a.questions.map((q) => `- Answer this question from the post: "${q}"`),
    ];
    user = [
      PLATFORM_NOTES[a.platform] || '',
      `JOB POST:\n"""\n${a.text}\n"""`,
      hard.length ? `MUST DO FOR THIS POST:\n${hard.join('\n')}` : '',
      PROPOSAL_STRUCTURE,
      LENGTHS[p.length] || LENGTHS.short,
      `${startRule ? '' : `Greeting: "${p.greeting}"\n`}Sign-off (last lines, exactly):\n${p.signOff}`,
      variant ? `REVISION REQUEST: ${variant}` : '',
      'Output only the proposal text, nothing else.',
    ].filter(Boolean).join('\n\n');
  }

  return { system, user, analysis: a };
}

export const VARIANTS = {
  shorter: 'Make it noticeably shorter and punchier. Cut anything the client would skim past.',
  different: 'Write a completely different version with a different hook angle. Do not reuse sentences from earlier drafts.',
  warmer: 'Same content, slightly warmer and more conversational, still professional.',
};

// ---------------------------------------------------------------------------
// Post-processing: remove the tells that make text read as AI-written.
// ---------------------------------------------------------------------------

const PHRASE_FIXES = [
  [/\bI hope (?:this|my) (?:message|proposal) finds you well[.!]?\s*/gi, ''],
  [/\bI came across your (?:job|post|project)[^.]*\.\s*/gi, ''],
  [/\bI(?:'m| am) (?:excited|thrilled|delighted) to\b/gi, "I'd like to"],
  [/\bseamless(?:ly)?\b/gi, 'smooth'],
  [/\bleverag(?:e|ing)\b/gi, 'use'],
  [/\bmeticulous(?:ly)?\b/gi, 'careful'],
  [/\bdelve into\b/gi, 'look at'],
  [/\butili[sz]e\b/gi, 'use'],
  [/\bDon't hesitate to\b/g, 'Feel free to'],
];

export function humanize(text, { signOff = '', greeting = '' } = {}) {
  let t = String(text || '').trim();

  // Models sometimes wrap output in quotes or a code fence.
  t = t.replace(/^```[a-z]*\n?|```$/g, '').trim();
  if (/^["“].*["”]$/s.test(t)) t = t.slice(1, -1).trim();
  t = t.replace(/^(?:here(?:'s| is) (?:the|a|your) (?:proposal|reply|draft)[^\n]*:\s*\n+)/i, '');

  // Markdown -> plain text.
  t = t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/^\s*[-*•]\s+/gm, '');

  // Em/en dashes used as punctuation are the #1 AI tell.
  t = t.replace(/\s*—\s*/g, ', ').replace(/\s+–\s+/g, ', ');
  t = t.replace(/,\s*,/g, ',').replace(/,\s*\./g, '.');
  t = t.replace(/;\s+([a-z]?)/g, (_, c) => `. ${c.toUpperCase()}`);

  for (const [re, rep] of PHRASE_FIXES) t = t.replace(re, rep);

  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' ').trim();

  if (signOff) {
    const so = signOff.trim();
    const firstLine = so.split('\n')[0].trim();
    // Drop whatever sign-off the model wrote and append the exact one.
    const idx = t.lastIndexOf(firstLine);
    if (idx !== -1 && idx > t.length - so.length - 40) t = t.slice(0, idx).trim();
    t = t.replace(/\n+(?:best regards|kind regards|regards|best|thanks|thank you|cheers|sincerely),?\s*\n?[^\n]{0,40}$/i, '').trim();
    t = `${t}\n\n${so}`;
  }
  if (greeting && !t.toLowerCase().startsWith(greeting.toLowerCase().replace(/[,!]$/, ''))) {
    // Only add the greeting if the model skipped one entirely (and no hidden "start with" rule applies).
    if (!/^(hi|hello|hey|dear)\b/i.test(t)) t = `${greeting}\n\n${t}`;
  }
  return t;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export const PROVIDERS = {
  gemini: { label: 'Google Gemini', defaultModel: 'gemini-flash-latest', keyUrl: 'https://aistudio.google.com/app/apikey' },
  anthropic: { label: 'Anthropic Claude', defaultModel: 'claude-sonnet-5-5', keyUrl: 'https://console.anthropic.com/settings/keys' },
  groq: { label: 'Groq', defaultModel: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
  openrouter: { label: 'OpenRouter', defaultModel: 'google/gemini-2.0-flash-lite-001', keyUrl: 'https://openrouter.ai/keys' },
};

export async function callProvider({ provider = 'gemini', apiKey, model, system, user, temperature = 0.7 }) {
  if (!apiKey) throw new Error('No API key set. Add one in settings.');
  const m = model || PROVIDERS[provider]?.defaultModel;

  if (provider === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        // Newer Gemini models spend part of this budget on hidden thinking, so leave plenty of room.
        generationConfig: { temperature, maxOutputTokens: 8192 },
      }),
    });
    const data = await readJson(res);
    const cand = data.candidates?.[0];
    const out = cand?.content?.parts?.filter((x) => !x.thought).map((x) => x.text || '').join('');
    if (!out) throw new Error('Gemini returned an empty response.');
    if (cand.finishReason === 'MAX_TOKENS') throw new Error('Gemini cut the response short. Try again.');
    return out;
  }

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: m, max_tokens: 1024, system, messages: [{ role: 'user', content: user }] }),
    });
    const data = await readJson(res);
    const out = data.content?.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!out) throw new Error('Claude returned an empty response.');
    return out;
  }

  const url = provider === 'groq'
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://openrouter.ai/api/v1/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(provider === 'openrouter' ? { 'X-Title': 'Closer AI' } : {}),
    },
    body: JSON.stringify({
      model: m,
      temperature,
      max_tokens: 1024,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  const data = await readJson(res);
  const out = data.choices?.[0]?.message?.content;
  if (!out) throw new Error(`${PROVIDERS[provider]?.label || provider} returned an empty response.`);
  return out;
}

async function readJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || data.message || `HTTP ${res.status}`);
  return data;
}

// ---------------------------------------------------------------------------
// One-call entry point
// ---------------------------------------------------------------------------

export const DEFAULT_PROFILE = {
  name: 'Khan',
  about: 'Professional freelance graphic designer since 2016. Specialist in logo vector tracing, print-ready files, and typography / hand-lettering vectorization in Adobe Illustrator.',
  offer: 'Fully editable vector file with organized layers, built in Illustrator. Delivered as AI, EPS, PDF, SVG and PNG, plus any other format the client asks for. Every line is drawn by hand, not auto-traced. Original style kept exactly, with clean even linework and correct letter spacing.',
  portfolio: '',
  greeting: 'Hello,',
  signOff: 'Cheers,\nKhan',
  length: 'short',
  extraRules: '',
  playbook: '',
  chatStyle: '',
};

export async function writeProposal({ mode = 'proposal', jobText, url = '', profile = {}, engine = {}, history = '', variant = '' }) {
  const p = { ...DEFAULT_PROFILE, ...profile };
  const analysis = analyzeJob(jobText, { url });
  const { system, user } = buildPrompts({ mode, jobText, analysis, profile: p, history, variant: VARIANTS[variant] || variant });
  const raw = await callProvider({ ...engine, system, user, temperature: variant === 'different' ? 0.95 : 0.7 });
  const text = mode === 'reply'
    ? humanize(raw)
    : humanize(raw, { signOff: p.signOff, greeting: analysis.mustFollow.some((m) => /^(start|begin|open)/i.test(m)) ? '' : p.greeting });
  return { text, analysis };
}
