import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import ClientSwitcher from './components/ClientSwitcher';
import ResponseBox from './components/ResponseBox';
import SettingsModal from './components/SettingsModal';
import HistoryDrawer from './components/HistoryDrawer';

import { generateAIResponse } from './services/aiService';
import { loadSettings, saveSettings, loadHistory, saveHistoryItem, clearHistory, loadClients, addClient, updateClient, deleteClient, getActiveClientId, setActiveClientId } from './services/storage';
import { Clipboard } from 'lucide-react';

export default function App() {
  const [settings, setSettings] = useState(loadSettings());
  const [history, setHistory] = useState(loadHistory());
  const [capturedText, setCapturedText] = useState('');
  const [activeTab, setActiveTab] = useState('bid'); // 'bid' | 'reply' — only one section shown at a time

  // Bid and Chat are two fully distinct pipelines: separate response, generating, and copied state.
  const [bidResponse, setBidResponse] = useState('');
  const [chatResponse, setChatResponse] = useState('');
  const [isGeneratingBid, setIsGeneratingBid] = useState(false);
  const [isGeneratingChat, setIsGeneratingChat] = useState(false);
  const [bidCopied, setBidCopied] = useState(false);
  const [chatCopied, setChatCopied] = useState(false);
  const [toast, setToast] = useState('');

  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Client sessions state
  const [clients, setClients] = useState(loadClients());
  const [activeClientId, setActiveClient] = useState(getActiveClientId());

  const activeClient = clients.find(c => c.id === activeClientId) || null;

  const combinedStatus = (isGeneratingBid || isGeneratingChat)
    ? 'generating'
    : (bidCopied || chatCopied)
    ? 'copied'
    : 'ready';

  // Show Toast notification
  const showToastMsg = (msg, durationMs = 3000) => {
    setToast(msg);
    setTimeout(() => setToast(''), durationMs);
  };

  // Check if clipboard text is the AI's own response that was auto-copied
  const lastCopiedOutputRef = React.useRef('');

  const isOwnAIResponse = useCallback((text) => {
    if (!text || !text.trim()) return false;
    const t = text.trim();
    if (lastCopiedOutputRef.current && t === lastCopiedOutputRef.current.trim()) return true;
    if (bidResponse && t === bidResponse.trim()) return true;
    if (chatResponse && t === chatResponse.trim()) return true;
    if (t.includes('Cheers,\nKhan') || t.includes('Cheers, Khan')) return true;
    return false;
  }, [bidResponse, chatResponse]);

  // Helper to safely grab fresh screen selection or clipboard without picking up AI's own responses
  const getFreshCapturedText = useCallback(async () => {
    if (!window.electronAPI) return '';
    let screenText = await window.electronAPI.triggerCopySelection();
    if (screenText && screenText.trim() && !isOwnAIResponse(screenText)) {
      return screenText.trim();
    }
    let clipText = await window.electronAPI.readClipboard();
    if (clipText && clipText.trim() && !isOwnAIResponse(clipText)) {
      return clipText.trim();
    }
    return '';
  }, [isOwnAIResponse]);

  // Main AI generation runner. `slot` is 'bid' or 'reply' and picks which distinct
  // pipeline (response state, engine settings, generating flag) this call feeds.
  const handleRunAI = useCallback(async (slot, actionType, textToProcess, variant = '') => {
    const textTarget = textToProcess || capturedText;
    if (!textTarget) {
      return;
    }

    const setResponse = slot === 'bid' ? setBidResponse : setChatResponse;
    const setGenerating = slot === 'bid' ? setIsGeneratingBid : setIsGeneratingChat;
    const setCopiedFlag = slot === 'bid' ? setBidCopied : setChatCopied;

    setGenerating(true);

    try {
      const { text: output, usedFallback } = await generateAIResponse({
        action: actionType,
        capturedText: textTarget,
        engineSettings: slot === 'bid' ? settings.bidEngine : settings.chatEngine,
        sharedSettings: {
          userPersona: settings.userPersona,
          tone: settings.tone,
          savedSituations: settings.savedSituations,
          redFlagsPrompt: settings.redFlagsPrompt,
        },
        clientChatHistory: slot === 'reply' ? (activeClient?.chatHistory || '') : '',
        clientName: slot === 'reply' ? (activeClient?.name || '') : '',
        variant,
      });

      setResponse(output);
      lastCopiedOutputRef.current = output;

      // Auto-copy output to system clipboard immediately
      if (window.electronAPI) {
        await window.electronAPI.writeClipboard(output);
      }
      setCopiedFlag(true);
      setTimeout(() => setCopiedFlag(false), 2500);

      if (usedFallback) {
        // Not a real AI reply — a generic offline fallback. Loudly flag this so it
        // never gets mistaken for (and sent as) a tailored answer.
        showToastMsg('⚠️ AI unavailable — generic fallback shown, not a real reply. Check your API key in Settings.', 6000);
      }

      // Save to local history
      const updatedHist = saveHistoryItem({
        action: slot,
        capturedText: textTarget,
        response: output
      });
      setHistory(updatedHist);

    } catch (err) {
      console.error('AI Error:', err);
    } finally {
      setGenerating(false);
    }
  }, [capturedText, settings, activeClient]);

  // Handle Global Hotkey actions from Electron IPC
  useEffect(() => {
    if (!window.electronAPI) return;

    // Handle new 4-hotkey action events
    const cleanupAction = window.electronAPI.onHotkeyAction?.(async ({ action, text }) => {
      const trimmedText = text ? text.trim() : '';
      let textToUse = (!isOwnAIResponse(trimmedText)) ? trimmedText : '';

      if (!textToUse) {
        textToUse = await getFreshCapturedText();
      }

      if (action === 'FEED_CONTEXT') {
        if (textToUse) {
          if (activeClientId) {
            const currentHist = activeClient?.chatHistory || '';
            const newHist = currentHist ? `${currentHist}\n\n${textToUse}` : textToUse;
            const updated = updateClient(activeClientId, { chatHistory: newHist });
            setClients(updated);
            setActiveTab('reply');
            showToastMsg(`📥 Context fed into ${activeClient?.name || 'Active Client'}!`);
          } else {
            showToastMsg('⚠️ Please select or create a Client to feed context into!');
          }
        } else {
          showToastMsg('⚠️ No text selected — highlight chat history in your browser first.');
        }
      } else if (action === 'AUTO_BID') {
        setActiveTab('bid');
        if (textToUse) {
          setCapturedText(textToUse);
          handleRunAI('bid', 'bid', textToUse);
          showToastMsg('🎯 Auto Bid triggered!');
        } else if (capturedText && capturedText.trim() && !isOwnAIResponse(capturedText)) {
          handleRunAI('bid', 'bid', capturedText.trim());
          showToastMsg('🎯 Auto Bid triggered!');
        } else {
          showToastMsg('⚠️ No text selected — highlight the job post in your browser first.');
        }
      } else if (action === 'AUTO_REPLY') {
        setActiveTab('reply');
        if (textToUse) {
          setCapturedText(textToUse);
          handleRunAI('reply', 'reply', textToUse);
          showToastMsg('💬 Auto Reply triggered!');
        } else if (capturedText && capturedText.trim() && !isOwnAIResponse(capturedText)) {
          handleRunAI('reply', 'reply', capturedText.trim());
          showToastMsg('💬 Auto Reply triggered!');
        } else {
          showToastMsg('⚠️ No text selected — highlight the client message in your browser first.');
        }
      }
    });

    // Legacy fallback listener
    const cleanupLegacy = window.electronAPI.onHotkeyTriggered?.(async ({ text }) => {
      const trimmedText = text ? text.trim() : '';
      let textToUse = (!isOwnAIResponse(trimmedText)) ? trimmedText : '';

      if (!textToUse) {
        textToUse = await getFreshCapturedText();
      }

      if (textToUse) {
        setCapturedText(textToUse);
        showToastMsg('Captured! Press Generate Bid or Generate Reply.');
      }
    });

    return () => {
      if (cleanupAction) cleanupAction();
      if (cleanupLegacy) cleanupLegacy();
    };
  }, [getFreshCapturedText, isOwnAIResponse, activeClientId, activeClient, capturedText, handleRunAI]);

  // Read selection manually or from clipboard button
  const handleManualCapture = async () => {
    const text = await getFreshCapturedText();
    if (text) {
      setCapturedText(text);
    }
  };

  const handleGenerateBid = async () => {
    setActiveTab('bid');
    let textToUse = await getFreshCapturedText();
    if (!textToUse && capturedText && capturedText.trim() && !isOwnAIResponse(capturedText)) {
      textToUse = capturedText.trim();
    }
    const finalVal = textToUse ? textToUse.trim() : '';
    if (finalVal) {
      setCapturedText(finalVal);
      handleRunAI('bid', 'bid', finalVal);
    }
  };

  const handleGenerateChat = async () => {
    setActiveTab('reply');
    let textToUse = await getFreshCapturedText();
    if (!textToUse && capturedText && capturedText.trim() && !isOwnAIResponse(capturedText)) {
      textToUse = capturedText.trim();
    }
    const finalVal = textToUse ? textToUse.trim() : '';
    if (finalVal) {
      setCapturedText(finalVal);
      handleRunAI('reply', 'reply', finalVal);
    }
  };

  // Copy to clipboard manually
  const handleCopyResponse = async (slot) => {
    const text = slot === 'bid' ? bidResponse : chatResponse;
    if (!text) return;
    if (window.electronAPI) {
      await window.electronAPI.writeClipboard(text);
    } else {
      navigator.clipboard?.writeText(text);
    }
    const setCopiedFlag = slot === 'bid' ? setBidCopied : setChatCopied;
    setCopiedFlag(true);
    showToastMsg('Copied to Clipboard!');
    setTimeout(() => setCopiedFlag(false), 2000);
  };

  // Paste response back into target window
  const handlePasteResponse = async (slot) => {
    const text = slot === 'bid' ? bidResponse : chatResponse;
    if (!text) return;
    if (window.electronAPI) {
      await window.electronAPI.writeClipboard(text);
      await window.electronAPI.triggerPasteSelection();
      showToastMsg('Pasted into active window!');
    }
  };

  // Save Settings handler
  const handleSaveSettings = (newSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
    if (window.electronAPI) {
      if (newSettings.shortcuts) {
        window.electronAPI.updateShortcuts(newSettings.shortcuts);
      } else if (newSettings.shortcutKey) {
        window.electronAPI.updateHotkey(newSettings.shortcutKey);
      }
    }
    showToastMsg('⚙️ Settings & Agent Prompt Saved!');
  };

  // Always on top handler
  const handleToggleAlwaysOnTop = async () => {
    if (window.electronAPI) {
      const newState = await window.electronAPI.toggleAlwaysOnTop(!alwaysOnTop);
      setAlwaysOnTop(newState);
    } else {
      setAlwaysOnTop(!alwaysOnTop);
    }
  };

  // Client session handlers
  const handleAddClient = (name) => {
    const { clients: updated, newClient } = addClient(name);
    setClients(updated);
    setActiveClient(newClient.id);
  };

  const handleSelectClient = (clientId) => {
    setActiveClientId(clientId);
    setActiveClient(clientId);
  };

  const handleDeleteClient = (clientId) => {
    const updated = deleteClient(clientId);
    setClients(updated);
    setActiveClient(getActiveClientId());
  };

  const handleUpdateChatHistory = (clientId, text) => {
    const updated = updateClient(clientId, { chatHistory: text });
    setClients(updated);
  };

  const handlePasteChatHistory = async (clientId) => {
    const text = window.electronAPI
      ? await window.electronAPI.readClipboard()
      : await navigator.clipboard?.readText();
    if (text && text.trim()) {
      const updated = updateClient(clientId, { chatHistory: text.trim() });
      setClients(updated);
      showToastMsg('Session file replaced from clipboard!');
    }
  };

  const handleClearChatHistory = (clientId) => {
    const updated = updateClient(clientId, { chatHistory: '' });
    setClients(updated);
  };

  return (
    <div className={`app-container ${(isGeneratingBid || isGeneratingChat) ? 'active-generating' : ''}`}>
      {/* Header Bar */}
      <Header
        status={combinedStatus}
        alwaysOnTop={alwaysOnTop}
        onToggleAlwaysOnTop={handleToggleAlwaysOnTop}
        onOpenSettings={() => setShowSettings(true)}
        onOpenHistory={() => setShowHistory(true)}
        onMinimize={() => window.electronAPI?.minimizeWindow()}
        onClose={() => window.electronAPI?.closeApp()}
      />

      {/* Hotkey Helper Banner */}
      <div className="hotkey-banner" style={{ flexWrap: 'wrap', gap: '6px', fontSize: '0.72rem' }}>
        <span>Context: <span className="key-badge">{settings.shortcuts?.feedContext || 'Alt+Shift+C'}</span></span>
        <span>Bid: <span className="key-badge">{settings.shortcuts?.autoBid || 'Alt+Shift+B'}</span></span>
        <span>Reply: <span className="key-badge">{settings.shortcuts?.autoReply || 'Alt+Shift+R'}</span></span>
        <span>Hide: <span className="key-badge">{settings.shortcuts?.toggleWindow || 'Alt+Shift+V'}</span></span>
        <button
          className="icon-btn"
          style={{ width: 'auto', padding: '2px 6px', fontSize: '0.68rem', gap: '3px', marginLeft: 'auto' }}
          onClick={handleManualCapture}
          title="Grab selected text or clipboard"
        >
          <Clipboard size={12} /> Read Selection
        </button>
      </div>

      {/* Main Body */}
      <div className="app-body">
        {/* Captured Text Section (shared by both Bid and Chat) */}
        <div>
          <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Client Message / Bid Selection</span>
            {capturedText && (
              <button
                onClick={() => setCapturedText('')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  padding: '2px 6px',
                  borderRadius: '4px'
                }}
                title="Clear input text"
              >
                Clear ✕
              </button>
            )}
          </div>
          <textarea
            className="captured-card"
            style={{ width: '100%', minHeight: '56px', resize: 'vertical', userSelect: 'text' }}
            placeholder={`Highlight client text anywhere on screen & press ${settings.shortcutKey || 'Alt+Shift+C'}, or paste here...`}
            value={capturedText}
            onChange={(e) => setCapturedText(e.target.value)}
          />
        </div>

        {/* Tab strip — clicking a tab also captures + generates for that mode */}
        <div className="segmented-control-bar">
          <button
            className={`segmented-pill-btn ${activeTab === 'bid' ? 'pill-active bid' : ''}`}
            disabled={isGeneratingBid}
            onClick={handleGenerateBid}
          >
            Generate Bid
          </button>
          <button
            className={`segmented-pill-btn ${activeTab === 'reply' ? 'pill-active chat' : ''}`}
            disabled={isGeneratingChat}
            onClick={handleGenerateChat}
          >
            Generate Reply
          </button>
        </div>

        {/* Only the active tab's section renders, so the inactive one takes no space */}
        {activeTab === 'bid' ? (
          <div className="mode-section mode-section-bid">
            <ResponseBox
              responseText={bidResponse}
              setResponseText={setBidResponse}
              isGenerating={isGeneratingBid}
              onCopy={() => handleCopyResponse('bid')}
              onPaste={() => handlePasteResponse('bid')}
              onVariant={(v) => handleRunAI('bid', 'bid', capturedText, v)}
              copied={bidCopied}
            />
          </div>
        ) : (
          <div className="mode-section mode-section-chat">
            {/* Client Context Switcher + per-client session chat history paste — chat-specific */}
            <ClientSwitcher
              clients={clients}
              activeClientId={activeClientId}
              onAddClient={handleAddClient}
              onSelectClient={handleSelectClient}
              onDeleteClient={handleDeleteClient}
              onUpdateChatHistory={handleUpdateChatHistory}
              onPasteChatHistory={handlePasteChatHistory}
              onClearChatHistory={handleClearChatHistory}
            />

            <ResponseBox
              responseText={chatResponse}
              setResponseText={setChatResponse}
              isGenerating={isGeneratingChat}
              onCopy={() => handleCopyResponse('reply')}
              onPaste={() => handlePasteResponse('reply')}
              onVariant={(v) => handleRunAI('reply', 'reply', capturedText, v)}
              copied={chatCopied}
            />
          </div>
        )}
      </div>

      {toast && <div className="toast-msg">{toast}</div>}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* History Drawer */}
      {showHistory && (
        <HistoryDrawer
          history={history}
          onSelectHistoryItem={(item) => {
            setCapturedText(item.capturedText || '');
            if (item.action === 'bid') {
              setBidResponse(item.response || '');
              setActiveTab('bid');
            } else {
              setChatResponse(item.response || '');
              setActiveTab('reply');
            }
            setShowHistory(false);
            showToastMsg('Loaded from History!');
          }}
          onClearHistory={() => {
            clearHistory();
            setHistory([]);
          }}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}
