const STORAGE_KEY = 'closer_ai_settings_v1';
const HISTORY_KEY = 'closer_ai_history_v1';
const CLIENTS_KEY = 'closer_ai_clients_v1';
const ACTIVE_CLIENT_KEY = 'closer_ai_active_client';

const DEFAULT_API_KEY = 'AQ.Ab8RN6JNVn1kdp-lOV5fHWqszCVoD5AsogRXEeE7K9in2PG6cQ';

export const DEFAULT_SETTINGS = {
  shortcuts: {
    feedContext: 'Alt+Shift+C',
    autoBid: 'Alt+Shift+B',
    autoReply: 'Alt+Shift+R',
    toggleWindow: 'Alt+Shift+V',
  },
  shortcutKey: 'Alt+Shift+C',
  alwaysOnTop: true,
  autoCopy: true,
  autoPasteOnHotkey: false,
  userPersona: 'Professional freelance graphic designer with 10+ years of experience.',
  tone: 'Calm, professional, human, copy-paste ready',
  savedSituations: `SITUATION: Client mentions lower prices elsewhere or budget competition
REPLY:
Nobody likes to lose any client, so I'm happy to discuss the details directly rather than compete on price alone.

Extremely cheap quotes often mean beginner work — messy nodes, poor pen-tool control, and inaccurate vectors. Fixing those later costs more time and hassle. I make sure those gaps don't happen in the first place.

With me you get precise, hand-drawn work and a smooth delivery — I've been doing this since 2016, so you get years of reliability and peace of mind.`,
  redFlagsPrompt: `RED FLAGS & TOXIC BUYER INDICATORS:
- Unrealistic low budget with high expectations (e.g. asking for multiple vector formats, revisions, or digitizing for $5-$10)
- Scope creep / Asking for too many extra tasks outside the initial request
- Vague or unclear end goals ("I don't know what I want, just show me 5 options")
- Demanding, rude, or overly aggressive tone

ACTION IF RED FLAGS ARE DETECTED:
- Warn user or politely decline the job without arguing.
- Refusal template: "Thank you for reaching out! Based on the requirements and budget specified, this project falls outside my current service scope. I recommend looking for a seller who matches your budget range. Best of luck with your project!"`,

  // Distinct, independently editable AI backend per section.
  bidEngine: {
    provider: 'gemini', // 'gemini' | 'groq' | 'openrouter'
    apiKey: DEFAULT_API_KEY,
    model: 'gemini-flash-latest',
    customSystemPrompt: `Generate a short, direct proposal response that:

Starts with Hello,

Opens by directly addressing the client's specific pain point or question, then gives the solution

Matches the job requirements exactly

Uses very simple, confident, formal language, small yet complete sentences, less is more

Has no fluff, no marketing buzzwords, no emojis

Mentions experience briefly

Confirms the deliverable: a fully editable vector file with organized layers in Illustrator, delivered in AI, EPS, PDF, SVG, and PNG formats (plus any other format the client asks for)

States that everything is manually hand-drawn, not auto-traced

States that delivery is quick, without naming a specific deadline or turnaround time

Do NOT mention or estimate any price, budget, or dollar amount

Do NOT commit to a hard deadline or specific turnaround time

Double paragraph return spacing after each logical paragraph complete, you can combine 2 or maximum 3 sentences in 1 paragraph.

Ends with one short clarifying question or a confident closing line

Finally write at the very end in 2 lines

Cheers,
Khan

Do NOT add extra services.
Do NOT exaggerate.
Do NOT repeat the job description word-for-word.`,
  },
  chatEngine: {
    provider: 'gemini',
    apiKey: DEFAULT_API_KEY,
    model: 'gemini-flash-latest',
    chatStyleExamples: `Yeah I can do that. I'll get it sorted for you.
Sure, let me take a look and get back to you.
Done. Check your inbox, sent the updated files.
No worries, I'll fix that right away.
I'll get the first draft over to you soon.
Got it, working on it now.`,
  },
};

// Exact text of the OLD defaults (pre price/deadline policy change). If a user's saved
// settings still hold these verbatim — meaning they never customized them — swap in the
// new defaults above so the no-price/no-deadline rule actually takes effect for them.
const OLD_DEFAULT_SAVED_SITUATIONS = `SITUATION: Client mentions lower prices elsewhere or budget competition
REPLY:
Nobody likes to lose any client so I can adjust the price slightly to beat competition.

Just remember that extremely cheap quotes often mean beginner work — messy nodes, poor pen-tool control, and inaccurate vectors. Fixing those later costs more time and budget. I actually plug the gaps that others usually miss.

With me you get precise work and a smooth delivery as I have been selling here since 2016, you get 10 years history, reliability and peace of mind.

SITUATION: Pricing Quote for Vector Tracing / Logos / Print Files
PRICING TIERS:
- Easy/Simple Logo Vectoring: $25
- Slightly Complex Logo / Detailed Vector: $50
- Premium / Tough Logo / Embroidery / Complex Print File: $100`;

const OLD_DEFAULT_BID_CUSTOM_SYSTEM_PROMPT = `Generate a short, direct proposal response that:

Starts with Hello,

Matches the job requirements exactly

Uses very simple, confident language slightly informal, small yet complete sentences, less is more

Has no fluff, no marketing buzzwords, no emojis

Mentions experience briefly

Confirms you can deliver all requested items

Shows respect for deadline

Double paragraph return spacing after each logical paragraph complete, you can combine 2 or maximum 3 sentences in 1 paragraph.

Ends with one short clarifying question or a confident closing line

Finally write at the very end in 2 lines

Cheers,
Khan

Do NOT add extra services.
Do NOT exaggerate.
Do NOT repeat the job description word-for-word.`;

