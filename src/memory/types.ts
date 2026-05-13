import type { SessionMessageRecord } from '../runtime/session-store.js'
import type { ToolExecution } from '../agent/types.js'
import type { SessionSandboxConfig } from '../tools/types.js'

export type MemoryScopeType = 'global' | 'workspace' | 'feishu-chat' | 'scheduler-job' | 'skill'

export interface MemoryScope {
  type: MemoryScopeType
  key: string
  label: string
}

export type MemoryKind = 'preference' | 'fact' | 'decision' | 'procedure' | 'failure' | 'todo' | 'artifact'

export interface MemoryRecord {
  id: string
  scope: MemoryScope
  kind: MemoryKind
  text: string
  tags: string[]
  sourceSessionId?: string
  sourceMessageIds?: string[]
  sourceRunId?: string
  confidence: number
  importance: number
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
  expiresAt?: string
}

export interface MemoryCandidate {
  scope: MemoryScope
  kind: MemoryKind
  text: string
  tags: string[]
  confidence: number
  importance: number
  sourceSessionId?: string
  sourceMessageIds?: string[]
  sourceRunId?: string
}

export interface SessionMemoryFailure {
  toolName: string
  inputPreview: string
  error: string
  resolved?: boolean
  at: string
}

export interface SessionMemoryState {
  summary: string
  goals: string[]
  decisions: string[]
  openItems: string[]
  userPreferences: string[]
  relevantFiles: string[]
  recentFailures: SessionMemoryFailure[]
  updatedAt: string
}

export interface CompletedRunForMemory {
  sessionId: string
  runId: string
  userMessage: SessionMessageRecord
  assistantMessages: SessionMessageRecord[]
  toolExecutions: ToolExecution[]
  sandbox?: SessionSandboxConfig | undefined
  source?: 'web' | 'feishu' | 'scheduler' | undefined
  scope: MemoryScope
}

export interface MemorySearchQuery {
  scope: MemoryScope
  query: string
  limit?: number
  kinds?: MemoryKind[]
}

export interface MemorySearchResult {
  record: MemoryRecord
  score: number
}
