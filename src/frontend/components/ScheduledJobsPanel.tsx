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
  scheduleType: 'once' | 'interval'
  runAtLocal: string
  everyMinutes: string
  enabled: boolean
  sessionTemplateId: string
  overlapPolicy: 'skip' | 'parallel'
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
    const runAt = new Date(form.runAtLocal).getTime()
    const delayMs = runAt - Date.now()
    return Number.isFinite(runAt) && delayMs > 0 && delayMs < schedulerPollIntervalMs
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
      enabled: job.enabled,
      sessionTemplateId: job.sessionTemplateId || '',
      overlapPolicy: job.overlapPolicy === 'parallel' ? 'parallel' : 'skip',
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

    if (editingJob?.sessionTemplateId && !form.sessionTemplateId.trim()) {
      setFormError('Removing an existing session template is not supported yet.')
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
    } else {
      const everyMinutes = Number(form.everyMinutes)
      if (!Number.isFinite(everyMinutes) || everyMinutes <= 0) {
        setFormError('Interval minutes must be a positive number.')
        return
      }
      schedule = {
        type: 'interval',
        everyMs: Math.round(everyMinutes * 60_000),
      }
    }

    const payload: Record<string, unknown> = {
      name,
      message,
      enabled: form.enabled,
      schedule,
      overlapPolicy: form.overlapPolicy,
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
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }, [editingJob?.sessionTemplateId, editingJobId, form, onCreateJob, onUpdateJob, resetForm])

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
                Each job reuses one fixed session. Template sessions copy prompt, model,
                sandbox, and loaded skills when that target session is first established.
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
                placeholder="daily-briefing"
                value={form.name}
                onChange={(event) => updateForm({ name: event.target.value })}
              />
            </label>

            <label className="scheduled-field">
              <span>Message</span>
              <textarea
                className="scheduled-textarea"
                rows={5}
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
              ) : (
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
              )}
            </div>

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
            </div>

            {hasShortIntervalWarning && (
              <div className="scheduled-note scheduled-note-warning">
                Current scan interval is {formatDurationMs(schedulerPollIntervalMs)}. Short-delay jobs may run late.
              </div>
            )}

            <div className="scheduled-note">
              Current frontend supports `once` and `interval`. Daily fixed-time scheduling is not implemented yet.
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
            <StatusCard label="Next Wake" value={status?.nextWakeAt ? formatDateTime(status.nextWakeAt) : 'None'} />
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
                <p>Create one from the form. Each run will create a separate session you can inspect later.</p>
              </div>
            ) : (
              jobs.map((job) => {
                const executions = executionsByJob[job.id] || []
                const isExpanded = expandedJobId === job.id
                const isPending = pendingJobIds.includes(job.id)
                const templateSession = job.sessionTemplateId ? sessionsById.get(job.sessionTemplateId) : null
                const targetSession = job.targetSessionId ? sessionsById.get(job.targetSessionId) : null

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
                      <span>Template: {templateSession?.title || (job.sessionTemplateId ? shortId(job.sessionTemplateId) : 'None')}</span>
                      <span>Target: {targetSession?.title || (job.targetSessionId ? shortId(job.targetSessionId) : 'Pending')}</span>
                    </div>

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
    scheduleType: 'once',
    runAtLocal: toDatetimeLocalValue(new Date(Date.now() + 30 * 60_000).toISOString()),
    everyMinutes: '60',
    enabled: true,
    sessionTemplateId: sessionTemplateId || '',
    overlapPolicy: 'skip',
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
  return `Every ${formatDurationMs(schedule.everyMs)}`
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
