import React, { useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import { fetchWorkspaceFile, fetchWorkspaceTree } from '../api.js'
import type { Session, WorkspaceEntry, WorkspaceFile, WorkspaceListing } from '../types.js'

interface WorkspacePanelProps {
  session: Session | null
  fallbackWorkspaceRoot: string
}

export const WorkspacePanel: React.FC<WorkspacePanelProps> = ({
  session,
  fallbackWorkspaceRoot,
}) => {
  const [listing, setListing] = useState<WorkspaceListing | null>(null)
  const [activePath, setActivePath] = useState('.')
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null)
  const [loadingTree, setLoadingTree] = useState(false)
  const [loadingFile, setLoadingFile] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sessionId = session?.id || null
  const workspaceRoot = session?.sandbox?.workspaceRoot || fallbackWorkspaceRoot

  useEffect(() => {
    setActivePath('.')
    setSelectedFile(null)
  }, [sessionId, workspaceRoot])

  useEffect(() => {
    let cancelled = false
    setLoadingTree(true)
    setError(null)

    fetchWorkspaceTree({ sessionId, path: activePath })
      .then((data) => {
        if (!cancelled) {
          setListing(data)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setListing(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingTree(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [sessionId, activePath, workspaceRoot])

  const breadcrumbParts = useMemo(() => {
    if (!listing?.path || listing.path === '.') {
      return ['.']
    }
    return listing.path.split('/').filter(Boolean)
  }, [listing?.path])

  const openDirectory = async (targetPath: string) => {
    setActivePath(targetPath || '.')
    setSelectedFile(null)
  }

  const openFile = async (entry: WorkspaceEntry) => {
    setLoadingFile(true)
    setError(null)
    try {
      const file = await fetchWorkspaceFile({ sessionId, path: entry.path })
      setSelectedFile(file)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSelectedFile(null)
    } finally {
      setLoadingFile(false)
    }
  }

  return (
    <section className="workspace-panel">
      <div className="workspace-sidebar">
        <div className="workspace-panel-header">
          <div>
            <h3>Workspace</h3>
            <p>{workspaceRoot || 'No workspace configured'}</p>
          </div>
          <button
            className="ghost-button"
            type="button"
            onClick={() => void openDirectory(activePath)}
            disabled={loadingTree}
          >
            Refresh
          </button>
        </div>

        <div className="workspace-breadcrumbs">
          <button type="button" className="workspace-crumb" onClick={() => void openDirectory('.')}>
            root
          </button>
          {breadcrumbParts[0] !== '.' && breadcrumbParts.map((part, index) => {
            const targetPath = breadcrumbParts.slice(0, index + 1).join('/')
            return (
              <button
                key={targetPath}
                type="button"
                className="workspace-crumb"
                onClick={() => void openDirectory(targetPath)}
              >
                / {part}
              </button>
            )
          })}
        </div>

        <div className="workspace-tree">
          {loadingTree && <p className="workspace-empty">Loading…</p>}
          {!loadingTree && listing && listing.entries.length === 0 && (
            <p className="workspace-empty">This directory is empty.</p>
          )}
          {!loadingTree && listing && listing.entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className="workspace-entry"
              data-kind={entry.kind}
              data-active={selectedFile?.path === entry.path}
              onClick={() => void (entry.kind === 'directory' ? openDirectory(entry.path) : openFile(entry))}
            >
              <span className="workspace-entry-icon">{entry.kind === 'directory' ? '▸' : '·'}</span>
              <span className="workspace-entry-name">{entry.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="workspace-viewer">
        {error && <div className="error-banner workspace-error">{error}</div>}
        {loadingFile && <p className="workspace-empty">Loading file…</p>}
        {!loadingFile && !selectedFile && (
          <div className="workspace-preview-empty">
            <h3>File Preview</h3>
            <p>Select a file from the workspace tree to preview text, Markdown, or images.</p>
          </div>
        )}
        {!loadingFile && selectedFile && (
          <article className="workspace-document">
            <div className="workspace-document-header">
              <h3>{selectedFile.path}</h3>
              <span>{selectedFile.contentType} · {formatBytes(selectedFile.size)}</span>
            </div>
            <WorkspaceFilePreview file={selectedFile} sessionId={sessionId} />
          </article>
        )}
      </div>
    </section>
  )
}

const WorkspaceFilePreview: React.FC<{
  file: WorkspaceFile
  sessionId: string | null
}> = ({ file, sessionId }) => {
  if (file.contentType === 'markdown') {
    return (
      <div
        className="workspace-markdown message-body"
        dangerouslySetInnerHTML={renderWorkspaceMarkdown(file.content || '', file.path, sessionId)}
      />
    )
  }

  if (file.contentType === 'text') {
    return <pre className="workspace-text">{file.content || ''}</pre>
  }

  if (file.contentType === 'image') {
    return (
      <div className="workspace-image-preview">
        <img src={buildWorkspaceImageUrl(file.path, sessionId)} alt={file.path} />
      </div>
    )
  }

  return (
    <div className="workspace-file-info">
      <h4>No inline preview</h4>
      <p>This file is treated as binary or is too large for text preview.</p>
      <dl>
        <div>
          <dt>Path</dt>
          <dd>{file.path}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{file.extension || 'unknown'}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(file.size)}</dd>
        </div>
      </dl>
    </div>
  )
}

function buildWorkspaceImageUrl(path: string, sessionId: string | null): string {
  const params = new URLSearchParams({ src: path })
  if (sessionId) {
    params.set('sessionId', sessionId)
  }
  return `/api/images?${params.toString()}`
}

function renderWorkspaceMarkdown(text: string, filePath: string, sessionId: string | null): { __html: string } {
  const renderer = new marked.Renderer()
  renderer.image = ({ href, title, text: altText }) => {
    const src = rewriteWorkspaceImageSrc(String(href || ''), filePath, sessionId)
    const titleAttr = title ? ` title="${escapeHtmlAttribute(title)}"` : ''
    return `<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(altText || '')}"${titleAttr}>`
  }
  return {
    __html: marked.parse(text, { async: false, breaks: true, gfm: true, renderer }) as string,
  }
}

function rewriteWorkspaceImageSrc(src: string, filePath: string, sessionId: string | null): string {
  const trimmed = src.trim()
  if (!trimmed || isDirectImageSrc(trimmed) || trimmed.startsWith('/api/')) {
    return trimmed
  }
  if (hasBlockedImageProtocol(trimmed)) {
    return ''
  }
  const localSrc = trimmed.toLowerCase().startsWith('file:')
    ? fileUrlToPath(trimmed)
    : resolveWorkspaceRelativePath(filePath, trimmed)
  return buildWorkspaceImageUrl(localSrc, sessionId)
}

function resolveWorkspaceRelativePath(filePath: string, imagePath: string): string {
  if (imagePath.startsWith('/') || imagePath.startsWith('~/')) {
    return imagePath
  }
  const directory = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '.'
  if (directory === '.') {
    return imagePath
  }
  return `${directory}/${imagePath}`
}

function isDirectImageSrc(src: string): boolean {
  return /^(https?:|blob:|\/\/)/i.test(src) || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(src)
}

function hasBlockedImageProtocol(src: string): boolean {
  const match = src.match(/^([a-z][a-z0-9+.-]*):/i)
  if (!match) {
    return false
  }
  const protocol = match[1]
  if (!protocol) {
    return false
  }
  return !['http', 'https', 'blob', 'file'].includes(protocol.toLowerCase())
}

function fileUrlToPath(src: string): string {
  try {
    const url = new URL(src)
    if (url.protocol === 'file:') {
      return decodeURIComponent(url.pathname)
    }
  } catch {
    return src
  }
  return src
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return 'unknown size'
  }
  if (value < 1024) {
    return `${value} B`
  }
  const units = ['KB', 'MB', 'GB']
  let size = value / 1024
  for (const unit of units) {
    if (size < 1024) {
      return `${size.toFixed(size >= 10 ? 0 : 1)} ${unit}`
    }
    size /= 1024
  }
  return `${size.toFixed(0)} TB`
}
