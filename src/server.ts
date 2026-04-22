import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type NextFunction, type Request, type Response } from 'express'

type SessionRole = 'user' | 'assistant'
type ToolInput = Record<string, unknown>
type JsonRecord = Record<string, unknown>
type ModelUsage = JsonRecord | null
type EmitFn = (event: string, data: unknown) => void

interface SessionMessage {
  id: string
  role: SessionRole
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

interface SessionSummary {
  id: string
  title: string
  model: string
  createdAt: string
  updatedAt: string
  messageCount: number
  preview: string
  lastRole: SessionRole | null
}

interface ToolExecutionResult {
  output: string
}

interface ToolDefinition {
  name: string
  description: string
  input_schema: JsonRecord
  execute: (input: ToolInput) => Promise<ToolExecutionResult>
}

interface ToolUse {
  id: string
  name: string
  input: ToolInput
}

interface ToolExecution {
  toolUseId: string
  toolName: string
  isError: boolean
  output: string
}

interface TextBlock {
  type: 'text'
  text: string
}

interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: ToolInput
}

interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error: boolean
}

type AgentContentBlock = TextBlock | ToolUseBlock | ToolResultBlock

interface AgentMessage {
  role: SessionRole
  content: string | AgentContentBlock[]
}

interface RunStep {
  step: number
  stopReason: string | null
  assistantText: string
  toolUseCount: number
}

interface RunResult {
  id: string
  sessionId: string
  createdAt: string
  model: string
  steps: RunStep[]
  finalText: string
  usage: ModelUsage[]
  toolExecutions: ToolExecution[]
}

interface ModelResponse {
  text: string
  toolUses: ToolUse[]
  usage: ModelUsage
  stopReason: string | null
  raw: unknown
}

interface InvokeModelParams {
  model: string
  systemPrompt: string
  messages: AgentMessage[]
  tools: ToolDefinition[]
}

interface CreateSessionParams {
  title: string
  systemPrompt: string
  model: string
}

interface RunAgentRequestResult {
  reply: string
  session: Session
  run: RunResult
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')
const PUBLIC_DIR = path.join(ROOT_DIR, 'public')
const SESSION_DIR = path.join(ROOT_DIR, '.sessions')

loadDotEnv(path.join(ROOT_DIR, '.env'))
mkdirSync(SESSION_DIR, { recursive: true })

const HOST = process.env.HOST || '127.0.0.1'
const PORT = parseInteger(process.env.PORT, 3011)
const APP_TITLE = process.env.APP_TITLE || 'Kraken Agent'
const API_BASE_URL = normalizeBaseUrl(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com')
const API_KEY = process.env.ANTHROPIC_API_KEY || ''
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'
const MAX_TOKENS = parseInteger(process.env.MAX_TOKENS, 2048)
const DEFAULT_SYSTEM_PROMPT =
  process.env.DEFAULT_SYSTEM_PROMPT ||
  [
    'You are Kraken Agent, a pragmatic engineering agent.',
    'Work in iterations. Think about whether a local tool should be used before you answer.',
    'Use the available tools when they materially improve accuracy.',
    'When you use a tool, incorporate the result into a direct final answer.'
  ].join(' ')
const MAX_CONTEXT_MESSAGES = parseInteger(process.env.MAX_CONTEXT_MESSAGES, 24)
const MAX_AGENT_STEPS = parseInteger(process.env.MAX_AGENT_STEPS, 8)
const REQUEST_TIMEOUT_MS = parseInteger(process.env.REQUEST_TIMEOUT_MS, 120000)
const ALLOW_SHELL_TOOL = parseBoolean(process.env.ALLOW_SHELL_TOOL, true)
const ALLOW_FILE_WRITE_TOOL = parseBoolean(process.env.ALLOW_FILE_WRITE_TOOL, false)

const toolRegistry = createToolRegistry()
const app = express()

app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }))

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    configured: Boolean(API_KEY),
    host: HOST,
    port: PORT,
    model: DEFAULT_MODEL,
    maxAgentSteps: MAX_AGENT_STEPS,
    toolCount: toolRegistry.length,
    now: new Date().toISOString()
  })
})

app.get('/api/config', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    appTitle: APP_TITLE,
    configured: Boolean(API_KEY),
    model: DEFAULT_MODEL,
    apiBaseUrl: API_BASE_URL,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    maxAgentSteps: MAX_AGENT_STEPS,
    tools: toolRegistry.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema
    }))
  })
})

