import React, { useCallback, useMemo, useState } from 'react'
import type {
  ScheduledExecution,
  ScheduledJob,
  SessionSummary,
  SchedulerStatus,
} from '../types.js'

type FormState = {
  name: string
  message: string
  scheduleType: 'once' | 'interval' | 'cron'
  runAtLocal: string
  everyMinutes: string
  cronExpression: string
  cronTimezone: string
  enabled: boolean
  sessionTemplateId: string
  overlapPolicy: 'skip' | 'parallel'
  createNewSession: boolean
  targetChatId: string
  maxItems: string
  sourceSet: string
  catchupPolicy: 'none' | 'latest'
  retryMaxAttempts: string
  retryBackoffMinutes: string
}

interface ScheduledJobsPanelProps {
  jobs: ScheduledJob[]
  status: SchedulerStatus | null
  sessions: SessionSummary[]
  activeSessionId?: string | null
  schedulerEnabled: boolean
  schedulerPollIntervalMs: number
  loading: boolean
  error: string | null
  executionsByJob: Record<string, ScheduledExecution[]>
  onRefresh: () => Promise<unknown>
  onCreateJob: (body: Record<string, unknown>) => Promise<unknown>
  onUpdateJob: (jobId: string, body: Record<string, unknown>) => Promise<unknown>
  onDeleteJob: (jobId: string) => Promise<void>
  onRunJobNow: (jobId: string) => Promise<unknown>
  onLoadExecutions: (jobId: string) => Promise<ScheduledExecution[]>
  onOpenSession: (sessionId: string) => Promise<void> | void
}

