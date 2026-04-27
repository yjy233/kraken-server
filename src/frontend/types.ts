/**
 * 前端类型定义
 */

export interface Config {
  appTitle: string
  configured: boolean
  model: string
  defaultSystemPrompt: string
  maxAgentSteps: number
  defaultWorkspaceRoot: string
  sandboxEnabled: boolean
  seatbeltEnabled: boolean
  schedulerEnabled: boolean
  schedulerMaxConcurrency: number
  schedulerPollIntervalMs: number
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

export interface Session {
  id: string
  title: string
  model: string
  systemPrompt: string
  sandbox?: SessionSandboxConfig | undefined
  loadedSkills?: string[] | undefined
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
  createdAt: string
  updatedAt: string
  messageCount: number
  preview: string
  lastRole: string | null
}

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
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
  outputPreview?: string
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
}
