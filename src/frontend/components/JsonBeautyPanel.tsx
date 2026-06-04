import React, { useMemo, useState } from 'react'

const escapeJsonText = (value: string) => JSON.stringify(value).slice(1, -1)

const unescapeJsonText = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ''

  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed === 'string') {
      return parsed
    }
  } catch {
    // Fall through to support escaped JSON text without wrapping quotes.
  }

  return JSON.parse(`"${trimmed}"`)
}

export const JsonBeautyPanel: React.FC = () => {
  const [input, setInput] = useState('')
  const [indent, setIndent] = useState(2)
  const [actionError, setActionError] = useState('')

  const result = useMemo(() => {
    const trimmed = input.trim()
    if (!trimmed) {
      return { output: '', error: '' }
    }

    try {
      const parsed = JSON.parse(trimmed)
      return {
        output: JSON.stringify(parsed, null, indent),
        error: '',
      }
    } catch (error) {
      return {
        output: '',
        error: error instanceof Error ? error.message : 'Invalid JSON input',
      }
    }
  }, [input, indent])

  const setInputValue = (value: string) => {
    setActionError('')
    setInput(value)
  }

  const handleBeauty = () => {
    if (result.output) {
      setInputValue(result.output)
    }
  }

  const handleMinify = () => {
    const trimmed = input.trim()
    if (!trimmed) return

    try {
      setInputValue(JSON.stringify(JSON.parse(trimmed)))
    } catch {
      // The visible error state already explains invalid JSON.
    }
  }

  const handleMinifyAndEscape = () => {
    const trimmed = input.trim()
    if (!trimmed) return

    try {
      const minified = JSON.stringify(JSON.parse(trimmed))
      setInputValue(escapeJsonText(minified))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Invalid JSON input')
    }
  }

  const handleUnescape = () => {
    const trimmed = input.trim()
    if (!trimmed) return

    try {
      setInputValue(unescapeJsonText(trimmed))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Invalid escaped JSON text')
    }
  }

  const handleClear = () => {
    setInputValue('')
  }

  const handleCopy = async () => {
    if (!result.output || !navigator.clipboard) return
    await navigator.clipboard.writeText(result.output)
  }

  return (
    <section className="json-beauty-panel" aria-label="JSON beauty tool">
      <div className="json-toolbar">
        <div className="json-indent-control" role="group" aria-label="Indent size">
          <span className="json-toolbar-label">Indent</span>
          {[2, 4].map((value) => (
            <button
              key={value}
              className="panel-tab json-indent-button"
              type="button"
              data-active={indent === value}
              onClick={() => setIndent(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="json-toolbar-actions">
          <button className="ghost-button" type="button" onClick={handleBeauty} disabled={!result.output}>
            Beauty
          </button>
          <button className="ghost-button" type="button" onClick={handleMinify} disabled={!input.trim() || !!result.error}>
            Minify
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={handleMinifyAndEscape}
            disabled={!input.trim() || !!result.error}
          >
            Minify + Escape
          </button>
          <button className="ghost-button" type="button" onClick={handleUnescape} disabled={!input.trim()}>
            Unescape
          </button>
          <button className="ghost-button" type="button" onClick={handleCopy} disabled={!result.output}>
            Copy
          </button>
          <button className="icon-button" type="button" onClick={handleClear} disabled={!input}>
            Clear
          </button>
        </div>
      </div>

      <div className="json-editor-grid">
        <label className="json-editor-pane">
          <span className="json-editor-label">Input</span>
          <textarea
            className="json-textarea"
            spellCheck={false}
            value={input}
            onChange={(event) => setInputValue(event.target.value)}
            placeholder='Paste JSON text, for example: {"name":"Kraken","ok":true}'
          />
        </label>

        <label className="json-editor-pane">
          <span className="json-editor-label">Output</span>
          <textarea
            className="json-textarea json-output"
            readOnly
            spellCheck={false}
            value={result.output}
            placeholder="Formatted JSON appears here"
          />
        </label>
      </div>

      {(actionError || result.error) && <div className="json-error">{actionError || result.error}</div>}
    </section>
  )
}
