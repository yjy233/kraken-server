/**
 * 前端类型定义
 */

export interface Config {
  appTitle: string
  configured: boolean
  model: string
  defaultSystemPrompt: string
  maxAgentSteps: number
  maxContextTokens: number
  defaultWorkspaceRoot: string
  sandboxEnabled: boolean
  seatbeltEnabled: boolean
  schedulerEnabled: boolean
  schedulerMaxConcurrency: number
  schedulerPollIntervalMs: number
  memoryEnabled: boolean
  skills: SkillInfo[]
  tools: ToolInfo[]
}

export interface SkillInfo {
  name: string
  description: string
}

export interface ToolInfo {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface WorkspaceEntry {
  name: string
  path: string
  kind: 'file' | 'directory'
  extension?: string
}

export interface WorkspaceListing {
  workspaceRoot: string
  path: string
  exists: boolean
  entries: WorkspaceEntry[]
}

export interface WorkspaceFile {
  workspaceRoot: string
  path: string
  contentType: 'markdown' | 'text' | 'image' | 'binary'
  content?: string
  size: number
  extension?: string
  mediaType?: string
}

export interface ModelUsageCounters {
  requestCount: number
  responseCount: number
  errorCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  cost: number
  durationMs: number
  toolUseCount: number
}

export interface ModelUsageModelStats extends ModelUsageCounters {
  model: string
  providerModels: string[]
  usageFields: Record<string, number>
  averageDurationMs: number | null
  firstSeenAt: string | null
  lastSeenAt: string | null
  lastRequestAt: string | null
  lastResponseAt: string | null
  lastErrorAt: string | null
}

export interface ModelUsageSummary {
  generatedAt: string
  logPath: string
  logBytes: number
  parsedLineCount: number
  skippedLineCount: number
  modelCount: number
  usageFieldKeys: string[]
  totals: ModelUsageCounters
  models: ModelUsageModelStats[]
}

export type EvolutionProposalType =
  | 'memory_write'
  | 'memory_merge'
  | 'prompt_patch'
  | 'skill_create'
  | 'skill_patch'
  | 'tool_policy'
  | 'doc_update'
  | 'code_followup'

export type EvolutionProposalStatus = 'pending' | 'accepted' | 'rejected' | 'applied'

export interface EvolutionProposal {
  id: string
  type: EvolutionProposalType
  title: string
  rationale: string
  sourceRunIds: string[]
  sourceSessionIds: string[]
  suggestedChange: string
  patch?: string
  risk: 'low' | 'medium' | 'high'
  status: EvolutionProposalStatus
  reviewNote?: string
  reviewedAt?: string
  createdAt: string
  updatedAt: string
}

export interface Session {
  id: string
  title: string
  model: string
  systemPrompt: string
  sandbox?: SessionSandboxConfig | undefined
  loadedSkills?: string[] | undefined
  contextWindow?: ContextWindowState | undefined
  memory?: SessionMemoryState | undefined
  createdAt: string
  updatedAt: string
  messages: SessionMessage[]
}

export interface SessionSummary {
  id: string
  title: string
  model: string
  sandbox?: SessionSandboxConfig | undefined
  loadedSkills?: string[] | undefined
  contextWindow?: ContextWindowState | undefined
  memory?: SessionMemoryState | undefined
  createdAt: string
  updatedAt: string
  messageCount: number
  preview: string
  lastRole: string | null
}

export interface ContextWindowState {
  maxTokens: number
  rawTokens: number
  effectiveTokens: number
  rawUsageRatio: number
  effectiveUsageRatio: number
  rawUsagePercent: number
  effectiveUsagePercent: number
  compressionMode: 'none' | 'partial' | 'full'
  recentTurnsKept: number
  summarizedMessages: number
  originalMessageCount: number
  effectiveMessageCount: number
  summaryTokens: number
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

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: SessionMessageContent
  createdAt: string
}

export type SessionMessageContent = string | AgentContentBlock[]

export type AgentContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ImageBlock {
  type: 'image'
  image: string
  mediaType?: string
  filename?: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  tool_name?: string
  content: string
  is_error: boolean
}

export interface RuntimeEvent {
  event: string
  data: unknown
  at: string
}

export interface RuntimeTimelineToolRecord {
  toolUseId: string
  toolName: string
  status: 'pending' | 'running' | 'done' | 'error'
  inputPreview?: string
  input?: Record<string, unknown>
  outputPreview?: string
  output?: string
}

export type RuntimeTimelineBlock =
  | {
      kind: 'assistant'
      id: string
      text: string
      step?: number
    }
  | {
      kind: 'tool'
      id: string
      record: RuntimeTimelineToolRecord
      step?: number
    }

export interface SessionSandboxConfig {
  workspaceRoot?: string
  readRoots?: string[]
}

export interface RunResult {
  id: string
  sessionId: string
  createdAt: string
  model: string
  steps: Array<{
    step: number
    stopReason: string | null
    assistantText: string
    toolUseCount: number
  }>
  finalText: string
  usage: Array<Record<string, unknown> | null>
  toolExecutions: Array<{
    toolUseId: string
    toolName: string
    isError: boolean
    output: string
  }>
  contextWindow?: ContextWindowState
}

export interface StreamCompleteData {
  ok: boolean
  reply: string
  session: Session
  run: RunResult
}

export type ScheduledJobSchedule =
  | { type: 'once'; runAt: string }
  | { type: 'interval'; everyMs: number }
  | { type: 'cron'; expression: string; timezone?: string }

export interface ScheduledJob {
  id: string
  name: string
  enabled: boolean
  targetSessionId?: string
  sessionTemplateId?: string
  message: string
  model?: string
  systemPrompt?: string
  sandbox?: SessionSandboxConfig | undefined
  loadedSkills?: string[] | undefined
  createNewSession?: boolean | undefined
  params?: Record<string, string | number | boolean> | undefined
  catchupPolicy?: 'none' | 'latest' | undefined
  retryPolicy?: {
    maxAttempts: number
    backoffMs: number
  } | undefined
  schedule: ScheduledJobSchedule
  nextRunAt: string | null
  lastRunAt?: string | null
  lastSuccessAt?: string | null
  lastFailureAt?: string | null
  overlapPolicy?: 'skip' | 'parallel'
  createdAt: string
  updatedAt: string
}

export interface ScheduledExecution {
  id: string
  jobId: string
  sessionId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  triggerType: 'schedule' | 'manual' | 'retry' | 'catchup'
  attempt: number
  startedAt?: string
  finishedAt?: string
  error?: string
  createdAt: string
  updatedAt: string
  result?: {
    reply: string
    runId: string
    toolExecutionCount: number
  }
}

export interface SchedulerStatus {
  enabled: boolean
  pollIntervalMs: number
  runningJobs: number
  jobCount: number
  nextWakeAt: string | null
  nextJobRunAt: string | null
}
