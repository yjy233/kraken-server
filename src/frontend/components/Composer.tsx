import React, { useState, useCallback } from 'react'

interface ComposerProps {
  sending: boolean
  onSend: (message: string) => void
  onCancel: () => void
}

export const Composer: React.FC<ComposerProps> = ({ sending, onSend, onCancel }) => {
  const [text, setText] = useState('')

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!text.trim() || sending) return
      onSend(text.trim())
      setText('')
    },
    [text, sending, onSend]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        if (!text.trim() || sending) return
        onSend(text.trim())
        setText('')
      }
    },
    [text, sending, onSend]
  )

  return (
    <form className="composer" autoComplete="off" onSubmit={handleSubmit}>
      <div className="composer-inner">
        <textarea
          id="message-input"
          className="message-input"
          rows={3}
          placeholder="Ask the agent to inspect code, generate text, or help with a task..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
        />
        <div className="composer-actions">
          <span className="composer-hint">Cmd + Enter to send</span>
          {sending ? (
            <button className="send-button" type="button" onClick={onCancel}>
              Cancel
            </button>
          ) : (
            <button className="send-button" type="submit">
              Send
            </button>
          )}
        </div>
      </div>
    </form>
  )
}
