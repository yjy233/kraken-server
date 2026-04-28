import React, { useRef, useEffect, useState, useCallback } from 'react'
import { marked } from 'marked'
import type { AgentContentBlock, Session, SessionMessage, RuntimeEvent, RuntimeTimelineBlock, RuntimeTimelineToolRecord } from '../types.js'

interface MessageListProps {
  session: Session | null
  runtimeEvents: RuntimeEvent[]
  sending: boolean
}

type DisplayBubble = {
  id: string
  role: SessionMessage['role']
  createdAt: string
  blocks: DisplayBlock[]
}

type DisplayBlock = {
  block: AgentContentBlock
  role: SessionMessage['role']
}

function buildInputPreview(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'shell_command':
      return `$ ${input.command || ''}`
    case 'read_file':
      return `${input.path || ''}`
    case 'write_file':
      return `${input.path || ''}`
    case 'search_files':
      return `${input.pattern || ''}`
    case 'project_overview':
      return `depth=${input.max_depth || 2}`
    default:
      return ''
  }
}

function buildRuntimeBlocks(events: RuntimeEvent[]): RuntimeTimelineBlock[] {
  const toolMap = new Map<string, RuntimeTimelineToolRecord>()
  const assistantByStep = new Map<number, RuntimeTimelineBlock & { kind: 'assistant' }>()
  const blocks: RuntimeTimelineBlock[] = []

  for (const event of events) {
    const data = event.data as any
    const step = typeof data.step === 'number' ? data.step : undefined

    if (event.event === 'assistant:delta') {
      const nextText = typeof data.text === 'string' ? data.text : ''
      if (step !== undefined) {
        const existing = assistantByStep.get(step)
        if (existing) {
          existing.text = nextText
        } else {
          const block: RuntimeTimelineBlock & { kind: 'assistant' } = {
            kind: 'assistant',
            id: `assistant-step-${step}`,
            text: nextText,
            step,
          }
          assistantByStep.set(step, block)
          blocks.push(block)
        }
      } else {
        blocks.push({
          kind: 'assistant',
          id: `assistant-${blocks.length}`,
          text: nextText,
        })
      }
      continue
    }

    if (event.event === 'tool:requested') {
      const record: RuntimeTimelineToolRecord = {
        toolUseId: data.toolUse.id,
        toolName: data.toolUse.name,
        status: 'pending',
        inputPreview: buildInputPreview(data.toolUse.name, data.toolUse.input),
        input: data.toolUse.input,
      }
      toolMap.set(data.toolUse.id, record)
      const block: RuntimeTimelineBlock = {
        kind: 'tool',
        id: `tool-${data.toolUse.id}`,
        record,
      }
      if (step !== undefined) {
        block.step = step
      }
      blocks.push(block)
      continue
    }

    if (event.event === 'tool:running') {
      const record = toolMap.get(data.toolUseId)
      if (record) {
        record.status = 'running'
      }
      continue
    }

    if (event.event === 'tool:result') {
      const record = toolMap.get(data.toolUseId)
      if (record) {
        record.status = data.isError ? 'error' : 'done'
        record.outputPreview = data.outputPreview
        record.output = typeof data.output === 'string' ? data.output : data.outputPreview
      }
    }
  }

  return blocks
}

function renderMarkdown(text: string): { __html: string } {
  const html = marked.parse(text, { async: false, breaks: true, gfm: true }) as string
  return { __html: html }
}

function stripAnsi(text: string): string {
  return text
    .replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/\[\d+(;\d+)*m/g, '')
}

