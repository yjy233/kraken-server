import { promises as fs } from 'node:fs'
import path from 'node:path'
import { buildSessionSandboxPolicy, resolveSandboxPath, toDisplayPath } from '../tools/sandbox.js'
import type { SessionSandboxConfig } from '../tools/types.js'

const MAX_FILE_BYTES = 2 * 1024 * 1024
const SKIPPED_NAMES = new Set([
  '.git',
  'node_modules',
  '.sessions',
  '.scheduled-jobs',
  'dist',
  '.sandbox',
])

export interface WorkspaceEntryRecord {
  name: string
  path: string
  kind: 'file' | 'directory'
  extension?: string
}

export interface WorkspaceDirectoryListing {
  workspaceRoot: string
  path: string
  exists: boolean
  entries: WorkspaceEntryRecord[]
}

export interface WorkspaceFileRecord {
  workspaceRoot: string
  path: string
  contentType: 'markdown' | 'text'
  content: string
}

export function createWorkspaceBrowserService(config: {
  defaultWorkspaceRoot: string
  sensitivePaths: string[]
  enablePathSandbox: boolean
}) {
  async function listDirectory(input: {
    path?: string
    sandbox?: SessionSandboxConfig | undefined
    sessionId?: string
  }): Promise<WorkspaceDirectoryListing> {
    const sandboxPolicy = buildSessionSandboxPolicy({
      sessionId: input.sessionId || 'workspace-browser',
      sessionSandbox: input.sandbox,
      defaultWorkspaceRoot: config.defaultWorkspaceRoot,
      sensitivePaths: config.sensitivePaths,
      enablePathSandbox: config.enablePathSandbox,
    })

    if (!(await exists(sandboxPolicy.workspaceRoot))) {
      return {
        workspaceRoot: sandboxPolicy.workspaceRoot,
        path: '.',
        exists: false,
        entries: [],
      }
    }

    const requestedPath = input.path || '.'
    const targetPath = await resolveSandboxPath(sandboxPolicy, requestedPath, { mode: 'read' })
    const stat = await fs.stat(targetPath)
    if (!stat.isDirectory()) {
      throw new Error('Requested path is not a directory')
    }

    const items = await fs.readdir(targetPath, { withFileTypes: true })
    const entries: WorkspaceEntryRecord[] = []

    for (const item of items) {
      if (SKIPPED_NAMES.has(item.name)) {
        continue
      }
      const absolutePath = path.join(targetPath, item.name)
      const displayPath = toDisplayPath(sandboxPolicy, absolutePath)
      const kind = item.isDirectory() ? 'directory' : 'file'
      const entry: WorkspaceEntryRecord = {
        name: item.name,
        path: displayPath,
        kind,
      }
      if (kind === 'file') {
        const extension = path.extname(item.name).toLowerCase()
        if (extension) {
          entry.extension = extension
        }
      }
      entries.push(entry)
    }

    entries.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'directory' ? -1 : 1
      }
      return left.name.localeCompare(right.name)
    })

    return {
      workspaceRoot: sandboxPolicy.workspaceRoot,
      path: toDisplayPath(sandboxPolicy, targetPath),
      exists: true,
      entries,
    }
  }

  async function readFile(input: {
    path: string
    sandbox?: SessionSandboxConfig | undefined
    sessionId?: string
  }): Promise<WorkspaceFileRecord> {
    const sandboxPolicy = buildSessionSandboxPolicy({
      sessionId: input.sessionId || 'workspace-browser',
      sessionSandbox: input.sandbox,
      defaultWorkspaceRoot: config.defaultWorkspaceRoot,
      sensitivePaths: config.sensitivePaths,
      enablePathSandbox: config.enablePathSandbox,
    })

    const targetPath = await resolveSandboxPath(sandboxPolicy, input.path, { mode: 'read' })
    const stat = await fs.stat(targetPath)
    if (!stat.isFile()) {
      throw new Error('Requested path is not a file')
    }
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error(`File is too large to preview (${stat.size} bytes)`)
    }

    const content = await fs.readFile(targetPath, 'utf8')
    const displayPath = toDisplayPath(sandboxPolicy, targetPath)

    return {
      workspaceRoot: sandboxPolicy.workspaceRoot,
      path: displayPath,
      contentType: isMarkdownFile(displayPath) ? 'markdown' : 'text',
      content,
    }
  }

  return {
    listDirectory,
    readFile,
  }
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

function isMarkdownFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase()
  return extension === '.md' || extension === '.markdown' || extension === '.mdx'
}
