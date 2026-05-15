import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateSkillDir, normalizeSkillName } from '../skills/authoring.js'
import { expandHomePath, isRecord } from '../utils/helpers.js'
import type { ProposalStore } from './proposal-store.js'
import type {
  EvolutionProposal,
  ProposalApplyResult,
  ProposalApplyValidation,
  WorkspaceAgentsProposalPayload,
  WorkspaceMemoryProposalEntry,
  WorkspaceMemoryProposalPayload,
  WorkspaceSkillCreateProposalPayload,
  WorkspaceSkillPatchProposalPayload,
  WorkspaceSkillProposalFile,
} from './types.js'

const MEMORY_START = '<!-- kraken-memory:start -->'
const MEMORY_END = '<!-- kraken-memory:end -->'
const USED_PROPOSALS_HEADING = '## Applied Proposals'
const MAX_PROPOSAL_TEXT_LENGTH = 12000
const MAX_SKILL_FILE_BYTES = 1024 * 1024
const ALLOWED_SKILL_TOP_LEVEL = new Set(['SKILL.md', 'references', 'scripts', 'assets'])

export interface ApplyEvolutionProposalInput {
  proposalStore: ProposalStore
  proposalId: string
  workspaceRoot: string
  dryRun?: boolean
  appliedBy?: string
  refreshSkills?: (extraDirs?: string[]) => unknown
}

export interface ApplyEvolutionProposalOutput {
  proposal: EvolutionProposal
  dryRun: boolean
  changedFiles: string[]
  preview: string
  validation: ProposalApplyValidation[]
  auditPath?: string
}

interface AdapterApplyInput {
  proposal: EvolutionProposal
  workspaceRoot: string
  dryRun: boolean
  appliedAt: string
  appliedBy?: string
}

interface AdapterApplyOutput {
  adapter: ProposalApplyResult['adapter']
  changedFiles: string[]
  preview: string
  validation: ProposalApplyValidation[]
  auditBefore: Record<string, string>
  auditAfter: Record<string, string>
}

export async function applyEvolutionProposal(input: ApplyEvolutionProposalInput): Promise<ApplyEvolutionProposalOutput> {
  const proposal = await input.proposalStore.get(input.proposalId)
  if (!proposal) {
    throw new Error('Proposal not found')
  }
  if (proposal.status !== 'accepted') {
    throw new Error('Only accepted proposals can be applied')
  }

  const workspaceRoot = resolveWorkspaceRoot(input.workspaceRoot)
  const dryRun = Boolean(input.dryRun)
  const appliedAt = new Date().toISOString()

  try {
    const adapterInput: AdapterApplyInput = {
      proposal,
      workspaceRoot,
      dryRun,
      appliedAt,
    }
    if (input.appliedBy) {
      adapterInput.appliedBy = input.appliedBy
    }
    const adapterResult = await runAdapter(adapterInput)

    let auditPath: string | undefined
    if (!dryRun) {
      const auditInput: {
        proposal: EvolutionProposal
        workspaceRoot: string
        appliedAt: string
        appliedBy?: string
        adapterResult: AdapterApplyOutput
      } = {
        proposal,
        workspaceRoot,
        appliedAt,
        adapterResult,
      }
      if (input.appliedBy) {
        auditInput.appliedBy = input.appliedBy
      }
      auditPath = await writeApplyAudit(auditInput)
      input.refreshSkills?.(adapterResult.adapter === 'workspace_skill'
        ? [safeJoin(workspaceRoot, 'skills')]
        : undefined)
    }

    const applyResult: ProposalApplyResult = {
      ok: true,
      adapter: adapterResult.adapter,
      changedFiles: adapterResult.changedFiles,
      validation: adapterResult.validation,
      preview: adapterResult.preview,
      appliedAt,
    }
    if (auditPath) {
      applyResult.auditPath = auditPath
    }
    if (input.appliedBy) {
      applyResult.appliedBy = input.appliedBy
    }

    const nextProposal = dryRun
      ? proposal
      : await input.proposalStore.markApplied({
        id: proposal.id,
        applyResult,
      })

    return {
      proposal: nextProposal,
      dryRun,
      changedFiles: adapterResult.changedFiles,
      preview: adapterResult.preview,
      validation: adapterResult.validation,
      ...(auditPath ? { auditPath } : {}),
    }
  } catch (error) {
    if (!dryRun) {
      const appliedAtFailed = new Date().toISOString()
      const failedResult: ProposalApplyResult = {
        ok: false,
        adapter: adapterForProposal(proposal),
        changedFiles: [],
        validation: [],
        preview: '',
        error: error instanceof Error ? error.message : String(error),
        appliedAt: appliedAtFailed,
      }
      if (input.appliedBy) {
        failedResult.appliedBy = input.appliedBy
      }
      await input.proposalStore.markApplyFailed({
        id: proposal.id,
        applyResult: failedResult,
      })
    }
    throw error
  }
}

