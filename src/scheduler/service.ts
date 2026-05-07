import type { EmitFn } from '../agent/types.js'
import type { SessionRecord } from '../runtime/session-store.js'
import { computeSubsequentRunAt, isJobDue } from './planner.js'
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
    messageMeta?: {
      source?: 'web' | 'feishu' | 'scheduler'
    }
  }, emit: EmitFn | null) => Promise<{
    reply: string
    session: SessionRecord
    run: {
      id: string
      finalText?: string
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
  let nextTickAt: string | null = null

  async function start(): Promise<void> {
    await recoverInterruptedExecutions()
    if (!params.enabled) {
      return
    }
    nextTickAt = new Date(Date.now() + params.pollIntervalMs).toISOString()
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
    nextTickAt = null
  }

  async function tick(): Promise<void> {
    if (!params.enabled || tickInFlight) {
      return
    }
    tickInFlight = true
    nextTickAt = new Date(Date.now() + params.pollIntervalMs).toISOString()
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
    const nextJobRunAt = jobs
      .map((job) => job.nextRunAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => left.localeCompare(right))[0] || null

    return {
      enabled: params.enabled,
      pollIntervalMs: params.pollIntervalMs,
      runningJobs: runningJobIds.size,
      jobCount: jobs.length,
      nextWakeAt: nextTickAt,
      nextJobRunAt,
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
    const startedAt = new Date().toISOString()
    const runAnchorDate = resolveRunAnchorDate(job, startedAt)

    if (triggerType === 'schedule' || triggerType === 'catchup') {
      const updatedJob = await params.store.updateJob(job.id, {
        lastRunAt: startedAt,
        nextRunAt: computeSubsequentRunAt(job, runAnchorDate),
      })
      params.onJobUpdated?.(updatedJob)
    }

    const execution = await params.store.createExecution({
      jobId: job.id,
      sessionId: '',
      status: 'queued',
      triggerType,
      attempt: 1,
    })
    params.onExecutionCreated?.(execution)

    try {
      const updatedRunning = await params.store.updateExecution(execution.id, {
        status: 'running',
        startedAt,
        attempt: 1,
      })
      params.onExecutionUpdated?.(updatedRunning)

      const result = await runJobAttempt(job)
      assertScheduledRunSucceeded(result)

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

      const jobPatch: Partial<Omit<ScheduledJob, 'id' | 'createdAt'>> = {
        lastSuccessAt: new Date().toISOString(),
        lastFailureAt: null,
      }
      if (triggerType === 'manual' || triggerType === 'retry') {
        jobPatch.lastRunAt = startedAt
      }
      if (job.createNewSession === false) {
        jobPatch.targetSessionId = result.session.id
      }
      const updatedJob = await params.store.updateJob(job.id, jobPatch)
      params.onJobUpdated?.(updatedJob)

      const latest = await params.store.getExecution(execution.id)
      if (!latest) {
        throw new Error(`Scheduled execution not found after update: ${execution.id}`)
      }
      return latest
    } catch (error) {
      const failedExecution = await handleFailure(job, execution.id, startedAt, error)
      params.onExecutionUpdated?.(failedExecution)
      const failurePatch: Partial<Omit<ScheduledJob, 'id' | 'createdAt'>> = {
        lastFailureAt: new Date().toISOString(),
      }
      if (triggerType === 'manual' || triggerType === 'retry') {
        failurePatch.lastRunAt = startedAt
      }
      const updatedJob = await params.store.updateJob(job.id, failurePatch)
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

  async function handleFailure(
    job: ScheduledJob,
    executionId: string,
    startedAt: string,
    initialError: unknown
  ): Promise<ScheduledExecution> {
    const maxAttempts = Math.max(1, job.retryPolicy?.maxAttempts || 1)
    let lastError = initialError

    for (let attempt = 2; attempt <= maxAttempts; attempt += 1) {
      const backoffMs = Math.max(0, job.retryPolicy?.backoffMs || 0)
      if (backoffMs > 0) {
        await sleep(backoffMs)
      }

      try {
        const retryPatch: Partial<Omit<ScheduledExecution, 'id' | 'createdAt'>> = {
          status: 'running',
          attempt,
        }
        const retrying = await params.store.updateExecution(executionId, retryPatch)
        params.onExecutionUpdated?.(retrying)

        const result = await runJobAttempt(job)
        assertScheduledRunSucceeded(result)
        return params.store.updateExecution(executionId, {
          sessionId: result.session.id,
          status: 'succeeded',
          attempt,
          finishedAt: new Date().toISOString(),
          result: {
            reply: result.reply,
            runId: result.run.id,
            toolExecutionCount: result.run.toolExecutions.length,
          },
        })
      } catch (retryError) {
        lastError = retryError
      }
    }

    return params.store.updateExecution(executionId, {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      error: lastError instanceof Error ? lastError.message : 'Unknown scheduler execution error',
    })
  }

  async function runJobAttempt(job: ScheduledJob): Promise<{
    reply: string
    session: SessionRecord
    run: {
      id: string
      finalText?: string
      toolExecutions: Array<unknown>
    }
  }> {
    const templateSession = job.sessionTemplateId
      ? await params.sessionStore.loadSession(job.sessionTemplateId)
      : null
    const createNewSession = job.createNewSession !== false
    const targetSessionId = createNewSession
      ? null
      : job.targetSessionId || `scheduled-${job.id}`

    const runInput: Parameters<AgentRunnerLike['run']>[0] = {
      sessionId: targetSessionId,
      title: job.name,
      message: buildScheduledJobMessage(job),
      loadedSkills: job.loadedSkills || templateSession?.loadedSkills || [],
      createNewSession,
      messageMeta: {
        source: 'scheduler',
      },
    }

    if (!createNewSession && targetSessionId) {
      runInput.forceSessionId = targetSessionId
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

    return params.agentRunner.run(runInput, null)
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

function buildScheduledJobMessage(job: ScheduledJob): string {
  const baseMessage = String(job.message || '').trim()
  if (!job.params || Object.keys(job.params).length === 0) {
    return baseMessage
  }

  const paramsLines = Object.entries(job.params)
    .map(([key, value]) => `- ${key}: ${String(value)}`)
    .join('\n')

  return [
    baseMessage,
    '',
    '[Scheduled job params]',
    paramsLines,
  ].join('\n')
}

function assertScheduledRunSucceeded(result: {
  reply: string
  run: {
    finalText?: string
  }
}): void {
  const finalText = String(result.run.finalText || result.reply || '').trim()
  if (!finalText) {
    throw new Error('Scheduled run completed without final text.')
  }
  if (finalText === 'The model returned without text.') {
    throw new Error('Scheduled run completed without final text.')
  }
}

function resolveRunAnchorDate(job: ScheduledJob, startedAt: string): Date {
  if (job.nextRunAt) {
    const scheduledAt = new Date(job.nextRunAt)
    if (!Number.isNaN(scheduledAt.getTime())) {
      return scheduledAt
    }
  }

  return new Date(startedAt)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
