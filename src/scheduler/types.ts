import type { SessionSandboxConfig } from '../tools/types.js'

export type ScheduledJobSchedule =
  | { type: 'once'; runAt: string }
  | { type: 'interval'; everyMs: number }

export interface ScheduledJob {
  id: string
  name: string
  enabled: boolean
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
  result?: {
    reply: string
    runId: string
    toolExecutionCount: number
  }
  createdAt: string
  updatedAt: string
}

export interface SchedulerStatus {
  enabled: boolean
  pollIntervalMs: number
  runningJobs: number
  jobCount: number
  nextWakeAt: string | null
}
