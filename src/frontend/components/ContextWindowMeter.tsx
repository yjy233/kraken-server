import React from 'react'
import type { ContextWindowState } from '../types.js'

interface ContextWindowMeterProps {
  contextWindow?: ContextWindowState | undefined
  compact?: boolean
}

export const ContextWindowMeter: React.FC<ContextWindowMeterProps> = ({ contextWindow, compact = false }) => {
  if (!contextWindow) {
    return (
      <div className="context-meter" data-compact={compact}>
        <div className="context-meter-inline">
          <span className="context-meter-label">Context</span>
          <div className="context-meter-track">
            <div className="context-meter-fill" style={{ width: '0%' }} />
          </div>
          <span className="context-meter-value">Unavailable</span>
        </div>
      </div>
    )
  }

  const percent = Math.max(0, Math.min(100, contextWindow.effectiveUsagePercent))
  const tone =
    percent >= 80 ? 'danger' :
    percent >= 50 ? 'warn' :
    'ok'

  return (
    <div className="context-meter" data-compact={compact}>
      <div className="context-meter-inline">
        <span className="context-meter-label" title={`Compression: ${contextWindow.compressionMode}`}>
          Context
        </span>
        <div className="context-meter-track" data-tone={tone}>
          <div
            className="context-meter-fill"
            data-tone={tone}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span
          className="context-meter-value"
          title={`Compression: ${contextWindow.compressionMode}; summarized ${contextWindow.summarizedMessages}; kept ${contextWindow.recentTurnsKept} recent turn(s)`}
        >
          {percent}%
        </span>
      </div>
    </div>
  )
}