app.get('/api/tools', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    tools: toolRegistry.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema
    }))
  })
})

app.get('/api/sessions', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const sessions = await listSessions()
    res.json({ ok: true, sessions })
  } catch (error) {
    next(error)
  }
})

app.post('/api/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = createSession({
      title: typeof req.body?.title === 'string' ? req.body.title : '',
      systemPrompt: typeof req.body?.systemPrompt === 'string' ? req.body.systemPrompt : DEFAULT_SYSTEM_PROMPT,
      model: typeof req.body?.model === 'string' ? req.body.model : DEFAULT_MODEL
    })

    await saveSession(session)
    res.status(201).json({ ok: true, session, summary: summarizeSession(session) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/sessions/:sessionId', async (req: Request<{ sessionId: string }>, res: Response, next: NextFunction) => {
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

app.patch('/api/sessions/:sessionId', async (req: Request<{ sessionId: string }>, res: Response, next: NextFunction) => {
  try {
    const session = await loadSession(req.params.sessionId)
    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session not found' })
    }

    if (typeof req.body?.title === 'string') {
      session.title = sanitizeTitle(req.body.title) || session.title
    }

    if (typeof req.body?.systemPrompt === 'string') {
      session.systemPrompt = req.body.systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT
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

app.delete('/api/sessions/:sessionId', async (req: Request<{ sessionId: string }>, res: Response, next: NextFunction) => {
  try {
    await deleteSession(req.params.sessionId)
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.post('/api/chat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await runAgentRequest(req.body, null)
    res.json({ ok: true, ...result })
  } catch (error) {
    next(error)
  }
})

app.get('/api/chat/stream', async (req: Request, res: Response, next: NextFunction) => {
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

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unknown server error'
  const status =
    message === 'message is required' || message === 'Invalid JSON body'
      ? 400
      : 500

  if (res.headersSent) {
    return next(error)
  }

  res.status(status).json({ ok: false, error: message })
})

app.listen(PORT, HOST, () => {
  console.log(`${APP_TITLE} listening on http://${HOST}:${PORT}`)
})

async function runAgentRequest(body: unknown, emit: EmitFn | null): Promise<RunAgentRequestResult> {
  const payload = isRecord(body) ? body : {}
  const rawMessage = typeof payload.message === 'string' ? payload.message.trim() : ''
  if (!rawMessage) {
    throw new Error('message is required')
  }

  if (!API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured. Add it to .env or your shell environment.')
  }

  const requestedModel =
    typeof payload.model === 'string' && payload.model.trim()
      ? payload.model.trim()
      : DEFAULT_MODEL

  let session =
    typeof payload.sessionId === 'string' && payload.sessionId
      ? await loadSession(payload.sessionId)
      : null

  if (!session) {
    session = createSession({
      title: sanitizeTitle(rawMessage),
      systemPrompt: typeof payload.systemPrompt === 'string' ? payload.systemPrompt : DEFAULT_SYSTEM_PROMPT,
      model: requestedModel
    })
  }

  if (typeof payload.systemPrompt === 'string') {
    session.systemPrompt = payload.systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT
  }

  session.model = requestedModel

  const userMessage: SessionMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: rawMessage,
    createdAt: new Date().toISOString()
  }

  session.messages.push(userMessage)
  session.updatedAt = new Date().toISOString()

  if (session.messages.filter((message) => message.role === 'user').length === 1) {
    session.title = sanitizeTitle(rawMessage) || session.title
  }

  emit?.('session', {
    session: summarizeSession(session),
    state: 'started'
  })

  const run: RunResult = {
    id: crypto.randomUUID(),
    sessionId: session.id,
    createdAt: new Date().toISOString(),
    model: session.model,
    steps: [],
    finalText: '',
    usage: [],
    toolExecutions: []
  }

  emit?.('run:start', {
    runId: run.id,
    model: run.model,
    maxAgentSteps: MAX_AGENT_STEPS
  })

  const agentMessages = buildAgentMessages(session.messages, MAX_CONTEXT_MESSAGES)

  for (let stepIndex = 0; stepIndex < MAX_AGENT_STEPS; stepIndex += 1) {
    emit?.('run:step', {
      runId: run.id,
      step: stepIndex + 1,
      phase: 'model_request'
    })

    const modelResponse = await invokeModel({
      model: session.model || DEFAULT_MODEL,
      systemPrompt: session.systemPrompt,
      messages: agentMessages,
      tools: toolRegistry
    })

    run.steps.push({
      step: stepIndex + 1,
      stopReason: modelResponse.stopReason,
      assistantText: modelResponse.text,
      toolUseCount: modelResponse.toolUses.length
    })
    run.usage.push(modelResponse.usage)

    const assistantContent: Array<TextBlock | ToolUseBlock> = []

    if (modelResponse.text) {
      assistantContent.push({ type: 'text', text: modelResponse.text })
      emit?.('assistant:delta', {
        step: stepIndex + 1,
        text: modelResponse.text
      })
    }

    for (const toolUse of modelResponse.toolUses) {
      assistantContent.push({
        type: 'tool_use',
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input
      })
      emit?.('tool:requested', {
        step: stepIndex + 1,
        toolUse
      })
    }

    if (assistantContent.length > 0) {
      agentMessages.push({
        role: 'assistant',
        content: assistantContent
      })
    }

    if (modelResponse.toolUses.length === 0) {
      const finalText = modelResponse.text || 'The model returned without text.'
      const assistantMessage: SessionMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: finalText,
        createdAt: new Date().toISOString()
      }

      session.messages.push(assistantMessage)
      session.updatedAt = new Date().toISOString()
      run.finalText = finalText

      await saveSession(session)

      emit?.('session', {
        session: summarizeSession(session),
        state: 'saved'
      })

      return {
        reply: finalText,
        session,
        run
      }
    }

    const toolResults: ToolResultBlock[] = []

    for (const toolUse of modelResponse.toolUses) {
      emit?.('tool:running', {
        step: stepIndex + 1,
        toolUseId: toolUse.id,
        toolName: toolUse.name
      })

      const toolResult = await executeTool(toolUse)
      run.toolExecutions.push(toolResult)
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: toolResult.output,
        is_error: toolResult.isError
      })

      emit?.('tool:result', {
        step: stepIndex + 1,
        toolUseId: toolUse.id,
        toolName: toolUse.name,
        outputPreview: truncate(collapseWhitespace(toolResult.output), 320),
        isError: toolResult.isError
      })
    }

    agentMessages.push({
      role: 'user',
      content: toolResults
    })
  }

  const exhaustedMessage = `Agent stopped after reaching the maximum step limit (${MAX_AGENT_STEPS}).`
  const assistantMessage: SessionMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: exhaustedMessage,
    createdAt: new Date().toISOString()
  }

  session.messages.push(assistantMessage)
  session.updatedAt = new Date().toISOString()
  run.finalText = exhaustedMessage
  await saveSession(session)

  emit?.('session', {
    session: summarizeSession(session),
    state: 'saved'
  })

  return {
    reply: exhaustedMessage,
    session,
    run
  }
}

async function invokeModel({ model, systemPrompt, messages, tools }: InvokeModelParams): Promise<ModelResponse> {
  const payload = {
    model,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema
    }))
  }

  const response = await fetch(`${API_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'x-api-key': API_KEY
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  const rawText = await response.text()
  const json = rawText ? safeJsonParse(rawText) : null

  if (!response.ok) {
    throw new Error(extractUpstreamError(json, rawText))
  }

  const content = getRecordArray(isRecord(json) ? json.content : undefined)
  const text = content
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n\n')
    .trim()

  const toolUses: ToolUse[] = content.flatMap((item) => {
    if (item.type !== 'tool_use' || typeof item.name !== 'string') {
      return []
    }

    return [
      {
        id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
        name: item.name,
        input: isRecord(item.input) ? item.input : {}
      }
    ]
  })

  const usage = isRecord(json) && isRecord(json.usage) ? json.usage : null
  const stopReason = isRecord(json) && typeof json.stop_reason === 'string' ? json.stop_reason : null

  return {
    text,
    toolUses,
    usage,
    stopReason,
    raw: json
  }
}

function createToolRegistry(): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      name: 'project_overview',
      description: 'Inspect the current project structure and return a concise overview of important files.',
      input_schema: {
        type: 'object',
        properties: {
          max_depth: {
            type: 'integer',
            minimum: 1,
            maximum: 5,
            description: 'Maximum directory traversal depth.'
          }
        },
        required: []
      },
      execute: async (input) => {
        const maxDepth = clampInteger(input.max_depth, 2, 1, 5)
        const files = await collectFiles(ROOT_DIR, maxDepth)
        return {
          output: files.join('\n') || '(no files found)'
        }
      }
    },
    {
      name: 'read_file',
      description: 'Read a UTF-8 text file from the project and optionally limit the line range.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Project-relative file path.'
          },
          start_line: {
            type: 'integer',
            minimum: 1,
            description: 'Optional starting line number.'
          },
          end_line: {
            type: 'integer',
            minimum: 1,
            description: 'Optional ending line number.'
          }
        },
        required: ['path']
      },
      execute: async (input) => {
        const filePath = resolveProjectPath(input.path)
        const raw = await fs.readFile(filePath, 'utf8')
        const lines = raw.split(/\r?\n/)
        const start = clampInteger(input.start_line, 1, 1, lines.length || 1)
        const end = clampInteger(input.end_line, lines.length, start, lines.length || start)
        const snippet = lines
          .slice(start - 1, end)
          .map((line, index) => `${String(start + index).padStart(4, ' ')} | ${line}`)
          .join('\n')

        return {
          output: snippet || '(empty file)'
        }
      }
    },
    {
      name: 'search_files',
      description: 'Search the project for a text pattern and return matching lines with filenames.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Text or regular expression pattern to search for.'
          },
          max_results: {
            type: 'integer',
            minimum: 1,
            maximum: 200,
            description: 'Maximum number of matches to return.'
          }
        },
        required: ['pattern']
      },
      execute: async (input) => {
        const pattern = String(input.pattern || '').trim()
        if (!pattern) {
          throw new Error('pattern is required')
        }

        const regex = new RegExp(pattern, 'i')
        const files = await collectFiles(ROOT_DIR, 4)
        const matches: string[] = []

        for (const relativeFile of files) {
          if (matches.length >= clampInteger(input.max_results, 50, 1, 200)) {
            break
          }

          const absoluteFile = path.join(ROOT_DIR, relativeFile)
          let raw = ''

          try {
            raw = await fs.readFile(absoluteFile, 'utf8')
          } catch {
            continue
          }

          const lines = raw.split(/\r?\n/)

          for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? ''
            if (regex.test(line)) {
              matches.push(`${relativeFile}:${index + 1}: ${line}`)
              if (matches.length >= clampInteger(input.max_results, 50, 1, 200)) {
                break
              }
            }
          }
        }

        return {
          output: matches.join('\n') || '(no matches)'
        }
      }
    },
    {
      name: 'write_file',
      description: 'Write UTF-8 content to a project file. Disabled unless ALLOW_FILE_WRITE_TOOL=true.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Project-relative file path.'
          },
          content: {
            type: 'string',
            description: 'Full file content to write.'
          }
        },
        required: ['path', 'content']
      },
      execute: async (input) => {
        if (!ALLOW_FILE_WRITE_TOOL) {
          throw new Error('write_file is disabled. Set ALLOW_FILE_WRITE_TOOL=true to enable it.')
        }

        const filePath = resolveProjectPath(input.path)
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.writeFile(filePath, String(input.content || ''), 'utf8')

        return {
          output: `Wrote ${path.relative(ROOT_DIR, filePath)}`
        }
      }
    },
    {
      name: 'shell_command',
      description: 'Run a shell command inside the project. Disabled unless ALLOW_SHELL_TOOL=true.',
      input_schema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Shell command to run.'
          },
          timeout_ms: {
            type: 'integer',
            minimum: 1000,
            maximum: 120000,
            description: 'Execution timeout in milliseconds.'
          }
        },
        required: ['command']
      },
      execute: async (input) => {
        if (!ALLOW_SHELL_TOOL) {
          throw new Error('shell_command is disabled. Set ALLOW_SHELL_TOOL=true to enable it.')
        }

        const timeoutMs = clampInteger(input.timeout_ms, 15000, 1000, 120000)
        const result = await runShellCommand(String(input.command || ''), timeoutMs)
        return {
          output: [
            `$ ${input.command}`,
            '',
            result.stdout ? `stdout:\n${result.stdout}` : 'stdout:\n(empty)',
            '',
            result.stderr ? `stderr:\n${result.stderr}` : 'stderr:\n(empty)',
            '',
            `exitCode: ${result.exitCode}`
          ].join('\n')
        }
      }
    }
  ]

  return tools
}

async function executeTool(toolUse: ToolUse): Promise<ToolExecution> {
  const tool = toolRegistry.find((entry) => entry.name === toolUse.name)
  if (!tool) {
    return {
      toolUseId: toolUse.id,
      toolName: toolUse.name,
      isError: true,
      output: `Unknown tool: ${toolUse.name}`
    }
  }

  try {
    const result = await tool.execute(toolUse.input || {})
    return {
      toolUseId: toolUse.id,
      toolName: toolUse.name,
      isError: false,
      output: String(result.output || '')
    }
  } catch (error) {
    return {
      toolUseId: toolUse.id,
      toolName: toolUse.name,
      isError: true,
      output: error instanceof Error ? error.message : 'Unknown tool error'
    }
  }
}

async function runShellCommand(
  command: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (!command.trim()) {
    throw new Error('command is required')
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: ROOT_DIR,
      env: process.env,
      shell: true
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) {
        return
      }

      settled = true
      child.kill('SIGTERM')
      reject(new Error(`Command timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk)
    })

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })

    child.on('error', (error) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      reject(error)
    })

    child.on('close', (exitCode) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: exitCode ?? -1
      })
    })
  })
}

