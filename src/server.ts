import './bootstrap.js'

import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { WebSocketServer, type WebSocket } from 'ws'
import { createToolRegistry, type CreateRegistryOptions } from './tools/registry.js'
import {
  buildSessionSandboxPolicy,
  parseSensitivePaths,
  resolveSandboxPath,
} from './tools/sandbox.js'
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
import { validateTimezone } from './scheduler/cron.js'
import { createSchedulerService } from './scheduler/service.js'
import type { ScheduledJob, ScheduledJobSchedule } from './scheduler/types.js'
import { createWsHub } from './ws/hub.js'
import type { WsClientMessage, WsServerMessage } from './ws/protocol.js'
import { isWsClientMessage } from './ws/protocol.js'
import { createWorkspaceBrowserService } from './workspace/browser.js'
import { readFeishuConfig, validateFeishuConfig } from './integrations/feishu/config.js'
import { createFeishuService } from './integrations/feishu/service.js'
import { summarizeModelUsageLog } from './logging/model-usage.js'
import { createMemoryStore } from './memory/store.js'
import { createProposalStore } from './evolution/proposal-store.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')
const PUBLIC_DIR = path.join(ROOT_DIR, 'public')
const SESSION_DIR = path.join(ROOT_DIR, '.sessions')
const SCHEDULED_JOBS_DIR = path.join(ROOT_DIR, '.scheduled-jobs')
const MEMORY_DIR = path.resolve(expandHomePath(process.env.MEMORY_DIR || path.join(ROOT_DIR, '.memory')))
const MAX_MARKDOWN_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_WORKSPACE_UPLOAD_BYTES = 25 * 1024 * 1024
const MAX_CHAT_JSON_BYTES = '20mb'
const MARKDOWN_IMAGE_CONTENT_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
])
const DOWNLOAD_CONTENT_TYPES = new Map([
  ['.md', 'text/markdown; charset=utf-8'],
  ['.markdown', 'text/markdown; charset=utf-8'],
  ['.mdx', 'text/markdown; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.jsonl', 'application/x-ndjson; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.jsx', 'text/javascript; charset=utf-8'],
  ['.ts', 'text/typescript; charset=utf-8'],
  ['.tsx', 'text/typescript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.pdf', 'application/pdf'],
  ['.zip', 'application/zip'],
  ['.gz', 'application/gzip'],
  ['.tar', 'application/x-tar'],
  ['.tgz', 'application/gzip'],
  ['.csv', 'text/csv; charset=utf-8'],
  ['.tsv', 'text/tab-separated-values; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.yaml', 'application/yaml; charset=utf-8'],
  ['.yml', 'application/yaml; charset=utf-8'],
])

const HOST = process.env.HOST || '0.0.0.0'
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
const MEMORY_ENABLED = parseBoolean(process.env.MEMORY_ENABLED, true)
const FEISHU_CONFIG = readFeishuConfig(process.env)

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
const memoryStore = createMemoryStore(MEMORY_DIR)
const proposalStore = createProposalStore(MEMORY_DIR)
TOOL_REGISTRY_OPTIONS.memoryStore = memoryStore
TOOL_REGISTRY_OPTIONS.proposalStore = proposalStore

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
  memoryEnabled: MEMORY_ENABLED,
  memoryStore,
  proposalStore,
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
    void broadcastSchedulerSnapshot()
  },
  onExecutionUpdated: (execution) => {
    wsHub.broadcastScheduler({
      type: 'scheduler:execution-updated',
      execution,
    })
    void broadcastSchedulerSnapshot()
  },
  onJobUpdated: (job) => {
    wsHub.broadcastScheduler({
      type: 'scheduler:job-updated',
      job,
    })
    void broadcastSchedulerSnapshot()
  },
})

const feishuService = createFeishuService({
  rootDir: ROOT_DIR,
  config: FEISHU_CONFIG,
  sessionStore,
  agentRunner: agentService,
  defaultModel: DEFAULT_MODEL,
  defaultSystemPrompt: BASE_SYSTEM_PROMPT,
  logger: console,
})

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: MAX_CHAT_JSON_BYTES }))
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
    memoryEnabled: MEMORY_ENABLED,
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

