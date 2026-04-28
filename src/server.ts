import './bootstrap.js'

import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { WebSocketServer, type WebSocket } from 'ws'
import { createToolRegistry, type CreateRegistryOptions } from './tools/registry.js'
import { parseSensitivePaths } from './tools/sandbox.js'
import type { SessionSandboxConfig } from './tools/types.js'
import { getAvailableSkills } from './skills/manager.js'
import {
  parseInteger,
  parseBoolean,
  expandHomePath,
} from './utils/helpers.js'
import { createSessionStore } from './runtime/session-store.js'
import { createAgentService } from './runtime/agent-service.js'
import { createSchedulerStore } from './scheduler/store.js'
import { computeNextRunAt } from './scheduler/planner.js'
import { createSchedulerService } from './scheduler/service.js'
import type { ScheduledJob, ScheduledJobSchedule } from './scheduler/types.js'
import { createWsHub } from './ws/hub.js'
import type { WsClientMessage, WsServerMessage } from './ws/protocol.js'
import { isWsClientMessage } from './ws/protocol.js'
import { createWorkspaceBrowserService } from './workspace/browser.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')
const PUBLIC_DIR = path.join(ROOT_DIR, 'public')
const SESSION_DIR = path.join(ROOT_DIR, '.sessions')
const SCHEDULED_JOBS_DIR = path.join(ROOT_DIR, '.scheduled-jobs')

const HOST = process.env.HOST || '127.0.0.1'
const PORT = parseInteger(process.env.PORT, 3011)
const APP_TITLE = process.env.APP_TITLE || 'Kraken Agent'
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || process.env.DEFAULT_MODEL || 'anthropic/claude-sonnet-4'
const MAX_TOKENS = parseInteger(process.env.MAX_TOKENS, 2048)
const MAX_CONTEXT_TOKENS = parseInteger(process.env.MAX_CONTEXT_TOKENS, 32000)
const BASE_SYSTEM_PROMPT = `You are Kraken Agent, an all-purpose AI assistant.

Before answering, think step by step:
1. Understand the user's intent and the core problem.
2. Determine whether a tool can help (search, file operations, code execution, etc.).
3. If a tool is needed, plan the sequence of calls and reason about the expected outcome of each step.
4. After gathering all necessary information, synthesize a clear, accurate, and helpful final answer.

Always reason through your plan explicitly before taking action. When you use tools, incorporate their outputs naturally into your response.`
const MAX_CONTEXT_MESSAGES = parseInteger(process.env.MAX_CONTEXT_MESSAGES, 24)
const MAX_AGENT_STEPS = parseInteger(process.env.MAX_AGENT_STEPS, 8)
const REQUEST_TIMEOUT_MS = parseInteger(process.env.REQUEST_TIMEOUT_MS, 120000)
const ALLOW_SHELL_TOOL = parseBoolean(process.env.ALLOW_SHELL_TOOL, true)
const ALLOW_FILE_WRITE_TOOL = parseBoolean(process.env.ALLOW_FILE_WRITE_TOOL, false)
const ALLOW_AGENT_BROWSER = parseBoolean(process.env.ALLOW_AGENT_BROWSER, false)
const AGENT_BROWSER_BIN = process.env.AGENT_BROWSER_BIN || 'agent-browser'
const AGENT_BROWSER_MAX_OUTPUT = parseInteger(process.env.AGENT_BROWSER_MAX_OUTPUT, 50000)
const AGENT_BROWSER_DEFAULT_TIMEOUT = parseInteger(process.env.AGENT_BROWSER_DEFAULT_TIMEOUT, 25000)
const AGENT_BROWSER_ALLOWED_DOMAINS = normalizeAgentBrowserAllowedDomains(process.env.AGENT_BROWSER_ALLOWED_DOMAINS)
const ENABLE_PATH_SANDBOX = parseBoolean(process.env.ENABLE_PATH_SANDBOX, true)
const ENABLE_SEATBELT = parseBoolean(process.env.ENABLE_SEATBELT, true)
const DEFAULT_WORKSPACE_ROOT = path.resolve(expandHomePath(process.env.DEFAULT_WORKSPACE_ROOT || path.join(os.homedir(), 'kraken')))
const SENSITIVE_PATHS = parseSensitivePaths(process.env.SENSITIVE_PATHS)
const CONFIGURED = Boolean(process.env.OPENROUTER_API_KEY)
const SCHEDULER_ENABLED = parseBoolean(process.env.SCHEDULER_ENABLED, true)
const SCHEDULER_POLL_INTERVAL_MS = parseInteger(process.env.SCHEDULER_POLL_INTERVAL_MS, 300000)
const SCHEDULER_MAX_CONCURRENCY = parseInteger(process.env.SCHEDULER_MAX_CONCURRENCY, 1)

