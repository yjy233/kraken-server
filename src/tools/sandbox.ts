import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SessionSandboxConfig, SessionSandboxPolicy } from './types.js'
import { isRecord } from '../utils/helpers.js'

const DEFAULT_SENSITIVE_PATHS = [
  '~/.ssh',
  '~/.aws',
  '~/.gnupg',
  '~/.config/gcloud',
  '~/.config/gh',
  '~/Library/Keychains',
  '/etc',
  '/private/etc',
]

export function expandHomePath(inputPath: string): string {
  const value = inputPath.trim()
  if (!value) return value
  if (value === '~') return os.homedir()
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2))
  }
  return value
}

export function normalizeHostPath(inputPath: string): string {
  return path.resolve(expandHomePath(inputPath))
}

export function parseSensitivePaths(value: string | undefined): string[] {
  const raw = value && value.trim()
    ? value.split(',').map((item) => item.trim()).filter(Boolean)
    : DEFAULT_SENSITIVE_PATHS
  return Array.from(new Set(raw.map(normalizeHostPath)))
}

export function normalizeSessionSandboxConfig(value: unknown): SessionSandboxConfig | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const workspaceRoot = typeof value.workspaceRoot === 'string'
    ? value.workspaceRoot.trim()
    : ''

  const readRoots = Array.isArray(value.readRoots)
    ? value.readRoots
      .map((item) => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean)
    : []

  if (!workspaceRoot && readRoots.length === 0) {
    return undefined
  }

  const sandbox: SessionSandboxConfig = {}
  if (workspaceRoot) {
    sandbox.workspaceRoot = workspaceRoot
  }
  if (readRoots.length > 0) {
    sandbox.readRoots = readRoots
  }
  return sandbox
}

export function buildSessionSandboxPolicy(params: {
  sessionId: string
  sessionSandbox?: SessionSandboxConfig | undefined
  defaultWorkspaceRoot: string
  sensitivePaths: string[]
  enablePathSandbox: boolean
}): SessionSandboxPolicy {
  const workspaceRoot = normalizeHostPath(params.sessionSandbox?.workspaceRoot || params.defaultWorkspaceRoot)
  const readRoots = Array.from(new Set(
    (params.sessionSandbox?.readRoots || [])
      .map(normalizeHostPath)
      .filter((root) => root !== workspaceRoot)
  ))
  const sandboxDir = path.join(workspaceRoot, '.sandbox')
  const tmpDir = path.join(sandboxDir, 'tmp')
  const profileDir = path.join(sandboxDir, 'profiles')

  return {
    sessionId: params.sessionId,
    workspaceRoot,
    readMode: readRoots.length > 0 ? 'allowlist' : 'host-read',
    readRoots,
    writeRoots: [workspaceRoot],
    sensitiveRoots: Array.from(new Set(params.sensitivePaths.map(normalizeHostPath))),
    sandboxDir,
    tmpDir,
    profileDir,
    enablePathSandbox: params.enablePathSandbox,
  }
}

export async function ensureSandboxLayout(policy: SessionSandboxPolicy): Promise<void> {
  await fs.mkdir(policy.workspaceRoot, { recursive: true })
  await fs.mkdir(policy.tmpDir, { recursive: true })
  await fs.mkdir(policy.profileDir, { recursive: true })
}

export async function resolveSandboxPath(
  policy: SessionSandboxPolicy,
  inputPath: unknown,
  options: { mode: 'read' | 'write'; allowMissing?: boolean }
): Promise<string> {
  const raw = String(inputPath || '').trim()
  if (!raw) {
    throw new Error('path is required')
  }

  const expanded = expandHomePath(raw)
  const candidate = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(policy.workspaceRoot, expanded)
  const resolved = await canonicalizePath(candidate, Boolean(options.allowMissing))

  if (isSensitivePath(policy, resolved)) {
    throw new Error(`Access to sensitive path is blocked: ${raw}`)
  }

  if (options.mode === 'write') {
    if (!canWritePath(policy, resolved)) {
      throw new Error(`Write outside workspace is blocked: ${raw}`)
    }
    return resolved
  }

  if (!canReadPath(policy, resolved)) {
    throw new Error(`Read access is blocked by sandbox policy: ${raw}`)
  }
  return resolved
}