async function runAdapter(input: AdapterApplyInput): Promise<AdapterApplyOutput> {
  if (input.proposal.type === 'memory_write' || input.proposal.type === 'memory_merge') {
    return applyWorkspaceMemory(input)
  }
  if (input.proposal.type === 'agents_patch') {
    return applyWorkspaceAgents(input)
  }
  if (input.proposal.type === 'skill_create' || input.proposal.type === 'skill_patch') {
    return applyWorkspaceSkill(input)
  }
  throw new Error(`Proposal type is not supported by apply: ${input.proposal.type}`)
}

function adapterForProposal(proposal: EvolutionProposal): ProposalApplyResult['adapter'] {
  if (proposal.type === 'agents_patch') {
    return 'workspace_agents'
  }
  if (proposal.type === 'skill_create' || proposal.type === 'skill_patch') {
    return 'workspace_skill'
  }
  return 'workspace_memory'
}

async function applyWorkspaceMemory(input: AdapterApplyInput): Promise<AdapterApplyOutput> {
  const payload = parseWorkspaceMemoryPayload(input.proposal)
  const memoryDir = safeJoin(input.workspaceRoot, 'memories')
  const memoryPath = safeJoin(memoryDir, 'MEMORY.md')
  const usedPath = safeJoin(memoryDir, 'USED.md')
  const beforeMemory = await readTextIfExists(memoryPath)
  const beforeUsed = await readTextIfExists(usedPath)
  const memoryEntries = payload.entries.filter((entry) => (entry.target || defaultMemoryTarget(payload)) === 'MEMORY.md')
  const usedEntries = payload.entries.filter((entry) => (entry.target || defaultMemoryTarget(payload)) === 'USED.md')
  const nextMemory = renderMemoryFile(beforeMemory, memoryEntries, input.proposal, input.appliedAt)
  const nextUsed = renderUsedFile(beforeUsed, usedEntries, input.proposal, input.appliedAt, input.appliedBy, [
    ...(nextMemory !== beforeMemory ? ['memories/MEMORY.md'] : []),
    'memories/USED.md',
  ])
  const changedFiles: string[] = []
  const before: Record<string, string> = {}
  const after: Record<string, string> = {}

  if (nextMemory !== beforeMemory) {
    changedFiles.push('memories/MEMORY.md')
    before['memories/MEMORY.md'] = beforeMemory
    after['memories/MEMORY.md'] = nextMemory
  }
  if (nextUsed !== beforeUsed) {
    changedFiles.push('memories/USED.md')
    before['memories/USED.md'] = beforeUsed
    after['memories/USED.md'] = nextUsed
  }

  const validation = validateTextMap(after)
  if (changedFiles.length === 0) {
    validation.push({ name: 'memory_noop', ok: true, output: 'No new memory entries to apply.' })
  }
  throwIfValidationFailed(validation)

  if (!input.dryRun) {
    await fs.mkdir(memoryDir, { recursive: true })
    if (nextMemory !== beforeMemory) {
      await writeAtomic(memoryPath, nextMemory)
    }
    if (nextUsed !== beforeUsed) {
      await writeAtomic(usedPath, nextUsed)
    }
  }

  return {
    adapter: 'workspace_memory',
    changedFiles,
    preview: buildPreview(before, after),
    validation,
    auditBefore: before,
    auditAfter: after,
  }
}

function parseWorkspaceMemoryPayload(proposal: EvolutionProposal): WorkspaceMemoryProposalPayload {
  const rawPayload = normalizePayload(proposal)
  if (
    isRecord(rawPayload) &&
    rawPayload.adapter === 'workspace_memory' &&
    Array.isArray(rawPayload.entries)
  ) {
    const entries = rawPayload.entries
      .map(normalizeMemoryEntry)
      .filter((entry): entry is WorkspaceMemoryProposalEntry => Boolean(entry))
    if (entries.length > 0) {
      return {
        adapter: 'workspace_memory',
        operation: rawPayload.operation === 'append_used' || rawPayload.operation === 'merge_memory'
          ? rawPayload.operation
          : 'append_memory',
        entries,
      }
    }
  }

  const text = proposal.suggestedChange.trim() || proposal.rationale.trim() || proposal.title.trim()
  if (!text) {
    throw new Error('memory proposal has no content to apply')
  }
  return {
    adapter: 'workspace_memory',
    operation: 'append_memory',
    entries: [{
      target: 'MEMORY.md',
      kind: proposal.type === 'memory_merge' ? 'fact' : 'procedure',
      text,
      tags: [proposal.type],
    }],
  }
}

