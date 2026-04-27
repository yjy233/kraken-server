import type { EmitFn } from '../agent/types.js'
import type { SessionRecord } from '../runtime/session-store.js'
import { computeNextRunAt, computeSubsequentRunAt, isJobDue } from './planner.js'
import type { ScheduledExecution, ScheduledJob, SchedulerStatus } from './types.js'

interface SchedulerStoreLike {
  listJobs: () => Promise<ScheduledJob[]>
  getJob: (jobId: string) => Promise<ScheduledJob | null>
  getExecution: (executionId: string) => Promise<ScheduledExecution | null>
  createExecution: (input: Omit<ScheduledExecution, 'id' | 'createdAt' | 'updatedAt'>) => Promise<ScheduledExecution>
  updateExecution: (
    executionId: string,
    patch: Partial<Omit<ScheduledExecution, 'id' | 'createdAt'>>
  ) => Promise<ScheduledExecution>
  updateJob: (
    jobId: string,
    patch: Partial<Omit<ScheduledJob, 'id' | 'createdAt'>>
  ) => Promise<ScheduledJob>
  listExecutions: (jobId?: string) => Promise<ScheduledExecution[]>
}

interface SessionStoreLike {
  loadSession: (sessionId: string) => Promise<SessionRecord | null>
}

interface AgentRunnerLike {
  run: (input: {
    message: string
    model?: string
    systemPrompt?: string
    sandbox?: SessionRecord['sandbox']
    loadedSkills?: string[]
    createNewSession?: boolean
    forceSessionId?: string
    sessionId?: string | null
    title?: string
  }, emit: EmitFn | null) => Promise<{
    reply: string
    session: SessionRecord
    run: {
      id: string
      toolExecutions: Array<unknown>
    }
  }>
}

