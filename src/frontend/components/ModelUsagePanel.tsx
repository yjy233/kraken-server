import React, { useMemo } from 'react'
import type { ModelUsageModelStats, ModelUsageSummary } from '../types.js'

interface ModelUsagePanelProps {
  summary: ModelUsageSummary | null
  loading: boolean
  error: string | null
  onRefresh: () => Promise<unknown>
}

export const ModelUsagePanel: React.FC<ModelUsagePanelProps> = ({
  summary,
  loading,
  error,
  onRefresh,
}) => {
  const usageRows = useMemo(() => {
    return (summary?.models || []).map((model) => ({
      model,
      fields: Object.entries(model.usageFields)
        .filter(([, value]) => value !== 0)
        .sort(([a], [b]) => a.localeCompare(b)),
    }))
  }, [summary])

  return (
    <section className="model-usage-panel">
      <div className="model-usage-toolbar">
        <div>
          <h3>Model Usage</h3>
          <p>
            {summary
              ? `${formatInteger(summary.parsedLineCount)} log entries parsed from ${formatBytes(summary.logBytes)}.`
              : 'Read token and request totals from logs/model.jsonl.'}
            {summary?.skippedLineCount ? ` ${formatInteger(summary.skippedLineCount)} malformed entries skipped.` : ''}
          </p>
        </div>
        <button className="ghost-button" type="button" onClick={() => void onRefresh()} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="scheduled-inline-error">
          {error}
        </div>
      )}

      {!summary && !loading ? (
        <div className="scheduled-empty">
          <h4>No Usage Data</h4>
          <p>Model usage will appear after the first logged model response.</p>
        </div>
      ) : null}

      {summary ? (
        <>
          <div className="model-usage-summary-grid">
            <Metric label="Models" value={formatInteger(summary.modelCount)} />
            <Metric label="Requests" value={formatInteger(summary.totals.requestCount)} />
            <Metric label="Responses" value={formatInteger(summary.totals.responseCount)} />
            <Metric label="Input Tokens" value={formatInteger(summary.totals.inputTokens)} />
            <Metric label="Cache Hit" value={formatInteger(summary.totals.cachedTokens)} />
            <Metric label="Output Tokens" value={formatInteger(summary.totals.outputTokens)} />
            <Metric label="Reasoning Tokens" value={formatInteger(summary.totals.reasoningTokens)} />
            <Metric label="Cost" value={formatCost(summary.totals.cost)} />
          </div>

          <section className="model-usage-table-card">
            <div className="model-usage-card-header">
              <div>
                <h3>By Model</h3>
                <p>
                  Requests, token totals, cache activity, and latency grouped by configured model.
                </p>
              </div>
              <span className="model-usage-stamp">
                Updated {formatDateTime(summary.generatedAt)}
              </span>
            </div>

            {summary.models.length === 0 ? (
              <div className="scheduled-empty">
                <h4>No Models</h4>
                <p>No valid request or response entries were found in the model log.</p>
              </div>
            ) : (
              <div className="model-usage-table-wrap">
                <table className="model-usage-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Requests</th>
                      <th>Responses</th>
                      <th>Errors</th>
                      <th>Input</th>
                      <th>Cache Hit</th>
                      <th>Cache Write</th>
                      <th>Output</th>
                      <th>Reasoning</th>
                      <th>Total</th>
                      <th>Cost</th>
                      <th>Avg Time</th>
                      <th>Last Seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.models.map((model) => (
                      <ModelUsageRow key={model.model} model={model} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="model-usage-table-card">
            <div className="model-usage-card-header">
              <div>
                <h3>Usage Fields</h3>
                <p>
                  Numeric fields flattened from provider usage payloads, grouped by model.
                </p>
              </div>
              <span className="model-usage-stamp">
                {formatInteger(summary.usageFieldKeys.length)} fields
              </span>
            </div>

            {usageRows.length === 0 ? (
              <div className="scheduled-empty">
                <h4>No Usage Fields</h4>
                <p>Provider usage fields will appear after responses include token metadata.</p>
              </div>
            ) : (
              <div className="model-usage-fields-list">
                {usageRows.map(({ model, fields }) => (
                  <div className="model-usage-fields-row" key={model.model}>
                    <div className="model-usage-fields-model">
                      <strong>{model.model}</strong>
                      <span>{formatInteger(fields.length)} fields</span>
                    </div>
                    <div className="model-usage-field-chips">
                      {fields.length > 0 ? fields.map(([key, value]) => (
                        <span className="model-usage-field-chip" key={key}>
                          <span>{key}</span>
                          <strong>{formatUsageFieldValue(key, value)}</strong>
                        </span>
                      )) : (
                        <span className="model-usage-muted">No numeric usage fields</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </section>
  )
}

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="model-usage-metric">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
)

const ModelUsageRow: React.FC<{ model: ModelUsageModelStats }> = ({ model }) => (
  <tr>
    <td>
      <div className="model-usage-model-cell">
        <strong>{model.model}</strong>
        {model.providerModels.length > 0 && (
          <span>{model.providerModels.join(', ')}</span>
        )}
      </div>
    </td>
    <td>{formatInteger(model.requestCount)}</td>
    <td>{formatInteger(model.responseCount)}</td>
    <td>{formatInteger(model.errorCount)}</td>
    <td>{formatInteger(model.inputTokens)}</td>
    <td>{formatInteger(model.cachedTokens)}</td>
    <td>{formatInteger(model.cacheWriteTokens)}</td>
    <td>{formatInteger(model.outputTokens)}</td>
    <td>{formatInteger(model.reasoningTokens)}</td>
    <td>{formatInteger(model.totalTokens)}</td>
    <td>{formatCost(model.cost)}</td>
    <td>{formatDuration(model.averageDurationMs)}</td>
    <td>{formatDateTime(model.lastSeenAt)}</td>
  </tr>
)

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

function formatCost(value: number): string {
  if (!value) {
    return '$0'
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value < 0.01 ? 6 : 2,
    maximumFractionDigits: value < 0.01 ? 6 : 2,
  }).format(value)
}

function formatUsageFieldValue(key: string, value: number): string {
  if (key === 'cost' || key.endsWith('_cost') || key.startsWith('cost_details.')) {
    return formatCost(value)
  }
  return Number.isInteger(value)
    ? formatInteger(value)
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value)
}

function formatDuration(value: number | null): string {
  if (value === null) {
    return '-'
  }
  if (value < 1000) {
    return `${formatInteger(value)} ms`
  }
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value / 1000)} s`
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return '-'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${formatInteger(value)} B`
  }
  if (value < 1024 * 1024) {
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value / 1024)} KB`
  }
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value / 1024 / 1024)} MB`
}
