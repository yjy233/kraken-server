const state = {
  activeSession: null,
  config: null,
  sending: false,
  sessions: [],
  runtimeEvents: []
}

const appTitle = document.querySelector('#app-title')
const chatTitle = document.querySelector('#chat-title')
const composerForm = document.querySelector('#composer-form')
const errorBanner = document.querySelector('#error-banner')
const messageInput = document.querySelector('#message-input')
const messageList = document.querySelector('#message-list')
const modelPill = document.querySelector('#model-pill')
const newChatButton = document.querySelector('#new-chat-button')
const refreshButton = document.querySelector('#refresh-button')
const savePromptButton = document.querySelector('#save-prompt-button')
const sessionList = document.querySelector('#session-list')
const sessionMeta = document.querySelector('#session-meta')
const statusText = document.querySelector('#status-text')
const systemPromptInput = document.querySelector('#system-prompt-input')
const messageTemplate = document.querySelector('#message-template')

boot().catch((error) => {
  showError(error.message)
})

composerForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  await sendMessage()
})

messageInput.addEventListener('keydown', async (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    await sendMessage()
  }
})

newChatButton.addEventListener('click', async () => {
  hideError()
  const created = await api('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({
      systemPrompt: systemPromptInput.value.trim() || state.config?.defaultSystemPrompt || ''
    })
  })

  state.activeSession = created.session
  state.runtimeEvents = []
  await refreshSessions()
  render()
  messageInput.focus()
})

refreshButton.addEventListener('click', async () => {
  hideError()
  await refreshSessions()
  render()
})

