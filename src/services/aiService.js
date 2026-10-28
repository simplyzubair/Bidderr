/**
 * AI Service for Closer AI (desktop app).
 * Prompting, provider calls and the human-style cleanup live in shared/proposalEngine.js,
 * the same engine the browser extension uses.
 */
import { writeProposal, DEFAULT_PROFILE } from '../../shared/proposalEngine.js';

// Default free API key fallback if none provided
const DEFAULT_FREE_API_KEY = 'AQ.Ab8RN6JNVn1kdp-lOV5fHWqszCVoD5AsogRXEeE7K9in2PG6cQ';

export async function generateAIResponse({
  action,           // 'reply' | 'bid'
  capturedText,     // The highlighted text captured from screen
  engineSettings,   // The Bid or Chat engine config: { provider, apiKey, model, customSystemPrompt?, chatStyleExamples? }
  sharedSettings,   // Settings shared across both engines: { userPersona, tone, savedSituations, redFlagsPrompt }
  clientChatHistory,// Full chat history with the active client
  clientName,       // Active client name
  variant = '',     // '' | 'shorter' | 'different' | 'warmer'
}) {
  const provider = engineSettings?.provider || 'gemini';
  const apiKey = (engineSettings?.apiKey || '').trim() || DEFAULT_FREE_API_KEY;

  const profile = {
    ...DEFAULT_PROFILE,
    about: [DEFAULT_PROFILE.about, sharedSettings?.userPersona].filter(Boolean).join('\n'),
    extraRules: [
      sharedSettings?.tone ? `Tone: ${sharedSettings.tone}` : '',
      engineSettings?.customSystemPrompt || '',
    ].filter(Boolean).join('\n\n'),
    playbook: [sharedSettings?.savedSituations, sharedSettings?.redFlagsPrompt].filter(Boolean).join('\n\n'),
    chatStyle: engineSettings?.chatStyleExamples || '',
  };

  try {
    const { text } = await writeProposal({
      mode: action === 'reply' ? 'reply' : 'proposal',
      jobText: capturedText,
      profile,
      engine: { provider, apiKey, model: engineSettings?.model },
      history: clientChatHistory ? `${clientName ? `Client: ${clientName}\n` : ''}${clientChatHistory}` : '',
      variant,
    });
    return { text, usedFallback: false };
  } catch (error) {
    console.warn('API Call warning, using intelligent local generator:', error.message);
    return { text: fallbackResponse(action), usedFallback: true, error: error.message };
  }
}

// Shown when the API key is missing or the provider is down
function fallbackResponse(action) {
  if (action === 'reply') {
    // Chat covers open-ended conversation, so stay neutral rather than pitching.
    return `Thanks for the message, let me take a look and get back to you shortly.`;
  }
  return `Hello,\n\nI can turn your original design into a fully editable vector file with organized layers in Illustrator, keeping your exact style intact. You'll get AI, EPS, PDF, SVG and PNG files, plus any other format you need.\n\nEvery line is drawn by hand, not auto-traced, and turnaround is quick.\n\nCheers,\nKhan`;
}