const ENABLED_TOOLS = (process.env.ENABLED_TOOLS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const TOOL_REGISTRY_OPTIONS: CreateRegistryOptions = {
  rootDir: ROOT_DIR,
  allowShellTool: ALLOW_SHELL_TOOL,
  allowFileWriteTool: ALLOW_FILE_WRITE_TOOL,
  allowAgentBrowserTool: ALLOW_AGENT_BROWSER,
  agentBrowserBin: AGENT_BROWSER_BIN,
  agentBrowserMaxOutput: AGENT_BROWSER_MAX_OUTPUT,
  agentBrowserDefaultTimeout: AGENT_BROWSER_DEFAULT_TIMEOUT,
  agentBrowserAllowedDomains: AGENT_BROWSER_ALLOWED_DOMAINS,
  enablePathSandbox: ENABLE_PATH_SANDBOX,
  enableSeatbelt: ENABLE_SEATBELT,
  defaultWorkspaceRoot: DEFAULT_WORKSPACE_ROOT,
  sensitivePaths: SENSITIVE_PATHS,
  enabledTools: ENABLED_TOOLS.length > 0 ? ENABLED_TOOLS : undefined,
}

const sessionStore = createSessionStore({
  sessionDir: SESSION_DIR,
  defaultModel: DEFAULT_MODEL,
  normalizeSystemPrompt,
})

const wsHub = createWsHub()

const agentService = createAgentService({
  defaultModel: DEFAULT_MODEL,
  baseSystemPrompt: BASE_SYSTEM_PROMPT,
  maxSteps: MAX_AGENT_STEPS,
  maxTokens: MAX_TOKENS,
  maxContextTokens: MAX_CONTEXT_TOKENS,
  timeout: REQUEST_TIMEOUT_MS,
  maxContextMessages: MAX_CONTEXT_MESSAGES,
  defaultWorkspaceRoot: DEFAULT_WORKSPACE_ROOT,
  sensitivePaths: SENSITIVE_PATHS,
  enablePathSandbox: ENABLE_PATH_SANDBOX,
  toolRegistryOptions: TOOL_REGISTRY_OPTIONS,
  sessionStore,
})

const schedulerStore = createSchedulerStore(SCHEDULED_JOBS_DIR)
const workspaceBrowser = createWorkspaceBrowserService({
  defaultWorkspaceRoot: DEFAULT_WORKSPACE_ROOT,
  sensitivePaths: SENSITIVE_PATHS,
  enablePathSandbox: ENABLE_PATH_SANDBOX,
})
const schedulerService = createSchedulerService({
  enabled: SCHEDULER_ENABLED,
  pollIntervalMs: SCHEDULER_POLL_INTERVAL_MS,
  maxConcurrency: SCHEDULER_MAX_CONCURRENCY,
  store: schedulerStore,
  sessionStore,
  agentRunner: agentService,
  onExecutionCreated: (execution) => {
    wsHub.broadcastScheduler({
      type: 'scheduler:execution-created',
      execution,
    })
  },
  onExecutionUpdated: (execution) => {
    wsHub.broadcastScheduler({
      type: 'scheduler:execution-updated',
      execution,
    })
  },
  onJobUpdated: (job) => {
    wsHub.broadcastScheduler({
      type: 'scheduler:job-updated',
      job,
    })
  },
})

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }))

