import React, { useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import {
  buildWorkspaceDownloadUrl,
  deleteWorkspaceFile,
  fetchWorkspaceFile,
  fetchWorkspaceTree,
  saveWorkspaceFile,
  uploadWorkspaceFile,
} from '../api.js'
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
  const [treeRefreshToken, setTreeRefreshToken] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draftContent, setDraftContent] = useState('')
  const [savingFile, setSavingFile] = useState(false)
  const [deletingFile, setDeletingFile] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadInputKey, setUploadInputKey] = useState(0)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sessionId = session?.id || null
  const workspaceRoot = session?.sandbox?.workspaceRoot || fallbackWorkspaceRoot

  useEffect(() => {
    setActivePath('.')
    setSelectedFile(null)
    setEditing(false)
    setDraftContent('')
    setUploadFile(null)
    setStatusMessage(null)
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
  }, [sessionId, activePath, workspaceRoot, treeRefreshToken])

  useEffect(() => {
    setEditing(false)
    setDraftContent(selectedFile?.content || '')
  }, [selectedFile?.path, selectedFile?.content])

  const breadcrumbParts = useMemo(() => {
    if (!listing?.path || listing.path === '.') {
      return ['.']
    }
    return listing.path.split('/').filter(Boolean)
  }, [listing?.path])

  const refreshTree = () => {
    setTreeRefreshToken((value) => value + 1)
  }

  const openDirectory = async (targetPath: string) => {
    const normalizedPath = targetPath || '.'
    if (normalizedPath === activePath) {
      refreshTree()
    } else {
      setActivePath(normalizedPath)
    }
    setSelectedFile(null)
    setStatusMessage(null)
  }

  const openFile = async (entry: WorkspaceEntry) => {
    setLoadingFile(true)
    setError(null)
    setStatusMessage(null)
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

  const handleSaveFile = async () => {
    if (!selectedFile || !isEditableWorkspaceFile(selectedFile)) {
      return
    }
    setSavingFile(true)
    setError(null)
    try {
      const file = await saveWorkspaceFile({
        sessionId,
        path: selectedFile.path,
        content: draftContent,
      })
      setSelectedFile(file)
      setEditing(false)
      setStatusMessage('File saved.')
      refreshTree()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingFile(false)
    }
  }

  const handleUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!uploadFile) {
      return
    }
    setUploadingFile(true)
    setError(null)
    setStatusMessage(null)
    try {
      const file = await uploadWorkspaceFile({
        sessionId,
        path: listing?.path || activePath,
        file: uploadFile,
      })
      setSelectedFile(file)
      setUploadFile(null)
      setUploadInputKey((value) => value + 1)
      setStatusMessage('File uploaded.')
      refreshTree()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploadingFile(false)
    }
  }

  const handleDeleteFile = async () => {
    if (!selectedFile) {
      return
    }
    const confirmed = window.confirm(`Delete ${selectedFile.path}?`)
    if (!confirmed) {
      return
    }

    setDeletingFile(true)
    setError(null)
    try {
      const deletedPath = selectedFile.path
      await deleteWorkspaceFile({ sessionId, path: deletedPath })
      setSelectedFile(null)
      setEditing(false)
      setDraftContent('')
      setStatusMessage(`Deleted ${deletedPath}.`)
      refreshTree()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeletingFile(false)
    }
  }

  const cancelEditing = () => {
    setDraftContent(selectedFile?.content || '')
    setEditing(false)
  }

  const canEditSelectedFile = Boolean(selectedFile && isEditableWorkspaceFile(selectedFile))
  const hasDraftChanges = Boolean(selectedFile && draftContent !== (selectedFile.content || ''))

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

        <form className="workspace-upload" onSubmit={(event) => void handleUpload(event)}>
          <span className="workspace-upload-label">
            Upload file
          </span>
          <div className="workspace-upload-row">
            <input
              key={uploadInputKey}
              id="workspace-upload-input"
              className="workspace-file-input"
              type="file"
              onChange={(event) => setUploadFile(event.currentTarget.files?.[0] || null)}
              disabled={uploadingFile}
            />
            <label className="workspace-file-picker" htmlFor="workspace-upload-input">
              Choose
            </label>
            <span className="workspace-file-name" title={uploadFile?.name || 'No file selected'}>
              {uploadFile?.name || 'No file selected'}
            </span>
            <button
              className="ghost-button workspace-upload-button"
              type="submit"
              disabled={!uploadFile || uploadingFile}
            >
              {uploadingFile ? 'Uploading...' : 'Upload'}
            </button>
          </div>
          {uploadFile && (
            <p className="workspace-upload-selection">
              {formatBytes(uploadFile.size)}
            </p>
          )}
        </form>

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
              <div className="workspace-document-heading">
                <h3>{selectedFile.path}</h3>
                <span>{selectedFile.contentType} · {formatBytes(selectedFile.size)}</span>
              </div>
              {canEditSelectedFile && (
                <div className="workspace-document-actions">
                  {editing ? (
                    <>
                      <button
                        className="ghost-button workspace-secondary-button"
                        type="button"
                        onClick={cancelEditing}
                        disabled={savingFile || deletingFile}
                      >
                        Cancel
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => void handleSaveFile()}
                        disabled={savingFile || deletingFile || !hasDraftChanges}
                      >
                        {savingFile ? 'Saving...' : 'Save'}
                      </button>
                    </>
                  ) : (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => setEditing(true)}
                      disabled={deletingFile}
                    >
                      Edit
                    </button>
                  )}
                </div>
              )}
              {!editing && (
                <div className="workspace-document-actions">
                  <a
                    className="ghost-button workspace-download-button"
                    href={buildWorkspaceDownloadUrl({ sessionId, path: selectedFile.path })}
                    download={fileNameFromPath(selectedFile.path)}
                  >
                    Download
                  </a>
                  <button
                    className="ghost-button workspace-danger-button"
                    type="button"
                    onClick={() => void handleDeleteFile()}
                    disabled={deletingFile}
                  >
                    {deletingFile ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              )}
            </div>
            {statusMessage && <div className="workspace-status">{statusMessage}</div>}
            {editing && canEditSelectedFile ? (
              <textarea
                className="workspace-editor"
                value={draftContent}
                onChange={(event) => setDraftContent(event.currentTarget.value)}
                spellCheck={false}
              />
            ) : (
              <WorkspaceFilePreview file={selectedFile} sessionId={sessionId} />
            )}
          </article>
        )}
      </div>
    </section>
  )
}

function isEditableWorkspaceFile(file: WorkspaceFile): boolean {
  return (file.contentType === 'markdown' || file.contentType === 'text') && file.content !== undefined
}

function fileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1) || 'download'
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
