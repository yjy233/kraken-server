import React, { useRef, useEffect } from 'react'
import type { Session, SessionMessage, RuntimeEvent } from '../types.js'

interface MessageListProps {
  session: Session | null
  runtimeEvents: RuntimeEvent[]
}

function summarizeEvent(entry: RuntimeEvent): string {
  const data = entry.data as any
  switch (entry.event) {
    case 'run:step':
      return `Step ${data.step} · ${data.phase || ''}`.trim()
    case 'tool:requested':
      return `${data.toolUse?.name || 'tool'} requested`
    case 'tool:running':
      return `${data.toolName} running`
    case 'tool:result':
      return `${data.toolName} ${data.isError ? 'failed' : 'finished'}`
    case 'assistant:delta':
      return truncate(collapseWhitespace(data.text || ''), 160)
    case 'session':
      return `${data.state}`
    case 'run:start':
      return `${data.model} · max ${data.maxAgentSteps} steps`
    default:
      return JSON.stringify(data)
  }
}

function collapseWhitespace(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value
}

export const MessageList: React.FC<MessageListProps> = ({ session, runtimeEvents }) => {
  const messages = session?.messages || []
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages.length, runtimeEvents.length])

  return (
    <section ref={listRef} className="message-list" aria-live="polite">
      {messages.length === 0 ? (
        <div className="hero-empty">
          <h3>What can I help you with?</h3>
          <p>Ask me to inspect code, search files, run commands, or help with any task.</p>
        </div>
      ) : (
        <>
          {messages.map((msg, idx) => (
            <MessageItem key={msg.id || idx} message={msg} />
          ))}

          {runtimeEvents.length > 0 && (
            <article className="trace-card">
              <div className="trace-header">Runtime Trace</div>
              {runtimeEvents.map((entry, idx) => (
                <div key={idx} className="trace-row">
                  <span className="trace-label">{entry.event}</span>
                  <span className="trace-detail">{summarizeEvent(entry)}</span>
                </div>
              ))}
            </article>
          )}
        </>
      )}
    </section>
  )
}

const MessageItem: React.FC<{ message: SessionMessage }> = ({ message }) => {
  return (
    <article className="message" data-role={message.role}>
      <div className="message-body">{message.content}</div>
    </article>
  )
}
