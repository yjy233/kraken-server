import { useCallback, useEffect, useState } from 'react'
import type { ScheduledExecution, ScheduledJob, SchedulerStatus } from '../types.js'
import {
  createScheduledJob,
  deleteScheduledJob,
  fetchJobExecutions,
  fetchScheduledJobs,
  fetchSchedulerStatus,
  runScheduledJob,
  updateScheduledJob,
} from '../api.js'

export function useScheduledJobs(active: boolean) {
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [status, setStatus] = useState<SchedulerStatus | null>(null)
  const [executionsByJob, setExecutionsByJob] = useState<Record<string, ScheduledExecution[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [nextJobs, nextStatus] = await Promise.all([
        fetchScheduledJobs(),
        fetchSchedulerStatus(),
      ])
      setJobs(nextJobs)
      setStatus(nextStatus)
      setError(null)
      return { jobs: nextJobs, status: nextStatus }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setError(message)
      throw error
    } finally {
      setLoading(false)
    }
  }, [])

  const loadExecutions = useCallback(async (jobId: string) => {
    try {
      const executions = await fetchJobExecutions(jobId)
      setExecutionsByJob((prev) => ({
        ...prev,
        [jobId]: executions,
      }))
      setError(null)
      return executions
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setError(message)
      throw error
    }
  }, [])

  const createJob = useCallback(async (body: Record<string, unknown>) => {
    try {
      const result = await createScheduledJob(body)
      setError(null)
      await refresh()
      return result.job
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setError(message)
      throw error
    }
  }, [refresh])

  const updateJob = useCallback(async (jobId: string, body: Record<string, unknown>) => {
    try {
      const result = await updateScheduledJob(jobId, body)
      setError(null)
      await refresh()
      if (executionsByJob[jobId]) {
        await loadExecutions(jobId)
      }
      return result.job
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setError(message)
      throw error
    }
  }, [executionsByJob, loadExecutions, refresh])

  const removeJob = useCallback(async (jobId: string) => {
    try {
      await deleteScheduledJob(jobId)
      setExecutionsByJob((prev) => {
        const next = { ...prev }
        delete next[jobId]
        return next
      })
      setError(null)
      await refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setError(message)
      throw error
    }
  }, [refresh])

  const runJobNow = useCallback(async (jobId: string) => {
    try {
      const result = await runScheduledJob(jobId)
      setError(null)
      await refresh()
      await loadExecutions(jobId)
      return result.execution
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setError(message)
      throw error
    }
  }, [loadExecutions, refresh])

  useEffect(() => {
    if (!active) {
      return
    }

    void refresh().catch(() => {})
    const timer = window.setInterval(() => {
      void refresh().catch(() => {})
    }, 15000)

    return () => {
      window.clearInterval(timer)
    }
  }, [active, refresh])

  return {
    jobs,
    status,
    executionsByJob,
    loading,
    error,
    refresh,
    loadExecutions,
    createJob,
    updateJob,
    removeJob,
    runJobNow,
  }
}
