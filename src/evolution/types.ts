export type EvolutionProposalType =
  | 'memory_write'
  | 'memory_merge'
  | 'agents_patch'
  | 'skill_create'
  | 'skill_patch'

export interface EvolutionProposal {
  id: string
  type: EvolutionProposalType
  title: string
  rationale: string
  sourceRunIds: string[]
  sourceSessionIds: string[]
  suggestedChange: string
  patch?: string
  payload?: EvolutionProposalPayload
  risk: 'low' | 'medium' | 'high'
  status: 'pending' | 'accepted' | 'rejected' | 'applied'
  reviewNote?: string
  reviewedAt?: string
  appliedAt?: string
  applyResult?: ProposalApplyResult
  createdAt: string
  updatedAt: string
}

export type EvolutionProposalPayload =
  | WorkspaceMemoryProposalPayload
  | WorkspaceAgentsProposalPayload
  | WorkspaceSkillCreateProposalPayload
  | WorkspaceSkillPatchProposalPayload
  | Record<string, unknown>

export interface WorkspaceMemoryProposalPayload {
  adapter: 'workspace_memory'
  operation: 'append_memory' | 'append_used' | 'merge_memory'
  entries: WorkspaceMemoryProposalEntry[]
}

export interface WorkspaceMemoryProposalEntry {
  target?: 'MEMORY.md' | 'USED.md'
  kind?: 'preference' | 'fact' | 'decision' | 'procedure' | 'failure' | 'todo' | 'artifact'
  text: string
  tags?: string[]
  source?: {
    sessionIds?: string[]
    runIds?: string[]
  }
}

export interface WorkspaceAgentsProposalPayload {
  adapter: 'workspace_agents'
  operation: 'append_section' | 'replace_section' | 'replace_file'
  heading?: string
  content: string
}

export interface WorkspaceSkillCreateProposalPayload {
  adapter: 'workspace_skill'
  operation: 'create_skill'
  skillName: string
  description: string
  force?: boolean
  files: WorkspaceSkillProposalFile[]
}

export interface WorkspaceSkillPatchProposalPayload {
  adapter: 'workspace_skill'
  operation: 'patch_skill'
  skillName: string
  files: WorkspaceSkillProposalFile[]
}

export interface WorkspaceSkillProposalFile {
  path: string
  mode?: 'replace' | 'append' | 'apply_patch'
  content?: string
  patch?: string
}

export interface ProposalApplyValidation {
  name: string
  ok: boolean
  output: string
}

export interface ProposalApplyResult {
  ok: boolean
  adapter: 'workspace_memory' | 'workspace_agents' | 'workspace_skill'
  changedFiles: string[]
  validation: ProposalApplyValidation[]
  preview: string
  auditPath?: string
  error?: string
  appliedBy?: string
  appliedAt: string
}