function normalizeMemoryEntry(value: unknown): WorkspaceMemoryProposalEntry | null {
  if (!isRecord(value)) {
    return null
  }
  const text = typeof value.text === 'string' ? value.text.trim() : ''
  if (!text) {
    return null
  }
  const entry: WorkspaceMemoryProposalEntry = { text: text.slice(0, MAX_PROPOSAL_TEXT_LENGTH) }
  if (value.target === 'MEMORY.md' || value.target === 'USED.md') {
    entry.target = value.target
  }
  if (
    value.kind === 'preference' ||
    value.kind === 'fact' ||
    value.kind === 'decision' ||
    value.kind === 'procedure' ||
    value.kind === 'failure' ||
    value.kind === 'todo' ||
    value.kind === 'artifact'
  ) {
    entry.kind = value.kind
  }
  if (Array.isArray(value.tags)) {
    entry.tags = value.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12)
  }
  return entry
}

function defaultMemoryTarget(payload: WorkspaceMemoryProposalPayload): 'MEMORY.md' | 'USED.md' {
  return payload.operation === 'append_used' ? 'USED.md' : 'MEMORY.md'
}

function renderMemoryFile(
  before: string,
  entries: WorkspaceMemoryProposalEntry[],
  proposal: EvolutionProposal,
  appliedAt: string
): string {
  if (entries.length === 0) {
    return before
  }
  const base = ensureMemoryMarkers(before)
  const insertion = entries
    .filter((entry) => !hasMemoryText(base, entry.text))
    .map((entry) => renderMemoryEntry(entry, proposal, appliedAt))
    .join('\n')
  if (!insertion) {
    return before
  }
  return base.replace(MEMORY_END, `${insertion}\n${MEMORY_END}`)
}

function ensureMemoryMarkers(value: string): string {
  const trimmed = value.trim()
  if (value.includes(MEMORY_START) && value.includes(MEMORY_END)) {
    return value.endsWith('\n') ? value : `${value}\n`
  }
  const prefix = trimmed ? `${trimmed}\n\n` : '# Workspace Memory\n\n'
  return `${prefix}${MEMORY_START}\n\n${MEMORY_END}\n`
}

function hasMemoryText(content: string, text: string): boolean {
  return normalizeComparable(content).includes(normalizeComparable(text))
}

function renderMemoryEntry(entry: WorkspaceMemoryProposalEntry, proposal: EvolutionProposal, appliedAt: string): string {
  const kind = entry.kind || 'fact'
  const tags = Array.from(new Set([...(entry.tags || []), proposal.type])).join(',')
  const id = `mem_${dateStamp(appliedAt)}_${shortHash(`${kind}:${entry.text}`)}`
  return [
    `## ${kind}`,
    '',
    `<!-- id: ${id}; tags: ${tags}; source: proposal:${proposal.id} -->`,
    `- ${singleLine(entry.text)}`,
    '',
  ].join('\n')
}

function renderUsedFile(
  before: string,
  usedEntries: WorkspaceMemoryProposalEntry[],
  proposal: EvolutionProposal,
  appliedAt: string,
  appliedBy: string | undefined,
  changedFiles: string[]
): string {
  if (before.includes(`<!-- proposal:${proposal.id} -->`)) {
    return before
  }
  const base = ensureUsedHeading(before)
  const explicitNotes = usedEntries.length > 0
    ? [
      '- notes:',
      ...usedEntries.map((entry) => `  - ${singleLine(entry.text)}`),
    ]
    : []
  const block = [
    `<!-- proposal:${proposal.id} -->`,
    `- appliedAt: ${appliedAt}`,
    `- type: ${proposal.type}`,
    `- appliedBy: ${appliedBy || 'web'}`,
    '- changedFiles:',
    ...changedFiles.map((file) => `  - ${file}`),
    ...explicitNotes,
    '',
  ].join('\n')
  return `${base.trimEnd()}\n\n${block}`
}