export function toDisplayPath(policy: SessionSandboxPolicy, targetPath: string): string {
  if (isWithinAnyRoot([policy.workspaceRoot], targetPath)) {
    const relative = path.relative(policy.workspaceRoot, targetPath)
    return relative || '.'
  }
  return targetPath
}

export function buildShellEnv(policy: SessionSandboxPolicy): Record<string, string> {
  return {
    PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: policy.workspaceRoot,
    TMPDIR: policy.tmpDir,
    LANG: process.env.LANG || 'en_US.UTF-8',
    LC_ALL: process.env.LC_ALL || process.env.LANG || 'en_US.UTF-8',
  }
}

export async function generateSeatbeltProfile(policy: SessionSandboxPolicy): Promise<string> {
  await ensureSandboxLayout(policy)

  const lines = [
    '(version 1)',
    '',
    '(deny default)',
    '(allow process*)',
    '(allow sysctl-read)',
    '(allow signal (target self))',
    '(allow file-read-metadata)',
    '(allow file-read* (subpath "/usr"))',
    '(allow file-read* (subpath "/bin"))',
    '(allow file-read* (subpath "/sbin"))',
    '(allow file-read* (subpath "/System"))',
    '(allow file-read* (literal "/dev/null"))',
    '(allow file-read* (literal "/dev/urandom"))',
    ...policy.writeRoots.map((root) => `(allow file-read* file-write* (subpath ${JSON.stringify(root)}))`),
  ]

  if (policy.readMode === 'allowlist') {
    for (const root of [policy.workspaceRoot, ...policy.readRoots]) {
      lines.push(`(allow file-read* (subpath ${JSON.stringify(root)}))`)
    }
  } else {
    lines.push('(allow file-read*)')
  }

  for (const sensitiveRoot of policy.sensitiveRoots) {
    lines.push(`(deny file-read* file-read-metadata (subpath ${JSON.stringify(sensitiveRoot)}))`)
  }

  const profilePath = path.join(policy.profileDir, `${sanitizeProfileName(policy.sessionId)}.sb`)
  await fs.writeFile(profilePath, lines.join('\n') + '\n', 'utf8')
  return profilePath
}

export function isWithinRoot(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root)
  const normalizedCandidate = path.resolve(candidate)
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(normalizedRoot + path.sep)
}

function canReadPath(policy: SessionSandboxPolicy, candidate: string): boolean {
  if (policy.readMode === 'host-read') {
    return true
  }
  return isWithinAnyRoot([policy.workspaceRoot, ...policy.readRoots], candidate)
}

function canWritePath(policy: SessionSandboxPolicy, candidate: string): boolean {
  return isWithinAnyRoot(policy.writeRoots, candidate)
}

function isSensitivePath(policy: SessionSandboxPolicy, candidate: string): boolean {
  return isWithinAnyRoot(policy.sensitiveRoots, candidate)
}

function isWithinAnyRoot(roots: string[], candidate: string): boolean {
  return roots.some((root) => isWithinRoot(root, candidate))
}

async function canonicalizePath(candidate: string, allowMissing: boolean): Promise<string> {
  try {
    return await fs.realpath(candidate)
  } catch (error) {
    if (!allowMissing || !isMissingPathError(error)) {
      throw error
    }
  }

  const missingParts: string[] = []
  let current = candidate

  while (!(await pathExists(current))) {
    const parent = path.dirname(current)
    if (parent === current) {
      throw new Error(`Path does not exist: ${candidate}`)
    }
    missingParts.unshift(path.basename(current))
    current = parent
  }

  const realExisting = await fs.realpath(current)
  return path.join(realExisting, ...missingParts)
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate)
    return true
  } catch {
    return false
  }
}

function isMissingPathError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function sanitizeProfileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_') || 'session'
}
