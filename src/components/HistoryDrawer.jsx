import React from 'react';
import { X, History, Copy, Trash2 } from 'lucide-react';

export default function HistoryDrawer({ history, onSelectHistoryItem, onClearHistory, onClose }) {
  return (
    <div className="modal-overlay">
      <div className="modal-header">
        <div className="modal-title">
          <History size={16} color="var(--accent-secondary)" />
          <span>Past AI Generations ({history.length})</span>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {history.length > 0 && (
            <button className="icon-btn" onClick={onClearHistory} title="Clear All History">
              <Trash2 size={14} color="var(--accent-rose)" />
            </button>
          )}
          <button className="icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="modal-body">
        {history.length === 0 ? (
          <div className="empty-state-text" style={{ marginTop: '40px' }}>
            No saved history yet. Highlight client text and press hotkey to get started!
          </div>
        ) : (
          history.map((item) => (
            <div
              key={item.id}
              className="captured-card"
              style={{ display: 'flex', flexDirection: 'column', gap: '6px', cursor: 'pointer' }}
              onClick={() => onSelectHistoryItem(item)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="key-badge" style={{ textTransform: 'uppercase' }}>
                  {item.action || 'Reply'}
                </span>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>
                  {item.timestamp}
                </span>
              </div>
              <div style={{ color: 'var(--text-main)', fontSize: '0.8rem', fontStyle: 'normal' }}>
                {item.response ? item.response.substring(0, 120) + '...' : ''}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <Copy size={11} /> Load into Editor
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