app.get('/api/model-usage', async (_req, res, next) => {
  try {
    const usage = await summarizeModelUsageLog()
    res.json({ ok: true, ...usage })
  } catch (error) {
    next(error)
  }
})

app.get('/api/memory', async (req, res, next) => {
  try {
    const scopeType = typeof req.query.scopeType === 'string' ? req.query.scopeType.trim() : ''
    const scopeKey = typeof req.query.scopeKey === 'string' ? req.query.scopeKey.trim() : ''
    const records = scopeType && scopeKey
      ? await memoryStore.list({ type: scopeType as any, key: scopeKey, label: `${scopeType}:${scopeKey}` })
      : await memoryStore.list()
    res.json({ ok: true, records })
  } catch (error) {
    next(error)
  }
})

app.get('/api/evolution/proposals', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : undefined
    const proposals = await proposalStore.list(status as any)
    res.json({ ok: true, proposals })
  } catch (error) {
    next(error)
  }
})

app.post('/api/evolution/proposals/:proposalId/accept', async (req, res, next) => {
  try {
    const proposal = await proposalStore.updateStatus({
      id: req.params.proposalId,
      status: 'accepted',
      reviewNote: typeof req.body?.reviewNote === 'string' ? req.body.reviewNote : undefined,
    })
    res.json({ ok: true, proposal })
  } catch (error) {
    next(error)
  }
})

app.post('/api/evolution/proposals/:proposalId/reject', async (req, res, next) => {
  try {
    const proposal = await proposalStore.updateStatus({
      id: req.params.proposalId,
      status: 'rejected',
      reviewNote: typeof req.body?.reviewNote === 'string' ? req.body.reviewNote : undefined,
    })
    res.json({ ok: true, proposal })
  } catch (error) {
    next(error)
  }
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

app.put('/api/workspace/file', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid JSON body' })
    }
    const sessionId = typeof req.body.sessionId === 'string' ? req.body.sessionId.trim() : ''
    const filePath = typeof req.body.path === 'string' ? req.body.path.trim() : ''
    const content = typeof req.body.content === 'string' ? req.body.content : null
    if (!filePath) {
      return res.status(400).json({ ok: false, error: 'path is required' })
    }
    if (content === null) {
      return res.status(400).json({ ok: false, error: 'content is required' })
    }

    const session = sessionId ? await sessionStore.loadSession(sessionId) : null
    const input: {
      sessionId?: string
      sandbox?: SessionSandboxConfig | undefined
      path: string
      content: string
    } = {
      path: filePath,
      content,
    }
    if (session?.id) {
      input.sessionId = session.id
    }
    if (session?.sandbox !== undefined) {
      input.sandbox = session.sandbox
    }
    const file = await workspaceBrowser.writeTextFile(input)
    res.json({ ok: true, ...file })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/workspace/file', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid JSON body' })
    }
    const sessionId = typeof req.body.sessionId === 'string' ? req.body.sessionId.trim() : ''
    const filePath = typeof req.body.path === 'string' ? req.body.path.trim() : ''
    if (!filePath) {
      return res.status(400).json({ ok: false, error: 'path is required' })
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
    const deleted = await workspaceBrowser.deleteFile(input)
    res.json({ ok: true, ...deleted })
  } catch (error) {
    next(error)
  }
})

app.post(
  '/api/workspace/upload',
  express.raw({ type: 'application/octet-stream', limit: MAX_WORKSPACE_UPLOAD_BYTES }),
  async (req, res, next) => {
    try {
      const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId.trim() : ''
      const directoryPath = typeof req.query.path === 'string' ? req.query.path.trim() : '.'
      const fileName = typeof req.query.filename === 'string' ? req.query.filename.trim() : ''
      if (!fileName) {
        return res.status(400).json({ ok: false, error: 'filename query parameter is required' })
      }
      if (!Buffer.isBuffer(req.body)) {
        return res.status(400).json({ ok: false, error: 'application/octet-stream body is required' })
      }

      const session = sessionId ? await sessionStore.loadSession(sessionId) : null
      const input: {
        sessionId?: string
        sandbox?: SessionSandboxConfig | undefined
        directoryPath?: string
        fileName: string
        content: Buffer
      } = {
        directoryPath: directoryPath || '.',
        fileName,
        content: req.body,
      }
      if (session?.id) {
        input.sessionId = session.id
      }
      if (session?.sandbox !== undefined) {
        input.sandbox = session.sandbox
      }
      const file = await workspaceBrowser.uploadFile(input)
      res.status(201).json({ ok: true, ...file })
    } catch (error) {
      next(error)
    }
  }
)