function buildAgentMessages(sessionMessages: SessionMessage[], maxMessages: number): AgentMessage[] {
  return sessionMessages.slice(-maxMessages).map((message) => ({
    role: message.role,
    content: message.content
  }))
}

function createSession({ title, systemPrompt, model }: CreateSessionParams): Session {
  const timestamp = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    title: sanitizeTitle(title) || 'New chat',
    model: model || DEFAULT_MODEL,
    systemPrompt: systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT,
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: []
  }
}

function summarizeSession(session: Session): SessionSummary {
  const lastMessage = session.messages.at(-1)
  return {
    id: session.id,
    title: session.title,
    model: session.model,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    preview: lastMessage ? truncate(collapseWhitespace(lastMessage.content), 100) : '',
    lastRole: lastMessage?.role ?? null
  }
}

async function listSessions(): Promise<SessionSummary[]> {
  const entries = await fs.readdir(SESSION_DIR, { withFileTypes: true })
  const sessions: SessionSummary[] = []

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

async function saveSession(session: Session): Promise<void> {
  await fs.writeFile(sessionFilePath(session.id), JSON.stringify(session, null, 2), 'utf8')
}

async function deleteSession(sessionId: string): Promise<void> {
  if (!isSafeSessionId(sessionId)) {
    return
  }

  const filePath = sessionFilePath(sessionId)
  if (existsSync(filePath)) {
    await fs.unlink(filePath)
  }
}

function sessionFilePath(sessionId: string): string {
  return path.join(SESSION_DIR, `${sessionId}.json`)
}

function isSafeSessionId(value: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(String(value || ''))
}

function resolveProjectPath(relativePath: unknown): string {
  const candidate = path.resolve(ROOT_DIR, String(relativePath || ''))
  if (!candidate.startsWith(ROOT_DIR)) {
    throw new Error('Path escapes project root')
  }

  return candidate
}

async function collectFiles(rootDir: string, maxDepth: number): Promise<string[]> {
  const results: string[] = []

  async function visit(currentDir: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      if (shouldSkipEntry(entry.name)) {
        continue
      }

      const absolute = path.join(currentDir, entry.name)
      const relative = path.relative(rootDir, absolute)

      if (entry.isDirectory()) {
        results.push(`${relative}/`)
        await visit(absolute, depth + 1)
      } else {
        results.push(relative)
      }
    }
  }

  await visit(rootDir, 0)
  return results.sort()
}

function shouldSkipEntry(name: string): boolean {
  return ['.git', 'node_modules', '.sessions', 'dist'].includes(name)
}

function initSse(res: Response): void {
  res.status(200)
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Connection', 'keep-alive')
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders()
  }
}

function writeSse(res: Response, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function loadDotEnv(filePath: string): void {
  if (!existsSync(filePath)) {
    return
  }

  const file = readFileSync(filePath, 'utf8')
  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = stripWrappedQuotes(line.slice(separatorIndex + 1).trim())
    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

function stripWrappedQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : parseInteger(typeof value === 'string' ? value : undefined, fallback)

  return Math.max(min, Math.min(max, parsed))
}

function sanitizeTitle(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

function collapseWhitespace(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value
}

function extractUpstreamError(payload: unknown, rawText: string): string {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string') {
    return payload.error.message
  }

  if (isRecord(payload) && typeof payload.message === 'string') {
    return payload.message
  }

  return rawText || 'Model request failed'
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}

function getRecordArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isRecord)
}
