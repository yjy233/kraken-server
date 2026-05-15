import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { EvolutionProposal, EvolutionProposalPayload, EvolutionProposalType, ProposalApplyResult } from './types.js'

const SUPPORTED_PROPOSAL_TYPES = new Set<EvolutionProposalType>([
  'memory_write',
  'memory_merge',
  'agents_patch',
  'skill_create',
  'skill_patch',
])

export interface ProposalStore {
  create(input: {
    type: EvolutionProposalType
    title: string
    rationale: string
    sourceRunIds?: string[]
    sourceSessionIds?: string[]
    suggestedChange: string
    patch?: string
    payload?: EvolutionProposalPayload
    risk?: 'low' | 'medium' | 'high'
  }): Promise<EvolutionProposal>
  list(status?: EvolutionProposal['status']): Promise<EvolutionProposal[]>
  get(id: string): Promise<EvolutionProposal | null>
  updateStatus(input: {
    id: string
    status: Extract<EvolutionProposal['status'], 'accepted' | 'rejected'>
    reviewNote?: string
  }): Promise<EvolutionProposal>
  markApplied(input: {
    id: string
    applyResult: ProposalApplyResult
  }): Promise<EvolutionProposal>
  markApplyFailed(input: {
    id: string
    applyResult: ProposalApplyResult
  }): Promise<EvolutionProposal>
}

export function createProposalStore(memoryDir: string): ProposalStore {
  mkdirSync(memoryDir, { recursive: true })
  const proposalPath = path.join(memoryDir, 'proposals.jsonl')

  async function create(input: {
    type: EvolutionProposalType
    title: string
    rationale: string
    sourceRunIds?: string[]
    sourceSessionIds?: string[]
    suggestedChange: string
    patch?: string
    payload?: EvolutionProposalPayload
    risk?: 'low' | 'medium' | 'high'
  }): Promise<EvolutionProposal> {
    const timestamp = new Date().toISOString()
    const proposal: EvolutionProposal = {
      id: crypto.randomUUID(),
      type: normalizeProposalTypeForStorage(input.type),
      title: input.title.trim(),
      rationale: input.rationale.trim(),
      sourceRunIds: input.sourceRunIds || [],
      sourceSessionIds: input.sourceSessionIds || [],
      suggestedChange: input.suggestedChange.trim(),
      risk: input.risk || 'medium',
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    if (input.patch) {
      proposal.patch = input.patch
    }
    if (input.payload) {
      proposal.payload = input.payload
    }
    await appendJsonLine(proposalPath, proposal)
    return proposal
  }

  async function list(status?: EvolutionProposal['status']): Promise<EvolutionProposal[]> {
    const valid = await readProposals(proposalPath)
    return (status ? valid.filter((proposal) => proposal.status === status) : valid)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  async function get(id: string): Promise<EvolutionProposal | null> {
    const normalizedId = id.trim()
    if (!normalizedId) {
      return null
    }
    const valid = await readProposals(proposalPath)
    return valid.find((proposal) => proposal.id === normalizedId) || null
  }

  async function updateStatus(input: {
    id: string
    status: Extract<EvolutionProposal['status'], 'accepted' | 'rejected'>
    reviewNote?: string
  }): Promise<EvolutionProposal> {
    const normalizedId = input.id.trim()
    if (!normalizedId) {
      throw new Error('proposal id is required')
    }

    const valid = await readProposals(proposalPath)
    const existing = valid.find((proposal) => proposal.id === normalizedId)
    if (!existing) {
      throw new Error('Proposal not found')
    }
    if (existing.status === 'applied') {
      throw new Error('Applied proposals cannot be changed')
    }

    const timestamp = new Date().toISOString()
    const reviewNote = normalizeReviewNote(input.reviewNote)
    const updated: EvolutionProposal = {
      ...existing,
      status: input.status,
      updatedAt: timestamp,
      reviewedAt: timestamp,
    }
    if (reviewNote) {
      updated.reviewNote = reviewNote
    } else {
      delete updated.reviewNote
    }

    await rewriteProposals(valid.map((proposal) => proposal.id === normalizedId ? updated : proposal))
    return updated
  }

  async function markApplied(input: {
    id: string
    applyResult: ProposalApplyResult
  }): Promise<EvolutionProposal> {
    return updateApplyResult({
      id: input.id,
      status: 'applied',
      applyResult: input.applyResult,
    })
  }

  async function markApplyFailed(input: {
    id: string
    applyResult: ProposalApplyResult
  }): Promise<EvolutionProposal> {
    return updateApplyResult({
      id: input.id,
      status: 'accepted',
      applyResult: input.applyResult,
    })
  }

  async function updateApplyResult(input: {
    id: string
    status: Extract<EvolutionProposal['status'], 'accepted' | 'applied'>
    applyResult: ProposalApplyResult
  }): Promise<EvolutionProposal> {
    const normalizedId = input.id.trim()
    if (!normalizedId) {
      throw new Error('proposal id is required')
    }

    const valid = await readProposals(proposalPath)
    const existing = valid.find((proposal) => proposal.id === normalizedId)
    if (!existing) {
      throw new Error('Proposal not found')
    }
    if (existing.status === 'rejected') {
      throw new Error('Rejected proposals cannot be applied')
    }
    if (existing.status === 'applied') {
      throw new Error('Proposal is already applied')
    }

    const timestamp = new Date().toISOString()
    const updated: EvolutionProposal = {
      ...existing,
      status: input.status,
      applyResult: input.applyResult,
      updatedAt: timestamp,
    }
    if (input.status === 'applied') {
      updated.appliedAt = input.applyResult.appliedAt || timestamp
    } else {
      delete updated.appliedAt
    }

    await rewriteProposals(valid.map((proposal) => proposal.id === normalizedId ? updated : proposal))
    return updated
  }

  async function rewriteProposals(proposals: EvolutionProposal[]): Promise<void> {
    await fs.mkdir(path.dirname(proposalPath), { recursive: true })
    const tmpPath = `${proposalPath}.${process.pid}.tmp`
    const body = proposals.map((proposal) => JSON.stringify(proposal)).join('\n')
    await fs.writeFile(tmpPath, body ? `${body}\n` : '', 'utf8')
    await fs.rename(tmpPath, proposalPath)
  }

  return {
    create,
    list,
    get,
    updateStatus,
    markApplied,
    markApplyFailed,
  }
}

async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8')
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  if (!existsSync(filePath)) {
    return []
  }
  const raw = await fs.readFile(filePath, 'utf8')
  return raw.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as T
      } catch {
        return null
      }
    })
    .filter((item): item is T => Boolean(item))
}