app.get('/api/workspace/download', async (req, res, next) => {
  try {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId.trim() : ''
    const filePath = typeof req.query.path === 'string' ? req.query.path.trim() : ''
    if (!filePath) {
      return res.status(400).json({ ok: false, error: 'path query parameter is required' })
    }

    const session = sessionId ? await sessionStore.loadSession(sessionId) : null
    const sandboxPolicy = buildSessionSandboxPolicy({
      sessionId: session?.id || 'workspace-browser',
      sessionSandbox: session?.sandbox,
      defaultWorkspaceRoot: DEFAULT_WORKSPACE_ROOT,
      sensitivePaths: SENSITIVE_PATHS,
      enablePathSandbox: ENABLE_PATH_SANDBOX,
    })
    const targetPath = await resolveSandboxPath(sandboxPolicy, filePath, { mode: 'read' })
    const stat = await fs.stat(targetPath)
    if (!stat.isFile()) {
      return res.status(404).json({ ok: false, error: 'File not found' })
    }

    const fileName = path.basename(targetPath)
    res.setHeader('Content-Type', inferDownloadContentType(targetPath))
    res.setHeader('Content-Length', String(stat.size))
    res.setHeader('Content-Disposition', buildAttachmentDisposition(fileName))
    res.setHeader('Cache-Control', 'private, max-age=60')

    const stream = createReadStream(targetPath)
    stream.on('error', next)
    stream.pipe(res)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to download file'
    if (isMissingFileError(error)) {
      return res.status(404).json({ ok: false, error: 'File not found' })
    }
    if (message.includes('sandbox policy') || message.includes('sensitive path')) {
      return res.status(403).json({ ok: false, error: message })
    }
    next(error)
  }
})

app.get('/api/images', async (req, res, next) => {
  try {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId.trim() : ''
    const src = typeof req.query.src === 'string' ? req.query.src.trim() : ''
    if (!src) {
      return res.status(400).json({ ok: false, error: 'src query parameter is required' })
    }

    const session = sessionId ? await sessionStore.loadSession(sessionId) : null
    if (sessionId && !session) {
      return res.status(404).json({ ok: false, error: 'Session not found' })
    }

    const sandboxPolicy = buildSessionSandboxPolicy({
      sessionId: session?.id || 'workspace-browser',
      sessionSandbox: session?.sandbox,
      defaultWorkspaceRoot: DEFAULT_WORKSPACE_ROOT,
      sensitivePaths: SENSITIVE_PATHS,
      enablePathSandbox: ENABLE_PATH_SANDBOX,
    })
    const imagePath = await resolveSandboxPath(sandboxPolicy, src, { mode: 'read' })
    const extension = path.extname(imagePath).toLowerCase()
    const contentType = MARKDOWN_IMAGE_CONTENT_TYPES.get(extension)
    if (!contentType) {
      return res.status(415).json({ ok: false, error: 'Unsupported image type' })
    }

    const stat = await fs.stat(imagePath)
    if (!stat.isFile()) {
      return res.status(404).json({ ok: false, error: 'Image not found' })
    }
    if (stat.size > MAX_MARKDOWN_IMAGE_BYTES) {
      return res.status(413).json({ ok: false, error: 'Image is too large' })
    }

    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'private, max-age=60')
    res.send(await fs.readFile(imagePath))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load image'
    if (isMissingFileError(error)) {
      return res.status(404).json({ ok: false, error: 'Image not found' })
    }
    if (message.includes('sandbox policy') || message.includes('sensitive path')) {
      return res.status(403).json({ ok: false, error: message })
    }
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
  const status = errorStatus(error, message)
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
void startFeishu()

function normalizeSystemPrompt(systemPrompt: string | undefined): string {
  return agentService.normalizeSystemPrompt(systemPrompt)
}

async function startFeishu() {
  const errors = validateFeishuConfig(FEISHU_CONFIG)
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`[feishu] ${error}`)
    }
    return
  }
  if (!FEISHU_CONFIG.enabled) {
    return
  }
  try {
    await feishuService.start()
  } catch (error) {
    console.error('[feishu] failed to start', error)
  }
}

