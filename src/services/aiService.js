/**
 * AI Service for Closer AI
 * Connects to Free AI APIs (Google Gemini, Groq, OpenRouter) or local fallback
 */

const DEFAULT_SYSTEM_PROMPT = `You are Closer AI, an elite sales, client communication, and freelance bidding agent specializing in graphic design, logo vector tracing, print-ready file perfection, and typography/hand-lettering vectorization.

STRICT RULES (these override anything else in these instructions, including any pricing tiers or deadlines mentioned elsewhere below):
1. NEVER invent or hallucinate fake details, numbers, or quantities (e.g., do NOT mention "5 logos" unless the client explicitly wrote "5 logos").
2. NEVER state or estimate a specific price, budget, or dollar amount, even if the client asks for one directly. If pricing comes up, say it can be discussed directly instead of naming a number.
3. NEVER commit to a hard deadline or specific turnaround time (no "24 hours", "2 days", exact dates, etc.). It's fine to say the work is done quickly, just without naming a timeframe.
4. ALWAYS open by directly addressing the client's specific pain point or question first, then immediately give the solution.
5. Use formal, simple, easy-to-understand language.
6. Always produce clean, direct, copy-paste ready text without meta-commentary.

THE SOLUTION TO OFFER (work this in naturally, don't just list it mechanically):
- A fully editable vector file with organized layers, built in Adobe Illustrator.
- Delivered in AI, EPS, PDF, SVG, and PNG formats — plus any other format the client specifically asks for.
- Every line is manually hand-drawn/traced, not auto-traced software output.
- Delivered quickly, without naming a specific deadline.`;

export async function generateAIResponse({
  action,           // 'reply' | 'bid'
  capturedText,     // The highlighted text captured from screen
  engineSettings,   // The Bid or Chat engine config: { provider, apiKey, model, customSystemPrompt?, chatStyleExamples? }
  sharedSettings,   // Settings shared across both engines: { userPersona, tone, savedSituations, redFlagsPrompt }
  clientChatHistory,// Full chat history with the active client
  clientName,       // Active client name
}) {
  const provider = engineSettings?.provider || 'gemini';
  const apiKey = engineSettings?.apiKey || '';
  const customSystemPrompt = engineSettings?.customSystemPrompt || '';
  const userPersona = sharedSettings?.userPersona || '';
  const userTone = sharedSettings?.tone || 'Professional & Confident';
  const chatStyleExamples = engineSettings?.chatStyleExamples || '';
  const savedSituations = sharedSettings?.savedSituations || '';
  const redFlagsPrompt = sharedSettings?.redFlagsPrompt || '';

  // Construct full context & prompt
  let fullSystemPrompt = `${DEFAULT_SYSTEM_PROMPT}\n\nUSER PERSONA / BACKGROUND:\n${userPersona || 'Freelance Expert / Professional Service Provider'}\n\nPREFERRED TONE:\n${userTone}\n\nADDITIONAL INSTRUCTIONS:\n${customSystemPrompt}`;

  if (savedSituations) {
    fullSystemPrompt += `\n\nSAVED SITUATIONS & PLAYBOOK TEMPLATES (If client message matches one of these scenarios, use these rules / exact responses):\n${savedSituations}`;
  }

  if (redFlagsPrompt) {
    fullSystemPrompt += `\n\nRED FLAGS & TOXIC BUYER DETECTION RULES:\n${redFlagsPrompt}`;
  }

  // Inject chat style examples for reply mode
  if (action === 'reply' && chatStyleExamples) {
    fullSystemPrompt += `\n\nMY REAL CHAT REPLY STYLE (match this tone and length exactly):\n${chatStyleExamples}`;
  }

  let userPrompt = '';

  // Build client context prefix
  const clientContextBlock = (clientChatHistory && clientChatHistory.trim())
    ? `\nCONVERSATION HISTORY WITH ${clientName || 'THIS CLIENT'} (use this for context — do NOT repeat it, just be aware of what's been discussed):\n"""\n${clientChatHistory.trim().slice(-3000)}\n"""\n\n`
    : '';

  switch (action) {
    case 'reply':
      userPrompt = `${clientContextBlock}CLIENT CHAT MESSAGE:
"""
${capturedText}
"""

TASK: Write a direct, human chat reply answering this client's exact message.

STRICT RULES FOR CHAT REPLY:
- Open by directly addressing their specific pain point or question, then give the solution. No price/budget numbers, no hard deadlines.
- Maximum 2-4 short sentences. Clean, human texting style, but still formal and easy to understand.
- Do NOT invent fake details, extra logos, or irrelevant services.
- No "Hello," or formal sign-offs unless appropriate for the message.
- If conversation history is provided above, use it for context.`;
      break;

    case 'bid':
      userPrompt = `${clientContextBlock}JOB POSTING / CLIENT INQUIRY:
"""
${capturedText}
"""

TASK: Write a highly relevant proposal/reply addressing this exact job posting or client inquiry.

STRICT RULES FOR PROPOSAL:
- Start with "Hello,"
- Open by directly addressing the client's specific pain point or request, then present the solution. Do NOT state a price, budget, or dollar amount, and do NOT commit to a hard deadline or specific turnaround time.
- Confirm the deliverable: a fully editable vector file with organized layers in Illustrator, delivered in AI, EPS, PDF, SVG, and PNG (plus any other format they specifically ask for), manually hand-drawn (not auto-traced), delivered quickly without naming a timeframe.
- Confirm you can deliver clean/even linework and perfect letter spacing without changing their original design style.
- Do NOT invent fake details or quantities (do NOT say 5 logos unless they asked for 5).
- Keep it concise, confident, and professional.
- Double paragraph return spacing between logical sections.
- End with:
  Cheers,
  Khan`;
      break;

    default:
      userPrompt = `CLIENT MESSAGE:\n"""\n${capturedText}\n"""\n\nTask: Respond to this message in a clean, professional, human manner.`;
  }

  // Default free API key fallback if none provided
  const defaultFreeApiKey = 'AQ.Ab8RN6JNVn1kdp-lOV5fHWqszCVoD5AsogRXEeE7K9in2PG6cQ';
  const effectiveApiKey = (apiKey && apiKey.trim()) ? apiKey.trim() : defaultFreeApiKey;

  try {
    let text;
    if (provider === 'gemini' || !engineSettings?.provider) {
      text = await callGeminiAPI(effectiveApiKey, fullSystemPrompt, userPrompt, engineSettings?.model || 'gemini-flash-latest');
    } else if (provider === 'groq') {
      text = await callGroqAPI(apiKey || effectiveApiKey, fullSystemPrompt, userPrompt, engineSettings?.model || 'llama-3.3-70b-versatile');
    } else if (provider === 'openrouter') {
      text = await callOpenRouterAPI(apiKey || effectiveApiKey, fullSystemPrompt, userPrompt, engineSettings?.model || 'google/gemini-2.0-flash-lite-001');
    } else {
      text = await callGeminiAPI(effectiveApiKey, fullSystemPrompt, userPrompt, 'gemini-flash-latest');
    }
    return { text, usedFallback: false };
  } catch (error) {
    console.warn('API Call warning, using intelligent local generator:', error.message);
    const text = await generateFallbackDemoResponse(action);
    return { text, usedFallback: true, error: error.message };
  }
}

