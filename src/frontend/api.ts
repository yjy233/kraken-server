/**
 * API 调用封装
 */

import type {
  Config,
  Session,
  SessionSummary,
  SessionSandboxConfig,
  StreamCompleteData,
  ScheduledExecution,
  ScheduledJob,
  SchedulerStatus,
  WorkspaceFile,
  WorkspaceListing,
  ModelUsageSummary,
  EvolutionProposal,
  EvolutionProposalStatus,
  ProposalApplyResponse,
  AgentContentBlock,
  MarketAlert,
  MarketNarrative,
  MarketOverview,
  MarketWatchlist,
  QuoteSnapshot,
  SectorHeat,
  TechnicalSignal,
} from './types.js'

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

export async function fetchScheduledJobs(): Promise<ScheduledJob[]> {
  const data = await request<{ jobs: ScheduledJob[] }>('/api/scheduled-jobs')
  return data.jobs
}

export async function fetchScheduledJob(jobId: string): Promise<ScheduledJob> {
  const data = await request<{ job: ScheduledJob }>(`/api/scheduled-jobs/${jobId}`)
  return data.job
}

export async function createScheduledJob(body: Record<string, unknown>): Promise<{ job: ScheduledJob }> {
  return request('/api/scheduled-jobs', { method: 'POST', body: JSON.stringify(body) })
}

export async function updateScheduledJob(jobId: string, body: Record<string, unknown>): Promise<{ job: ScheduledJob }> {
  return request(`/api/scheduled-jobs/${jobId}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export async function deleteScheduledJob(jobId: string): Promise<void> {
  await request(`/api/scheduled-jobs/${jobId}`, { method: 'DELETE' })
}

export async function runScheduledJob(jobId: string): Promise<{ execution: ScheduledExecution }> {
  return request(`/api/scheduled-jobs/${jobId}/run`, { method: 'POST' })
}

export async function fetchJobExecutions(jobId: string): Promise<ScheduledExecution[]> {
  const data = await request<{ executions: ScheduledExecution[] }>(`/api/scheduled-jobs/${jobId}/executions`)
  return data.executions
}

export async function fetchSchedulerStatus(): Promise<SchedulerStatus> {
  return request('/api/scheduler/status')
}

export async function fetchModelUsage(): Promise<ModelUsageSummary> {
  return request('/api/model-usage')
}

export async function fetchEvolutionProposals(status?: EvolutionProposalStatus | 'all'): Promise<EvolutionProposal[]> {
  const query = new URLSearchParams()
  if (status && status !== 'all') {
    query.set('status', status)
  }
  const suffix = query.toString() ? `?${query.toString()}` : ''
  const data = await request<{ proposals: EvolutionProposal[] }>(`/api/evolution/proposals${suffix}`)
  return data.proposals
}

export async function acceptEvolutionProposal(
  proposalId: string,
  reviewNote?: string
): Promise<EvolutionProposal> {
  const data = await request<{ proposal: EvolutionProposal }>(
    `/api/evolution/proposals/${encodeURIComponent(proposalId)}/accept`,
    {
      method: 'POST',
      body: JSON.stringify({ reviewNote: reviewNote || '' }),
    }
  )
  return data.proposal
}

export async function rejectEvolutionProposal(
  proposalId: string,
  reviewNote?: string
): Promise<EvolutionProposal> {
  const data = await request<{ proposal: EvolutionProposal }>(
    `/api/evolution/proposals/${encodeURIComponent(proposalId)}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ reviewNote: reviewNote || '' }),
    }
  )
  return data.proposal
}

export async function dryRunEvolutionProposal(
  proposalId: string,
  workspaceRoot?: string,
  sessionId?: string | null
): Promise<ProposalApplyResponse> {
  return request<ProposalApplyResponse>(
    `/api/evolution/proposals/${encodeURIComponent(proposalId)}/dry-run`,
    {
      method: 'POST',
      body: JSON.stringify(buildApplyBody(workspaceRoot, sessionId)),
    }
  )
}

export async function applyEvolutionProposal(
  proposalId: string,
  workspaceRoot?: string,
  sessionId?: string | null
): Promise<ProposalApplyResponse> {
  return request<ProposalApplyResponse>(
    `/api/evolution/proposals/${encodeURIComponent(proposalId)}/apply`,
    {
      method: 'POST',
      body: JSON.stringify(buildApplyBody(workspaceRoot, sessionId)),
    }
  )
}

export async function fetchWorkspaceTree(params: {
  sessionId?: string | null
  path?: string
}): Promise<WorkspaceListing> {
  const query = new URLSearchParams()
  if (params.sessionId) {
    query.set('sessionId', params.sessionId)
  }
  if (params.path) {
    query.set('path', params.path)
  }
  const data = await request<WorkspaceListing>(`/api/workspace/tree?${query.toString()}`)
  return data
}

