import React, { useCallback, useMemo, useState } from 'react'
import type { EvolutionProposal, ProposalApplyResponse } from '../types.js'
import type { ProposalFilter } from '../hooks/useEvolutionProposals.js'

interface ProposalReviewPanelProps {
  proposals: EvolutionProposal[]
  filter: ProposalFilter
  counts: Record<ProposalFilter, number>
  loading: boolean
  error: string | null
  workspaceRoot: string
  sessionId: string | null
  onFilterChange: (filter: ProposalFilter) => void
  onRefresh: () => Promise<unknown>
  onAccept: (proposalId: string, reviewNote?: string) => Promise<unknown>
  onReject: (proposalId: string, reviewNote?: string) => Promise<unknown>
  onDryRunApply: (
    proposalId: string,
    workspaceRoot?: string,
    sessionId?: string | null
  ) => Promise<ProposalApplyResponse>
  onApply: (
    proposalId: string,
    workspaceRoot?: string,
    sessionId?: string | null
  ) => Promise<ProposalApplyResponse>
}

const FILTERS: ProposalFilter[] = ['pending', 'accepted', 'rejected', 'applied', 'all']

export const ProposalReviewPanel: React.FC<ProposalReviewPanelProps> = ({
  proposals,
  filter,
  counts,
  loading,
  error,
  workspaceRoot,
  sessionId,
  onFilterChange,
  onRefresh,
  onAccept,
  onReject,
  onDryRunApply,
  onApply,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [applyPreviews, setApplyPreviews] = useState<Record<string, ProposalApplyResponse>>({})

  const pendingCount = counts.pending || 0
  const visibleTitle = useMemo(() => {
    if (filter === 'all') {
      return 'All Proposals'
    }
    return `${capitalize(filter)} Proposals`
  }, [filter])

  const updateReviewNote = useCallback((proposalId: string, value: string) => {
    setReviewNotes((prev) => ({
      ...prev,
      [proposalId]: value,
    }))
  }, [])

  const runReviewAction = useCallback(async (
    proposal: EvolutionProposal,
    action: 'accept' | 'reject'
  ) => {
    const actionKey = `${action}:${proposal.id}`
    setPendingAction(actionKey)
    setActionError(null)
    try {
      const note = reviewNotes[proposal.id] || ''
      if (action === 'accept') {
        await onAccept(proposal.id, note)
      } else {
        await onReject(proposal.id, note)
      }
      setReviewNotes((prev) => {
        const next = { ...prev }
        delete next[proposal.id]
        return next
      })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setPendingAction(null)
    }
  }, [onAccept, onReject, reviewNotes])

  const runApplyAction = useCallback(async (
    proposal: EvolutionProposal,
    action: 'preview' | 'apply'
  ) => {
    const actionKey = `${action}:${proposal.id}`
    setPendingAction(actionKey)
    setActionError(null)
    try {
      const result = action === 'preview'
        ? await onDryRunApply(proposal.id, workspaceRoot, sessionId)
        : await onApply(proposal.id, workspaceRoot, sessionId)
      setApplyPreviews((prev) => ({
        ...prev,
        [proposal.id]: result,
      }))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setPendingAction(null)
    }
  }, [onApply, onDryRunApply, sessionId, workspaceRoot])

  return (
    <section className="proposal-panel">
      <div className="proposal-toolbar">
        <div>
          <h3>Proposal Review</h3>
          <p>
            Review self-improvement proposals before they affect memory, prompts, skills, docs, or tool policy.
          </p>
        </div>
        <button className="ghost-button" type="button" onClick={() => void onRefresh()} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="proposal-summary-grid">
        <ProposalMetric label="Pending" value={pendingCount} tone={pendingCount > 0 ? 'warn' : 'neutral'} />
        <ProposalMetric label="Accepted" value={counts.accepted || 0} tone="good" />
        <ProposalMetric label="Rejected" value={counts.rejected || 0} tone="neutral" />
        <ProposalMetric label="Applied" value={counts.applied || 0} tone="neutral" />
      </div>

      <div className="proposal-filter-row" role="tablist" aria-label="Proposal status filters">
        {FILTERS.map((item) => (
          <button
            key={item}
            className="proposal-filter"
            type="button"
            data-active={filter === item}
            onClick={() => onFilterChange(item)}
          >
            <span>{capitalize(item)}</span>
            <strong>{counts[item] || 0}</strong>
          </button>
        ))}
      </div>

      {(error || actionError) && (
        <div className="scheduled-inline-error">
          {error || actionError}
        </div>
      )}

      <section className="proposal-list-card">
        <div className="proposal-list-header">
          <div>
            <h3>{visibleTitle}</h3>
            <p>
              Accepting marks a proposal as approved for later application. It does not change files, prompts, skills, or policy.
            </p>
          </div>
          <span className="model-usage-stamp">{proposals.length} visible</span>
        </div>

        {proposals.length === 0 ? (
          <div className="scheduled-empty">
            <h4>No Proposals</h4>
            <p>No proposals match the current filter.</p>
          </div>
        ) : (
          <div className="proposal-list">
            {proposals.map((proposal) => {
              const expanded = expandedId === proposal.id
              return (
                <article className="proposal-card" key={proposal.id} data-risk={proposal.risk}>
                  <button
                    className="proposal-card-main"
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : proposal.id)}
                    aria-expanded={expanded}
                  >
                    <div className="proposal-heading">
                      <div className="proposal-title-row">
                        <span className="proposal-type">{proposal.type}</span>
                        <span className="proposal-risk" data-risk={proposal.risk}>{proposal.risk}</span>
                        <span className="proposal-status" data-status={proposal.status}>{proposal.status}</span>
                      </div>
                      <h4>{proposal.title}</h4>
                      <p>{proposal.rationale || 'No rationale provided.'}</p>
                    </div>
                    <span className="proposal-date">{formatDateTime(proposal.createdAt)}</span>
                  </button>

                  {expanded && (
                    <div className="proposal-detail">
                      <ProposalSection title="Suggested Change" value={proposal.suggestedChange} />
                      {proposal.patch ? (
                        <ProposalSection title="Patch" value={proposal.patch} mono />
                      ) : null}
                      <div className="proposal-meta-grid">
                        <ProposalMeta label="ID" value={proposal.id} />
                        <ProposalMeta label="Source Runs" value={proposal.sourceRunIds.join(', ') || '-'} />
                        <ProposalMeta label="Source Sessions" value={proposal.sourceSessionIds.join(', ') || '-'} />
                        <ProposalMeta label="Updated" value={formatDateTime(proposal.updatedAt)} />
                        <ProposalMeta label="Reviewed" value={proposal.reviewedAt ? formatDateTime(proposal.reviewedAt) : '-'} />
                        <ProposalMeta label="Applied" value={proposal.appliedAt ? formatDateTime(proposal.appliedAt) : '-'} />
                        <ProposalMeta label="Review Note" value={proposal.reviewNote || '-'} />
                      </div>

                      {proposal.status === 'pending' ? (
                        <div className="proposal-review-box">
                          <label className="scheduled-field">
                            <span>Review Note</span>
                            <textarea
                              className="scheduled-textarea proposal-review-note"
                              placeholder="Optional context for why this proposal was accepted or rejected."
                              value={reviewNotes[proposal.id] || ''}
                              onChange={(event) => updateReviewNote(proposal.id, event.target.value)}
                            />
                          </label>
                          <div className="proposal-actions">
                            <button
                              className="ghost-button proposal-accept-button"
                              type="button"
                              disabled={pendingAction !== null}
                              onClick={() => void runReviewAction(proposal, 'accept')}
                            >
                              {pendingAction === `accept:${proposal.id}` ? 'Accepting...' : 'Accept'}
                            </button>
                            <button
                              className="ghost-button workspace-danger-button"
                              type="button"
                              disabled={pendingAction !== null}
                              onClick={() => void runReviewAction(proposal, 'reject')}
                            >
                              {pendingAction === `reject:${proposal.id}` ? 'Rejecting...' : 'Reject'}
                            </button>
                          </div>
                        </div>
                      ) : proposal.status === 'accepted' ? (
                        <div className="proposal-review-box">
                          <div className="proposal-apply-copy">
                            <strong>Apply to workspace</strong>
                            <span>{workspaceRoot || 'Default workspace'}</span>
                          </div>
                          <div className="proposal-actions">
                            <button
                              className="ghost-button"
                              type="button"
                              disabled={pendingAction !== null}
                              onClick={() => void runApplyAction(proposal, 'preview')}
                            >
                              {pendingAction === `preview:${proposal.id}` ? 'Previewing...' : 'Preview Apply'}
                            </button>
                            <button
                              className="ghost-button proposal-accept-button"
                              type="button"
                              disabled={pendingAction !== null}
                              onClick={() => void runApplyAction(proposal, 'apply')}
                            >
                              {pendingAction === `apply:${proposal.id}` ? 'Applying...' : 'Apply'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="proposal-readonly-note">
                          This proposal is {proposal.status}. Use a follow-up proposal for further changes.
                        </div>
                      )}
                      <ProposalApplyResultView result={applyPreviews[proposal.id] || proposalApplyResultToResponse(proposal)} />
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>
    </section>
  )
}

const ProposalMetric: React.FC<{ label: string; value: number; tone: 'neutral' | 'warn' | 'good' }> = ({
  label,
  value,
  tone,
}) => (
  <div className="proposal-metric" data-tone={tone}>
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
)

const ProposalSection: React.FC<{ title: string; value: string; mono?: boolean }> = ({
  title,
  value,
  mono = false,
}) => (
  <section className="proposal-section">
    <h5>{title}</h5>
    <pre data-mono={mono}>{value}</pre>
  </section>
)

const ProposalMeta: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
)

const ProposalApplyResultView: React.FC<{ result: ProposalApplyResponse | null }> = ({ result }) => {
  if (!result) {
    return null
  }
  return (
    <section className="proposal-apply-result">
      <div className="proposal-apply-result-header">
        <h5>{result.dryRun ? 'Apply Preview' : 'Apply Result'}</h5>
        {result.auditPath ? <span>{result.auditPath}</span> : null}
      </div>
      {result.changedFiles.length > 0 ? (
        <div className="proposal-changed-files">
          {result.changedFiles.map((file) => (
            <span key={file}>{file}</span>
          ))}
        </div>
      ) : null}
      {result.validation.length > 0 ? (
        <div className="proposal-validation-list">
          {result.validation.map((item) => (
            <div key={item.name} data-ok={item.ok}>
              <strong>{item.name}</strong>
              <span>{item.output}</span>
            </div>
          ))}
        </div>
      ) : null}
      {result.preview ? (
        <ProposalSection title="Apply Preview" value={result.preview} mono />
      ) : null}
    </section>
  )
}

function proposalApplyResultToResponse(proposal: EvolutionProposal): ProposalApplyResponse | null {
  if (!proposal.applyResult) {
    return null
  }
  return {
    proposal,
    dryRun: false,
    changedFiles: proposal.applyResult.changedFiles || [],
    preview: proposal.applyResult.preview || proposal.applyResult.error || '',
    validation: proposal.applyResult.validation || [],
    ...(proposal.applyResult.auditPath ? { auditPath: proposal.applyResult.auditPath } : {}),
  }
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}