function normalizeAgentBrowserAllowedDomains(value: string | undefined): string | undefined {
  const normalized = String(value || '').trim()
  if (!normalized || normalized === '*') {
    return undefined
  }
  return normalized
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function inferDownloadContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  return DOWNLOAD_CONTENT_TYPES.get(extension) || 'application/octet-stream'
}

function buildAttachmentDisposition(fileName: string): string {
  const asciiFallback = fileName
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
    .trim() || 'download'
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRFC5987Value(fileName)}`
}

function encodeRFC5987Value(value: string): string {
  return encodeURIComponent(value)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, '%2A')
}

function errorStatus(error: unknown, message: string): number {
  if (
    isRecordWithCode(error) &&
    (error.type === 'entity.too.large' || error.code === 'LIMIT_FILE_SIZE')
  ) {
    return 413
  }
  if (
    message === 'message is required' ||
    message === 'Invalid JSON body' ||
    message === 'path is required' ||
    message === 'content is required' ||
    message === 'filename is required' ||
    message === 'Target path is a directory' ||
    message === 'Requested path is not a file' ||
    message.startsWith('Text content exceeds')
  ) {
    return 400
  }
  if (message.includes('sandbox policy') || message.includes('sensitive path') || message.includes('outside workspace')) {
    return 403
  }
  return 500
}

function isRecordWithCode(value: unknown): value is { code?: unknown; type?: unknown } {
  return Boolean(value && typeof value === 'object')
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
  if (typeof record.createNewSession === 'boolean') {
    job.createNewSession = record.createNewSession
  }
  if (Object.prototype.hasOwnProperty.call(record, 'params')) {
    job.params = normalizeScheduledJobParams(record.params)
  }
  if (record.catchupPolicy === 'latest' || record.catchupPolicy === 'none') {
    job.catchupPolicy = record.catchupPolicy
  }
  if (Object.prototype.hasOwnProperty.call(record, 'retryPolicy')) {
    job.retryPolicy = normalizeRetryPolicy(record.retryPolicy)
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
  if (typeof record.createNewSession === 'boolean') {
    patch.createNewSession = record.createNewSession
  }
  if (Object.prototype.hasOwnProperty.call(record, 'params')) {
    patch.params = normalizeScheduledJobParams(record.params)
  }
  if (record.catchupPolicy === 'latest' || record.catchupPolicy === 'none') {
    patch.catchupPolicy = record.catchupPolicy
  }
  if (Object.prototype.hasOwnProperty.call(record, 'retryPolicy')) {
    patch.retryPolicy = normalizeRetryPolicy(record.retryPolicy)
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
  if (type === 'cron') {
    const expression = String(record.expression || '').trim()
    if (!expression) {
      throw new Error('schedule.expression is required for cron jobs')
    }
    const timezone = typeof record.timezone === 'string' && record.timezone.trim()
      ? validateTimezone(record.timezone.trim())
      : undefined
    return timezone
      ? { type: 'cron', expression, timezone }
      : { type: 'cron', expression }
  }
  throw new Error(`Unsupported schedule type: ${type}`)
}

function normalizeScheduledJobParams(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const record = value as Record<string, unknown>
  const params = Object.fromEntries(
    Object.entries(record).filter(([, item]) => {
      return typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
    }).map(([key, item]) => [key, item as string | number | boolean])
  )

  return Object.keys(params).length > 0 ? params : undefined
}

function normalizeRetryPolicy(value: unknown): ScheduledJob['retryPolicy'] {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const record = value as Record<string, unknown>
  const maxAttempts = parseInteger(record.maxAttempts, 0)
  const backoffMs = parseInteger(record.backoffMs, 0)
  if (maxAttempts <= 0) {
    return undefined
  }
  return {
    maxAttempts,
    backoffMs: Math.max(0, backoffMs),
  }
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