app.get('/api/health', async (_req, res) => {
  const schedulerStatus = await schedulerService.getStatus()
  res.json({
    ok: true,
    configured: CONFIGURED,
    host: HOST,
    port: PORT,
    model: DEFAULT_MODEL,
    maxAgentSteps: MAX_AGENT_STEPS,
    toolCount: createToolRegistry(TOOL_REGISTRY_OPTIONS).length,
    scheduler: schedulerStatus,
    now: new Date().toISOString(),
  })
})

app.get('/api/config', (_req, res) => {
  res.json({
    ok: true,
    appTitle: APP_TITLE,
    configured: CONFIGURED,
    model: DEFAULT_MODEL,
    defaultSystemPrompt: normalizeSystemPrompt(undefined),
    maxAgentSteps: MAX_AGENT_STEPS,
    maxContextTokens: MAX_CONTEXT_TOKENS,
    defaultWorkspaceRoot: DEFAULT_WORKSPACE_ROOT,
    sandboxEnabled: ENABLE_PATH_SANDBOX,
    seatbeltEnabled: ENABLE_SEATBELT,
    schedulerEnabled: SCHEDULER_ENABLED,
    schedulerMaxConcurrency: SCHEDULER_MAX_CONCURRENCY,
    schedulerPollIntervalMs: SCHEDULER_POLL_INTERVAL_MS,
    skills: getAvailableSkills().map((skill) => ({
      name: skill.name,
      description: skill.description,
    })),
    tools: createToolRegistry(TOOL_REGISTRY_OPTIONS).map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    })),
  })
})

app.get('/api/tools', (_req, res) => {
  res.json({
    ok: true,
    tools: createToolRegistry(TOOL_REGISTRY_OPTIONS).map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    })),
  })
})

app.get('/api/workspace/tree', async (req, res, next) => {
  try {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId.trim() : ''
    const directoryPath = typeof req.query.path === 'string' ? req.query.path.trim() : '.'
    const session = sessionId ? await sessionStore.loadSession(sessionId) : null
    const input: {
      sessionId?: string
      sandbox?: SessionSandboxConfig | undefined
      path?: string
    } = {
      path: directoryPath || '.',
    }
    if (session?.id) {
      input.sessionId = session.id
    }
    if (session?.sandbox !== undefined) {
      input.sandbox = session.sandbox
    }
    const listing = await workspaceBrowser.listDirectory(input)
    res.json({ ok: true, ...listing })
  } catch (error) {
    next(error)
  }
})

app.get('/api/workspace/file', async (req, res, next) => {
  try {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId.trim() : ''
    const filePath = typeof req.query.path === 'string' ? req.query.path.trim() : ''
    if (!filePath) {
      return res.status(400).json({ ok: false, error: 'path query parameter is required' })
    }
    const session = sessionId ? await sessionStore.loadSession(sessionId) : null
    const input: {
      sessionId?: string
      sandbox?: SessionSandboxConfig | undefined
      path: string
    } = {
      path: filePath,
    }
    if (session?.id) {
      input.sessionId = session.id
    }
    if (session?.sandbox !== undefined) {
      input.sandbox = session.sandbox
    }
    const file = await workspaceBrowser.readFile(input)
    res.json({ ok: true, ...file })
  } catch (error) {
    next(error)
  }
})

app.get('/api/sessions', async (_req, res, next) => {
  try {
    const sessions = await sessionStore.listSessions()
    res.json({ ok: true, sessions })
  } catch (error) {
    next(error)
  }
})