const OLD_DEFAULT_MODEL = 'gemini-2.0-flash';

const OLD_DEFAULT_CHAT_STYLE_EXAMPLES = `Yeah I can do that. Give me a couple hours.
Sure, let me take a look and get back to you.
Done. Check your inbox, sent the updated files.
No worries, I'll fix that right away.
Will send the first draft tonight.
Got it, working on it now.`;

// --- Settings ---
export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw);

    // If the user never customized these fields (still holding the old verbatim
    // defaults), upgrade them to the new no-price/no-deadline defaults.
    const savedSituations = saved.savedSituations === OLD_DEFAULT_SAVED_SITUATIONS
      ? DEFAULT_SETTINGS.savedSituations
      : saved.savedSituations;
    const bidCustomSystemPrompt = saved.bidEngine?.customSystemPrompt === OLD_DEFAULT_BID_CUSTOM_SYSTEM_PROMPT
      ? DEFAULT_SETTINGS.bidEngine.customSystemPrompt
      : saved.bidEngine?.customSystemPrompt;
    const chatStyleExamples = saved.chatEngine?.chatStyleExamples === OLD_DEFAULT_CHAT_STYLE_EXAMPLES
      ? DEFAULT_SETTINGS.chatEngine.chatStyleExamples
      : saved.chatEngine?.chatStyleExamples;

    // "gemini-2.0-flash" now has zero free-tier quota on new projects — upgrade anyone
    // still on that dead default to the current working alias.
    const upgradeModel = (model) => (model === OLD_DEFAULT_MODEL ? DEFAULT_SETTINGS.bidEngine.model : model);

    // Migrate pre-existing flat provider/apiKey/model/customSystemPrompt/chatStyleExamples
    // (from before Bid/Chat had separate engines) into both engines so nothing is lost.
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      shortcuts: {
        ...DEFAULT_SETTINGS.shortcuts,
        ...(saved.shortcuts || {}),
      },
      savedSituations: savedSituations ?? DEFAULT_SETTINGS.savedSituations,
      bidEngine: {
        provider: saved.bidEngine?.provider ?? saved.provider ?? DEFAULT_SETTINGS.bidEngine.provider,
        apiKey: saved.bidEngine?.apiKey ?? saved.apiKey ?? DEFAULT_SETTINGS.bidEngine.apiKey,
        model: upgradeModel(saved.bidEngine?.model ?? saved.model) ?? DEFAULT_SETTINGS.bidEngine.model,
        customSystemPrompt: bidCustomSystemPrompt ?? saved.customSystemPrompt ?? DEFAULT_SETTINGS.bidEngine.customSystemPrompt,
      },
      chatEngine: {
        provider: saved.chatEngine?.provider ?? saved.provider ?? DEFAULT_SETTINGS.chatEngine.provider,
        apiKey: saved.chatEngine?.apiKey ?? saved.apiKey ?? DEFAULT_SETTINGS.chatEngine.apiKey,
        model: upgradeModel(saved.chatEngine?.model ?? saved.model) ?? DEFAULT_SETTINGS.chatEngine.model,
        chatStyleExamples: chatStyleExamples ?? saved.chatStyleExamples ?? DEFAULT_SETTINGS.chatEngine.chatStyleExamples,
      },
    };
  } catch (e) {
    console.error('Failed to load settings from localStorage:', e);
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

// --- History ---
export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function saveHistoryItem(item) {
  try {
    const history = loadHistory();
    const newItem = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      ...item,
    };
    const updated = [newItem, ...history].slice(0, 50); // Keep last 50
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.error('Failed to save history:', e);
    return [];
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch (e) {}
}

// --- Client Sessions ---
export function loadClients() {
  try {
    const raw = localStorage.getItem(CLIENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveClients(clients) {
  try {
    localStorage.setItem(CLIENTS_KEY, JSON.stringify(clients));
  } catch (e) {
    console.error('Failed to save clients:', e);
  }
}

export function addClient(name) {
  const clients = loadClients();
  const newClient = {
    id: Date.now().toString(),
    name: name.trim(),
    chatHistory: '',
    createdAt: new Date().toISOString().split('T')[0],
  };
  const updated = [newClient, ...clients].slice(0, 20); // Max 20 clients
  saveClients(updated);
  setActiveClientId(newClient.id);
  return { clients: updated, newClient };
}

export function updateClient(clientId, updates) {
  const clients = loadClients();
  const idx = clients.findIndex(c => c.id === clientId);
  if (idx === -1) return clients;
  clients[idx] = { ...clients[idx], ...updates };
  saveClients(clients);
  return clients;
}

export function deleteClient(clientId) {
  let clients = loadClients();
  clients = clients.filter(c => c.id !== clientId);
  saveClients(clients);
  const activeId = getActiveClientId();
  if (activeId === clientId) {
    setActiveClientId(clients.length > 0 ? clients[0].id : '');
  }
  return clients;
}

export function getActiveClientId() {
  try {
    return localStorage.getItem(ACTIVE_CLIENT_KEY) || '';
  } catch (e) {
    return '';
  }
}

export function setActiveClientId(id) {
  try {
    localStorage.setItem(ACTIVE_CLIENT_KEY, id || '');
  } catch (e) {}
}
