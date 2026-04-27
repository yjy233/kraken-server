import type { Session } from '../frontend/types.js'
import type { RunResult } from '../agent/types.js'
import type { ScheduledExecution, ScheduledJob, SchedulerStatus } from '../scheduler/types.js'

export type WsClientMessage =
  | {
      type: 'heartbeat:ping'
      ts: number
    }
  | {
      type: 'chat:start'
      requestId: string
      payload: {
        sessionId: string | null
        systemPrompt: string
        message: string
        model?: string
        sandbox?: {
          workspaceRoot?: string
          readRoots?: string[]
        }
      }
    }
  | {
      type: 'chat:cancel'
      requestId: string
    }
  | {
      type: 'scheduler:subscribe'
      requestId: string
    }
  | {
      type: 'scheduler:refresh'
      requestId: string
    }
  | {
      type: 'scheduled-job:create'
      requestId: string
      payload: Record<string, unknown>
    }
  | {
      type: 'scheduled-job:update'
      requestId: string
      jobId: string
      payload: Record<string, unknown>
    }
  | {
      type: 'scheduled-job:delete'
      requestId: string
      jobId: string
    }
  | {
      type: 'scheduled-job:run'
      requestId: string
      jobId: string
    }
  | {
      type: 'scheduled-job:load-executions'
      requestId: string
      jobId: string
    }

export type WsServerMessage =
  | {
      type: 'heartbeat:pong'
      ts: number
    }
  | {
      type: 'request:error'
      requestId?: string
      error: string
    }
  | {
      type: 'chat:event'
      requestId: string
      event: string
      data: unknown
    }
  | {
      type: 'chat:complete'
      requestId: string
      payload: {
        ok: true
        reply: string
        session: Session
        run: RunResult
      }
    }
  | {
      type: 'scheduler:snapshot'
      requestId?: string
      payload: {
        jobs: ScheduledJob[]
        status: SchedulerStatus
      }
    }
  | {
      type: 'scheduler:job-created'
      requestId?: string
      job: ScheduledJob
    }
  | {
      type: 'scheduler:job-updated'
      requestId?: string
      job: ScheduledJob
    }
  | {
      type: 'scheduler:job-deleted'
      requestId?: string
      jobId: string
    }
  | {
      type: 'scheduler:job-executions'
      requestId?: string
      jobId: string
      executions: ScheduledExecution[]
    }
  | {
      type: 'scheduler:execution-created'
      execution: ScheduledExecution
    }
  | {
      type: 'scheduler:execution-updated'
      execution: ScheduledExecution
    }

export function isWsClientMessage(value: unknown): value is WsClientMessage {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}
