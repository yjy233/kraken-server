import React from 'react'
import type { Session, SessionSummary } from '../types.js'

interface SidebarProps {
  sessions: SessionSummary[]
  activeSession: Session | null
  onOpenSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onClearAll: () => void
  onRefresh: () => void
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  activeSession,
  onOpenSession,
  onDeleteSession,
  onClearAll,
  onRefresh,
}) => {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <img src="/logo.png" className="sidebar-logo" alt="Kraken" />
          <h2>Sessions</h2>
        </div>
        <div className="sidebar-actions">
          <button className="icon-button" type="button" aria-label="Refresh sessions" onClick={onRefresh}>
            Refresh
          </button>
          {sessions.length > 0 && (
            <button
              className="icon-button danger"
              type="button"
              aria-label="Clear all sessions"
              title="Clear all"
              onClick={onClearAll}
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      <div className="session-list">
        {sessions.length === 0 ? (
          <p className="empty-state">No saved sessions yet.</p>
        ) : (
          sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className="session-item"
              data-active={s.id === activeSession?.id}
              onClick={() => onOpenSession(s.id)}
            >
              <span className="session-title">{s.title}</span>
              <div className="session-meta-row">
                <span className="session-preview">{s.preview || 'Empty session'}</span>
                <span className="session-time">{new Date(s.updatedAt).toLocaleDateString()}</span>
              </div>
              <button
                className="session-delete-btn"
                type="button"
                aria-label="Delete session"
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteSession(s.id)
                }}
              >
                ×
              </button>
            </button>
          ))
        )}
      </div>
    </aside>
  )
}
