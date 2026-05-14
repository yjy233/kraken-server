import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  acceptEvolutionProposal,
  fetchEvolutionProposals,
  rejectEvolutionProposal,
} from '../api.js'
import type { EvolutionProposal, EvolutionProposalStatus } from '../types.js'

export type ProposalFilter = EvolutionProposalStatus | 'all'

export function useEvolutionProposals(active: boolean) {
  const [allProposals, setAllProposals] = useState<EvolutionProposal[]>([])
  const [filter, setFilter] = useState<ProposalFilter>('pending')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = await fetchEvolutionProposals('all')
      setAllProposals(next)
      setError(null)
      return next
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setError(message)
      throw error
    } finally {
      setLoading(false)
    }
  }, [])

  const accept = useCallback(async (proposalId: string, reviewNote?: string) => {
    const proposal = await acceptEvolutionProposal(proposalId, reviewNote)
    setAllProposals((prev) => updateProposalList(prev, proposal))
    setError(null)
    return proposal
  }, [])

  const reject = useCallback(async (proposalId: string, reviewNote?: string) => {
    const proposal = await rejectEvolutionProposal(proposalId, reviewNote)
    setAllProposals((prev) => updateProposalList(prev, proposal))
    setError(null)
    return proposal
  }, [])

  const counts = useMemo(() => {
    return allProposals.reduce((acc, proposal) => {
      acc[proposal.status] += 1
      acc.all += 1
      return acc
    }, {
      all: 0,
      pending: 0,
      accepted: 0,
      rejected: 0,
      applied: 0,
    } as Record<ProposalFilter, number>)
  }, [allProposals])

  const proposals = useMemo(() => {
    return filter === 'all'
      ? allProposals
      : allProposals.filter((proposal) => proposal.status === filter)
  }, [allProposals, filter])

  useEffect(() => {
    if (!active) {
      return
    }
    void refresh()
  }, [active, refresh])

  return {
    proposals,
    filter,
    counts,
    loading,
    error,
    setFilter,
    refresh,
    accept,
    reject,
  }
}

function updateProposalList(
  proposals: EvolutionProposal[],
  proposal: EvolutionProposal
): EvolutionProposal[] {
  const next = [proposal, ...proposals.filter((item) => item.id !== proposal.id)]
  return next.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}