// Google Gemini API call
async function callGeminiAPI(apiKey, systemInstruction, userPrompt, modelName = 'gemini-flash-latest') {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: [
        {
          parts: [{ text: userPrompt }]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024,
      }
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `HTTP ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  const outputText = candidate?.content?.parts?.[0]?.text;

  if (!outputText) {
    throw new Error('Gemini API returned an empty response.');
  }

  return outputText.trim();
}

// Groq API call (OpenAI Compatible)
async function callGroqAPI(apiKey, systemInstruction, userPrompt, modelName = 'llama-3.3-70b-versatile') {
  const url = 'https://api.groq.com/openai/v1/chat/completions';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 1024,
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `HTTP ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const outputText = data.choices?.[0]?.message?.content;

  if (!outputText) {
    throw new Error('Groq API returned an empty response.');
  }

  return outputText.trim();
}

// OpenRouter API call
async function callOpenRouterAPI(apiKey, systemInstruction, userPrompt, modelName = 'google/gemini-2.0-flash-lite-001') {
  const url = 'https://openrouter.ai/api/v1/chat/completions';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/closer-ai',
      'X-Title': 'Closer AI Desktop Assistant'
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 1024,
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `HTTP ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// Dynamic fallback generator when API key is missing or offline
function generateFallbackDemoResponse(action) {
  return new Promise((resolve) => {
    setTimeout(() => {
      let result = '';

      if (action === 'reply') {
        // Chat covers open-ended conversation, not just new job pitches — a fixed
        // sales pitch would look absurd as a reply to an arbitrary question, so keep
        // this neutral rather than assuming what the client asked about.
        result = `Thanks for the message — let me take a look and get back to you shortly.`;
      } else {
        // bid / proposal mode
        result = `Hello,\n\nI can turn your original design into a fully editable vector file with organized layers in Illustrator, keeping your exact style intact. Delivery includes AI, EPS, PDF, SVG, and PNG files, plus any other format you need.\n\nEvery line is manually hand-drawn, not auto-traced, and delivery is quick.\n\nCheers,\nKhan`;
      }

      resolve(result);
    }, 200);
  });
}
