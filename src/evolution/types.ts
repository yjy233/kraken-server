export type EvolutionProposalType =
  | 'memory_write'
  | 'memory_merge'
  | 'prompt_patch'
  | 'skill_create'
  | 'skill_patch'
  | 'tool_policy'
  | 'doc_update'
  | 'code_followup'

export interface EvolutionProposal {
  id: string
  type: EvolutionProposalType
  title: string
  rationale: string
  sourceRunIds: string[]
  sourceSessionIds: string[]
  suggestedChange: string
  patch?: string
  risk: 'low' | 'medium' | 'high'
  status: 'pending' | 'accepted' | 'rejected' | 'applied'
  reviewNote?: string
  reviewedAt?: string
  createdAt: string
  updatedAt: string
}