function ensureUsedHeading(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return `# Workspace Memory Usage\n\n${USED_PROPOSALS_HEADING}\n`
  }
  if (trimmed.includes(USED_PROPOSALS_HEADING)) {
    return value.endsWith('\n') ? value : `${value}\n`
  }
  return `${trimmed}\n\n${USED_PROPOSALS_HEADING}\n`
}

async function applyWorkspaceAgents(input: AdapterApplyInput): Promise<AdapterApplyOutput> {
  const payload = parseWorkspaceAgentsPayload(input.proposal)
  const agentsPath = safeJoin(input.workspaceRoot, 'AGENTS.md')
  const beforeAgents = await readTextIfExists(agentsPath)
  const nextAgents = renderAgentsFile(beforeAgents, payload, input.proposal, input.appliedAt)
  const before: Record<string, string> = {}
  const after: Record<string, string> = {}
  const changedFiles: string[] = []

  if (nextAgents !== beforeAgents) {
    changedFiles.push('AGENTS.md')
    before['AGENTS.md'] = beforeAgents
    after['AGENTS.md'] = nextAgents
  }

  const validation = validateTextMap(after)
  if (changedFiles.length === 0) {
    validation.push({ name: 'agents_noop', ok: true, output: 'No AGENTS.md changes to apply.' })
  }
  throwIfValidationFailed(validation)

  if (!input.dryRun && nextAgents !== beforeAgents) {
    await assertNoSymlinkPath(agentsPath)
    await writeAtomic(agentsPath, nextAgents)
  }

  return {
    adapter: 'workspace_agents',
    changedFiles,
    preview: buildPreview(before, after),
    validation,
    auditBefore: before,
    auditAfter: after,
  }
}

function parseWorkspaceAgentsPayload(proposal: EvolutionProposal): WorkspaceAgentsProposalPayload {
  const rawPayload = normalizePayload(proposal)
  if (
    isRecord(rawPayload) &&
    rawPayload.adapter === 'workspace_agents' &&
    typeof rawPayload.content === 'string'
  ) {
    const operation = rawPayload.operation === 'replace_section' || rawPayload.operation === 'replace_file'
      ? rawPayload.operation
      : 'append_section'
    const payload: WorkspaceAgentsProposalPayload = {
      adapter: 'workspace_agents',
      operation,
      content: rawPayload.content.slice(0, MAX_PROPOSAL_TEXT_LENGTH),
    }
    if (typeof rawPayload.heading === 'string' && rawPayload.heading.trim()) {
      payload.heading = normalizeAgentsHeading(rawPayload.heading)
    }
    return payload
  }

  const content = proposal.suggestedChange.trim() || proposal.rationale.trim() || proposal.title.trim()
  if (!content) {
    throw new Error('agents proposal has no content to apply')
  }
  return {
    adapter: 'workspace_agents',
    operation: 'append_section',
    heading: proposal.title,
    content,
  }
}

function renderAgentsFile(
  before: string,
  payload: WorkspaceAgentsProposalPayload,
  proposal: EvolutionProposal,
  appliedAt: string
): string {
  const content = payload.content.trim()
  if (!content) {
    return before
  }
  if (payload.operation === 'replace_file') {
    return ensureTrailingNewline(content)
  }

  const heading = normalizeAgentsHeading(payload.heading || 'Self Improvement Notes')
  const section = renderAgentsSection(heading, content, proposal, appliedAt)
  if (!before.trim()) {
    return `# Repository Guidelines\n\n${section}`
  }
  if (hasMemoryText(before, content)) {
    return before
  }
  if (payload.operation === 'replace_section') {
    return replaceAgentsSection(before, heading, section)
  }
  return `${before.trimEnd()}\n\n${section}`
}

function renderAgentsSection(
  heading: string,
  content: string,
  proposal: EvolutionProposal,
  appliedAt: string
): string {
  return [
    `## ${heading}`,
    '',
    `<!-- proposal:${proposal.id}; appliedAt:${appliedAt} -->`,
    content,
    '',
  ].join('\n')
}

function replaceAgentsSection(before: string, heading: string, section: string): string {
  const lines = before.split(/\r?\n/)
  const startIndex = lines.findIndex((line) => /^##\s+/.test(line) && normalizeAgentsHeading(line) === heading)
  if (startIndex >= 0) {
    let endIndex = lines.length
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      if (/^##\s+/.test(lines[index] || '')) {
        endIndex = index
        break
      }
    }
    const nextLines = [
      ...lines.slice(0, startIndex),
      ...section.trimEnd().split('\n'),
      '',
      ...lines.slice(endIndex),
    ]
    return ensureTrailingNewline(nextLines.join('\n'))
  }
  return `${before.trimEnd()}\n\n${section}`
}

