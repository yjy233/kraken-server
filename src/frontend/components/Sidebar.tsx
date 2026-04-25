import React from 'react'
import type { Session, SessionSummary } from '../types.js'

interface SidebarProps {
  sessions: SessionSummary[]
  activeSession: Session | null
  onOpenSession: (id: string) => void
  onDeleteSession: (id: string) => void
  onRefresh: () => void
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  activeSession,
  onOpenSession,
  onDeleteSession,
  onRefresh,
}) => {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <img src="/logo.png" className="sidebar-logo" alt="Kraken" />
          <h2>Sessions</h2>
        </div>
        <button className="icon-button" type="button" aria-label="Refresh sessions" onClick={onRefresh}>
          Refresh
        </button>
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
              <span
                className="session-delete"
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteSession(s.id)
                }}
              >
                Delete
              </span>
            </button>
          ))
        )}
      </div>
    </aside>
  )
}