export function createSchedulerService(params: {
  enabled: boolean
  pollIntervalMs: number
  maxConcurrency?: number
  store: SchedulerStoreLike
  sessionStore: SessionStoreLike
  agentRunner: AgentRunnerLike
  onExecutionCreated?: (execution: ScheduledExecution) => void
  onExecutionUpdated?: (execution: ScheduledExecution) => void
  onJobUpdated?: (job: ScheduledJob) => void
}) {
  const runningJobIds = new Set<string>()
  let intervalHandle: NodeJS.Timeout | null = null
  let tickInFlight = false

  async function start(): Promise<void> {
    await recoverInterruptedExecutions()
    if (!params.enabled) {
      return
    }
    intervalHandle = setInterval(() => {
      void tick()
    }, params.pollIntervalMs)
    void tick()
  }

  async function stop(): Promise<void> {
    if (intervalHandle) {
      clearInterval(intervalHandle)
      intervalHandle = null
    }
  }

  async function tick(): Promise<void> {
    if (!params.enabled || tickInFlight) {
      return
    }
    tickInFlight = true
    try {
      const maxConcurrency = Math.max(1, params.maxConcurrency || 1)
      if (runningJobIds.size >= maxConcurrency) {
        return
      }
      const jobs = await params.store.listJobs()
      const dueJobs = jobs.filter((job) => isJobDue(job))
      for (const job of dueJobs) {
        if (runningJobIds.size >= maxConcurrency) {
          break
        }
        if (runningJobIds.has(job.id) && (job.overlapPolicy || 'skip') === 'skip') {
          continue
        }
        void executeJob(job, 'schedule')
      }
    } finally {
      tickInFlight = false
    }
  }

  async function runNow(jobId: string): Promise<ScheduledExecution> {
    const job = await params.store.getJob(jobId)
    if (!job) {
      throw new Error(`Scheduled job not found: ${jobId}`)
    }
    return executeJob(job, 'manual')
  }

  async function getStatus(): Promise<SchedulerStatus> {
    const jobs = await params.store.listJobs()
    const nextWakeAt = jobs
      .map((job) => job.nextRunAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => left.localeCompare(right))[0] || null

    return {
      enabled: params.enabled,
      pollIntervalMs: params.pollIntervalMs,
      runningJobs: runningJobIds.size,
      jobCount: jobs.length,
      nextWakeAt,
    }
  }

  async function executeJob(job: ScheduledJob, triggerType: ScheduledExecution['triggerType']): Promise<ScheduledExecution> {
    if (runningJobIds.has(job.id) && (job.overlapPolicy || 'skip') === 'skip') {
      const existing = (await params.store.listExecutions(job.id)).find((execution) => execution.status === 'running')
      if (existing) {
        return existing
      }
    }

    runningJobIds.add(job.id)
    const baseTimestamp = new Date().toISOString()
    const execution = await params.store.createExecution({
      jobId: job.id,
      sessionId: '',
      status: 'queued',
      triggerType,
      attempt: 1,
    })
    params.onExecutionCreated?.(execution)

    try {
      const runningExecution = await params.store.updateExecution(execution.id, {
        status: 'running',
        startedAt: baseTimestamp,
      })
      params.onExecutionUpdated?.(runningExecution)

      const templateSession = job.sessionTemplateId
        ? await params.sessionStore.loadSession(job.sessionTemplateId)
        : null
      const targetSessionId = job.targetSessionId || `scheduled-${job.id}`

      const runInput: {
        createNewSession?: boolean
        forceSessionId?: string
        sessionId?: string | null
        title: string
        message: string
        model?: string
        systemPrompt?: string
        sandbox?: SessionRecord['sandbox']
        loadedSkills?: string[]
      } = {
        sessionId: targetSessionId,
        forceSessionId: targetSessionId,
        title: job.name,
        message: job.message,
        loadedSkills: job.loadedSkills || templateSession?.loadedSkills || [],
      }
      const effectiveModel = job.model || templateSession?.model
      if (effectiveModel) {
        runInput.model = effectiveModel
      }
      const effectiveSystemPrompt = job.systemPrompt || templateSession?.systemPrompt
      if (effectiveSystemPrompt) {
        runInput.systemPrompt = effectiveSystemPrompt
      }
      const effectiveSandbox = job.sandbox || templateSession?.sandbox
      if (effectiveSandbox !== undefined) {
        runInput.sandbox = effectiveSandbox
      }

      const result = await params.agentRunner.run(runInput, null)

      const succeededExecution = await params.store.updateExecution(execution.id, {
        sessionId: result.session.id,
        status: 'succeeded',
        finishedAt: new Date().toISOString(),
        result: {
          reply: result.reply,
          runId: result.run.id,
          toolExecutionCount: result.run.toolExecutions.length,
        },
      })
      params.onExecutionUpdated?.(succeededExecution)

      const updatedJob = await params.store.updateJob(job.id, {
        targetSessionId,
        lastRunAt: baseTimestamp,
        lastSuccessAt: new Date().toISOString(),
        lastFailureAt: null,
        nextRunAt: computeSubsequentRunAt(job, new Date()),
      })
      params.onJobUpdated?.(updatedJob)

      const latest = await params.store.getExecution(execution.id)
      if (!latest) {
        throw new Error(`Scheduled execution not found after update: ${execution.id}`)
      }
      return latest
    } catch (error) {
      const failedExecution = await params.store.updateExecution(execution.id, {
        status: 'failed',
        startedAt: baseTimestamp,
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown scheduler execution error',
      })
      params.onExecutionUpdated?.(failedExecution)
      const updatedJob = await params.store.updateJob(job.id, {
        targetSessionId: job.targetSessionId || `scheduled-${job.id}`,
        lastRunAt: baseTimestamp,
        lastFailureAt: new Date().toISOString(),
        nextRunAt: computeSubsequentRunAt(job, new Date()),
      })
      params.onJobUpdated?.(updatedJob)
      const latest = await params.store.getExecution(execution.id)
      if (!latest) {
        throw new Error(`Scheduled execution not found after failure update: ${execution.id}`)
      }
      return latest
    } finally {
      runningJobIds.delete(job.id)
    }
  }

  async function recoverInterruptedExecutions(): Promise<void> {
    const executions = await params.store.listExecutions()
    const runningExecutions = executions.filter((execution) => execution.status === 'running' || execution.status === 'queued')
    for (const execution of runningExecutions) {
      await params.store.updateExecution(execution.id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: 'Process terminated before scheduled execution completed',
      })
    }
  }

  return {
    start,
    stop,
    tick,
    runNow,
    getStatus,
  }
}
