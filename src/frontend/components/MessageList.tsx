import React, { useRef, useEffect, useState, useCallback } from 'react'
import { marked } from 'marked'
import type { Session, SessionMessage, RuntimeEvent } from '../types.js'

interface MessageListProps {
  session: Session | null
  runtimeEvents: RuntimeEvent[]
  streamingText: string
  sending: boolean
}

/* ─── 工具调用记录 ─── */

interface ToolCallRecord {
  toolUseId: string
  toolName: string
  status: 'pending' | 'running' | 'done' | 'error'
  inputPreview?: string
  outputPreview?: string
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

function buildToolRecords(events: RuntimeEvent[]): ToolCallRecord[] {
  const map = new Map<string, ToolCallRecord>()

  for (const e of events) {
    const data = e.data as any
    if (e.event === 'tool:requested') {
      map.set(data.toolUse.id, {
        toolUseId: data.toolUse.id,
        toolName: data.toolUse.name,
        status: 'pending',
        inputPreview: buildInputPreview(data.toolUse.name, data.toolUse.input),
      })
    } else if (e.event === 'tool:running') {
      const r = map.get(data.toolUseId)
      if (r) r.status = 'running'
    } else if (e.event === 'tool:result') {
      const r = map.get(data.toolUseId)
      if (r) {
        r.status = data.isError ? 'error' : 'done'
        r.outputPreview = data.outputPreview
      }
    }
  }

  return Array.from(map.values())
}

/* ─── Markdown 渲染 ─── */

function renderMarkdown(text: string): { __html: string } {
  const html = marked.parse(text, { async: false, breaks: true, gfm: true }) as string
  return { __html: html }
}

/* ─── 清理工具输出 ─── */

function cleanToolOutput(text: string): string {
  // eslint-disable-next-line no-control-regex
  let t = text.replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
  t = t.replace(/\[\d+(;\d+)*m/g, '')
  t = t.replace(/(?:_\s*-\s*){2,}/g, ' ')
  t = t.replace(/[┌┐└┘│─┬┼┤├┴┬╔╗╚╝║═╦╩╠╣]/g, ' ')
  t = t.replace(/[▀▄█▌▐░▒▓]/g, ' ')
  t = t.replace(/\s+/g, ' ').trim()
  return t
}

/* ─── 可折叠工具调用项 ─── */

const ToolCallItem: React.FC<{ record: ToolCallRecord }> = ({ record }) => {
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

/* ─── 主组件 ─── */

export const MessageList: React.FC<MessageListProps> = ({
  session,
  runtimeEvents,
  streamingText,
  sending,
}) => {
  const messages = session?.messages || []
  const listRef = useRef<HTMLDivElement>(null)
  const toolRecords = buildToolRecords(runtimeEvents)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages.length, runtimeEvents.length, streamingText])

  const isStreaming = sending && (toolRecords.length > 0 || streamingText)
  const lastMsgIsAssistant =
    !sending &&
    toolRecords.length > 0 &&
    messages.length > 0 &&
    messages.at(-1)!.role === 'assistant'

  return (
    <section ref={listRef} className="message-list" aria-live="polite">
      {messages.length === 0 && !isStreaming ? (
        <div className="hero-empty">
          <h3>What can I help you with?</h3>
          <p>Ask me to inspect code, search files, run commands, or help with any task.</p>
        </div>
      ) : (
        <>
          {messages.map((msg, idx) => {
            const attachTraces = lastMsgIsAssistant && idx === messages.length - 1
            return (
              <MessageItem
                key={msg.id || idx}
                message={msg}
                toolRecords={attachTraces ? toolRecords : undefined}
              />
            )
          })}

          {isStreaming && (
            <div className="message-row">
              <img src="/logo.png" className="agent-avatar" alt="Kraken" />
              <article className="message agent-reply" data-role="assistant">
                {toolRecords.length > 0 && (
                  <div className="agent-traces">
                    {toolRecords.map((r) => (
                      <ToolCallItem key={r.toolUseId} record={r} />
                    ))}
                  </div>
                )}
                {streamingText && (
                  <div className="agent-answer">
                    <div className="message-body" dangerouslySetInnerHTML={renderMarkdown(streamingText)} />
                  </div>
                )}
              </article>
            </div>
          )}
        </>
      )}
    </section>
  )
}

const MessageItem: React.FC<{
  message: SessionMessage
  toolRecords?: ToolCallRecord[] | undefined
}> = ({ message, toolRecords }) => {
  const isAssistant = message.role === 'assistant'
  return (
    <div className="message-row">
      {isAssistant && (
        <img src="/logo.png" className="agent-avatar" alt="Kraken" />
      )}
      <article className="message" data-role={message.role}>
        {isAssistant && toolRecords && toolRecords.length > 0 && (
          <div className="agent-traces">
            {toolRecords.map((r) => (
              <ToolCallItem key={r.toolUseId} record={r} />
            ))}
          </div>
        )}
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
  )
}

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}
