import { useState, useCallback } from 'react'
import type { Session, SessionSummary } from '../types.js'
import { fetchSessions, createSession, fetchSession, updateSession, deleteSession as apiDeleteSession } from '../api.js'

export function useSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    const list = await fetchSessions()
    setSessions(list)
    return list
  }, [])

  const open = useCallback(async (sessionId: string) => {
    const session = await fetchSession(sessionId)
    setActiveSession(session)
    return session
  }, [])

  const create = useCallback(async (systemPrompt: string) => {
    const { session } = await createSession({ systemPrompt })
    setActiveSession(session)
    await refresh()
    return session
  }, [refresh])

  const patch = useCallback(async (sessionId: string, systemPrompt: string) => {
    const { session } = await updateSession(sessionId, { systemPrompt })
    setActiveSession(session)
    await refresh()
    return session
  }, [refresh])

  const remove = useCallback(async (sessionId: string) => {
    await apiDeleteSession(sessionId)
    if (activeSession?.id === sessionId) {
      setActiveSession(null)
    }
    await refresh()
  }, [activeSession, refresh])

  const setSystemPrompt = useCallback((sessionId: string, systemPrompt: string) => {
    setActiveSession((prev) => (prev && prev.id === sessionId ? { ...prev, systemPrompt } : prev))
  }, [])

  return {
    sessions,
    activeSession,
    loading,
    setLoading,
    refresh,
    open,
    create,
    patch,
    remove,
    setActiveSession,
    setSystemPrompt,
  }
}
