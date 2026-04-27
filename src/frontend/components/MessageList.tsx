import React, { useRef, useEffect, useState, useCallback } from 'react'
import { marked } from 'marked'
import type { Session, SessionMessage, RuntimeEvent, RuntimeTimelineBlock, RuntimeTimelineToolRecord } from '../types.js'

interface MessageListProps {
  session: Session | null
  runtimeEvents: RuntimeEvent[]
  streamingText: string
  sending: boolean
  traceSessionId?: string | null
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
      }
    }
  }

  return blocks
}

function renderMarkdown(text: string): { __html: string } {
  const html = marked.parse(text, { async: false, breaks: true, gfm: true }) as string
  return { __html: html }
}

function cleanToolOutput(text: string): string {
  let t = text.replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
  t = t.replace(/\[\d+(;\d+)*m/g, '')
  t = t.replace(/(?:_\s*-\s*){2,}/g, ' ')
  t = t.replace(/[┌┐└┘│─┬┼┤├┴┬╔╗╚╝║═╦╩╠╣]/g, ' ')
  t = t.replace(/[▀▄█▌▐░▒▓]/g, ' ')
  t = t.replace(/\s+/g, ' ').trim()
  return t
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
      {expanded && record.outputPreview && (
        <div className="tool-call-detail">{cleanToolOutput(record.outputPreview)}</div>
      )}
    </div>
  )
}

export const MessageList: React.FC<MessageListProps> = ({
  session,
  runtimeEvents,
  sending,
  traceSessionId,
}) => {
  const messages = session?.messages || []
  const listRef = useRef<HTMLDivElement>(null)
  const runtimeBlocks = buildRuntimeBlocks(runtimeEvents)
  const shouldAttachToSession = Boolean(traceSessionId && session?.id && traceSessionId === session.id)
  const persistedMessages = shouldAttachToSession && runtimeBlocks.length > 0 && messages.length > 0 && messages.at(-1)?.role === 'assistant'
    ? messages.slice(0, -1)
    : messages

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages.length, runtimeEvents.length])

  const showRuntimeBubble = runtimeBlocks.length > 0 && (sending || shouldAttachToSession)

  return (
    <section ref={listRef} className="message-list" aria-live="polite">
      {persistedMessages.length === 0 && !showRuntimeBubble ? (
        <div className="hero-empty">
          <h3>What can I help you with?</h3>
          <p>Ask me to inspect code, search files, run commands, or help with any task.</p>
        </div>
      ) : (
        <>
          {persistedMessages.map((msg, idx) => (
            <MessageItem key={msg.id || idx} message={msg} />
          ))}

          {showRuntimeBubble && (
            <RuntimeReplyBubble
              blocks={runtimeBlocks}
              createdAt={messages.at(-1)?.createdAt || runtimeEvents[0]?.at || new Date().toISOString()}
            />
          )}

          {!showRuntimeBubble && shouldAttachToSession && messages.length > 0 && messages.at(-1)?.role === 'assistant' && (
            <MessageItem message={messages.at(-1)!} />
          )}
        </>
      )}
    </section>
  )
}

const MessageItem: React.FC<{ message: SessionMessage }> = ({ message }) => {
  const isAssistant = message.role === 'assistant'
  const timestamp = formatMessageTimestamp(message.createdAt)

  return (
    <div className="message-row" data-role={message.role}>
      {isAssistant && (
        <img src="/logo.png" className="agent-avatar" alt="Kraken" />
      )}
      <div className="message-stack" data-role={message.role}>
        <div className="message-timestamp" aria-label={`Sent at ${timestamp}`}>
          {timestamp}
        </div>
        <article className="message" data-role={message.role}>
          <div
            className="message-body"
            dangerouslySetInnerHTML={
              isAssistant
                ? renderMarkdown(message.content)
                : { __html: escapeHtml(message.content).replace(/\n/g, '<br>') }
            }
          />
        </article>
      </div>
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

function formatMessageTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}
