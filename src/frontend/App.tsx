import React, { useState, useEffect, useCallback } from 'react'
import { Sidebar } from './components/Sidebar.js'
import { MessageList } from './components/MessageList.js'
import { Composer } from './components/Composer.js'
import { useConfig } from './hooks/useConfig.js'
import { useSessions } from './hooks/useSessions.js'
import { useChat } from './hooks/useChat.js'
import type { SessionSandboxConfig } from './types.js'

export default function App() {
  const { config, error: configError } = useConfig()
  const sessions = useSessions()
  const [systemPrompt, setSystemPrompt] = useState('')
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [readRootsInput, setReadRootsInput] = useState('')

  useEffect(() => {
    sessions.refresh()
  }, [sessions.refresh])

  useEffect(() => {
    if (config && !sessions.activeSession && !systemPrompt) {
      setSystemPrompt(config.defaultSystemPrompt)
    }
  }, [config, sessions.activeSession, systemPrompt])

  useEffect(() => {
    if (sessions.activeSession) {
      setSystemPrompt(sessions.activeSession.systemPrompt || config?.defaultSystemPrompt || '')
      setWorkspaceRoot(sessions.activeSession.sandbox?.workspaceRoot || '')
      setReadRootsInput((sessions.activeSession.sandbox?.readRoots || []).join('\n'))
    }
  }, [sessions.activeSession?.id, config])

  useEffect(() => {
    if (!sessions.activeSession && config) {
      setWorkspaceRoot(config.defaultWorkspaceRoot || '')
      setReadRootsInput('')
    }
  }, [sessions.activeSession, config])

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
    await sessions.create(sp, buildSandboxConfig(workspaceRoot, readRootsInput))
  }, [chat, sessions, systemPrompt, config, workspaceRoot, readRootsInput])

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

  const handleClearAll = useCallback(async () => {
    chat.clearError()
    await sessions.clearAll()
  }, [chat, sessions])

  const handleSend = useCallback(
    (message: string) => {
      chat.send(message, systemPrompt, buildSandboxConfig(workspaceRoot, readRootsInput))
    },
    [chat, systemPrompt, workspaceRoot, readRootsInput]
  )

  const handleSaveSandbox = useCallback(async () => {
    if (!sessions.activeSession) return
    const sandbox = buildSandboxConfig(workspaceRoot, readRootsInput)
    sessions.setSandbox(sessions.activeSession.id, sandbox)
    const body = sandbox ? { sandbox } : {}
    await sessions.patch(sessions.activeSession.id, body)
  }, [sessions, workspaceRoot, readRootsInput])

  return (
    <div className="page-shell">
      <Sidebar
        sessions={sessions.sessions}
        activeSession={sessions.activeSession}
        onOpenSession={handleOpenSession}
        onDeleteSession={handleDeleteSession}
        onClearAll={handleClearAll}
        onRefresh={sessions.refresh}
      />

      <main className="chat-panel">
        <header className="chat-header">
          <div>
            <h2>{sessions.activeSession?.title || 'New chat'}</h2>
            <div className="sandbox-meta">
              <input
                className="sandbox-input"
                type="text"
                placeholder={config?.defaultWorkspaceRoot || '~/kraken'}
                value={workspaceRoot}
                onChange={(e) => setWorkspaceRoot(e.target.value)}
              />
              <textarea
                className="sandbox-textarea"
                rows={2}
                placeholder="Extra readable roots, one per line"
                value={readRootsInput}
                onChange={(e) => setReadRootsInput(e.target.value)}
              />
              {sessions.activeSession && (
                <button className="ghost-button" type="button" onClick={handleSaveSandbox}>
                  Save sandbox
                </button>
              )}
            </div>
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

function buildSandboxConfig(workspaceRoot: string, readRootsInput: string): SessionSandboxConfig | undefined {
  const normalizedWorkspaceRoot = workspaceRoot.trim()
  const readRoots = readRootsInput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (!normalizedWorkspaceRoot && readRoots.length === 0) {
    return undefined
  }

  const sandbox: SessionSandboxConfig = {}
  if (normalizedWorkspaceRoot) {
    sandbox.workspaceRoot = normalizedWorkspaceRoot
  }
  if (readRoots.length > 0) {
    sandbox.readRoots = readRoots
  }
  return sandbox
}
