import React, { useState, useEffect, useCallback } from 'react'
import { Sidebar } from './components/Sidebar.js'
import { MessageList } from './components/MessageList.js'
import { Composer } from './components/Composer.js'
import type { ImageBlock } from './types.js'
import { ScheduledJobsPanel } from './components/ScheduledJobsPanel.js'
import { WorkspacePanel } from './components/WorkspacePanel.js'
import { ModelUsagePanel } from './components/ModelUsagePanel.js'
import { ProposalReviewPanel } from './components/ProposalReviewPanel.js'
import { ContextWindowMeter } from './components/ContextWindowMeter.js'
import { useConfig } from './hooks/useConfig.js'
import { useSessions } from './hooks/useSessions.js'
import { useChat } from './hooks/useChat.js'
import { useScheduledJobs } from './hooks/useScheduledJobs.js'
import { useModelUsage } from './hooks/useModelUsage.js'
import { useEvolutionProposals } from './hooks/useEvolutionProposals.js'
import type { SessionSandboxConfig } from './types.js'

export default function App() {
  const { config, error: configError } = useConfig()
  const sessions = useSessions()
  const [activeTab, setActiveTab] = useState<'chat' | 'files' | 'scheduled' | 'usage' | 'evolution'>('chat')
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

  const chat = useChat(
    sessions.activeSession,
    handleSessionUpdate,
    sessions.refresh,
    sessions.setContextWindow
  )
  const scheduled = useScheduledJobs(activeTab === 'scheduled')
  const modelUsage = useModelUsage(activeTab === 'usage')
  const evolution = useEvolutionProposals(activeTab === 'evolution')

  useEffect(() => {
    const hasSucceededExecution = Object.values(scheduled.executionsByJob)
      .flat()
      .some((execution) => execution.status === 'succeeded')
    if (!hasSucceededExecution) {
      return
    }
    void sessions.refresh()
  }, [scheduled.executionsByJob, sessions])

  const displayError = activeTab === 'chat'
    ? (chat.error || configError)
    : configError

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
    (message: string, images: ImageBlock[]) => {
      chat.send(message, systemPrompt, buildSandboxConfig(effectiveWorkspaceRoot, readRootsInput), images)
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

  const handleOpenScheduledSession = useCallback(
    async (sessionId: string) => {
      chat.clearError()
      await sessions.open(sessionId)
      await sessions.refresh()
      setActiveTab('chat')
    },
    [chat, sessions]
  )

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
            <div className="panel-tabs" role="tablist" aria-label="Primary views">
              <button
                className="panel-tab"
                type="button"
                data-active={activeTab === 'chat'}
                onClick={() => setActiveTab('chat')}
              >
                Chat
              </button>
              <button
                className="panel-tab"
                type="button"
                data-active={activeTab === 'files'}
                onClick={() => setActiveTab('files')}
              >
                Files
              </button>
              <button
                className="panel-tab"
                type="button"
                data-active={activeTab === 'scheduled'}
                onClick={() => setActiveTab('scheduled')}
              >
                Scheduled
              </button>
              <button
                className="panel-tab"
                type="button"
                data-active={activeTab === 'usage'}
                onClick={() => setActiveTab('usage')}
              >
                Usage
              </button>
              <button
                className="panel-tab"
                type="button"
                data-active={activeTab === 'evolution'}
                onClick={() => setActiveTab('evolution')}
              >
                Evolution
              </button>
            </div>

            {activeTab === 'chat' ? (
              <>
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
              </>
            ) : activeTab === 'files' ? (
              <div className="scheduled-header-copy">
                <h2>Workspace Files</h2>
                <p>
                  Browse, upload, edit, and download files from the current workspace.
                </p>
              </div>
            ) : activeTab === 'scheduled' ? (
              <div className="scheduled-header-copy">
                <h2>Scheduled Jobs</h2>
                <p>
                  Create one-off, interval, and cron jobs. Jobs can bootstrap from a template session and optionally create a fresh session on each run.
                </p>
              </div>
            ) : activeTab === 'usage' ? (
              <div className="scheduled-header-copy">
                <h2>Model Usage</h2>
                <p>
                  Track model requests, token totals, cache hits, usage fields, and cost by model.
                </p>
              </div>
            ) : (
              <div className="scheduled-header-copy">
                <h2>Evolution Proposals</h2>
                <p>
                  Review self-improvement proposals before they change long-term behavior.
                </p>
              </div>
            )}
          </div>
          {activeTab === 'chat' ? (
            <div className="header-meta">
              <span className="session-count">
                {sessions.activeSession
                  ? `${sessions.activeSession.messages.length} messages`
                  : 'No session'}
              </span>
              <span className="model-pill">{config?.model || 'Model'}</span>
              <ContextWindowMeter contextWindow={sessions.activeSession?.contextWindow} compact />
              <button className="ghost-button" type="button" onClick={handleNewChat}>
                New chat
              </button>
            </div>
          ) : activeTab === 'files' ? (
            <div className="header-meta">
              <span className="session-count">
                {sessions.activeSession?.sandbox?.workspaceRoot || config?.defaultWorkspaceRoot || 'Workspace'}
              </span>
              <span className="model-pill">Browse and edit</span>
            </div>
          ) : activeTab === 'scheduled' ? (
            <div className="header-meta">
              <span className="session-count">
                {scheduled.status
                  ? `${scheduled.status.jobCount} jobs`
                  : `${scheduled.jobs.length} jobs`}
              </span>
              <span className="model-pill">
                {config?.schedulerEnabled ? 'Scheduler on' : 'Scheduler off'}
              </span>
              <button className="ghost-button" type="button" onClick={() => void scheduled.refresh()}>
                Refresh jobs
              </button>
            </div>
          ) : activeTab === 'usage' ? (
            <div className="header-meta">
              <span className="session-count">
                {modelUsage.summary
                  ? `${modelUsage.summary.totals.requestCount} requests`
                  : 'Usage loading'}
              </span>
              <span className="model-pill">
                {modelUsage.summary
                  ? `${modelUsage.summary.modelCount} models`
                  : 'Model logs'}
              </span>
              <button className="ghost-button" type="button" onClick={() => void modelUsage.refresh()}>
                Refresh usage
              </button>
            </div>
          ) : (
            <div className="header-meta">
              <span className="session-count">
                {evolution.counts.pending} pending
              </span>
              <span className="model-pill">
                {evolution.counts.all} total
              </span>
              <button className="ghost-button" type="button" onClick={() => void evolution.refresh()}>
                Refresh proposals
              </button>
            </div>
          )}
        </header>

        {displayError && (
          <div className="error-banner">
            {displayError}
          </div>
        )}

        {activeTab === 'chat' ? (
          <>
            <MessageList
              session={sessions.activeSession}
              runtimeEvents={chat.runtimeEvents}
              sending={chat.sending}
            />

            <Composer sending={chat.sending} onSend={handleSend} onCancel={chat.cancel} />
          </>
        ) : activeTab === 'files' ? (
          <WorkspacePanel
            session={sessions.activeSession}
            fallbackWorkspaceRoot={config?.defaultWorkspaceRoot || ''}
          />
        ) : activeTab === 'scheduled' ? (
          <ScheduledJobsPanel
            jobs={scheduled.jobs}
            status={scheduled.status}
            sessions={sessions.sessions}
            activeSessionId={sessions.activeSession?.id || null}
            schedulerEnabled={Boolean(config?.schedulerEnabled)}
            schedulerPollIntervalMs={config?.schedulerPollIntervalMs || 300000}
            loading={scheduled.loading}
            error={scheduled.error}
            executionsByJob={scheduled.executionsByJob}
            onRefresh={scheduled.refresh}
            onCreateJob={scheduled.createJob}
            onUpdateJob={scheduled.updateJob}
            onDeleteJob={scheduled.removeJob}
            onRunJobNow={scheduled.runJobNow}
            onLoadExecutions={scheduled.loadExecutions}
            onOpenSession={handleOpenScheduledSession}
          />
        ) : activeTab === 'usage' ? (
          <ModelUsagePanel
            summary={modelUsage.summary}
            loading={modelUsage.loading}
            error={modelUsage.error}
            onRefresh={modelUsage.refresh}
          />
        ) : (
          <ProposalReviewPanel
            proposals={evolution.proposals}
            filter={evolution.filter}
            counts={evolution.counts}
            loading={evolution.loading}
            error={evolution.error}
            onFilterChange={evolution.setFilter}
            onRefresh={evolution.refresh}
            onAccept={evolution.accept}
            onReject={evolution.reject}
          />
        )}
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