function buildApplyBody(workspaceRoot?: string, sessionId?: string | null): Record<string, string> {
  const body: Record<string, string> = {}
  if (workspaceRoot && workspaceRoot.trim()) {
    body.workspaceRoot = workspaceRoot.trim()
  }
  if (sessionId) {
    body.sessionId = sessionId
  }
  return body
}

export async function fetchWorkspaceFile(params: {
  sessionId?: string | null
  path: string
}): Promise<WorkspaceFile> {
  const query = new URLSearchParams()
  if (params.sessionId) {
    query.set('sessionId', params.sessionId)
  }
  query.set('path', params.path)
  const data = await request<WorkspaceFile>(`/api/workspace/file?${query.toString()}`)
  return data
}

export async function fetchMarketOverview(): Promise<MarketOverview> {
  const data = await request<{ overview: MarketOverview }>('/api/market/overview')
  return data.overview
}

export async function fetchMarketQuotes(symbols: string[]): Promise<QuoteSnapshot[]> {
  const query = new URLSearchParams()
  if (symbols.length > 0) {
    query.set('symbols', symbols.join(','))
  }
  const suffix = query.toString() ? `?${query.toString()}` : ''
  const data = await request<{ quotes: QuoteSnapshot[] }>(`/api/market/quotes${suffix}`)
  return data.quotes
}

export async function fetchMarketSectors(): Promise<SectorHeat[]> {
  const data = await request<{ sectors: SectorHeat[] }>('/api/market/sectors/hot')
  return data.sectors
}

export async function fetchMarketAlerts(): Promise<MarketAlert[]> {
  const data = await request<{ alerts: MarketAlert[] }>('/api/market/alerts')
  return data.alerts
}

export async function addMarketWatchlistSymbols(symbols: string[]): Promise<MarketWatchlist> {
  const data = await request<{ watchlist: MarketWatchlist }>('/api/market/watchlists', {
    method: 'POST',
    body: JSON.stringify({ symbols }),
  })
  return data.watchlist
}

export async function removeMarketWatchlistSymbol(symbol: string): Promise<MarketWatchlist> {
  const data = await request<{ watchlist: MarketWatchlist }>(
    `/api/market/watchlists/${encodeURIComponent(symbol)}`,
    { method: 'DELETE' }
  )
  return data.watchlist
}

export async function analyzeMarketNarrative(content: string): Promise<MarketNarrative> {
  const data = await request<{ narrative: MarketNarrative }>('/api/market/narratives/analyze', {
    method: 'POST',
    body: JSON.stringify({ content }),
  })
  return data.narrative
}

export async function fetchMarketTechnical(symbol: string): Promise<TechnicalSignal> {
  const data = await request<{ technical: TechnicalSignal }>(
    `/api/market/technicals/${encodeURIComponent(symbol)}`
  )
  return data.technical
}

export function buildWorkspaceDownloadUrl(params: {
  sessionId?: string | null
  path: string
}): string {
  const query = new URLSearchParams({ path: params.path })
  if (params.sessionId) {
    query.set('sessionId', params.sessionId)
  }
  return `${BASE}/api/workspace/download?${query.toString()}`
}

export async function saveWorkspaceFile(params: {
  sessionId?: string | null
  path: string
  content: string
}): Promise<WorkspaceFile> {
  const body: {
    path: string
    content: string
    sessionId?: string
  } = {
    path: params.path,
    content: params.content,
  }
  if (params.sessionId) {
    body.sessionId = params.sessionId
  }
  return request('/api/workspace/file', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function deleteWorkspaceFile(params: {
  sessionId?: string | null
  path: string
}): Promise<void> {
  const body: {
    path: string
    sessionId?: string
  } = {
    path: params.path,
  }
  if (params.sessionId) {
    body.sessionId = params.sessionId
  }
  await request('/api/workspace/file', {
    method: 'DELETE',
    body: JSON.stringify(body),
  })
}

export async function uploadWorkspaceFile(params: {
  sessionId?: string | null
  path: string
  file: File
}): Promise<WorkspaceFile> {
  const query = new URLSearchParams({
    path: params.path || '.',
    filename: params.file.name,
  })
  if (params.sessionId) {
    query.set('sessionId', params.sessionId)
  }

  const response = await fetch(`${BASE}/api/workspace/upload?${query.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: params.file,
  })
  const text = await response.text()
  let payload: any = {}
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = { error: text || 'Invalid server response' }
  }
  if (!response.ok) {
    throw new Error(payload.error || 'Upload failed')
  }
  return payload as WorkspaceFile
}

export interface ChatPayload {
  sessionId: string | null
  systemPrompt: string
  message: string
  content?: AgentContentBlock[]
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
