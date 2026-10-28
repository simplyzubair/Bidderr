import { DEFAULT_PROFILE, PROVIDERS } from './lib/proposalEngine.js';

export const DEFAULT_CONFIG = {
  engine: { provider: 'gemini', apiKey: '', model: PROVIDERS.gemini.defaultModel },
  profile: DEFAULT_PROFILE,
  autoCopy: true,
  autoInsert: true,
};

export async function getConfig() {
  const { config } = await chrome.storage.local.get('config');
  return {
    ...DEFAULT_CONFIG,
    ...(config || {}),
    engine: { ...DEFAULT_CONFIG.engine, ...(config?.engine || {}) },
    profile: { ...DEFAULT_CONFIG.profile, ...(config?.profile || {}) },
  };
}