function normalizeAgentsHeading(value: string): string {
  const normalized = singleLine(value)
    .replace(/^#+\s*/, '')
    .slice(0, 120)
  return normalized || 'Self Improvement Notes'
}

async function applyWorkspaceSkill(input: AdapterApplyInput): Promise<AdapterApplyOutput> {
  const payload = parseWorkspaceSkillPayload(input.proposal)
  const skillsRoot = safeJoin(input.workspaceRoot, 'skills')
  const skillName = normalizeSkillName(payload.skillName)
  const skillDir = safeJoin(skillsRoot, skillName)
  const usagePath = safeJoin(skillsRoot, '.usage.json')
  const skillExists = await isDirectory(skillDir)

  if (payload.operation === 'create_skill' && skillExists && !payload.force) {
    throw new Error(`Skill already exists: ${skillName}`)
  }
  if (payload.operation === 'patch_skill' && !skillExists) {
    throw new Error(`Skill does not exist: ${skillName}`)
  }

  await assertNoSymlinkPath(skillsRoot)
  if (skillExists) {
    await assertNoSymlinkPath(skillDir)
  }

  const before = await readSkillFilesForAudit(skillDir)
  const stageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kraken-skill-apply-'))
  const stagedSkillDir = path.join(stageRoot, skillName)
  try {
    if (skillExists && payload.operation === 'patch_skill') {
      await fs.cp(skillDir, stagedSkillDir, { recursive: true })
    } else {
      await fs.mkdir(stagedSkillDir, { recursive: true })
    }

    for (const file of payload.files) {
      await applySkillFile(stagedSkillDir, file)
    }

    const validation = await validateStagedSkill(stagedSkillDir, skillName)
    throwIfValidationFailed(validation)

    const stagedFiles = await readSkillFilesForAudit(stagedSkillDir)
    const after = prefixAuditFiles(`skills/${skillName}`, stagedFiles)
    const beforePrefixed = prefixAuditFiles(`skills/${skillName}`, before)
    const changedFiles = diffFileNames(beforePrefixed, after)
    const usageBefore = await readTextIfExists(usagePath)
    const usageAfter = renderSkillUsage(usageBefore, skillName, input.proposal, input.appliedAt, payload.operation)

    if (usageAfter !== usageBefore) {
      beforePrefixed['skills/.usage.json'] = usageBefore
      after['skills/.usage.json'] = usageAfter
      changedFiles.push('skills/.usage.json')
    }

    if (!input.dryRun) {
      await fs.mkdir(skillsRoot, { recursive: true })
      if (payload.operation === 'create_skill' && skillExists && payload.force) {
        await fs.rm(skillDir, { recursive: true, force: true })
      }
      if (payload.operation === 'create_skill') {
        await fs.cp(stagedSkillDir, skillDir, { recursive: true })
      } else {
        for (const file of payload.files) {
          const relative = normalizeSkillRelativePath(file.path)
          const source = safeJoin(stagedSkillDir, relative)
          const target = safeJoin(skillDir, relative)
          await fs.mkdir(path.dirname(target), { recursive: true })
          await writeAtomic(target, await fs.readFile(source, 'utf8'))
        }
      }
      await writeAtomic(usagePath, usageAfter)
    }

    return {
      adapter: 'workspace_skill',
      changedFiles: Array.from(new Set(changedFiles)).sort(),
      preview: buildPreview(beforePrefixed, after),
      validation,
      auditBefore: beforePrefixed,
      auditAfter: after,
    }
  } finally {
    await fs.rm(stageRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

type WorkspaceSkillPayload = WorkspaceSkillCreateProposalPayload | WorkspaceSkillPatchProposalPayload

function parseWorkspaceSkillPayload(proposal: EvolutionProposal): WorkspaceSkillPayload {
  const rawPayload = normalizePayload(proposal)
  if (
    isRecord(rawPayload) &&
    rawPayload.adapter === 'workspace_skill' &&
    (rawPayload.operation === 'create_skill' || rawPayload.operation === 'patch_skill') &&
    typeof rawPayload.skillName === 'string' &&
    Array.isArray(rawPayload.files)
  ) {
    const files = rawPayload.files.map(normalizeSkillFile).filter((file): file is WorkspaceSkillProposalFile => Boolean(file))
    if (files.length === 0) {
      throw new Error('skill proposal payload must include files')
    }
    const base = {
      adapter: 'workspace_skill' as const,
      operation: rawPayload.operation,
      skillName: rawPayload.skillName,
      files,
    }
    if (rawPayload.operation === 'create_skill') {
      return {
        ...base,
        operation: 'create_skill',
        description: typeof rawPayload.description === 'string' ? rawPayload.description : proposal.title,
        force: Boolean(rawPayload.force),
      }
    }
    return {
      ...base,
      operation: 'patch_skill',
    }
  }

  if (proposal.type === 'skill_create') {
    const skillName = normalizeSkillName(slugify(proposal.title.replace(/^consider\s+/i, '').replace(/^create\s+/i, '')) || `skill-${shortHash(proposal.id)}`)
    const description = singleLine(proposal.rationale || proposal.title).slice(0, 240) || `Skill created from proposal ${proposal.id}`
    return {
      adapter: 'workspace_skill',
      operation: 'create_skill',
      skillName,
      description,
      files: [{
        path: 'SKILL.md',
        mode: 'replace',
        content: buildSkillMarkdown(skillName, description, proposal.suggestedChange),
      }],
    }
  }

  throw new Error('skill_patch requires a structured workspace_skill payload')
}

function normalizePayload(proposal: EvolutionProposal): unknown {
  if (proposal.payload && isRecord(proposal.payload)) {
    return proposal.payload
  }
  for (const value of [proposal.suggestedChange, proposal.patch]) {
    if (!value || !value.trim().startsWith('{')) {
      continue
    }
    try {
      return JSON.parse(value)
    } catch {
      continue
    }
  }
  return undefined
}

function normalizeSkillFile(value: unknown): WorkspaceSkillProposalFile | null {
  if (!isRecord(value) || typeof value.path !== 'string') {
    return null
  }
  const mode = value.mode === 'append' || value.mode === 'apply_patch' ? value.mode : 'replace'
  const file: WorkspaceSkillProposalFile = {
    path: value.path,
    mode,
  }
  if (typeof value.content === 'string') {
    file.content = value.content
  }
  if (typeof value.patch === 'string') {
    file.patch = value.patch
  }
  return file
}

async function applySkillFile(skillDir: string, file: WorkspaceSkillProposalFile): Promise<void> {
  const relative = normalizeSkillRelativePath(file.path)
  const target = safeJoin(skillDir, relative)
  await assertWritableSkillPath(skillDir, target)

  if (file.mode === 'apply_patch') {
    throw new Error('skill apply_patch mode is not implemented yet; use replace or append')
  }
  if (typeof file.content !== 'string') {
    throw new Error(`content is required for skill file: ${relative}`)
  }
  if (Buffer.byteLength(file.content, 'utf8') > MAX_SKILL_FILE_BYTES) {
    throw new Error(`skill file exceeds size limit: ${relative}`)
  }
  assertSafeContent(file.content)
  await fs.mkdir(path.dirname(target), { recursive: true })
  if (file.mode === 'append') {
    const before = await readTextIfExists(target)
    await fs.writeFile(target, `${before}${before.endsWith('\n') || !before ? '' : '\n'}${file.content}`, 'utf8')
    return
  }
  await fs.writeFile(target, file.content, 'utf8')
}

function normalizeSkillRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) {
    throw new Error(`Invalid skill file path: ${value}`)
  }
  const parts = normalized.split('/').filter(Boolean)
  const first = parts[0]
  if (!first || !ALLOWED_SKILL_TOP_LEVEL.has(first)) {
    throw new Error(`Skill file path is not allowed: ${value}`)
  }
  if (parts.some((part) => part.startsWith('.') && part !== '.usage.json')) {
    throw new Error(`Hidden skill file paths are not allowed: ${value}`)
  }
  if (first === 'SKILL.md' && parts.length !== 1) {
    throw new Error(`Invalid SKILL.md path: ${value}`)
  }
  return parts.join(path.sep)
}

async function assertWritableSkillPath(skillDir: string, target: string): Promise<void> {
  if (!isWithinRoot(skillDir, target)) {
    throw new Error('Skill file path escapes skill directory')
  }
  const existing = await safeLstat(target)
  if (existing?.isSymbolicLink()) {
    throw new Error(`Refusing to write through symlink: ${target}`)
  }
}

async function validateStagedSkill(skillDir: string, expectedName: string): Promise<ProposalApplyValidation[]> {
  const validation = await validateSkillDir(skillDir)
  const results: ProposalApplyValidation[] = [{
    name: 'skill_validate',
    ok: validation.valid,
    output: [
      ...validation.errors.map((error) => `Error: ${error}`),
      ...validation.warnings.map((warning) => `Warning: ${warning}`),
      validation.valid ? 'Skill validation passed.' : '',
    ].filter(Boolean).join('\n'),
  }]
  if (validation.skill?.name && validation.skill.name !== expectedName) {
    results.push({
      name: 'skill_name_match',
      ok: false,
      output: `SKILL.md name ${validation.skill.name} does not match target ${expectedName}.`,
    })
  } else {
    results.push({
      name: 'skill_name_match',
      ok: true,
      output: `Skill name matches ${expectedName}.`,
    })
  }
  return results
}

function buildSkillMarkdown(skillName: string, description: string, suggestedChange: string): string {
  const body = suggestedChange.trim() || `Use this skill for ${skillName}.`
  return [
    '---',
    `name: ${skillName}`,
    `description: ${description.replace(/\n/g, ' ').trim()}`,
    '---',
    '',
    `# ${titleCase(skillName)}`,
    '',
    '## Overview',
    '',
    body,
    '',
    '## Workflow',
    '',
    '1. Confirm the request matches this skill.',
    '2. Follow the relevant procedure from the overview or references.',
    '3. Keep outputs concise and verify changed files when applicable.',
    '',
  ].join('\n')
}

async function readSkillFilesForAudit(skillDir: string): Promise<Record<string, string>> {
  if (!await isDirectory(skillDir)) {
    return {}
  }
  const files: Record<string, string> = {}
  await visitFiles(skillDir, async (filePath) => {
    const relative = path.relative(skillDir, filePath)
    if (relative.split(path.sep).some((part) => part.startsWith('.'))) {
      return
    }
    files[relative] = await fs.readFile(filePath, 'utf8').catch(() => '')
  })
  return files
}

async function visitFiles(root: string, visitor: (filePath: string) => Promise<void>): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      await visitFiles(fullPath, visitor)
    } else if (entry.isFile()) {
      await visitor(fullPath)
    }
  }
}

