/**
 * Express 服务器入口
 *
 * 职责：
 * - 加载环境变量、创建 Express 应用
 * - 挂载 REST API 路由（health、config、tools、sessions、chat）
 * - 管理会话持久化（JSON 文件读写）
 * - 接收用户消息后，委托 ReActAgent 执行多轮推理，
 *   通过 SSE 将运行事件实时推送到前端
 */

import './bootstrap.js' // 最先加载，保证 .env 在其他模块读取 process.env 之前生效

import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import type { AgentMessage } from './agent/types.js'
import { ReActAgent } from './agent/react-agent.js'
import { PromptBuilder } from './agent/prompt-builder.js'
import { createToolRegistry } from './tools/registry.js'
import {
  parseInteger,
  parseBoolean,
  sanitizeTitle,
  isSafeSessionId,
  isRecord,
  collapseWhitespace,
  truncate,
} from './utils/helpers.js'

// ─── 路径与环境 ───────────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')
const PUBLIC_DIR = path.join(ROOT_DIR, 'public')
const SESSION_DIR = path.join(ROOT_DIR, '.sessions')

mkdirSync(SESSION_DIR, { recursive: true })

const HOST = process.env.HOST || '127.0.0.1'
const PORT = parseInteger(process.env.PORT, 3011)
const APP_TITLE = process.env.APP_TITLE || 'Kraken Agent'
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || process.env.DEFAULT_MODEL || 'anthropic/claude-sonnet-4'
const MAX_TOKENS = parseInteger(process.env.MAX_TOKENS, 2048)
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
const CONFIGURED = Boolean(process.env.OPENROUTER_API_KEY)

// 解析 ENABLED_TOOLS，格式：逗号分隔的工具名，如 "list_directory,read_file,todo"
const ENABLED_TOOLS = (process.env.ENABLED_TOOLS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// ─── 类型 ────────────────────────────────────────────

interface SessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

interface Session {
  id: string
  title: string
  model: string
  systemPrompt: string
  createdAt: string
  updatedAt: string
  messages: SessionMessage[]
}

// ─── 初始化 ──────────────────────────────────────────

/** 创建工具注册表 */
const toolRegistry = createToolRegistry({
  rootDir: ROOT_DIR,
  allowShellTool: ALLOW_SHELL_TOOL,
  allowFileWriteTool: ALLOW_FILE_WRITE_TOOL,
  enabledTools: ENABLED_TOOLS.length > 0 ? ENABLED_TOOLS : undefined,
})

/** 构建动态 System Prompt */
const promptBuilder = new PromptBuilder(BASE_SYSTEM_PROMPT, toolRegistry)
const SYSTEM_PROMPT = promptBuilder.build()

/** 创建 ReAct Agent 实例，负责多轮推理循环 */
const agent = new ReActAgent({
  defaultModel: DEFAULT_MODEL,
  defaultSystemPrompt: SYSTEM_PROMPT,
  maxSteps: MAX_AGENT_STEPS,
  maxTokens: MAX_TOKENS,
  timeout: REQUEST_TIMEOUT_MS,
  toolRegistry,
})

// ─── Express 应用 ────────────────────────────────────

const app = express()

app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }))

// ─── 路由：健康检查 ──────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    configured: CONFIGURED,
    host: HOST,
    port: PORT,
    model: DEFAULT_MODEL,
    maxAgentSteps: MAX_AGENT_STEPS,
    toolCount: toolRegistry.length,
    now: new Date().toISOString(),
  })
})

// ─── 路由：配置与工具列表 ─────────────────────────────

app.get('/api/config', (_req, res) => {
  res.json({
    ok: true,
    appTitle: APP_TITLE,
    configured: CONFIGURED,
    model: DEFAULT_MODEL,
    defaultSystemPrompt: SYSTEM_PROMPT,
    maxAgentSteps: MAX_AGENT_STEPS,
    tools: toolRegistry.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    })),
  })
})

app.get('/api/tools', (_req, res) => {
  res.json({
    ok: true,
    tools: toolRegistry.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    })),
  })
})

// ─── 路由：会话 CRUD ─────────────────────────────────

