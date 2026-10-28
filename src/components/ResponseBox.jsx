import React from 'react';
import { Copy, Check } from 'lucide-react';

export default function ResponseBox({
  responseText,
  setResponseText,
  isGenerating,
  onCopy,
  onPaste,
  onVariant,
  copied
}) {
  const wordCount = responseText ? responseText.trim().split(/\s+/).length : 0;

  return (
    <div className="response-container">
      <div className="response-header">
        <div className="response-badge">
          <span>AI AGENT RESPONSE</span>
        </div>
        <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>
          {wordCount} words
        </div>
      </div>

      <textarea
        className="response-text-area"
        placeholder={isGenerating ? 'Analyzing client message & crafting response...' : 'Generated AI response will appear here...'}
        value={responseText}
        onChange={(e) => setResponseText(e.target.value)}
        disabled={isGenerating}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          className="action-btn-sm btn-secondary"
          onClick={onPaste}
          disabled={!responseText || isGenerating}
          title="Paste response directly into client message / bid box"
        >
          <span>Auto-Paste (Ctrl+V)</span>
        </button>

        <button
          className="action-btn-sm btn-secondary"
          onClick={() => onVariant?.('shorter')}
          disabled={!responseText || isGenerating}
          title="Rewrite shorter and punchier"
        >
          <span>Shorter</span>
        </button>

        <button
          className="action-btn-sm btn-secondary"
          onClick={() => onVariant?.('different')}
          disabled={!responseText || isGenerating}
          title="Write a fresh version with a different opening"
        >
          <span>New angle</span>
        </button>

        <button
          className="action-btn-sm btn-primary"
          onClick={onCopy}
          disabled={!responseText || isGenerating}
          title="Copy generated response to clipboard"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? 'Copied!' : 'Copy Reply'}</span>
        </button>
      </div>
    </div>
  );
}