export const ScheduledJobsPanel: React.FC<ScheduledJobsPanelProps> = ({
  jobs,
  status,
  sessions,
  activeSessionId,
  schedulerEnabled,
  schedulerPollIntervalMs,
  loading,
  error,
  executionsByJob,
  onRefresh,
  onCreateJob,
  onUpdateJob,
  onDeleteJob,
  onRunJobNow,
  onLoadExecutions,
  onOpenSession,
}) => {
  const [editingJobId, setEditingJobId] = useState<string | null>(null)
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pendingJobIds, setPendingJobIds] = useState<string[]>([])
  const [historyLoadingJobId, setHistoryLoadingJobId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(() => createDefaultForm(activeSessionId))

  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions]
  )

  const editingJob = useMemo(
    () => jobs.find((job) => job.id === editingJobId) || null,
    [editingJobId, jobs]
  )

  const hasShortIntervalWarning = useMemo(() => {
    if (form.scheduleType === 'interval') {
      const everyMs = Number(form.everyMinutes) * 60_000
      return Number.isFinite(everyMs) && everyMs > 0 && everyMs < schedulerPollIntervalMs
    }
    if (form.scheduleType === 'once') {
      const runAt = new Date(form.runAtLocal).getTime()
      const delayMs = runAt - Date.now()
      return Number.isFinite(runAt) && delayMs > 0 && delayMs < schedulerPollIntervalMs
    }
    return false
  }, [form.everyMinutes, form.runAtLocal, form.scheduleType, schedulerPollIntervalMs])

  const updateForm = useCallback((patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }))
  }, [])

  const resetForm = useCallback(() => {
    setEditingJobId(null)
    setFormError(null)
    setForm(createDefaultForm(activeSessionId))
  }, [activeSessionId])

  const editJob = useCallback((job: ScheduledJob) => {
    setEditingJobId(job.id)
    setFormError(null)
    setForm({
      name: job.name,
      message: job.message,
      scheduleType: job.schedule.type,
      runAtLocal: job.schedule.type === 'once'
        ? toDatetimeLocalValue(job.schedule.runAt)
        : toDatetimeLocalValue(new Date(Date.now() + 30 * 60_000).toISOString()),
      everyMinutes: job.schedule.type === 'interval'
        ? String(Math.max(1, Math.round(job.schedule.everyMs / 60_000)))
        : '60',
      cronExpression: job.schedule.type === 'cron' ? job.schedule.expression : '30 8 * * *',
      cronTimezone: job.schedule.type === 'cron' ? (job.schedule.timezone || 'Asia/Shanghai') : 'Asia/Shanghai',
      enabled: job.enabled,
      sessionTemplateId: job.sessionTemplateId || '',
      overlapPolicy: job.overlapPolicy === 'parallel' ? 'parallel' : 'skip',
      createNewSession: job.createNewSession !== false,
      targetChatId: typeof job.params?.targetChatId === 'string' ? job.params.targetChatId : '',
      maxItems: job.params?.maxItems !== undefined ? String(job.params.maxItems) : '20',
      sourceSet: typeof job.params?.sourceSet === 'string' ? job.params.sourceSet : 'cn-tech-default',
      catchupPolicy: job.catchupPolicy === 'latest' ? 'latest' : 'none',
      retryMaxAttempts: String(job.retryPolicy?.maxAttempts || 1),
      retryBackoffMinutes: String(Math.max(0, Math.round((job.retryPolicy?.backoffMs || 0) / 60_000))),
    })
  }, [])

  const withPendingJob = useCallback(async (jobId: string, task: () => Promise<void>) => {
    setPendingJobIds((prev) => [...prev, jobId])
    try {
      await task()
    } finally {
      setPendingJobIds((prev) => prev.filter((id) => id !== jobId))
    }
  }, [])

  const handleSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)

    const name = form.name.trim()
    const message = form.message.trim()
    if (!name) {
      setFormError('Job name is required.')
      return
    }
    if (!message) {
      setFormError('Message is required.')
      return
    }

    let schedule: Record<string, unknown>
    if (form.scheduleType === 'once') {
      const runAt = new Date(form.runAtLocal)
      if (Number.isNaN(runAt.getTime())) {
        setFormError('Run time is invalid.')
        return
      }
      schedule = {
        type: 'once',
        runAt: runAt.toISOString(),
      }
    } else if (form.scheduleType === 'interval') {
      const everyMinutes = Number(form.everyMinutes)
      if (!Number.isFinite(everyMinutes) || everyMinutes <= 0) {
        setFormError('Interval minutes must be a positive number.')
        return
      }
      schedule = {
        type: 'interval',
        everyMs: Math.round(everyMinutes * 60_000),
      }
    } else {
      const expression = form.cronExpression.trim()
      if (!expression) {
        setFormError('Cron expression is required.')
        return
      }
      schedule = {
        type: 'cron',
        expression,
        timezone: form.cronTimezone.trim() || 'Asia/Shanghai',
      }
    }

    const maxItems = Number(form.maxItems)
    if (!Number.isFinite(maxItems) || maxItems <= 0) {
      setFormError('Max items must be a positive number.')
      return
    }

    const retryMaxAttempts = Number(form.retryMaxAttempts)
    const retryBackoffMinutes = Number(form.retryBackoffMinutes)
    if (!Number.isFinite(retryMaxAttempts) || retryMaxAttempts <= 0) {
      setFormError('Retry max attempts must be at least 1.')
      return
    }
    if (!Number.isFinite(retryBackoffMinutes) || retryBackoffMinutes < 0) {
      setFormError('Retry backoff minutes must be 0 or greater.')
      return
    }

    const payload: Record<string, unknown> = {
      name,
      message,
      enabled: form.enabled,
      schedule,
      overlapPolicy: form.overlapPolicy,
      createNewSession: form.createNewSession,
      catchupPolicy: form.catchupPolicy,
      retryPolicy: {
        maxAttempts: Math.round(retryMaxAttempts),
        backoffMs: Math.round(retryBackoffMinutes * 60_000),
      },
      params: {
        maxItems: Math.round(maxItems),
        sourceSet: form.sourceSet.trim() || 'cn-tech-default',
      },
    }

    const targetChatId = form.targetChatId.trim()
    if (targetChatId) {
      ;(payload.params as Record<string, unknown>).targetChatId = targetChatId
    }
    if (form.sessionTemplateId.trim()) {
      payload.sessionTemplateId = form.sessionTemplateId.trim()
    }

    setSubmitting(true)
    try {
      if (editingJobId) {
        await onUpdateJob(editingJobId, payload)
      } else {
        await onCreateJob(payload)
      }
      resetForm()
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setSubmitting(false)
    }
  }, [editingJobId, form, onCreateJob, onUpdateJob, resetForm])

  const handleToggleHistory = useCallback(async (jobId: string) => {
    if (expandedJobId === jobId) {
      setExpandedJobId(null)
      return
    }
    setExpandedJobId(jobId)
    setHistoryLoadingJobId(jobId)
    try {
      await onLoadExecutions(jobId)
    } finally {
      setHistoryLoadingJobId(null)
    }
  }, [expandedJobId, onLoadExecutions])

  const handleToggleEnabled = useCallback(async (job: ScheduledJob) => {
    await withPendingJob(job.id, async () => {
      await onUpdateJob(job.id, { enabled: !job.enabled })
    })
  }, [onUpdateJob, withPendingJob])

  const handleRunNow = useCallback(async (jobId: string) => {
    await withPendingJob(jobId, async () => {
      await onRunJobNow(jobId)
      setExpandedJobId(jobId)
    })
  }, [onRunJobNow, withPendingJob])

  const handleDelete = useCallback(async (jobId: string) => {
    if (!window.confirm('Delete this scheduled job?')) {
      return
    }
    await withPendingJob(jobId, async () => {
      await onDeleteJob(jobId)
      if (editingJobId === jobId) {
        resetForm()
      }
      if (expandedJobId === jobId) {
        setExpandedJobId(null)
      }
    })
  }, [editingJobId, expandedJobId, onDeleteJob, resetForm, withPendingJob])

  return (
    <section className="scheduled-panel">
      <div className="scheduled-layout">
        <section className="scheduled-form-card">
          <div className="scheduled-card-header">
            <div>
              <h3>{editingJobId ? 'Edit Job' : 'New Job'}</h3>
              <p>
                Configure a scheduled agent run. Daily digest jobs should prefer cron,
                `createNewSession`, and skill-driven instructions in the message.
              </p>
            </div>
            {editingJobId && (
              <button className="icon-button" type="button" onClick={resetForm}>
                Cancel edit
              </button>
            )}
          </div>

          <form className="scheduled-form" onSubmit={handleSubmit}>
            <label className="scheduled-field">
              <span>Job Name</span>
              <input
                className="scheduled-input"
                type="text"
                placeholder="daily-feishu-news-digest"
                value={form.name}
                onChange={(event) => updateForm({ name: event.target.value })}
              />
            </label>

            <label className="scheduled-field">
              <span>Message</span>
              <textarea
                className="scheduled-textarea"
                rows={6}
                placeholder="Ask the agent what to do when this job fires."
                value={form.message}
                onChange={(event) => updateForm({ message: event.target.value })}
              />
            </label>

            <div className="scheduled-field-row">
              <label className="scheduled-field">
                <span>Schedule Type</span>
                <select
                  className="scheduled-select"
                  value={form.scheduleType}
                  onChange={(event) => updateForm({ scheduleType: event.target.value as FormState['scheduleType'] })}
                >
                  <option value="once">Once</option>
                  <option value="interval">Interval</option>
                  <option value="cron">Cron</option>
                </select>
              </label>

              {form.scheduleType === 'once' ? (
                <label className="scheduled-field">
                  <span>Run At</span>
                  <input
                    className="scheduled-input"
                    type="datetime-local"
                    value={form.runAtLocal}
                    onChange={(event) => updateForm({ runAtLocal: event.target.value })}
                  />
                </label>
              ) : form.scheduleType === 'interval' ? (
                <label className="scheduled-field">
                  <span>Every Minutes</span>
                  <input
                    className="scheduled-input"
                    type="number"
                    min="1"
                    step="1"
                    value={form.everyMinutes}
                    onChange={(event) => updateForm({ everyMinutes: event.target.value })}
                  />
                </label>
              ) : (
                <label className="scheduled-field">
                  <span>Cron</span>
                  <input
                    className="scheduled-input"
                    type="text"
                    placeholder="30 8 * * *"
                    value={form.cronExpression}
                    onChange={(event) => updateForm({ cronExpression: event.target.value })}
                  />
                </label>
              )}
            </div>

            {form.scheduleType === 'cron' && (
              <label className="scheduled-field">
                <span>Timezone</span>
                <input
                  className="scheduled-input"
                  type="text"
                  placeholder="Asia/Shanghai"
                  value={form.cronTimezone}
                  onChange={(event) => updateForm({ cronTimezone: event.target.value })}
                />
              </label>
            )}

            <label className="scheduled-field">
              <span>Session Template</span>
              <select
                className="scheduled-select"
                value={form.sessionTemplateId}
                onChange={(event) => updateForm({ sessionTemplateId: event.target.value })}
              >
                <option value="">None. Use default runtime config.</option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.title}
                  </option>
                ))}
                {form.sessionTemplateId && !sessionsById.has(form.sessionTemplateId) && (
                  <option value={form.sessionTemplateId}>
                    Missing session ({shortId(form.sessionTemplateId)})
                  </option>
                )}
              </select>
            </label>

            {activeSessionId && (
              <div className="scheduled-inline-actions">
                <button
                  className="link-button"
                  type="button"
                  onClick={() => updateForm({ sessionTemplateId: activeSessionId })}
                >
                  Use current chat session
                </button>
              </div>
            )}

            <div className="scheduled-field-row">
              <label className="scheduled-toggle">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) => updateForm({ enabled: event.target.checked })}
                />
                <span>Enabled</span>
              </label>

              <label className="scheduled-toggle">
                <input
                  type="checkbox"
                  checked={form.createNewSession}
                  onChange={(event) => updateForm({ createNewSession: event.target.checked })}
                />
                <span>Create new session</span>
              </label>
            </div>

            <div className="scheduled-field-row">
              <label className="scheduled-field">
                <span>Overlap</span>
                <select
                  className="scheduled-select"
                  value={form.overlapPolicy}
                  onChange={(event) => updateForm({ overlapPolicy: event.target.value as FormState['overlapPolicy'] })}
                >
                  <option value="skip">Skip overlap</option>
                  <option value="parallel">Run in parallel</option>
                </select>
              </label>

              <label className="scheduled-field">
                <span>Catchup</span>
                <select
                  className="scheduled-select"
                  value={form.catchupPolicy}
                  onChange={(event) => updateForm({ catchupPolicy: event.target.value as FormState['catchupPolicy'] })}
                >
                  <option value="none">None</option>
                  <option value="latest">Latest</option>
                </select>
              </label>
            </div>

            <div className="scheduled-field-row">
              <label className="scheduled-field">
                <span>Target Chat ID</span>
                <input
                  className="scheduled-input"
                  type="text"
                  placeholder="oc_xxx"
                  value={form.targetChatId}
                  onChange={(event) => updateForm({ targetChatId: event.target.value })}
                />
              </label>

              <label className="scheduled-field">
                <span>Max Items</span>
                <input
                  className="scheduled-input"
                  type="number"
                  min="1"
                  step="1"
                  value={form.maxItems}
                  onChange={(event) => updateForm({ maxItems: event.target.value })}
                />
              </label>
            </div>

            <label className="scheduled-field">
              <span>Source Set</span>
              <input
                className="scheduled-input"
                type="text"
                placeholder="cn-tech-default"
                value={form.sourceSet}
                onChange={(event) => updateForm({ sourceSet: event.target.value })}
              />
            </label>

            <div className="scheduled-field-row">
              <label className="scheduled-field">
                <span>Retry Attempts</span>
                <input
                  className="scheduled-input"
                  type="number"
                  min="1"
                  step="1"
                  value={form.retryMaxAttempts}
                  onChange={(event) => updateForm({ retryMaxAttempts: event.target.value })}
                />
              </label>

              <label className="scheduled-field">
                <span>Retry Backoff Minutes</span>
                <input
                  className="scheduled-input"
                  type="number"
                  min="0"
                  step="1"
                  value={form.retryBackoffMinutes}
                  onChange={(event) => updateForm({ retryBackoffMinutes: event.target.value })}
                />
              </label>
            </div>

            {hasShortIntervalWarning && (
              <div className="scheduled-note scheduled-note-warning">
                Current scan interval is {formatDurationMs(schedulerPollIntervalMs)}. Short-delay jobs may run late.
              </div>
            )}

            <div className="scheduled-note">
              Cron format uses 5 fields: minute hour day-of-month month day-of-week.
            </div>

            {formError && <div className="scheduled-inline-error">{formError}</div>}

            <div className="scheduled-form-actions">
              <button className="ghost-button" type="submit" disabled={submitting}>
                {submitting ? 'Saving...' : editingJobId ? 'Update job' : 'Create job'}
              </button>
              <button className="icon-button" type="button" onClick={resetForm}>
                Reset
              </button>
            </div>
          </form>
        </section>

        <section className="scheduled-content">
          <div className="scheduled-toolbar">
            <div className="scheduled-card-header">
              <div>
                <h3>Scheduled Jobs</h3>
                <p>Scan interval: {formatDurationMs(schedulerPollIntervalMs)}.</p>
              </div>
            </div>
            <button className="ghost-button" type="button" onClick={() => void onRefresh()} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          <div className="scheduled-status-grid">
            <StatusCard label="Scheduler" value={schedulerEnabled ? 'Enabled' : 'Disabled'} />
            <StatusCard label="Jobs" value={String(status?.jobCount ?? jobs.length)} />
            <StatusCard label="Running" value={String(status?.runningJobs ?? 0)} />
            <StatusCard label="Next Scan" value={status?.nextWakeAt ? formatDateTime(status.nextWakeAt) : 'None'} />
            <StatusCard label="Next Job" value={status?.nextJobRunAt ? formatDateTime(status.nextJobRunAt) : 'None'} />
          </div>

          <div className="scheduled-note">
            `Next Scan` is the scheduler poll time. `Next Job` is the earliest planned job trigger time.
          </div>

          {!schedulerEnabled && (
            <div className="scheduled-note scheduled-note-warning">
              Scheduler is disabled on the server. Jobs can be saved, but they will not fire until `SCHEDULER_ENABLED=true`.
            </div>
          )}

          {error && <div className="scheduled-inline-error">{error}</div>}

          <div className="scheduled-jobs-list">
            {jobs.length === 0 ? (
              <div className="scheduled-empty">
                <h4>No scheduled jobs yet</h4>
                <p>Create one from the form. Daily digest jobs should prefer cron and create-new-session mode.</p>
              </div>
            ) : (
              jobs.map((job) => {
                const executions = executionsByJob[job.id] || []
                const isExpanded = expandedJobId === job.id
                const isPending = pendingJobIds.includes(job.id)
                const templateSession = job.sessionTemplateId ? sessionsById.get(job.sessionTemplateId) : null
                const targetSession = job.targetSessionId ? sessionsById.get(job.targetSessionId) : null
                const latestExecution = executions[0] || null
                const isRunning = latestExecution?.status === 'queued' || latestExecution?.status === 'running'

                return (
                  <article key={job.id} className="scheduled-job-card">
                    <div className="scheduled-job-header">
                      <div className="scheduled-job-title-group">
                        <h4>{job.name}</h4>
                        <p>{formatSchedule(job.schedule)}</p>
                      </div>
                      <span className="status-chip" data-enabled={job.enabled}>
                        {job.enabled ? 'Enabled' : 'Paused'}
                      </span>
                    </div>

                    <p className="scheduled-job-message">{job.message}</p>

                    <div className="scheduled-job-meta">
                      <span>Next: {job.nextRunAt ? formatDateTime(job.nextRunAt) : 'None'}</span>
                      <span>Last success: {job.lastSuccessAt ? formatDateTime(job.lastSuccessAt) : 'Never'}</span>
                      <span>Last run: {job.lastRunAt ? formatDateTime(job.lastRunAt) : 'Never'}</span>
                      <span>Template: {templateSession?.title || (job.sessionTemplateId ? shortId(job.sessionTemplateId) : 'None')}</span>
                      <span>Session mode: {job.createNewSession === false ? 'Reuse' : 'New each run'}</span>
                      {job.params?.targetChatId && <span>Chat: {String(job.params.targetChatId)}</span>}
                      {targetSession && <span>Target: {targetSession.title}</span>}
                    </div>

                    {isRunning && (
                      <div className="scheduled-note">
                        This job has been triggered and is still running. Check History for the live execution status.
                      </div>
                    )}

                    <div className="scheduled-job-actions">
                      <button className="icon-button" type="button" onClick={() => editJob(job)} disabled={isPending}>
                        Edit
                      </button>
                      <button className="icon-button" type="button" onClick={() => void handleToggleEnabled(job)} disabled={isPending}>
                        {job.enabled ? 'Pause' : 'Enable'}
                      </button>
                      <button className="icon-button" type="button" onClick={() => void handleRunNow(job.id)} disabled={isPending}>
                        Run now
                      </button>
                      <button className="icon-button" type="button" onClick={() => void handleToggleHistory(job.id)} disabled={isPending}>
                        {isExpanded ? 'Hide history' : 'History'}
                      </button>
                      {job.targetSessionId && (
                        <button className="icon-button" type="button" onClick={() => void onOpenSession(job.targetSessionId!)} disabled={isPending}>
                          Open session
                        </button>
                      )}
                      <button className="icon-button danger" type="button" onClick={() => void handleDelete(job.id)} disabled={isPending}>
                        Delete
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="scheduled-history">
                        {historyLoadingJobId === job.id ? (
                          <p className="scheduled-history-empty">Loading executions...</p>
                        ) : executions.length === 0 ? (
                          <p className="scheduled-history-empty">No executions yet.</p>
                        ) : (
                          executions.slice(0, 8).map((execution) => (
                            <div key={execution.id} className="scheduled-execution-item">
                              <div className="scheduled-execution-main">
                                <div>
                                  <strong>{execution.status}</strong>
                                  <span>{formatDateTime(execution.createdAt)}</span>
                                </div>
                                <div>
                                  <span>{execution.triggerType}</span>
                                  {execution.result?.toolExecutionCount !== undefined && (
                                    <span>{execution.result.toolExecutionCount} tool calls</span>
                                  )}
                                </div>
                              </div>
                              {execution.error && (
                                <div className="scheduled-execution-error">{execution.error}</div>
                              )}
                              {execution.result?.reply && (
                                <div className="scheduled-execution-reply">{truncateText(execution.result.reply, 220)}</div>
                              )}
                              {execution.sessionId && (
                                <div className="scheduled-inline-actions">
                                  <button
                                    className="link-button"
                                    type="button"
                                    onClick={() => void onOpenSession(execution.sessionId)}
                                  >
                                    Open result session
                                  </button>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </article>
                )
              })
            )}
          </div>
        </section>
      </div>
    </section>
  )
}

const StatusCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="status-card">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
)

function createDefaultForm(sessionTemplateId?: string | null): FormState {
  return {
    name: '',
    message: '',
    scheduleType: 'cron',
    runAtLocal: toDatetimeLocalValue(new Date(Date.now() + 30 * 60_000).toISOString()),
    everyMinutes: '60',
    cronExpression: '30 8 * * *',
    cronTimezone: 'Asia/Shanghai',
    enabled: true,
    sessionTemplateId: sessionTemplateId || '',
    overlapPolicy: 'skip',
    createNewSession: true,
    targetChatId: '',
    maxItems: '20',
    sourceSet: 'cn-tech-default',
    catchupPolicy: 'none',
    retryMaxAttempts: '1',
    retryBackoffMinutes: '0',
  }
}

function toDatetimeLocalValue(isoString: string): string {
  const date = new Date(isoString)
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return adjusted.toISOString().slice(0, 16)
}

function formatSchedule(schedule: ScheduledJob['schedule']): string {
  if (schedule.type === 'once') {
    return `Once at ${formatDateTime(schedule.runAt)}`
  }
  if (schedule.type === 'interval') {
    return `Every ${formatDurationMs(schedule.everyMs)}`
  }
  return `Cron ${schedule.expression}${schedule.timezone ? ` (${schedule.timezone})` : ''}`
}

function formatDurationMs(value: number): string {
  const minutes = value / 60_000
  if (minutes < 60) {
    return `${trimNumber(minutes)} min`
  }
  const hours = minutes / 60
  if (hours < 24) {
    return `${trimNumber(hours)} hr`
  }
  const days = hours / 24
  return `${trimNumber(days)} day`
}

function trimNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value)
  }
  return value.toFixed(1).replace(/\.0$/, '')
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}

function shortId(value: string): string {
  return value.slice(0, 8)
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, maxLength).trim()}...`
}
