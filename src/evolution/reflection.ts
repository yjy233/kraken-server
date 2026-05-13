import type { CompletedRunForMemory, MemoryCandidate } from '../memory/types.js'
import type { ProposalStore } from './proposal-store.js'

export async function createPostRunProposals(input: {
  completedRun: CompletedRunForMemory
  candidates: MemoryCandidate[]
  proposalStore: ProposalStore
}): Promise<void> {
  const failureCount = input.completedRun.toolExecutions.filter((execution) => execution.isError).length
  if (failureCount > 0) {
    await input.proposalStore.create({
      type: 'code_followup',
      title: `Review ${failureCount} tool failure${failureCount === 1 ? '' : 's'} from run`,
      rationale: 'The run produced tool failures that may indicate missing workflow knowledge, brittle tooling, or a needed skill update.',
      sourceRunIds: [input.completedRun.runId],
      sourceSessionIds: [input.completedRun.sessionId],
      suggestedChange: input.completedRun.toolExecutions
        .filter((execution) => execution.isError)
        .map((execution) => `Investigate ${execution.toolName}: ${execution.output.slice(0, 300)}`)
        .join('\n'),
      risk: 'low',
    })
  }

  const procedureCandidates = input.candidates.filter((candidate) => candidate.kind === 'procedure')
  if (procedureCandidates.length >= 2) {
    await input.proposalStore.create({
      type: 'skill_create',
      title: 'Consider extracting repeated workflow into a skill',
      rationale: 'The run produced multiple procedure memories. If this workflow repeats, a dedicated skill would make it more reliable.',
      sourceRunIds: [input.completedRun.runId],
      sourceSessionIds: [input.completedRun.sessionId],
      suggestedChange: procedureCandidates.map((candidate) => `- ${candidate.text}`).join('\n'),
      risk: 'medium',
    })
  }
}
