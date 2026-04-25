/**
 * API 调用封装
 */

import type { Config, Session, SessionSummary, SessionSandboxConfig, StreamCompleteData } from './types.js'

const BASE = ''

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${url}`, {
    headers: { 'content-type': 'application/json', ...(options?.headers || {}) },
    ...options,
  })
  const text = await response.text()
  let payload: any = {}
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = { error: text || 'Invalid server response' }
  }
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed')
  }
  return payload as T
}

export async function fetchConfig(): Promise<Config> {
  const data = await request<Config | { config: Config }>('/api/config')
  return 'config' in data ? data.config : data
}

export async function fetchSessions(): Promise<SessionSummary[]> {
  const data = await request<{ sessions: SessionSummary[] }>('/api/sessions')
  return data.sessions
}

export async function createSession(body: { systemPrompt: string; sandbox?: SessionSandboxConfig | undefined }): Promise<{ session: Session; summary: SessionSummary }> {
  return request('/api/sessions', { method: 'POST', body: JSON.stringify(body) })
}

export async function fetchSession(sessionId: string): Promise<Session> {
  const data = await request<{ session: Session }>(`/api/sessions/${sessionId}`)
  return data.session
}

export async function updateSession(sessionId: string, body: { title?: string; systemPrompt?: string; model?: string; sandbox?: SessionSandboxConfig | undefined }): Promise<{ session: Session; summary: SessionSummary }> {
  return request(`/api/sessions/${sessionId}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export async function deleteSession(sessionId: string): Promise<void> {
  await request(`/api/sessions/${sessionId}`, { method: 'DELETE' })
}

export async function deleteAllSessions(): Promise<void> {
  await request('/api/sessions', { method: 'DELETE' })
}

export interface ChatPayload {
  sessionId: string | null
  systemPrompt: string
  message: string
  model?: string
  sandbox?: SessionSandboxConfig | undefined
}

export function streamChat(
  payload: ChatPayload,
  handlers: {
    onEvent: (event: string, data: unknown) => void
    onComplete: (data: StreamCompleteData) => void
    onError: (error: Error) => void
  }
): () => void {
  const url = `/api/chat/stream?payload=${encodeURIComponent(JSON.stringify(payload))}`
  const abortController = new AbortController()

  fetch(url, { method: 'GET', headers: { accept: 'text/event-stream' }, signal: abortController.signal })
    .then(async (response) => {
      if (!response.ok || !response.body) {
        const message = await response.text()
        throw new Error(message || 'Unable to open stream')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() || ''

        for (const chunk of chunks) {
          const parsed = parseSseChunk(chunk)
          if (!parsed) continue

          if (parsed.event === 'error') {
            const errData = parsed.data as any
            throw new Error(errData?.error || 'Streaming request failed')
          }

          if (parsed.event === 'complete') {
            handlers.onComplete(parsed.data as StreamCompleteData)
            continue
          }

          handlers.onEvent(parsed.event, parsed.data)
        }
      }
    })
    .catch((error) => {
      if (error.name !== 'AbortError') {
        handlers.onError(error instanceof Error ? error : new Error(String(error)))
      }
    })

  return () => abortController.abort()
}

function parseSseChunk(chunk: string): { event: string; data: unknown } | null {
  const lines = chunk.split('\n')
  let event = 'message'
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }

  if (!dataLines.length) return null

  try {
    return { event, data: JSON.parse(dataLines.join('\n')) }
  } catch {
    return null
  }
}