const ToolCallItem: React.FC<{ record: RuntimeTimelineToolRecord }> = ({ record }) => {
  const [expanded, setExpanded] = useState(false)
  const toggle = useCallback(() => setExpanded((p) => !p), [])

  const statusIcon =
    record.status === 'done' ? '✅' :
    record.status === 'error' ? '❌' :
    record.status === 'running' ? '⏳' : '🔧'

  return (
    <div className="tool-call-item">
      <div className="tool-call-header" onClick={toggle}>
        <span className="tool-call-arrow">{expanded ? '▼' : '▶'}</span>
        <span className="tool-call-name">{record.toolName}</span>
        {record.inputPreview && (
          <span className="tool-call-input" title={record.inputPreview}>
            {record.inputPreview}
          </span>
        )}
        <span className="tool-call-status">{statusIcon}</span>
      </div>
      {expanded && (
        <div className="tool-call-expanded">
          {record.input && (
            <>
              <div className="tool-call-section-label">input</div>
              <pre className="tool-call-detail tool-call-detail-full">{formatJson(record.input)}</pre>
            </>
          )}
          {(record.output || record.outputPreview) && (
            <>
              <div className="tool-call-section-label">output</div>
              <pre className="tool-call-detail tool-call-detail-full">{stripAnsi(record.output || record.outputPreview || '')}</pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export const MessageList: React.FC<MessageListProps> = ({
  session,
  runtimeEvents,
  sending,
}) => {
  const messages = session?.messages || []
  const listRef = useRef<HTMLDivElement>(null)
  const runtimeBlocks = buildRuntimeBlocks(runtimeEvents)
  const persistedBubbles = buildDisplayBubbles(messages)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages.length, runtimeEvents.length])

  const showRuntimeBubble = runtimeBlocks.length > 0 && sending

  return (
    <section ref={listRef} className="message-list" aria-live="polite">
      {persistedBubbles.length === 0 && !showRuntimeBubble ? (
        <div className="hero-empty">
          <h3>What can I help you with?</h3>
          <p>Ask me to inspect code, search files, run commands, or help with any task.</p>
        </div>
      ) : (
        <>
          {persistedBubbles.map((bubble) => (
            <MessageBubble key={bubble.id} bubble={bubble} />
          ))}

          {showRuntimeBubble && (
            <RuntimeReplyBubble
              blocks={runtimeBlocks}
              createdAt={messages.at(-1)?.createdAt || runtimeEvents[0]?.at || new Date().toISOString()}
            />
          )}
        </>
      )}
    </section>
  )
}

function buildDisplayBubbles(messages: SessionMessage[]): DisplayBubble[] {
  const bubbles: DisplayBubble[] = []
  let currentAssistantBubble: DisplayBubble | null = null

  for (const message of messages) {
    const blocks = normalizeMessageBlocks(message.content).map((block): DisplayBlock => ({
      block,
      role: message.role,
    }))
    if (blocks.length === 0) {
      continue
    }

    if (message.role === 'user' && !isToolResultMessage(message)) {
      bubbles.push({
        id: message.id,
        role: 'user',
        createdAt: message.createdAt,
        blocks,
      })
      currentAssistantBubble = null
      continue
    }

    if (!currentAssistantBubble) {
      currentAssistantBubble = {
        id: `assistant-group-${message.id}`,
        role: 'assistant',
        createdAt: message.createdAt,
        blocks: [],
      }
      bubbles.push(currentAssistantBubble)
    }

    currentAssistantBubble.blocks.push(...blocks)
  }

  return bubbles
}

const MessageBubble: React.FC<{ bubble: DisplayBubble }> = ({ bubble }) => {
  const timestamp = formatMessageTimestamp(bubble.createdAt)

  return (
    <div className="message-row" data-role={bubble.role}>
      {bubble.role === 'assistant' && (
        <img src="/logo.png" className="agent-avatar" alt="Kraken" />
      )}
      <div className="message-stack" data-role={bubble.role}>
        <div className="message-timestamp" aria-label={`Sent at ${timestamp}`}>
          {timestamp}
        </div>
        <article className="message" data-role={bubble.role}>
          <div className="message-block-flow">
            {bubble.blocks.map(({ block, role }, index) => (
              <MessageContentBlock
                key={`${block.type}-${index}`}
                block={block}
                role={role}
              />
            ))}
          </div>
        </article>
      </div>
    </div>
  )
}

const MessageContentBlock: React.FC<{
  block: AgentContentBlock
  role: SessionMessage['role']
}> = ({ block, role }) => {
  if (block.type === 'text') {
    return (
      <div
        className="message-body"
        dangerouslySetInnerHTML={
          role === 'assistant'
            ? renderMarkdown(block.text)
            : { __html: escapeHtml(block.text).replace(/\n/g, '<br>') }
        }
      />
    )
  }

  if (block.type === 'tool_use') {
    return (
      <ToolDetailItem
        title={block.name}
        subtitle={block.id}
        status="requested"
        body={formatJson(block.input)}
      />
    )
  }

  return (
    <ToolDetailItem
      title={block.tool_name || block.tool_use_id}
      subtitle={block.tool_use_id}
      status={block.is_error ? 'error' : 'result'}
      body={block.content}
    />
  )
}

const ToolDetailItem: React.FC<{
  title: string
  subtitle: string
  status: 'requested' | 'result' | 'error'
  body: string
}> = ({ title, subtitle, status, body }) => {
  const [expanded, setExpanded] = useState(true)
  const toggle = useCallback(() => setExpanded((p) => !p), [])

  return (
    <div className="tool-detail-item" data-status={status}>
      <button className="tool-detail-header" type="button" onClick={toggle}>
        <span className="tool-call-arrow">{expanded ? '▼' : '▶'}</span>
        <span className="tool-call-name">{title}</span>
        <span className="tool-detail-label">{status}</span>
        <span className="tool-call-input" title={subtitle}>{subtitle}</span>
      </button>
      {expanded && (
        <pre className="tool-call-detail tool-call-detail-full">{stripAnsi(body)}</pre>
      )}
    </div>
  )
}

const RuntimeReplyBubble: React.FC<{
  blocks: RuntimeTimelineBlock[]
  createdAt: string
}> = ({ blocks, createdAt }) => {
  const timestamp = formatMessageTimestamp(createdAt)

  return (
    <div className="message-row" data-role="assistant">
      <img src="/logo.png" className="agent-avatar" alt="Kraken" />
      <div className="message-stack" data-role="assistant">
        <div className="message-timestamp" aria-label={`Sent at ${timestamp}`}>
          {timestamp}
        </div>
        <article className="message agent-reply" data-role="assistant">
          <div className="runtime-reply-flow">
            {blocks.map((block) => (
              block.kind === 'assistant' ? (
                <div key={block.id} className="runtime-reply-text">
                  <div className="message-body" dangerouslySetInnerHTML={renderMarkdown(block.text)} />
                </div>
              ) : (
                <div key={block.id} className="runtime-reply-tool">
                  <ToolCallItem record={block.record} />
                </div>
              )
            ))}
          </div>
        </article>
      </div>
    </div>
  )
}

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function normalizeMessageBlocks(content: SessionMessage['content']): AgentContentBlock[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  return content
}

function isToolResultMessage(message: SessionMessage): boolean {
  return Array.isArray(message.content) && message.content.length > 0 && message.content.every((block) => block.type === 'tool_result')
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatMessageTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}
