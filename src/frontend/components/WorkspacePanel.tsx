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
            <h3>Markdown Preview</h3>
            <p>Select a Markdown file from the workspace tree to preview it here.</p>
          </div>
        )}
        {!loadingFile && selectedFile && (
          <article className="workspace-document">
            <div className="workspace-document-header">
              <h3>{selectedFile.path}</h3>
              <span>{selectedFile.contentType}</span>
            </div>
            {selectedFile.contentType === 'markdown' ? (
              <div
                className="workspace-markdown message-body"
                dangerouslySetInnerHTML={{ __html: marked.parse(selectedFile.content, { async: false, breaks: true, gfm: true }) as string }}
              />
            ) : (
              <pre className="workspace-text">{selectedFile.content}</pre>
            )}
          </article>
        )}
      </div>
    </section>
  )
}
