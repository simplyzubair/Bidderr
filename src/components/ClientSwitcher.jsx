import React, { useState } from 'react';
import { Users, Plus, ChevronDown, ChevronUp, Trash2, ClipboardPaste } from 'lucide-react';

export default function ClientSwitcher({
  clients,
  activeClientId,
  onAddClient,
  onSelectClient,
  onDeleteClient,
  onUpdateChatHistory,
  onPasteChatHistory,
  onClearChatHistory,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newName, setNewName] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const activeClient = clients.find(c => c.id === activeClientId);

  const handleAddClient = () => {
    if (!newName.trim()) return;
    onAddClient(newName.trim());
    setNewName('');
    setShowNewInput(false);
  };

  return (
    <div className="client-switcher">
      {/* Main Toggle Bar */}
      <button
        type="button"
        className="client-toggle-bar"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="client-bar-left">
          <Users size={13} style={{ color: '#8b5cf6' }} />
          <span className="client-bar-label">
            {activeClient ? activeClient.name : 'No Client Selected'}
          </span>
          {activeClient && (
            <span className="client-dot" />
          )}
        </span>
        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {/* Expanded Panel */}
      {isOpen && (
        <div className="client-panel">
          {/* Client List */}
          <div className="client-list">
            {clients.map(client => (
              <div
                key={client.id}
                className={`client-item ${client.id === activeClientId ? 'client-item-active' : ''}`}
              >
                <button
                  className="client-item-btn"
                  onClick={() => onSelectClient(client.id)}
                >
                  <span className={client.id === activeClientId ? 'client-dot' : 'client-dot-dim'} />
                  <span className="client-item-name">{client.name}</span>
                </button>
                <button
                  className="client-delete-btn"
                  onClick={() => onDeleteClient(client.id)}
                  title="Remove client"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}

            {clients.length === 0 && (
              <div className="client-empty">No clients yet — add one below</div>
            )}
          </div>

          {/* Add New Client */}
          {showNewInput ? (
            <div className="client-add-row">
              <input
                type="text"
                className="client-add-input"
                placeholder="e.g. Sarah - Logo Project"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddClient()}
                autoFocus
              />
              <button className="client-add-btn" onClick={handleAddClient}>Add</button>
              <button className="client-cancel-btn" onClick={() => { setShowNewInput(false); setNewName(''); }}>✕</button>
            </div>
          ) : (
            <button className="client-new-btn" onClick={() => setShowNewInput(true)}>
              <Plus size={13} /> New Client
            </button>
          )}

          {/* Single Session Chat File for Active Client */}
          {activeClient && (
            <div className="client-history-section">
              <button
                className="client-history-toggle"
                onClick={() => setShowHistory(!showHistory)}
              >
                <span>📄 Session Chat File: <strong>{activeClient.name}</strong>{activeClient.chatHistory ? ` (${activeClient.chatHistory.split('\n').filter(l => l.trim()).length} lines)` : ' (Empty)'}</span>
                {showHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>

              {showHistory && (
                <div className="client-history-body">
                  <textarea
                    className="client-history-textarea"
                    placeholder={`Paste 1 session chat for ${activeClient.name} here...\n\nCopy full chat thread from Fiverr/Upwork → click "Paste Session File" below.\nThe AI will read ONLY this single session chat file.`}
                    value={activeClient.chatHistory || ''}
                    onChange={e => onUpdateChatHistory(activeClient.id, e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      className="client-paste-btn"
                      onClick={() => onPasteChatHistory(activeClient.id)}
                      title="Replace this session file with copied clipboard chat"
                    >
                      <ClipboardPaste size={12} /> Paste & Replace Session File
                    </button>
                    {activeClient.chatHistory && (
                      <button
                        className="client-cancel-btn"
                        onClick={() => onClearChatHistory && onClearChatHistory(activeClient.id)}
                        style={{ fontSize: '0.7rem', padding: '4px 8px' }}
                        title="Clear this session chat file"
                      >
                        Clear File
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