async function readProposals(filePath: string): Promise<EvolutionProposal[]> {
  return (await readJsonLines<unknown>(filePath))
    .map(normalizeStoredProposal)
    .filter((proposal): proposal is EvolutionProposal => Boolean(proposal))
}

function isEvolutionProposal(value: unknown): value is EvolutionProposal {
  if (!value || typeof value !== 'object') {
    return false
  }
  const proposal = value as Partial<EvolutionProposal>
  return typeof proposal.id === 'string' &&
    typeof proposal.type === 'string' &&
    typeof proposal.title === 'string' &&
    typeof proposal.suggestedChange === 'string' &&
    typeof proposal.status === 'string'
}

function normalizeStoredProposal(value: unknown): EvolutionProposal | null {
  if (!isEvolutionProposal(value)) {
    return null
  }
  const rawType = String((value as { type?: unknown }).type || '')
  const normalizedType = normalizeLegacyProposalType(rawType)
  if (!normalizedType) {
    return null
  }
  return {
    ...value,
    type: normalizedType,
    risk: normalizeRisk(value.risk),
    status: normalizeStatus(value.status),
  }
}

function normalizeProposalTypeForStorage(type: EvolutionProposalType): EvolutionProposalType {
  if (SUPPORTED_PROPOSAL_TYPES.has(type)) {
    return type
  }
  const normalized = normalizeLegacyProposalType(String(type))
  if (!normalized) {
    throw new Error(`Unsupported proposal type: ${String(type)}`)
  }
  return normalized
}

function normalizeLegacyProposalType(type: string): EvolutionProposalType | null {
  if (SUPPORTED_PROPOSAL_TYPES.has(type as EvolutionProposalType)) {
    return type as EvolutionProposalType
  }
  return null
}

function normalizeRisk(value: unknown): EvolutionProposal['risk'] {
  return value === 'low' || value === 'high' ? value : 'medium'
}

function normalizeStatus(value: unknown): EvolutionProposal['status'] {
  return value === 'accepted' || value === 'rejected' || value === 'applied' ? value : 'pending'
}

function normalizeReviewNote(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, 1000)
    : ''
}
