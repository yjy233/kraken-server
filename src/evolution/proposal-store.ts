import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { EvolutionProposal, EvolutionProposalType } from './types.js'

export interface ProposalStore {
  create(input: {
    type: EvolutionProposalType
    title: string
    rationale: string
    sourceRunIds?: string[]
    sourceSessionIds?: string[]
    suggestedChange: string
    patch?: string
    risk?: 'low' | 'medium' | 'high'
  }): Promise<EvolutionProposal>
  list(status?: EvolutionProposal['status']): Promise<EvolutionProposal[]>
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
    risk?: 'low' | 'medium' | 'high'
  }): Promise<EvolutionProposal> {
    const timestamp = new Date().toISOString()
    const proposal: EvolutionProposal = {
      id: crypto.randomUUID(),
      type: input.type,
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
    await appendJsonLine(proposalPath, proposal)
    return proposal
  }

  async function list(status?: EvolutionProposal['status']): Promise<EvolutionProposal[]> {
    const proposals = await readJsonLines<EvolutionProposal>(proposalPath)
    const valid = proposals.filter(isEvolutionProposal)
    return (status ? valid.filter((proposal) => proposal.status === status) : valid)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  return {
    create,
    list,
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
