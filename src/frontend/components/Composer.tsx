import React, { useRef, useState, useCallback } from 'react'
import type { ImageBlock } from '../types.js'

export interface ComposerImageAttachment {
  id: string
  block: ImageBlock
}

interface ComposerProps {
  sending: boolean
  onSend: (message: string, images: ImageBlock[]) => void
  onCancel: () => void
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export const Composer: React.FC<ComposerProps> = ({ sending, onSend, onCancel }) => {
  const [text, setText] = useState('')
  const [images, setImages] = useState<ComposerImageAttachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const canSend = (text.trim().length > 0 || images.length > 0) && !sending

  const submit = useCallback(() => {
    if (!canSend) return
    onSend(text.trim(), images.map((item) => item.block))
    setText('')
    setImages([])
    setError(null)
  }, [canSend, images, onSend, text])

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    submit()
  }, [submit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        submit()
      }
    },
    [submit]
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
            id="message-input"
            className="message-input"
            rows={3}
            placeholder="Ask the agent to inspect code, generate text, or help with a task..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={sending}
          />
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