app.get('/api/sessions', async (_req, res, next) => {
  try {
    const sessions = await listSessions()
    res.json({ ok: true, sessions })
  } catch (error) {
    next(error)
  }
})

app.post('/api/sessions', async (req, res, next) => {
  try {
    const session = createSession({
      title: typeof req.body?.title === 'string' ? req.body.title : '',
      systemPrompt: typeof req.body?.systemPrompt === 'string' ? req.body.systemPrompt : SYSTEM_PROMPT,
      model: typeof req.body?.model === 'string' ? req.body.model : DEFAULT_MODEL,
    })
    await saveSession(session)
    res.status(201).json({ ok: true, session, summary: summarizeSession(session) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/sessions/:sessionId', async (req, res, next) => {
  try {
    const session = await loadSession(req.params.sessionId)
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
    const session = await loadSession(req.params.sessionId)
    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session not found' })
    }
    if (typeof req.body?.title === 'string') {
      session.title = sanitizeTitle(req.body.title) || session.title
    }
    if (typeof req.body?.systemPrompt === 'string') {
      session.systemPrompt = req.body.systemPrompt.trim() || SYSTEM_PROMPT
    }
    if (typeof req.body?.model === 'string' && req.body.model.trim()) {
      session.model = req.body.model.trim()
    }
    session.updatedAt = new Date().toISOString()
    await saveSession(session)
    res.json({ ok: true, session, summary: summarizeSession(session) })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/sessions/:sessionId', async (req, res, next) => {
  try {
    await deleteSession(req.params.sessionId)
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

// ─── 路由：聊天（同步 & SSE 流式）──────────────────────

/** 同步聊天接口 */
app.post('/api/chat', async (req, res, next) => {
  try {
    const result = await runAgentRequest(req.body, null)
    res.json({ ok: true, ...result })
  } catch (error) {
    next(error)
  }
})

/**
 * SSE 流式聊天接口
 * 前端通过 EventSource 连接，实时接收 run:start、run:step、
 * assistant:delta、tool:requested、tool:running、tool:result 等事件。
 */
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
    const result = await runAgentRequest(payload, (event, data) => {
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

// ─── 全局错误处理 ────────────────────────────────────

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unknown server error'
  const status = message === 'message is required' || message === 'Invalid JSON body' ? 400 : 500
  if (res.headersSent) {
    return next(error)
  }
  res.status(status).json({ ok: false, error: message })
})

// ─── 启动 ────────────────────────────────────────────

app.listen(PORT, HOST, () => {
  console.log(`${APP_TITLE} listening on http://${HOST}:${PORT}`)
})

// ─── Agent 请求处理 ──────────────────────────────────

/**
 * 处理一次用户聊天请求的核心逻辑。
 * 1. 获取或创建 Session
 * 2. 追加用户消息
 * 3. 委托 ReActAgent 执行多轮推理
 * 4. 保存会话并返回结果
 */
async function runAgentRequest(body: unknown, emit: ((event: string, data: unknown) => void) | null) {
  const payload = isRecord(body) ? body : {}
  const rawMessage = typeof payload.message === 'string' ? payload.message.trim() : ''
  if (!rawMessage) {
    throw new Error('message is required')
  }
  if (!CONFIGURED) {
    throw new Error('No API key is configured. Add OPENROUTER_API_KEY to .env or your shell environment.')
  }

  const requestedModel = typeof payload.model === 'string' && payload.model.trim()
    ? payload.model.trim()
    : DEFAULT_MODEL

  // 获取已有会话，或创建新会话
  let session: Session | null = typeof payload.sessionId === 'string' && payload.sessionId
    ? await loadSession(payload.sessionId)
    : null
  if (!session) {
    session = createSession({
      title: sanitizeTitle(rawMessage),
      systemPrompt: typeof payload.systemPrompt === 'string' ? payload.systemPrompt : SYSTEM_PROMPT,
      model: requestedModel,
    })
  }
  if (typeof payload.systemPrompt === 'string') {
    session.systemPrompt = payload.systemPrompt.trim() || SYSTEM_PROMPT
  }
  session.model = requestedModel

  // 追加用户消息
  const userMessage: SessionMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: rawMessage,
    createdAt: new Date().toISOString(),
  }
  session.messages.push(userMessage)
  session.updatedAt = new Date().toISOString()
  if (session.messages.filter((message) => message.role === 'user').length === 1) {
    session.title = sanitizeTitle(rawMessage) || session.title
  }

  emit?.('session', {
    session: summarizeSession(session),
    state: 'started',
  })

  // 构建上下文消息（限制长度），交给 Agent 执行
  const agentMessages = buildAgentMessages(session.messages, MAX_CONTEXT_MESSAGES)

  const result = await agent.run({
    messages: agentMessages,
    model: session.model,
    systemPrompt: session.systemPrompt,
    emit: emit ?? undefined,
  })

  // 将最终回复追加到会话
  const finalText = result.reply
  const assistantMessage: SessionMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: finalText,
    createdAt: new Date().toISOString(),
  }
  session.messages.push(assistantMessage)
  session.updatedAt = new Date().toISOString()

  // 回填 sessionId 到运行记录
  const run = result.run
  run.sessionId = session.id

  await saveSession(session)
  emit?.('session', {
    session: summarizeSession(session),
    state: 'saved',
  })

  return {
    reply: finalText,
    session,
    run,
  }
}

// ─── 会话辅助函数 ────────────────────────────────────

/** 将会话消息转换为 AgentMessage 数组，并按 maxMessages 截断上下文 */
function buildAgentMessages(sessionMessages: SessionMessage[], maxMessages: number): AgentMessage[] {
  return sessionMessages.slice(-maxMessages).map((message) => ({
    role: message.role,
    content: message.content,
  }))
}

/** 创建新会话 */
function createSession({ title, systemPrompt, model }: { title: string; systemPrompt: string; model: string }): Session {
  const timestamp = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    title: sanitizeTitle(title) || 'New chat',
    model: model || DEFAULT_MODEL,
    systemPrompt: systemPrompt.trim() || SYSTEM_PROMPT,
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [],
  }
}

/** 生成会话摘要（用于列表展示） */
function summarizeSession(session: Session) {
  const lastMessage = session.messages.at(-1)
  return {
    id: session.id,
    title: session.title,
    model: session.model,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    preview: lastMessage ? truncate(collapseWhitespace(lastMessage.content), 100) : '',
    lastRole: lastMessage?.role ?? null,
  }
}

/** 列出所有会话（按更新时间倒序） */
async function listSessions() {
  const entries = await fs.readdir(SESSION_DIR, { withFileTypes: true })
  const sessions: Array<ReturnType<typeof summarizeSession>> = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }
    try {
      const raw = await fs.readFile(path.join(SESSION_DIR, entry.name), 'utf8')
      const session = JSON.parse(raw) as Session
      sessions.push(summarizeSession(session))
    } catch {
      continue
    }
  }
  return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

/** 加载单个会话 */
async function loadSession(sessionId: string): Promise<Session | null> {
  if (!isSafeSessionId(sessionId)) {
    return null
  }
  const filePath = sessionFilePath(sessionId)
  if (!existsSync(filePath)) {
    return null
  }
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw) as Session
}

/** 保存会话到磁盘 */
async function saveSession(session: Session) {
  await fs.writeFile(sessionFilePath(session.id), JSON.stringify(session, null, 2), 'utf8')
}

/** 删除会话 */
async function deleteSession(sessionId: string) {
  if (!isSafeSessionId(sessionId)) {
    return
  }
  const filePath = sessionFilePath(sessionId)
  if (existsSync(filePath)) {
    await fs.unlink(filePath)
  }
}

/** 生成会话文件路径 */
function sessionFilePath(sessionId: string) {
  return path.join(SESSION_DIR, `${sessionId}.json`)
}

// ─── SSE 辅助函数 ────────────────────────────────────

/** 初始化 SSE 响应头 */
function initSse(res: express.Response) {
  res.status(200)
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Connection', 'keep-alive')
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders()
  }
}

/** 写入一条 SSE 事件 */
function writeSse(res: express.Response, event: string, payload: unknown) {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}
