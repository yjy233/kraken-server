import { useState, useCallback, useRef } from 'react'
import type { Session, SessionMessage, RuntimeEvent, StreamCompleteData } from '../types.js'
import { streamChat as apiStreamChat } from '../api.js'

interface ChatState {
  sending: boolean
  error: string | null
  runtimeEvents: RuntimeEvent[]
  streamingText: string
}

export function useChat(
  activeSession: Session | null,
  onSessionUpdate: (session: Session) => void,
  onSessionsRefresh: () => Promise<unknown>
) {
  const [state, setState] = useState<ChatState>({
    sending: false,
    error: null,
    runtimeEvents: [],
    streamingText: '',
  })

  const abortRef = useRef<(() => void) | null>(null)

  const send = useCallback(
    async (message: string, systemPrompt: string) => {
      if (!message.trim()) return

      setState({ sending: true, error: null, runtimeEvents: [], streamingText: '' })

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
          setState((prev) => {
            const next: ChatState = {
              ...prev,
              runtimeEvents: [...prev.runtimeEvents, { event, data, at: new Date().toISOString() }].slice(-80),
            }
            // 提取 assistant 流式文本
            if (event === 'assistant:delta') {
              next.streamingText = (data as any).text || ''
            }
            return next
          })
        },
        onComplete: async (data) => {
          onSessionUpdate(data.session)
          await onSessionsRefresh()
          setState((prev) => ({ ...prev, sending: false, streamingText: '' }))
        },
        onError: (error) => {
          setState((prev) => ({ ...prev, sending: false, error: error.message, streamingText: '' }))
        },
      })
    },
    [activeSession, onSessionUpdate, onSessionsRefresh]
  )

  const cancel = useCallback(() => {
    abortRef.current?.()
    abortRef.current = null
    setState((prev) => ({ ...prev, sending: false, streamingText: '' }))
  }, [])

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }))
  }, [])

  return { ...state, send, cancel, clearError }
}
