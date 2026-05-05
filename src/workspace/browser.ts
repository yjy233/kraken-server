import { promises as fs } from 'node:fs'
import path from 'node:path'
import { buildSessionSandboxPolicy, resolveSandboxPath, toDisplayPath } from '../tools/sandbox.js'
import type { SessionSandboxConfig } from '../tools/types.js'

const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

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
  contentType: 'markdown' | 'text' | 'image' | 'binary'
  content?: string
  size: number
  extension?: string
  mediaType?: string
}

export function createWorkspaceBrowserService(config: {
  defaultWorkspaceRoot: string
  sensitivePaths: string[]
  enablePathSandbox: boolean
}) {
  function buildPolicy(input: {
    sandbox?: SessionSandboxConfig | undefined
    sessionId?: string
  }) {
    return buildSessionSandboxPolicy({
      sessionId: input.sessionId || 'workspace-browser',
      sessionSandbox: input.sandbox,
      defaultWorkspaceRoot: config.defaultWorkspaceRoot,
      sensitivePaths: config.sensitivePaths,
      enablePathSandbox: config.enablePathSandbox,
    })
  }

  async function listDirectory(input: {
    path?: string
    sandbox?: SessionSandboxConfig | undefined
    sessionId?: string
  }): Promise<WorkspaceDirectoryListing> {
    const sandboxPolicy = buildPolicy(input)

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
    const sandboxPolicy = buildPolicy(input)

    const targetPath = await resolveSandboxPath(sandboxPolicy, input.path, { mode: 'read' })
    const stat = await fs.stat(targetPath)
    if (!stat.isFile()) {
      throw new Error('Requested path is not a file')
    }
    const displayPath = toDisplayPath(sandboxPolicy, targetPath)
    const extension = path.extname(displayPath).toLowerCase()
    const baseRecord: WorkspaceFileRecord = {
      workspaceRoot: sandboxPolicy.workspaceRoot,
      path: displayPath,
      contentType: inferWorkspaceContentType(displayPath),
      size: stat.size,
    }
    if (extension) {
      baseRecord.extension = extension
    }
    if (baseRecord.contentType === 'image') {
      const mediaType = imageMediaType(extension)
      if (mediaType) {
        baseRecord.mediaType = mediaType
      }
      return baseRecord
    }
    if (baseRecord.contentType === 'binary') {
      return baseRecord
    }
    if (stat.size > MAX_TEXT_FILE_BYTES) {
      return {
        ...baseRecord,
        contentType: 'binary',
      }
    }

    return {
      ...baseRecord,
      content: await fs.readFile(targetPath, 'utf8'),
    }
  }

  async function writeTextFile(input: {
    path: string
    content: string
    sandbox?: SessionSandboxConfig | undefined
    sessionId?: string
  }): Promise<WorkspaceFileRecord> {
    const sandboxPolicy = buildPolicy(input)
    const byteLength = Buffer.byteLength(input.content, 'utf8')
    if (byteLength > MAX_TEXT_FILE_BYTES) {
      throw new Error(`Text content exceeds ${formatBytes(MAX_TEXT_FILE_BYTES)} limit`)
    }

    const targetPath = await resolveSandboxPath(sandboxPolicy, input.path, { mode: 'write', allowMissing: true })
    await ensureWritableFileTarget(targetPath)
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, input.content, 'utf8')

    const outputInput: {
      path: string
      sandbox?: SessionSandboxConfig | undefined
      sessionId?: string
    } = {
      path: toDisplayPath(sandboxPolicy, targetPath),
    }
    if (input.sandbox !== undefined) {
      outputInput.sandbox = input.sandbox
    }
    if (input.sessionId) {
      outputInput.sessionId = input.sessionId
    }
    return readFile(outputInput)
  }

  async function uploadFile(input: {
    directoryPath?: string
    fileName: string
    content: Uint8Array
    sandbox?: SessionSandboxConfig | undefined
    sessionId?: string
  }): Promise<WorkspaceFileRecord> {
    const sandboxPolicy = buildPolicy(input)
    const fileName = normalizeUploadedFileName(input.fileName)
    const targetPathInput = path.join(input.directoryPath || '.', fileName)
    const targetPath = await resolveSandboxPath(sandboxPolicy, targetPathInput, { mode: 'write', allowMissing: true })
    await ensureWritableFileTarget(targetPath)
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, input.content)

    const outputInput: {
      path: string
      sandbox?: SessionSandboxConfig | undefined
      sessionId?: string
    } = {
      path: toDisplayPath(sandboxPolicy, targetPath),
    }
    if (input.sandbox !== undefined) {
      outputInput.sandbox = input.sandbox
    }
    if (input.sessionId) {
      outputInput.sessionId = input.sessionId
    }
    return readFile(outputInput)
  }

  async function deleteFile(input: {
    path: string
    sandbox?: SessionSandboxConfig | undefined
    sessionId?: string
  }): Promise<{ workspaceRoot: string; path: string }> {
    const sandboxPolicy = buildPolicy(input)
    const targetPath = await resolveSandboxPath(sandboxPolicy, input.path, { mode: 'write' })
    const stat = await fs.stat(targetPath)
    if (!stat.isFile()) {
      throw new Error('Requested path is not a file')
    }
    const displayPath = toDisplayPath(sandboxPolicy, targetPath)
    await fs.unlink(targetPath)
    return {
      workspaceRoot: sandboxPolicy.workspaceRoot,
      path: displayPath,
    }
  }

  return {
    listDirectory,
    readFile,
    writeTextFile,
    uploadFile,
    deleteFile,
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

async function ensureWritableFileTarget(targetPath: string): Promise<void> {
  try {
    const stat = await fs.stat(targetPath)
    if (stat.isDirectory()) {
      throw new Error('Target path is a directory')
    }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }
}

function normalizeUploadedFileName(value: string): string {
  const fileName = path.basename(value.replace(/\\/g, '/').replace(/\0/g, '')).trim()
  if (!fileName || fileName === '.' || fileName === '..') {
    throw new Error('filename is required')
  }
  return fileName
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function formatBytes(value: number): string {
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

function isMarkdownFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase()
  return extension === '.md' || extension === '.markdown' || extension === '.mdx'
}

function inferWorkspaceContentType(filePath: string): WorkspaceFileRecord['contentType'] {
  const extension = path.extname(filePath).toLowerCase()
  if (isMarkdownFile(filePath)) {
    return 'markdown'
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image'
  }
  if (isLikelyTextFile(extension)) {
    return 'text'
  }
  return 'binary'
}

function imageMediaType(extension: string): string | undefined {
  switch (extension) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    default:
      return undefined
  }
}

function isLikelyTextFile(extension: string): boolean {
  if (!extension) {
    return true
  }
  return new Set([
    '.txt',
    '.json',
    '.jsonl',
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.mjs',
    '.cjs',
    '.css',
    '.scss',
    '.sass',
    '.less',
    '.html',
    '.htm',
    '.xml',
    '.svg',
    '.yml',
    '.yaml',
    '.toml',
    '.ini',
    '.env',
    '.sh',
    '.bash',
    '.zsh',
    '.py',
    '.rb',
    '.go',
    '.rs',
    '.java',
    '.c',
    '.h',
    '.cpp',
    '.hpp',
    '.cs',
    '.php',
    '.sql',
    '.csv',
    '.tsv',
    '.log',
    '.gitignore',
    '.dockerignore',
  ]).has(extension)
}
