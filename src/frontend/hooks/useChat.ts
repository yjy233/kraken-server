import { useState, useCallback, useRef, useEffect } from 'react'
import type { Session, SessionMessage, RuntimeEvent, SessionSandboxConfig, ContextWindowState } from '../types.js'
import { wsClient } from '../ws-client.js'
import type { WsServerMessage } from '../../ws/protocol.js'

interface ChatState {
  sending: boolean
  error: string | null
  runtimeEvents: RuntimeEvent[]
  streamingText: string
  traceSessionId: string | null
}

export function useChat(
  activeSession: Session | null,
  onSessionUpdate: (session: Session) => void,
  onSessionsRefresh: () => Promise<unknown>,
  onContextWindowUpdate?: (sessionId: string, contextWindow: ContextWindowState) => void
) {
  const [state, setState] = useState<ChatState>({
    sending: false,
    error: null,
    runtimeEvents: [],
    streamingText: '',
    traceSessionId: null,
  })

  const abortRef = useRef<(() => void) | null>(null)
  const requestIdRef = useRef<string | null>(null)

  useEffect(() => {
    wsClient.connect()
    const unsubscribe = wsClient.subscribe((message: WsServerMessage) => {
      const requestId = requestIdRef.current
      if (!requestId) {
        return
      }

      if (message.type === 'request:error' && message.requestId === requestId) {
        setState((prev) => ({ ...prev, sending: false, error: message.error, streamingText: '' }))
        requestIdRef.current = null
        return
      }

      if (message.type === 'chat:event' && message.requestId === requestId) {
        setState((prev) => {
          const next: ChatState = {
            ...prev,
            runtimeEvents: [...prev.runtimeEvents, { event: message.event, data: message.data, at: new Date().toISOString() }].slice(-80),
          }
          if (message.event === 'assistant:delta') {
            next.streamingText = ((message.data as { text?: string }).text) || ''
          }
          if (message.event === 'context:state') {
            const data = message.data as { sessionId?: string; contextWindow?: ContextWindowState }
            if (data.sessionId && data.contextWindow) {
              onContextWindowUpdate?.(data.sessionId, data.contextWindow)
            }
          }
          return next
        })
        return
      }

      if (message.type === 'chat:complete' && message.requestId === requestId) {
        void (async () => {
          onSessionUpdate(message.payload.session)
          await onSessionsRefresh()
          setState((prev) => ({
            ...prev,
            sending: false,
            streamingText: '',
            traceSessionId: message.payload.session.id,
          }))
          requestIdRef.current = null
        })()
      }
    })

    return () => {
      unsubscribe()
    }
  }, [onSessionUpdate, onSessionsRefresh, onContextWindowUpdate])

  const send = useCallback(
    async (message: string, systemPrompt: string, sandbox?: SessionSandboxConfig) => {
      if (!message.trim()) return

      setState({
        sending: true,
        error: null,
        runtimeEvents: [],
        streamingText: '',
        traceSessionId: activeSession?.id || 'pending',
      })

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
        sandbox,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      }

      const messagesWithOptimistic = [...baseSession.messages, optimisticUserMsg]
      onSessionUpdate({ ...baseSession, messages: messagesWithOptimistic })

      const payload: {
        sessionId: string | null
        systemPrompt: string
        message: string
        sandbox?: SessionSandboxConfig
      } = {
        sessionId: activeSession?.id || null,
        systemPrompt: systemPrompt.trim(),
        message: message.trim(),
      }
      if (sandbox !== undefined) {
        payload.sandbox = sandbox
      }

      const requestId = globalThis.crypto.randomUUID()
      requestIdRef.current = requestId
      wsClient.send({
        type: 'chat:start',
        requestId,
        payload,
      })
      abortRef.current = () => {
        wsClient.send({
          type: 'chat:cancel',
          requestId,
        })
      }
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