savePromptButton.addEventListener('click', async () => {
  if (!state.activeSession) {
    showError('Create or open a session before saving instructions.')
    return
  }

  hideError()
  const updated = await api(`/api/sessions/${state.activeSession.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      systemPrompt: systemPromptInput.value.trim()
    })
  })

  state.activeSession = updated.session
  await refreshSessions()
  render()
})

async function boot() {
  state.config = await api('/api/config')
  appTitle.textContent = state.config.appTitle
  modelPill.textContent = state.config.model
  statusText.textContent = state.config.configured
    ? `API configured. ${state.config.tools.length} tools available.`
    : 'API key missing. Add ANTHROPIC_API_KEY to .env before chatting.'

  await refreshSessions()

  if (state.sessions.length > 0) {
    await openSession(state.sessions[0].id)
  } else {
    systemPromptInput.value = state.config.defaultSystemPrompt
    render()
  }
}

async function refreshSessions() {
  const response = await api('/api/sessions')
  state.sessions = response.sessions

  if (state.activeSession) {
    const stillExists = state.sessions.find((session) => session.id === state.activeSession.id)
    if (!stillExists) {
      state.activeSession = null
    }
  }
}

async function openSession(sessionId) {
  hideError()
  const response = await api(`/api/sessions/${sessionId}`)
  state.activeSession = response.session
  state.runtimeEvents = []
  systemPromptInput.value = state.activeSession.systemPrompt || state.config.defaultSystemPrompt
  render()
}

async function deleteSession(sessionId) {
  hideError()
  await api(`/api/sessions/${sessionId}`, { method: 'DELETE' })

  if (state.activeSession?.id === sessionId) {
    state.activeSession = null
    state.runtimeEvents = []
    systemPromptInput.value = state.config.defaultSystemPrompt
  }

  await refreshSessions()

  if (!state.activeSession && state.sessions[0]) {
    await openSession(state.sessions[0].id)
    return
  }

  render()
}

async function sendMessage() {
  const message = messageInput.value.trim()
  if (!message || state.sending) {
    return
  }

  hideError()
  state.sending = true
  state.runtimeEvents = []
  messageInput.value = ''

  appendOptimisticUserMessage(message)
  render()

  try {
    const payload = {
      sessionId: state.activeSession?.id || null,
      systemPrompt: systemPromptInput.value.trim(),
      message
    }

    const result = await streamChat(payload)
    state.activeSession = result.session
    systemPromptInput.value = state.activeSession.systemPrompt || state.config.defaultSystemPrompt
    await refreshSessions()
    render()
  } catch (error) {
    restoreComposerMessage(message)
    showError(error.message)
  } finally {
    state.sending = false
    render()
  }
}

async function streamChat(payload) {
  const url = `/api/chat/stream?payload=${encodeURIComponent(JSON.stringify(payload))}`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'text/event-stream'
    }
  })

  if (!response.ok || !response.body) {
    const message = await response.text()
    throw new Error(message || 'Unable to open stream')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() || ''

    for (const chunk of chunks) {
      const parsed = parseSseChunk(chunk)
      if (!parsed) {
        continue
      }

      if (parsed.event === 'error') {
        throw new Error(parsed.data.error || 'Streaming request failed')
      }

      if (parsed.event === 'complete') {
        completed = parsed.data
        continue
      }

      handleRuntimeEvent(parsed.event, parsed.data)
    }
  }

  if (!completed) {
    throw new Error('Stream closed before completion')
  }

  return completed
}

function handleRuntimeEvent(event, data) {
  if (event === 'assistant:delta') {
    upsertPendingAssistantMessage(data.text)
  }

  state.runtimeEvents.push({
    event,
    data,
    at: new Date().toISOString()
  })

  state.runtimeEvents = state.runtimeEvents.slice(-40)
  render()
}

function appendOptimisticUserMessage(message) {
  const baseSession =
    state.activeSession ||
    {
      id: 'pending',
      title: message.slice(0, 60) || 'New chat',
      systemPrompt: systemPromptInput.value.trim() || state.config?.defaultSystemPrompt || '',
      model: state.config?.model || 'unknown',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: []
    }

  const messages = Array.isArray(baseSession.messages) ? [...baseSession.messages] : []
  messages.push({
    id: `optimistic-user-${Date.now()}`,
    role: 'user',
    content: message,
    createdAt: new Date().toISOString()
  })

  state.activeSession = {
    ...baseSession,
    title: baseSession.title === 'New chat' ? message.slice(0, 60) : baseSession.title,
    messages
  }
}

function restoreComposerMessage(message) {
  messageInput.value = message
}

function upsertPendingAssistantMessage(content) {
  if (!state.activeSession) {
    return
  }

  const messages = [...state.activeSession.messages]
  const existingIndex = messages.findIndex((message) => message.id === 'pending-assistant')

  if (existingIndex >= 0) {
    messages[existingIndex] = {
      ...messages[existingIndex],
      content
    }
  } else {
    messages.push({
      id: 'pending-assistant',
      role: 'assistant',
      content,
      createdAt: new Date().toISOString()
    })
  }

  state.activeSession = {
    ...state.activeSession,
    messages
  }
}

function parseSseChunk(chunk) {
  const lines = chunk.split('\n')
  let event = 'message'
  const dataLines = []

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
      continue
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }

  if (!dataLines.length) {
    return null
  }

  try {
    return {
      event,
      data: JSON.parse(dataLines.join('\n'))
    }
  } catch {
    return null
  }
}

function render() {
  renderSessions()
  renderMessages()
  chatTitle.textContent = state.activeSession?.title || 'New chat'
  sessionMeta.textContent = state.activeSession
    ? `${state.activeSession.messages.length} messages`
    : 'No session yet'
}

function renderSessions() {
  sessionList.replaceChildren()

  const toolSummary = document.createElement('div')
  toolSummary.className = 'tool-summary'
  toolSummary.textContent = state.config
    ? `Tools: ${state.config.tools.map((tool) => tool.name).join(', ')}`
    : 'Tools: loading...'
  sessionList.append(toolSummary)

  if (state.sessions.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'empty-state'
    empty.textContent = 'No saved sessions yet.'
    sessionList.append(empty)
    return
  }

  for (const session of state.sessions) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'session-item'
    if (session.id === state.activeSession?.id) {
      button.dataset.active = 'true'
    }

    const title = document.createElement('span')
    title.className = 'session-title'
    title.textContent = session.title

    const preview = document.createElement('span')
    preview.className = 'session-preview'
    preview.textContent = session.preview || 'Empty session'

    const meta = document.createElement('span')
    meta.className = 'session-preview'
    meta.textContent = new Date(session.updatedAt).toLocaleString()

    const remove = document.createElement('span')
    remove.className = 'session-delete'
    remove.textContent = 'Delete'
    remove.addEventListener('click', async (event) => {
      event.stopPropagation()
      await deleteSession(session.id)
    })

    button.append(title, preview, meta, remove)
    button.addEventListener('click', async () => {
      await openSession(session.id)
    })
    sessionList.append(button)
  }
}

function renderMessages() {
  messageList.replaceChildren()
  const messages = state.activeSession?.messages || []

  if (messages.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'hero-empty'
    empty.innerHTML = `
      <p class="eyebrow">Heavy Runtime</p>
      <h3>Express server, tools, multi-step loop, streaming events.</h3>
      <p>This UI shows the conversation and the live execution trace from the agent runtime.</p>
    `
    messageList.append(empty)
  } else {
    for (const message of messages) {
      messageList.append(renderMessage(message.role, message.content))
    }
  }

  if (state.runtimeEvents.length > 0) {
    const traceCard = document.createElement('article')
    traceCard.className = 'trace-card'

    const heading = document.createElement('div')
    heading.className = 'message-meta'
    heading.textContent = 'Runtime Trace'
    traceCard.append(heading)

    for (const entry of state.runtimeEvents) {
      const row = document.createElement('div')
      row.className = 'trace-row'

      const label = document.createElement('strong')
      label.textContent = entry.event

      const detail = document.createElement('span')
      detail.textContent = summarizeRuntimeEvent(entry)

      row.append(label, detail)
      traceCard.append(row)
    }

    messageList.append(traceCard)
  }

  messageList.scrollTop = messageList.scrollHeight
}

function summarizeRuntimeEvent(entry) {
  const data = entry.data || {}

  if (entry.event === 'run:step') {
    return `step ${data.step} ${data.phase || ''}`.trim()
  }

  if (entry.event === 'tool:requested') {
    return `${data.toolUse?.name || 'tool'} requested`
  }

  if (entry.event === 'tool:running') {
    return `${data.toolName} running`
  }

  if (entry.event === 'tool:result') {
    return `${data.toolName} ${data.isError ? 'failed' : 'finished'}: ${data.outputPreview || ''}`
  }

  if (entry.event === 'assistant:delta') {
    return truncate(collapseWhitespace(data.text || ''), 120)
  }

  if (entry.event === 'session') {
    return `${data.state}: ${data.session?.title || data.session?.id || ''}`
  }

  if (entry.event === 'run:start') {
    return `${data.model} max ${data.maxAgentSteps} steps`
  }

  return JSON.stringify(data)
}

function renderMessage(role, content) {
  const fragment = messageTemplate.content.cloneNode(true)
  const article = fragment.querySelector('.message')
  const meta = fragment.querySelector('.message-meta')
  const body = fragment.querySelector('.message-body')

  article.dataset.role = role
  meta.textContent = role === 'user' ? 'You' : 'Agent'
  body.textContent = content
  return fragment
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  })

  const text = await response.text()
  let payload = {}

  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = { error: text || 'Invalid server response' }
  }

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed')
  }

  return payload
}

function showError(message) {
  errorBanner.hidden = false
  errorBanner.textContent = message
}

function hideError() {
  errorBanner.hidden = true
  errorBanner.textContent = ''
}

function collapseWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function truncate(value, length) {
  return value.length > length ? `${value.slice(0, length - 1)}...` : value
}
