import { writeProposal } from './lib/proposalEngine.js';
import { getConfig } from './config.js';

async function addHistory(item) {
  const { history = [] } = await chrome.storage.local.get('history');
  history.unshift({ id: Date.now(), at: new Date().toISOString(), ...item });
  await chrome.storage.local.set({ history: history.slice(0, 200) });
}

// Make sure the content script is present (it's auto-injected only on Upwork/PPH),
// then hand it the command.
async function sendToTab(tab, msg) {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, msg);
    } catch (e) {
      console.warn('Closer: cannot run on this page', e);
    }
  }
}

const COMMAND_TO_MSG = {
  'write-proposal': { type: 'run', mode: 'proposal' },
  'write-reply': { type: 'run', mode: 'reply' },
  'insert-last': { type: 'insert-last' },
};

chrome.commands.onCommand.addListener(async (command, tab) => {
  const msg = COMMAND_TO_MSG[command];
  if (!msg) return;
  tab = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  sendToTab(tab, msg);
});

chrome.action.onClicked.addListener((tab) => sendToTab(tab, COMMAND_TO_MSG['write-proposal']));

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({ id: 'proposal', title: 'Closer: write proposal for this', contexts: ['selection', 'page'] });
  chrome.contextMenus.create({ id: 'reply', title: 'Closer: write chat reply to this', contexts: ['selection'] });
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const mode = info.menuItemId === 'reply' ? 'reply' : 'proposal';
  sendToTab(tab, { type: 'run', mode, text: info.selectionText || '' });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'generate') {
    (async () => {
      try {
        const config = await getConfig();
        const { text, analysis } = await writeProposal({
          mode: msg.mode,
          jobText: msg.text,
          url: msg.url || sender.tab?.url || '',
          profile: config.profile,
          engine: config.engine,
          history: msg.history || '',
          variant: msg.variant || '',
        });
        const last = { text, mode: msg.mode, url: msg.url || sender.tab?.url || '', at: Date.now() };
        await chrome.storage.local.set({ last });
        await addHistory({ mode: msg.mode, url: last.url, job: msg.text.slice(0, 600), text, variant: msg.variant || '' });
        sendResponse({ ok: true, text, analysis, autoCopy: config.autoCopy, autoInsert: config.autoInsert });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true; // async response
  }
  if (msg.type === 'get-last') {
    chrome.storage.local.get('last').then(({ last }) => sendResponse(last || null));
    return true;
  }
  if (msg.type === 'open-options') {
    chrome.runtime.openOptionsPage();
  }
  return false;
});
