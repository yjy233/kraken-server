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
  const defaultWorkspaceRoot = config?.defaultWorkspaceRoot || ''
  const effectiveWorkspaceRoot = workspaceRoot.trim() || defaultWorkspaceRoot

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
      setWorkspaceRoot(sessions.activeSession.sandbox?.workspaceRoot || config?.defaultWorkspaceRoot || '')
      setReadRootsInput((sessions.activeSession.sandbox?.readRoots || []).join(', '))
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
    await sessions.create(sp, buildSandboxConfig(effectiveWorkspaceRoot, readRootsInput))
  }, [chat, sessions, systemPrompt, config, effectiveWorkspaceRoot, readRootsInput])

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
      chat.send(message, systemPrompt, buildSandboxConfig(effectiveWorkspaceRoot, readRootsInput))
    },
    [chat, systemPrompt, effectiveWorkspaceRoot, readRootsInput]
  )

  const handleSaveSandbox = useCallback(async () => {
    if (!sessions.activeSession) return
    const sandbox = buildSandboxConfig(effectiveWorkspaceRoot, readRootsInput)
    sessions.setSandbox(sessions.activeSession.id, sandbox)
    const body = sandbox ? { sandbox } : {}
    await sessions.patch(sessions.activeSession.id, body)
  }, [sessions, effectiveWorkspaceRoot, readRootsInput])

  return (
    <div className="page-shell">
      <Sidebar
        sessions={sessions.sessions}
        activeSession={sessions.activeSession}
        skills={config?.skills || []}
        onOpenSession={handleOpenSession}
        onDeleteSession={handleDeleteSession}
        onClearAll={handleClearAll}
        onRefresh={sessions.refresh}
      />

      <main className="chat-panel">
        <header className="chat-header">
          <div className="header-primary">
            <h2>{sessions.activeSession?.title || 'New chat'}</h2>
            <div className="sandbox-meta">
              <div className="sandbox-field">
                <label className="sandbox-label" htmlFor="workspace-root">
                  Workspace
                </label>
                <input
                  id="workspace-root"
                  className="sandbox-input"
                  type="text"
                  placeholder={config?.defaultWorkspaceRoot || '~/kraken'}
                  value={workspaceRoot}
                  onChange={(e) => setWorkspaceRoot(e.target.value)}
                />
              </div>
              <div className="sandbox-field sandbox-field-grow">
                <label className="sandbox-label" htmlFor="read-roots">
                  Read Roots
                </label>
                <input
                  id="read-roots"
                  className="sandbox-input"
                  type="text"
                  placeholder="Optional. Comma-separated readable roots"
                  value={readRootsInput}
                  onChange={(e) => setReadRootsInput(e.target.value)}
                />
              </div>
              <button
                className="ghost-button sandbox-save-button"
                type="button"
                onClick={handleSaveSandbox}
                disabled={!sessions.activeSession}
              >
                Save sandbox
              </button>
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
    .split(/[\n,]/)
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
