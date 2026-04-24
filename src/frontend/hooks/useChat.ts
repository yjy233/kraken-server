import { useState, useCallback, useRef } from 'react'
import type { Session, SessionMessage, RuntimeEvent, StreamCompleteData } from '../types.js'
import { streamChat as apiStreamChat } from '../api.js'

interface ChatState {
  sending: boolean
  error: string | null
  runtimeEvents: RuntimeEvent[]
}

export function useChat(
  activeSession: Session | null,
  onSessionUpdate: (session: Session) => void,
  onSessionsRefresh: () => Promise<void>
) {
  const [state, setState] = useState<ChatState>({
    sending: false,
    error: null,
    runtimeEvents: [],
  })

  const abortRef = useRef<(() => void) | null>(null)

  const send = useCallback(
    async (message: string, systemPrompt: string) => {
      if (!message.trim()) return

      setState({ sending: true, error: null, runtimeEvents: [] })

      // 乐观插入用户消息到当前会话
      const optimisticUserMsg: SessionMessage = {
        id: `optimistic-user-${Date.now()}`,
        role: 'user',
        content: message,
        createdAt: new Date().toISOString(),
      }

      const baseSession: Session = activeSession || {
        id: 'pending',
        title: message.slice(0, 60) || 'New chat',
        model: '',
        systemPrompt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      }

      const messagesWithOptimistic = [...baseSession.messages, optimisticUserMsg]
      onSessionUpdate({ ...baseSession, messages: messagesWithOptimistic })

      const payload = {
        sessionId: activeSession?.id || null,
        systemPrompt: systemPrompt.trim(),
        message: message.trim(),
      }

      abortRef.current = apiStreamChat(payload, {
        onEvent: (event, data) => {
          setState((prev) => ({
            ...prev,
            runtimeEvents: [...prev.runtimeEvents, { event, data, at: new Date().toISOString() }].slice(-80),
          }))
        },
        onComplete: async (data) => {
          onSessionUpdate(data.session)
          await onSessionsRefresh()
          setState((prev) => ({ ...prev, sending: false }))
        },
        onError: (error) => {
          setState((prev) => ({ ...prev, sending: false, error: error.message }))
        },
      })
    },
    [activeSession, onSessionUpdate, onSessionsRefresh]
  )

  const cancel = useCallback(() => {
    abortRef.current?.()
    abortRef.current = null
    setState((prev) => ({ ...prev, sending: false }))
  }, [])

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }))
  }, [])

  return { ...state, send, cancel, clearError }
}