function prefixAuditFiles(prefix: string, files: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [file, content] of Object.entries(files)) {
    result[path.posix.join(prefix, file.replace(/\\/g, '/'))] = content
  }
  return result
}

function diffFileNames(before: Record<string, string>, after: Record<string, string>): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)])
  return Array.from(names)
    .filter((name) => (before[name] || '') !== (after[name] || ''))
    .sort()
}

function renderSkillUsage(
  before: string,
  skillName: string,
  proposal: EvolutionProposal,
  appliedAt: string,
  operation: WorkspaceSkillPayload['operation']
): string {
  let data: Record<string, any> = {}
  if (before.trim()) {
    try {
      const parsed = JSON.parse(before)
      if (isRecord(parsed)) {
        data = parsed
      }
    } catch {
      data = {}
    }
  }
  const existing = isRecord(data[skillName]) ? data[skillName] : {}
  data[skillName] = {
    ...existing,
    state: existing.state || 'active',
    pinned: Boolean(existing.pinned),
    ...(operation === 'create_skill' && !existing.createdAt
      ? {
          createdAt: appliedAt,
          createdByProposalId: proposal.id,
        }
      : {}),
    lastPatchedAt: appliedAt,
    lastPatchedByProposalId: proposal.id,
    patchCount: Number(existing.patchCount || 0) + 1,
  }
  return `${JSON.stringify(data, null, 2)}\n`
}

