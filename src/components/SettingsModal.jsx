import React, { useState } from 'react';
import { X, Key, Cpu, User, ExternalLink, Save, Keyboard, ShieldAlert } from 'lucide-react';

export default function SettingsModal({ settings, onSave, onClose }) {
  const [activeTab, setActiveTab] = useState('bid'); // 'bid' | 'reply' | 'persona' | 'shortcuts'
  const [formData, setFormData] = useState({
    ...settings,
    shortcuts: {
      feedContext: 'Alt+Shift+C',
      autoBid: 'Alt+Shift+B',
      autoReply: 'Alt+Shift+R',
      toggleWindow: 'Alt+Shift+V',
      ...(settings.shortcuts || {}),
    },
    bidEngine: {
      provider: 'gemini',
      apiKey: '',
      model: 'gemini-flash-latest',
      customSystemPrompt: '',
      ...(settings.bidEngine || {}),
    },
    chatEngine: {
      provider: 'gemini',
      apiKey: '',
      model: 'gemini-flash-latest',
      customSystemPrompt: '',
      chatStyleExamples: '',
      ...(settings.chatEngine || {}),
    },
  });

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleShortcutChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      shortcuts: { ...prev.shortcuts, [field]: value },
    }));
  };

  const handleEngineChange = (engineKey, field, value) => {
    setFormData((prev) => ({
      ...prev,
      [engineKey]: { ...prev[engineKey], [field]: value },
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-header">
        <div className="modal-title">
          <Cpu size={16} color="var(--accent-primary)" />
          <span>AI Engine & Settings</span>
        </div>
        <button className="icon-btn" onClick={onClose}>
          <X size={15} />
        </button>
      </div>

      {/* Tab Navigation Strip */}
      <div className="segmented-control-bar" style={{ margin: '8px 12px 0 12px' }}>
        <button
          type="button"
          className={`segmented-pill-btn ${activeTab === 'bid' ? 'pill-active bid' : ''}`}
          onClick={() => setActiveTab('bid')}
          style={{ fontSize: '0.72rem', padding: '6px' }}
        >
          🎯 Bid Engine
        </button>
        <button
          type="button"
          className={`segmented-pill-btn ${activeTab === 'reply' ? 'pill-active chat' : ''}`}
          onClick={() => setActiveTab('reply')}
          style={{ fontSize: '0.72rem', padding: '6px' }}
        >
          💬 Reply Engine
        </button>
        <button
          type="button"
          className={`segmented-pill-btn ${activeTab === 'persona' ? 'pill-active' : ''}`}
          onClick={() => setActiveTab('persona')}
          style={{ fontSize: '0.72rem', padding: '6px' }}
        >
          👤 Persona
        </button>
        <button
          type="button"
          className={`segmented-pill-btn ${activeTab === 'shortcuts' ? 'pill-active' : ''}`}
          onClick={() => setActiveTab('shortcuts')}
          style={{ fontSize: '0.72rem', padding: '6px' }}
        >
          ⌨️ Shortcuts
        </button>
      </div>

      <form onSubmit={handleSubmit} className="modal-body" style={{ gap: '12px' }}>
        {/* Tab 1: Bid Engine */}
        {activeTab === 'bid' && (
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Key size={13} /> Bid & Proposal Engine Provider
            </label>
            <select
              className="form-select"
              value={formData.bidEngine.provider}
              onChange={(e) => handleEngineChange('bidEngine', 'provider', e.target.value)}
            >
              <option value="gemini">Google Gemini API (Free 15 RPM)</option>
              <option value="groq">Groq Llama 3.3 (Ultra Fast Free Tier)</option>
              <option value="openrouter">OpenRouter API</option>
            </select>
            <span className="hint-text">
              {formData.bidEngine.provider === 'gemini' && (
                <>
                  Get free key at{' '}
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="api-link">
                    Google AI Studio <ExternalLink size={10} />
                  </a>
                </>
              )}
              {formData.bidEngine.provider === 'groq' && (
                <>
                  Get free key at{' '}
                  <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="api-link">
                    Groq Console <ExternalLink size={10} />
                  </a>
                </>
              )}
            </span>

            <label className="form-label" style={{ marginTop: '8px' }}>API Key</label>
            <input
              type="password"
              className="form-input"
              placeholder="Paste your API key..."
              value={formData.bidEngine.apiKey}
              onChange={(e) => handleEngineChange('bidEngine', 'apiKey', e.target.value)}
            />

            <label className="form-label" style={{ marginTop: '8px' }}>Model Name</label>
            <input
              type="text"
              className="form-input"
              placeholder="Model (e.g. gemini-flash-latest)"
              value={formData.bidEngine.model}
              onChange={(e) => handleEngineChange('bidEngine', 'model', e.target.value)}
            />

            <label className="form-label" style={{ marginTop: '8px' }}>🎯 Proposal & Bid Prompt Instructions</label>
            <textarea
              className="form-textarea"
              rows={8}
              placeholder="Custom instructions specifically for proposal/bidding generation..."
              value={formData.bidEngine.customSystemPrompt}
              onChange={(e) => handleEngineChange('bidEngine', 'customSystemPrompt', e.target.value)}
            />
            <span className="hint-text">These instructions only apply when generating Bids & Proposals.</span>
          </div>
        )}

        {/* Tab 2: Chat Reply Engine */}
        {activeTab === 'reply' && (
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Key size={13} /> Chat Reply Engine Provider
            </label>
            <select
              className="form-select"
              value={formData.chatEngine.provider}
              onChange={(e) => handleEngineChange('chatEngine', 'provider', e.target.value)}
            >
              <option value="gemini">Google Gemini API (Free 15 RPM)</option>
              <option value="groq">Groq Llama 3.3 (Ultra Fast Free Tier)</option>
              <option value="openrouter">OpenRouter API</option>
            </select>
            <span className="hint-text">
              {formData.chatEngine.provider === 'gemini' && (
                <>
                  Get free key at{' '}
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="api-link">
                    Google AI Studio <ExternalLink size={10} />
                  </a>
                </>
              )}
              {formData.chatEngine.provider === 'groq' && (
                <>
                  Get free key at{' '}
                  <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="api-link">
                    Groq Console <ExternalLink size={10} />
                  </a>
                </>
              )}
            </span>

            <label className="form-label" style={{ marginTop: '8px' }}>API Key</label>
            <input
              type="password"
              className="form-input"
              placeholder="Paste your API key..."
              value={formData.chatEngine.apiKey}
              onChange={(e) => handleEngineChange('chatEngine', 'apiKey', e.target.value)}
            />

            <label className="form-label" style={{ marginTop: '8px' }}>Model Name</label>
            <input
              type="text"
              className="form-input"
              placeholder="Model (e.g. gemini-flash-latest)"
              value={formData.chatEngine.model}
              onChange={(e) => handleEngineChange('chatEngine', 'model', e.target.value)}
            />

            <label className="form-label" style={{ marginTop: '8px' }}>💬 Chat Reply Prompt Instructions</label>
            <textarea
              className="form-textarea"
              rows={4}
              placeholder="Custom instructions specifically for chat replies..."
              value={formData.chatEngine.customSystemPrompt || ''}
              onChange={(e) => handleEngineChange('chatEngine', 'customSystemPrompt', e.target.value)}
            />

            <label className="form-label" style={{ marginTop: '8px' }}>My Real Chat Style Examples</label>
            <textarea
              className="form-textarea"
              rows={4}
              placeholder={`Paste real example messages so AI learns your voice:\nYeah I can do that. I'll get it sorted for you.`}
              value={formData.chatEngine.chatStyleExamples || ''}
              onChange={(e) => handleEngineChange('chatEngine', 'chatStyleExamples', e.target.value)}
            />
            <span className="hint-text">These instructions and style examples only apply to Chat Replies.</span>
          </div>
        )}

        {/* Tab 3: Persona & Playbook */}
        {activeTab === 'persona' && (
          <>
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <User size={13} /> Your Persona / Bio
              </label>
              <textarea
                className="form-textarea"
                rows={2}
                placeholder="e.g. Senior Freelance Developer specializing in Vector Tracing & Design..."
                value={formData.userPersona}
                onChange={(e) => handleChange('userPersona', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Tone of Voice</label>
              <select
                className="form-select"
                value={formData.tone}
                onChange={(e) => handleChange('tone', e.target.value)}
              >
                <option value="Professional & Confident">Professional & Confident</option>
                <option value="Warm & Conversational">Warm & Conversational</option>
                <option value="Direct & Technical">Direct & Technical</option>
                <option value="Persuasive Agency Owner">Persuasive Agency Owner</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                🛡️ Saved Situation Playbook & Templates
              </label>
              <textarea
                className="form-textarea"
                rows={4}
                placeholder={`SITUATION: Client mentions lower price\nREPLY: Nobody likes to lose any client...`}
                value={formData.savedSituations || ''}
                onChange={(e) => handleChange('savedSituations', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <ShieldAlert size={13} /> Toxic Buyer & Red Flag Rules
              </label>
              <textarea
                className="form-textarea"
                rows={4}
                placeholder={`Define red flags and refusal behavior:\n- Extremely low budget with high demands`}
                value={formData.redFlagsPrompt || ''}
                onChange={(e) => handleChange('redFlagsPrompt', e.target.value)}
              />
            </div>
          </>
        )}

        {/* Tab 4: Shortcuts */}
        {activeTab === 'shortcuts' && (
          <>
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Keyboard size={13} /> 1. Feed Chat Context Shortkey
              </label>
              <input
                type="text"
                className="form-input"
                value={formData.shortcuts.feedContext}
                onChange={(e) => handleShortcutChange('feedContext', e.target.value)}
              />
              <span className="hint-text">Captures selected chat history into active client's context.</span>
            </div>

            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Keyboard size={13} /> 2. Auto Generate Bid Shortkey
              </label>
              <input
                type="text"
                className="form-input"
                value={formData.shortcuts.autoBid}
                onChange={(e) => handleShortcutChange('autoBid', e.target.value)}
              />
              <span className="hint-text">Captures job post text & auto-clicks Generate Bid.</span>
            </div>

            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Keyboard size={13} /> 3. Auto Generate Reply Shortkey
              </label>
              <input
                type="text"
                className="form-input"
                value={formData.shortcuts.autoReply}
                onChange={(e) => handleShortcutChange('autoReply', e.target.value)}
              />
              <span className="hint-text">Captures client message & auto-clicks Generate Reply.</span>
            </div>

            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Keyboard size={13} /> 4. Toggle Window Visibility Shortkey
              </label>
              <input
                type="text"
                className="form-input"
                value={formData.shortcuts.toggleWindow}
                onChange={(e) => handleShortcutChange('toggleWindow', e.target.value)}
              />
              <span className="hint-text">Shows or minimizes Closer AI window to tray.</span>
            </div>
          </>
        )}

        <div style={{ marginTop: 'auto', display: 'flex', gap: '8px', paddingTop: '8px' }}>
          <button type="button" className="action-btn-sm btn-secondary" onClick={onClose} style={{ flex: 1 }}>
            Cancel
          </button>
          <button type="submit" className="action-btn-sm btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
            <Save size={14} />
            <span>Save Settings</span>
          </button>
        </div>
      </form>
    </div>
  );
}
