import type { CompletedRunForMemory, MemoryCandidate } from '../memory/types.js'
import type { ProposalStore } from './proposal-store.js'

export async function createPostRunProposals(input: {
  completedRun: CompletedRunForMemory
  candidates: MemoryCandidate[]
  proposalStore: ProposalStore
}): Promise<void> {
  const failureCount = input.completedRun.toolExecutions.filter((execution) => execution.isError).length
  if (failureCount > 0) {
    const failureExecutions = input.completedRun.toolExecutions.filter((execution) => execution.isError)
    await input.proposalStore.create({
      type: 'memory_write',
      title: `Remember ${failureCount} tool failure${failureCount === 1 ? '' : 's'} from run`,
      rationale: 'The run produced tool failures that may be useful as long-term workflow memory after review.',
      sourceRunIds: [input.completedRun.runId],
      sourceSessionIds: [input.completedRun.sessionId],
      suggestedChange: failureExecutions
        .map((execution) => `Tool ${execution.toolName} failed: ${execution.output.slice(0, 300)}`)
        .join('\n'),
      payload: {
        adapter: 'workspace_memory',
        operation: 'append_memory',
        entries: failureExecutions.map((execution) => ({
          target: 'MEMORY.md',
          kind: 'failure',
          text: `Tool ${execution.toolName} failed: ${execution.output.slice(0, 300)}`,
          tags: ['tool-failure', execution.toolName],
          source: {
            runIds: [input.completedRun.runId],
            sessionIds: [input.completedRun.sessionId],
          },
        })),
      },
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