async function writeApplyAudit(input: {
  proposal: EvolutionProposal
  workspaceRoot: string
  appliedAt: string
  appliedBy?: string
  adapterResult: AdapterApplyOutput
}): Promise<string> {
  const auditDir = safeJoin(input.workspaceRoot, '.memory', 'apply-audit')
  await fs.mkdir(auditDir, { recursive: true })
  const relativePath = path.posix.join('.memory', 'apply-audit', `${input.proposal.id}.json`)
  const auditPath = safeJoin(input.workspaceRoot, relativePath)
  const audit = {
    proposalId: input.proposal.id,
    type: input.proposal.type,
    appliedAt: input.appliedAt,
    appliedBy: input.appliedBy || 'web',
    workspaceRoot: input.workspaceRoot,
    adapter: input.adapterResult.adapter,
    changedFiles: input.adapterResult.changedFiles,
    before: input.adapterResult.auditBefore,
    after: input.adapterResult.auditAfter,
    validation: input.adapterResult.validation,
    revertInstructions: 'Restore the before content for each changed file.',
  }
  await writeAtomic(auditPath, `${JSON.stringify(audit, null, 2)}\n`)
  return relativePath
}

function validateTextMap(files: Record<string, string>): ProposalApplyValidation[] {
  const validation: ProposalApplyValidation[] = []
  for (const [file, content] of Object.entries(files)) {
    try {
      assertSafeContent(content)
      validation.push({ name: `scan:${file}`, ok: true, output: 'ok' })
    } catch (error) {
      validation.push({
        name: `scan:${file}`,
        ok: false,
        output: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return validation
}

function throwIfValidationFailed(validation: ProposalApplyValidation[]): void {
  const failed = validation.filter((item) => !item.ok)
  if (failed.length > 0) {
    throw new Error(failed.map((item) => `${item.name}: ${item.output}`).join('\n'))
  }
}

function assertSafeContent(content: string): void {
  const patterns: Array<[RegExp, string]> = [
    [/sk-[a-z0-9_-]{20,}/i, 'OpenAI-style API key'],
    [/sk-or-v1-[a-z0-9]{40,}/i, 'OpenRouter API key'],
    [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
    [/-----BEGIN [A-Z ]+PRIVATE KEY-----/, 'private key'],
    [/xox[baprs]-[a-z0-9-]+/i, 'Slack token'],
    [/ignore\s+(previous|all|above|prior)\s+instructions/i, 'prompt injection'],
    [/you\s+are\s+now\s+/i, 'role hijack'],
    [/<system>/i, 'system tag injection'],
    [/curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, 'secret exfiltration command'],
    [/cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i, 'credential file read command'],
    [/[\u200b\u200c\u200d\u2060\ufeff\u202a-\u202e]/, 'invisible unicode control character'],
  ]
  for (const [pattern, label] of patterns) {
    if (pattern.test(content)) {
      throw new Error(`Blocked unsafe content: ${label}`)
    }
  }
}

function buildPreview(before: Record<string, string>, after: Record<string, string>): string {
  const files = diffFileNames(before, after)
  if (files.length === 0) {
    return 'No file changes.'
  }
  return files.map((file) => {
    const beforeText = before[file] || ''
    const afterText = after[file] || ''
    return [
      `diff -- ${file}`,
      `--- before (${lineCount(beforeText)} lines)`,
      `+++ after (${lineCount(afterText)} lines)`,
      previewText(afterText),
    ].join('\n')
  }).join('\n\n')
}

function previewText(value: string): string {
  const limit = 4000
  return value.length > limit ? `${value.slice(0, limit)}\n... truncated ...` : value
}

function lineCount(value: string): number {
  return value ? value.split(/\r?\n/).length : 0
}

function resolveWorkspaceRoot(inputPath: string): string {
  const raw = String(inputPath || '').trim()
  if (!raw) {
    throw new Error('workspaceRoot is required')
  }
  return path.resolve(expandHomePath(raw))
}

function safeJoin(root: string, ...parts: string[]): string {
  const target = path.resolve(root, ...parts)
  if (!isWithinRoot(root, target)) {
    throw new Error('Path escapes workspace')
  }
  return target
}

function isWithinRoot(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root)
  const normalizedTarget = path.resolve(target)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + path.sep)
}

async function assertNoSymlinkPath(targetPath: string): Promise<void> {
  const stat = await safeLstat(targetPath)
  if (stat?.isSymbolicLink()) {
    throw new Error(`Refusing to use symlink path: ${targetPath}`)
  }
}

async function safeLstat(targetPath: string) {
  try {
    return await fs.lstat(targetPath)
  } catch {
    return null
  }
}

async function readTextIfExists(filePath: string): Promise<string> {
  if (!existsSync(filePath)) {
    return ''
  }
  return fs.readFile(filePath, 'utf8')
}

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await fs.stat(targetPath)).isDirectory()
  } catch {
    return false
  }
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(tmpPath, content, 'utf8')
  await fs.rename(tmpPath, filePath)
}

function shortHash(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 10)
}

function dateStamp(value: string): string {
  return value.slice(0, 10).replace(/-/g, '')
}

function normalizeComparable(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function titleCase(value: string): string {
  return value
    .split('-')
    .map((part) => part ? `${part[0]?.toUpperCase() || ''}${part.slice(1)}` : '')
    .join(' ')
}
