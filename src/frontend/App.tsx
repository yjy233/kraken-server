import React, { useState, useEffect, useCallback } from 'react'
import { Sidebar } from './components/Sidebar.js'
import { MessageList } from './components/MessageList.js'
import { Composer } from './components/Composer.js'
import { useConfig } from './hooks/useConfig.js'
import { useSessions } from './hooks/useSessions.js'
import { useChat } from './hooks/useChat.js'

export default function App() {
  const { config, error: configError } = useConfig()
  const sessions = useSessions()
  const [systemPrompt, setSystemPrompt] = useState('')

  useEffect(() => {
    if (config && !sessions.activeSession && !systemPrompt) {
      setSystemPrompt(config.defaultSystemPrompt)
    }
  }, [config, sessions.activeSession, systemPrompt])

  useEffect(() => {
    if (sessions.activeSession) {
      setSystemPrompt(sessions.activeSession.systemPrompt || config?.defaultSystemPrompt || '')
    }
  }, [sessions.activeSession?.id, config])

  const handleSessionUpdate = useCallback(
    (session: any) => {
      sessions.setActiveSession(session)
    },
    [sessions]
  )

  const chat = useChat(sessions.activeSession, handleSessionUpdate, sessions.refresh)

  const displayError = chat.error || configError

  const handleNewChat = useCallback(async () => {
    chat.clearError()
    const sp = systemPrompt || config?.defaultSystemPrompt || ''
    await sessions.create(sp)
  }, [chat, sessions, systemPrompt, config])

  const handleOpenSession = useCallback(
    async (id: string) => {
      chat.clearError()
      await sessions.open(id)
    },
    [chat, sessions]
  )

  const handleDeleteSession = useCallback(
    async (id: string) => {
      chat.clearError()
      await sessions.remove(id)
    },
    [chat, sessions]
  )

  const handleSend = useCallback(
    (message: string) => {
      chat.send(message, systemPrompt)
    },
    [chat, systemPrompt]
  )

  return (
    <div className="page-shell">
      <Sidebar
        sessions={sessions.sessions}
        activeSession={sessions.activeSession}
        onOpenSession={handleOpenSession}
        onDeleteSession={handleDeleteSession}
        onRefresh={sessions.refresh}
      />

      <main className="chat-panel">
        <header className="chat-header">
          <div>
            <h2>{sessions.activeSession?.title || 'New chat'}</h2>
          </div>
          <div className="header-meta">
            <span className="session-count">
              {sessions.activeSession
                ? `${sessions.activeSession.messages.length} messages`
                : 'No session'}
            </span>
            <span className="model-pill">{config?.model || 'Model'}</span>
            <button className="ghost-button" type="button" onClick={handleNewChat}>
              New chat
            </button>
          </div>
        </header>

        {displayError && (
          <div className="error-banner">
            {displayError}
          </div>
        )}

        <MessageList
          session={sessions.activeSession}
          runtimeEvents={chat.runtimeEvents}
          streamingText={chat.streamingText}
          sending={chat.sending}
        />

        <Composer sending={chat.sending} onSend={handleSend} onCancel={chat.cancel} />
      </main>
    </div>
  )
}
