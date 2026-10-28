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
  const MODELS = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.5-flash-lite'];

  // The default prompt. The user can replace it in the app (Edit prompt); this is the "Reset" value.
  const DEFAULT_PROMPT = `You write Upwork / PeoplePerHour proposals for a freelancer named Khan.
Read the job posting and write a proposal with exactly these 5 sections, in this order.
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
1. 100% Manual Careful Work No Auto Tools
2. File Formats: AI EPS PDF SVG PNG (source file scalable with editable layers)
3. Quick Revisions if needed
4. Backup support of 90 days if any issues in the file
5. **Delivery Time: 6 hours**
6. **Price: $**

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

OUTPUT RULES:
- Output only the proposal text, ready to paste. No section labels, no headings, no notes before or after.
- Put one blank line between sections.
- Do not use markdown except the ** around the two bold lines in the Offer Summary.
- Do not use em dashes. Do not invent facts about the job that are not in the posting.`;

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

  async function callGemini(model, apiKey, prompt, jobText, fetchImpl) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt }] },
        contents: [{ role: 'user', parts: [{ text: `JOB POSTING:\n\n${jobText}` }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 2048 },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.error?.message || `Google returned error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    if (!text.trim()) throw new Error('Google sent back an empty answer. Try again.');
    return text;
  }

  // Errors where trying the next model can help: model not found, out of quota, overloaded.
  const RETRY_NEXT_MODEL = new Set([404, 429, 500, 503]);

  async function generateProposal(jobText, apiKey, { prompt, fetchImpl = fetch, models = MODELS } = {}) {
    const job = String(jobText || '').trim();
    if (!apiKey) throw new Error('No API key yet. Open Settings and paste your free Google key.');
    if (job.length < 30) throw new Error('Copy the job posting first (the clipboard text is too short).');

    let lastError;
    for (const model of models) {
      try {
        return formatProposal(await callGemini(model, apiKey, (prompt || '').trim() || DEFAULT_PROMPT, job.slice(0, 15000), fetchImpl));
      } catch (e) {
        lastError = e;
        if (!RETRY_NEXT_MODEL.has(e.status)) break;
      }
    }
    if (lastError?.status === 400 || lastError?.status === 403) {
      throw new Error('Google did not accept the API key. Please check it.');
    }
    if (lastError?.status === 429) {
      throw new Error('Free limit reached for now. Wait a minute and try again.');
    }
    throw lastError;
  }

  return { MODELS, DEFAULT_PROMPT, toUnicodeBold, formatProposal, generateProposal };
});
