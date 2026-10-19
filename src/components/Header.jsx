import React from 'react';
import { Pin, Settings, History, Minus, X, Zap } from 'lucide-react';

export default function Header({
  status,
  alwaysOnTop,
  onToggleAlwaysOnTop,
  onOpenSettings,
  onOpenHistory,
  onMinimize,
  onClose
}) {
  return (
    <header className="app-header">
      <div className="header-left">
        <div className="brand-badge">
          <Zap size={13} fill="#fff" />
          <span>CLOSER AI</span>
        </div>
        <div className="status-indicator">
          <span className={`status-dot ${status}`} />
          <span style={{ textTransform: 'capitalize' }}>
            {status === 'generating' ? 'AI Reasoning...' : status === 'copied' ? 'Copied!' : 'Ready'}
          </span>
        </div>
      </div>

      <div className="header-actions">
        <button
          className={`icon-btn ${alwaysOnTop ? 'active' : ''}`}
          onClick={onToggleAlwaysOnTop}
          title={alwaysOnTop ? 'Always on top: ON' : 'Always on top: OFF'}
        >
          <Pin size={14} />
        </button>

        <button className="icon-btn" onClick={onOpenHistory} title="Past History">
          <History size={14} />
        </button>

        <button className="icon-btn" onClick={onOpenSettings} title="Settings & Custom Agent Instructions">
          <Settings size={14} />
        </button>

        <button className="icon-btn" onClick={onMinimize} title="Minimize">
          <Minus size={14} />
        </button>

        <button className="icon-btn close-btn" onClick={onClose} title="Close App">
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
