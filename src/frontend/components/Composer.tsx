import React, { useRef, useState, useCallback, useEffect } from 'react'
import type { ImageBlock, SkillInfo } from '../types.js'
import {
  applySlashSelection,
  getSlashContext,
  getSlashOptions,
  type SlashCommandOption,
  type SlashContext,
} from '../utils/slash-commands.js'

export interface ComposerImageAttachment {
  id: string
  block: ImageBlock
}

interface ComposerProps {
  sending: boolean
  skills: SkillInfo[]
  onSend: (message: string, images: ImageBlock[]) => void
  onCancel: () => void
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export const Composer: React.FC<ComposerProps> = ({ sending, skills, onSend, onCancel }) => {
  const [text, setText] = useState('')
  const [images, setImages] = useState<ComposerImageAttachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [slashContext, setSlashContext] = useState<SlashContext>(() => getSlashContext('', 0))
  const [slashOptions, setSlashOptions] = useState<SlashCommandOption[]>([])
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [isComposing, setIsComposing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const canSend = (text.trim().length > 0 || images.length > 0) && !sending
  const slashOpen = slashContext.active && slashOptions.length > 0

  const updateSlashState = useCallback((nextText: string, cursor: number) => {
    const context = getSlashContext(nextText, cursor)
    const options = getSlashOptions(context, skills)
    setSlashContext(context)
    setSlashOptions(options)
    setHighlightedIndex(0)
  }, [skills])

  const submit = useCallback(() => {
    if (!canSend) return
    onSend(text.trim(), images.map((item) => item.block))
    setText('')
    setImages([])
    setError(null)
    setSlashContext(getSlashContext('', 0))
    setSlashOptions([])
    setHighlightedIndex(0)
  }, [canSend, images, onSend, text])

  const handleSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    submit()
  }, [submit])

  const handleSlashSelection = useCallback((option: SlashCommandOption) => {
    const next = applySlashSelection(text, slashContext, option)
    setText(next.text)
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(next.cursor, next.cursor)
      }
      updateSlashState(next.text, next.cursor)
    })
  }, [slashContext, text, updateSlashState])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isComposing) {
        return
      }

      if (slashOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setHighlightedIndex((prev) => (prev + 1) % slashOptions.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setHighlightedIndex((prev) => (prev - 1 + slashOptions.length) % slashOptions.length)
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          const option = slashOptions[highlightedIndex]
          if (option) {
            handleSlashSelection(option)
          }
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setSlashContext(getSlashContext('', 0))
          setSlashOptions([])
          setHighlightedIndex(0)
          return
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        submit()
      }
    },
    [handleSlashSelection, highlightedIndex, isComposing, slashOpen, slashOptions, submit]
  )

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFilesSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files || [])
    event.currentTarget.value = ''
    if (files.length === 0) {
      return
    }

    const nextImages: ComposerImageAttachment[] = []
    for (const file of files) {
      if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
        setError('Only PNG, JPEG, WebP, and GIF images are supported.')
        continue
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError('Images must be 5 MB or smaller.')
        continue
      }
      const dataUrl = await readFileAsDataUrl(file)
      nextImages.push({
        id: `${file.name}-${file.lastModified}-${file.size}-${crypto.randomUUID()}`,
        block: {
          type: 'image',
          image: dataUrl,
          mediaType: file.type,
          filename: file.name,
        },
      })
    }

    if (nextImages.length > 0) {
      setImages((prev) => [...prev, ...nextImages].slice(0, 4))
      setError(null)
    }
  }, [])

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const handlePaste = useCallback(async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(event.clipboardData.files || []).filter((file) => file.type.startsWith('image/'))
    if (imageFiles.length === 0) {
      return
    }
    event.preventDefault()
    const dataTransfer = new DataTransfer()
    for (const file of imageFiles) {
      dataTransfer.items.add(file)
    }
    if (fileInputRef.current) {
      fileInputRef.current.files = dataTransfer.files
      await handleFilesSelected({ currentTarget: fileInputRef.current } as React.ChangeEvent<HTMLInputElement>)
    }
  }, [handleFilesSelected])

  useEffect(() => {
    if (!slashOpen) {
      setHighlightedIndex(0)
      return
    }
    setHighlightedIndex((prev) => Math.min(prev, slashOptions.length - 1))
  }, [slashOpen, slashOptions.length])

  return (
    <form className="composer" autoComplete="off" onSubmit={handleSubmit}>
      <div className="composer-inner">
        <button
          className="attach-button"
          type="button"
          aria-label="Add image"
          onClick={handleAttachClick}
          disabled={sending}
        >
          +
        </button>
        <input
          ref={fileInputRef}
          className="composer-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          onChange={handleFilesSelected}
        />
        <div className="composer-main">
          {images.length > 0 && (
            <div className="composer-attachments" aria-label="Attached images">
              {images.map((item) => (
                <div className="composer-attachment" key={item.id}>
                  <img src={item.block.image} alt={item.block.filename || 'Attached image'} />
                  <button type="button" aria-label="Remove image" onClick={() => removeImage(item.id)}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            id="message-input"
            className="message-input"
            rows={3}
            placeholder="Ask the agent to inspect code, generate text, or help with a task..."
            value={text}
            onChange={(e) => {
              const nextText = e.target.value
              const cursor = e.target.selectionStart ?? nextText.length
              setText(nextText)
              updateSlashState(nextText, cursor)
            }}
            onClick={(e) => updateSlashState(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
            onKeyUp={(e) => updateSlashState(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={(e) => {
              setIsComposing(false)
              updateSlashState(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length)
            }}
            disabled={sending}
          />
          {slashOpen && (
            <div className="slash-menu" role="listbox" aria-label={slashContext.stage === 'root' ? 'Slash commands' : 'Available skills'}>
              {slashOptions.map((option, index) => (
                <button
                  key={option.id}
                  type="button"
                  className="slash-option"
                  data-active={index === highlightedIndex}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSlashSelection(option)}
                >
                  <div className="slash-option-header">
                    <span className="slash-option-label">{option.type === 'command' ? `/${option.label}` : option.label}</span>
                  </div>
                  {option.description && <span className="slash-option-description">{option.description}</span>}
                </button>
              ))}
            </div>
          )}
          {error && <div className="composer-error">{error}</div>}
        </div>
        <div className="composer-right">
          {sending ? (
            <button className="send-button" type="button" onClick={onCancel}>
              Cancel
            </button>
          ) : (
            <button className="send-button" type="submit" disabled={!canSend}>
              Send
            </button>
          )}
          <span className="composer-hint">Cmd + Enter to send</span>
        </div>
      </div>
    </form>
  )
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Unable to read image'))
    reader.readAsDataURL(file)
  })
}
