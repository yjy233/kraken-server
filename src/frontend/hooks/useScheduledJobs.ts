import { useCallback, useEffect, useState } from 'react'
import type { ScheduledExecution, ScheduledJob, SchedulerStatus } from '../types.js'
import { wsClient } from '../ws-client.js'
import type { WsServerMessage } from '../../ws/protocol.js'

export function useScheduledJobs(active: boolean) {
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [status, setStatus] = useState<SchedulerStatus | null>(null)
  const [executionsByJob, setExecutionsByJob] = useState<Record<string, ScheduledExecution[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleMessage = useCallback((message: WsServerMessage) => {
    if (message.type === 'request:error') {
      setLoading(false)
      setError(message.error)
      return
    }
    if (message.type === 'scheduler:snapshot') {
      setJobs(message.payload.jobs)
      setStatus(message.payload.status)
      setLoading(false)
      setError(null)
      return
    }
    if (message.type === 'scheduler:job-created' || message.type === 'scheduler:job-updated') {
      setJobs((prev) => {
        const next = prev.filter((job) => job.id !== message.job.id)
        next.unshift(message.job)
        return next
      })
      setError(null)
      return
    }
    if (message.type === 'scheduler:job-deleted') {
      setJobs((prev) => prev.filter((job) => job.id !== message.jobId))
      setExecutionsByJob((prev) => {
        const next = { ...prev }
        delete next[message.jobId]
        return next
      })
      setError(null)
      return
    }
    if (message.type === 'scheduler:job-executions') {
      setExecutionsByJob((prev) => ({
        ...prev,
        [message.jobId]: message.executions,
      }))
      setError(null)
      return
    }
    if (message.type === 'scheduler:execution-created' || message.type === 'scheduler:execution-updated') {
      setExecutionsByJob((prev) => {
        const list = prev[message.execution.jobId] || []
        const nextList = [message.execution, ...list.filter((item) => item.id !== message.execution.id)]
        return {
          ...prev,
          [message.execution.jobId]: nextList,
        }
      })
      setLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    const response = await wsClient.request({
      type: 'scheduler:refresh',
      requestId: globalThis.crypto.randomUUID(),
    }, (message): message is Extract<WsServerMessage, { type: 'scheduler:snapshot' }> => {
      return message.type === 'scheduler:snapshot'
    })
    setJobs(response.payload.jobs)
    setStatus(response.payload.status)
    setLoading(false)
    setError(null)
    return response.payload
  }, [])

  const loadExecutions = useCallback(async (jobId: string) => {
    const response = await wsClient.request({
      type: 'scheduled-job:load-executions',
      requestId: globalThis.crypto.randomUUID(),
      jobId,
    }, (message): message is Extract<WsServerMessage, { type: 'scheduler:job-executions' }> => {
      return message.type === 'scheduler:job-executions' && message.jobId === jobId
    })
    setExecutionsByJob((prev) => ({
      ...prev,
      [jobId]: response.executions,
    }))
    setError(null)
    return response.executions
  }, [])

  const createJob = useCallback(async (body: Record<string, unknown>) => {
    const response = await wsClient.request({
      type: 'scheduled-job:create',
      requestId: globalThis.crypto.randomUUID(),
      payload: body,
    }, (message): message is Extract<WsServerMessage, { type: 'scheduler:job-created' }> => {
      return message.type === 'scheduler:job-created'
    })
    setError(null)
    return response.job
  }, [])

  const updateJob = useCallback(async (jobId: string, body: Record<string, unknown>) => {
    const response = await wsClient.request({
      type: 'scheduled-job:update',
      requestId: globalThis.crypto.randomUUID(),
      jobId,
      payload: body,
    }, (message): message is Extract<WsServerMessage, { type: 'scheduler:job-updated' }> => {
      return message.type === 'scheduler:job-updated' && message.job.id === jobId
    })
    setError(null)
    return response.job
  }, [])

  const removeJob = useCallback(async (jobId: string) => {
    await wsClient.request({
      type: 'scheduled-job:delete',
      requestId: globalThis.crypto.randomUUID(),
      jobId,
    }, (message): message is Extract<WsServerMessage, { type: 'scheduler:job-deleted' }> => {
      return message.type === 'scheduler:job-deleted' && message.jobId === jobId
    })
    setError(null)
  }, [])

  const runJobNow = useCallback(async (jobId: string) => {
    const response = await wsClient.request({
      type: 'scheduled-job:run',
      requestId: globalThis.crypto.randomUUID(),
      jobId,
    }, (message): message is Extract<WsServerMessage, { type: 'scheduler:job-executions' }> => {
      return message.type === 'scheduler:job-executions' && message.jobId === jobId
    })
    setExecutionsByJob((prev) => ({
      ...prev,
      [jobId]: response.executions,
    }))
    setError(null)
    return response.executions[0]
  }, [])

  useEffect(() => {
    if (!active) {
      return
    }

    wsClient.connect()
    const unsubscribe = wsClient.subscribe(handleMessage)
    const subscribe = () => wsClient.send({
      type: 'scheduler:subscribe',
      requestId: globalThis.crypto.randomUUID(),
    })
    subscribe()
    const unsubscribeOpen = wsClient.onOpen(() => {
      subscribe()
    })

    return () => {
      unsubscribe()
      unsubscribeOpen()
    }
  }, [active, handleMessage])

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