app.post('/api/sessions', async (req, res, next) => {
  try {
    const session = sessionStore.createSession({
      title: typeof req.body?.title === 'string' ? req.body.title : '',
      systemPrompt: typeof req.body?.systemPrompt === 'string' ? req.body.systemPrompt : undefined,
      model: typeof req.body?.model === 'string' ? req.body.model : DEFAULT_MODEL,
      sandbox: req.body?.sandbox as SessionSandboxConfig | undefined,
    })
    await sessionStore.saveSession(session)
    res.status(201).json({ ok: true, session, summary: sessionStore.summarizeSession(session) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/sessions/:sessionId', async (req, res, next) => {
  try {
    const session = await sessionStore.loadSession(req.params.sessionId)
    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session not found' })
    }
    res.json({ ok: true, session })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/sessions/:sessionId', async (req, res, next) => {
  try {
    const session = await sessionStore.loadSession(req.params.sessionId)
    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session not found' })
    }
    if (typeof req.body?.title === 'string') {
      session.title = req.body.title
    }
    if (typeof req.body?.systemPrompt === 'string') {
      session.systemPrompt = normalizeSystemPrompt(req.body.systemPrompt)
    }
    if (typeof req.body?.model === 'string' && req.body.model.trim()) {
      session.model = req.body.model.trim()
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'sandbox')) {
      session.sandbox = req.body?.sandbox as SessionSandboxConfig | undefined
    }
    if (Array.isArray(req.body?.loadedSkills)) {
      session.loadedSkills = req.body.loadedSkills
        .map((item: unknown) => typeof item === 'string' ? item.trim() : '')
        .filter(Boolean)
    }
    session.updatedAt = new Date().toISOString()
    await sessionStore.saveSession(session)
    res.json({ ok: true, session, summary: sessionStore.summarizeSession(session) })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/sessions/:sessionId', async (req, res, next) => {
  try {
    await sessionStore.deleteSession(req.params.sessionId)
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/sessions', async (_req, res, next) => {
  try {
    await sessionStore.deleteAllSessions()
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.post('/api/chat', async (req, res, next) => {
  try {
    if (!CONFIGURED) {
      throw new Error('No API key is configured. Add OPENROUTER_API_KEY to .env or your shell environment.')
    }
    const result = await agentService.runRequest(req.body, null)
    res.json({ ok: true, ...result })
  } catch (error) {
    next(error)
  }
})

app.get('/api/chat/stream', async (req, res, next) => {
  const rawPayload = req.query.payload
  if (typeof rawPayload !== 'string' || !rawPayload) {
    return res.status(400).json({ ok: false, error: 'payload query parameter is required' })
  }
  let payload: unknown = null
  try {
    payload = JSON.parse(rawPayload)
  } catch {
    return res.status(400).json({ ok: false, error: 'payload must be valid JSON' })
  }
  initSse(res)
  try {
    if (!CONFIGURED) {
      throw new Error('No API key is configured. Add OPENROUTER_API_KEY to .env or your shell environment.')
    }
    const result = await agentService.runRequest(payload, (event, data) => {
      writeSse(res, event, data)
    })
    writeSse(res, 'complete', { ok: true, ...result })
    res.end()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    writeSse(res, 'error', { ok: false, error: message })
    res.end()
    next(error)
  }
})

app.get('/api/scheduler/status', async (_req, res, next) => {
  try {
    const status = await schedulerService.getStatus()
    res.json({ ok: true, ...status })
  } catch (error) {
    next(error)
  }
})

app.get('/api/scheduled-jobs', async (_req, res, next) => {
  try {
    const jobs = await schedulerStore.listJobs()
    res.json({ ok: true, jobs })
  } catch (error) {
    next(error)
  }
})

app.post('/api/scheduled-jobs', async (req, res, next) => {
  try {
    const job = await schedulerStore.createJob(buildScheduledJobInput(req.body))
    res.status(201).json({ ok: true, job })
  } catch (error) {
    next(error)
  }
})

app.get('/api/scheduled-jobs/:jobId', async (req, res, next) => {
  try {
    const job = await schedulerStore.getJob(req.params.jobId)
    if (!job) {
      return res.status(404).json({ ok: false, error: 'Scheduled job not found' })
    }
    res.json({ ok: true, job })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/scheduled-jobs/:jobId', async (req, res, next) => {
  try {
    const current = await schedulerStore.getJob(req.params.jobId)
    if (!current) {
      return res.status(404).json({ ok: false, error: 'Scheduled job not found' })
    }
    const patch = buildScheduledJobPatch(req.body, current)
    const job = await schedulerStore.updateJob(req.params.jobId, patch)
    res.json({ ok: true, job })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/scheduled-jobs/:jobId', async (req, res, next) => {
  try {
    await schedulerStore.deleteJob(req.params.jobId)
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.post('/api/scheduled-jobs/:jobId/run', async (req, res, next) => {
  try {
    const execution = await schedulerService.runNow(req.params.jobId)
    res.json({ ok: true, execution })
  } catch (error) {
    next(error)
  }
})

app.get('/api/scheduled-jobs/:jobId/executions', async (req, res, next) => {
  try {
    const executions = await schedulerStore.listExecutions(req.params.jobId)
    res.json({ ok: true, executions })
  } catch (error) {
    next(error)
  }
})

app.get('/api/scheduled-executions/:executionId', async (req, res, next) => {
  try {
    const execution = await schedulerStore.getExecution(req.params.executionId)
    if (!execution) {
      return res.status(404).json({ ok: false, error: 'Scheduled execution not found' })
    }
    res.json({ ok: true, execution })
  } catch (error) {
    next(error)
  }
})

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unknown server error'
  const status = message === 'message is required' || message === 'Invalid JSON body' ? 400 : 500
  if (res.headersSent) {
    return next(error)
  }
  res.status(status).json({ ok: false, error: message })
})

const server = http.createServer(app)
const wss = new WebSocketServer({
  server,
  path: '/ws',
})

wss.on('connection', (socket: WebSocket) => {
  const client = wsHub.addClient(socket)

  socket.on('message', (raw: Buffer) => {
    void handleWsMessage(client.id, String(raw))
  })

  socket.on('close', () => {
    wsHub.removeClient(client.id)
  })
})

server.listen(PORT, HOST, () => {
  console.log(`${APP_TITLE} listening on http://${HOST}:${PORT}`)
})

void schedulerService.start()

function normalizeSystemPrompt(systemPrompt: string | undefined): string {
  return agentService.normalizeSystemPrompt(systemPrompt)
}

function normalizeAgentBrowserAllowedDomains(value: string | undefined): string | undefined {
  const normalized = String(value || '').trim()
  if (!normalized || normalized === '*') {
    return undefined
  }
  return normalized
}

function buildScheduledJobInput(body: unknown): Omit<ScheduledJob, 'id' | 'createdAt' | 'updatedAt'> {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid JSON body')
  }
  const record = body as Record<string, unknown>
  const name = String(record.name || '').trim()
  const message = String(record.message || '').trim()
  if (!name) {
    throw new Error('name is required')
  }
  if (!message) {
    throw new Error('message is required')
  }
  const schedule = normalizeSchedule(record.schedule)
  const job: Omit<ScheduledJob, 'id' | 'createdAt' | 'updatedAt'> = {
    name,
    enabled: record.enabled === undefined ? true : Boolean(record.enabled),
    message,
    schedule,
    nextRunAt: computeNextRunAt(schedule),
    overlapPolicy: record.overlapPolicy === 'parallel' ? 'parallel' : 'skip',
  }
  if (typeof record.targetSessionId === 'string' && record.targetSessionId.trim()) {
    job.targetSessionId = record.targetSessionId.trim()
  }
  if (typeof record.sessionTemplateId === 'string' && record.sessionTemplateId.trim()) {
    job.sessionTemplateId = record.sessionTemplateId.trim()
  }
  if (typeof record.model === 'string' && record.model.trim()) {
    job.model = record.model.trim()
  }
  if (typeof record.systemPrompt === 'string') {
    job.systemPrompt = record.systemPrompt
  }
  if (Object.prototype.hasOwnProperty.call(record, 'sandbox')) {
    job.sandbox = record.sandbox as SessionSandboxConfig | undefined
  }
  if (Array.isArray(record.loadedSkills)) {
    job.loadedSkills = record.loadedSkills.map((item) => String(item).trim()).filter(Boolean)
  }
  return job
}

function buildScheduledJobPatch(
  body: unknown,
  current: ScheduledJob
): Partial<Omit<ScheduledJob, 'id' | 'createdAt'>> {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid JSON body')
  }
  const record = body as Record<string, unknown>
  const patch: Partial<Omit<ScheduledJob, 'id' | 'createdAt'>> = {}

  if (typeof record.name === 'string' && record.name.trim()) {
    patch.name = record.name.trim()
  }
  if (typeof record.message === 'string' && record.message.trim()) {
    patch.message = record.message.trim()
  }
  if (typeof record.sessionTemplateId === 'string') {
    if (record.sessionTemplateId.trim()) {
      patch.sessionTemplateId = record.sessionTemplateId.trim()
    }
  }
  if (typeof record.targetSessionId === 'string') {
    if (record.targetSessionId.trim()) {
      patch.targetSessionId = record.targetSessionId.trim()
    }
  }
  if (typeof record.model === 'string') {
    if (record.model.trim()) {
      patch.model = record.model.trim()
    }
  }
  if (typeof record.systemPrompt === 'string') {
    patch.systemPrompt = record.systemPrompt
  }
  if (Object.prototype.hasOwnProperty.call(record, 'sandbox')) {
    patch.sandbox = record.sandbox as SessionSandboxConfig | undefined
  }
  if (Array.isArray(record.loadedSkills)) {
    patch.loadedSkills = record.loadedSkills.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof record.enabled === 'boolean') {
    patch.enabled = record.enabled
  }
  if (record.overlapPolicy === 'parallel' || record.overlapPolicy === 'skip') {
    patch.overlapPolicy = record.overlapPolicy
  }
  if (Object.prototype.hasOwnProperty.call(record, 'schedule')) {
    const schedule = normalizeSchedule(record.schedule)
    patch.schedule = schedule
    patch.nextRunAt = computeNextRunAt(schedule)
  } else if (patch.enabled === false) {
    patch.nextRunAt = current.nextRunAt
  }
  patch.updatedAt = new Date().toISOString()
  return patch
}

function normalizeSchedule(value: unknown): ScheduledJobSchedule {
  if (!value || typeof value !== 'object') {
    throw new Error('schedule is required')
  }
  const record = value as Record<string, unknown>
  const type = String(record.type || '').trim()
  if (type === 'once') {
    const runAt = String(record.runAt || '').trim()
    if (!runAt) {
      throw new Error('schedule.runAt is required for once jobs')
    }
    return { type: 'once', runAt }
  }
  if (type === 'interval') {
    const everyMs = parseInteger(record.everyMs, 0)
    if (everyMs <= 0) {
      throw new Error('schedule.everyMs must be a positive number for interval jobs')
    }
    return { type: 'interval', everyMs }
  }
  throw new Error(`Unsupported schedule type: ${type}`)
}

function initSse(res: express.Response) {
  res.status(200)
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Connection', 'keep-alive')
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders()
  }
}

function writeSse(res: express.Response, event: string, payload: unknown) {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

async function handleWsMessage(clientId: string, raw: string): Promise<void> {
  const client = getWsClient(clientId)
  if (!client) {
    return
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    wsHub.send(client, {
      type: 'request:error',
      error: 'Invalid JSON message',
    })
    return
  }

  if (!isWsClientMessage(parsed)) {
    wsHub.send(client, {
      type: 'request:error',
      error: 'Invalid WebSocket message',
    })
    return
  }

  const message = parsed as WsClientMessage

  if (message.type === 'heartbeat:ping') {
    wsHub.send(client, {
      type: 'heartbeat:pong',
      ts: message.ts,
    })
    return
  }

  try {
    switch (message.type) {
      case 'chat:start': {
        if (!CONFIGURED) {
          throw new Error('No API key is configured. Add OPENROUTER_API_KEY to .env or your shell environment.')
        }
        client.activeChatRequestIds.add(message.requestId)
        const result = await agentService.runRequest(message.payload, (event, data) => {
          if (!client.activeChatRequestIds.has(message.requestId)) {
            return
          }
          wsHub.send(client, {
            type: 'chat:event',
            requestId: message.requestId,
            event,
            data,
          })
        })
        wsHub.send(client, {
          type: 'chat:complete',
          requestId: message.requestId,
          payload: {
            ok: true,
            reply: result.reply,
            session: result.session as unknown as import('./frontend/types.js').Session,
            run: result.run,
          },
        })
        client.activeChatRequestIds.delete(message.requestId)
        return
      }
      case 'chat:cancel': {
        client.activeChatRequestIds.delete(message.requestId)
        return
      }
      case 'scheduler:subscribe':
      case 'scheduler:refresh': {
        client.schedulerSubscribed = true
        const [jobs, status] = await Promise.all([
          schedulerStore.listJobs(),
          schedulerService.getStatus(),
        ])
        wsHub.send(client, {
          type: 'scheduler:snapshot',
          requestId: message.requestId,
          payload: {
            jobs,
            status,
          },
        })
        return
      }
      case 'scheduled-job:create': {
        const job = await schedulerStore.createJob(buildScheduledJobInput(message.payload))
        wsHub.broadcastScheduler({
          type: 'scheduler:job-created',
          requestId: message.requestId,
          job,
        })
        await broadcastSchedulerSnapshot()
        return
      }
      case 'scheduled-job:update': {
        const current = await schedulerStore.getJob(message.jobId)
        if (!current) {
          throw new Error('Scheduled job not found')
        }
        const job = await schedulerStore.updateJob(message.jobId, buildScheduledJobPatch(message.payload, current))
        wsHub.broadcastScheduler({
          type: 'scheduler:job-updated',
          requestId: message.requestId,
          job,
        })
        await broadcastSchedulerSnapshot()
        return
      }
      case 'scheduled-job:delete': {
        await schedulerStore.deleteJob(message.jobId)
        wsHub.broadcastScheduler({
          type: 'scheduler:job-deleted',
          requestId: message.requestId,
          jobId: message.jobId,
        })
        await broadcastSchedulerSnapshot()
        return
      }
      case 'scheduled-job:run': {
        await schedulerService.runNow(message.jobId)
        const executions = await schedulerStore.listExecutions(message.jobId)
        wsHub.send(client, {
          type: 'scheduler:job-executions',
          requestId: message.requestId,
          jobId: message.jobId,
          executions,
        })
        await broadcastSchedulerSnapshot()
        return
      }
      case 'scheduled-job:load-executions': {
        const executions = await schedulerStore.listExecutions(message.jobId)
        wsHub.send(client, {
          type: 'scheduler:job-executions',
          requestId: message.requestId,
          jobId: message.jobId,
          executions,
        })
        return
      }
      default:
        return
    }
  } catch (error) {
    const messagePayload: WsServerMessage = {
      type: 'request:error',
      error: error instanceof Error ? error.message : 'Unknown WebSocket error',
    }
    if ('requestId' in message && typeof message.requestId === 'string') {
      messagePayload.requestId = message.requestId
    }
    wsHub.send(client, messagePayload)
  }
}

function getWsClient(clientId: string) {
  return wsHub.getClient(clientId)
}

async function broadcastSchedulerSnapshot() {
  const [jobs, status] = await Promise.all([
    schedulerStore.listJobs(),
    schedulerService.getStatus(),
  ])
  wsHub.broadcastScheduler({
    type: 'scheduler:snapshot',
    payload: {
      jobs,
      status,
    },
  })
}
