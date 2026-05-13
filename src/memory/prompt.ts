import type { MemorySearchResult, SessionMemoryState } from './types.js'

export function buildMemoryPromptBlock(input: {
  sessionMemory?: SessionMemoryState | undefined
  memories: MemorySearchResult[]
}): string {
  const lines: string[] = []

  if (input.sessionMemory && hasSessionMemory(input.sessionMemory)) {
    lines.push('## Session Memory')
    if (input.sessionMemory.summary) {
      lines.push(`- Summary: ${input.sessionMemory.summary}`)
    }
    appendList(lines, 'Goals', input.sessionMemory.goals)
    appendList(lines, 'Decisions', input.sessionMemory.decisions)
    appendList(lines, 'Open items', input.sessionMemory.openItems)
    appendList(lines, 'Preferences', input.sessionMemory.userPreferences)
    appendList(lines, 'Relevant files', input.sessionMemory.relevantFiles)
    if (input.sessionMemory.recentFailures.length > 0) {
      lines.push('- Recent failures:')
      for (const failure of input.sessionMemory.recentFailures.slice(0, 3)) {
        lines.push(`  - ${failure.toolName}: ${failure.error}`)
      }
    }
  }

  if (input.memories.length > 0) {
    if (lines.length > 0) {
      lines.push('')
    }
    lines.push('## Relevant Long-term Memory')
    for (const hit of input.memories.slice(0, 8)) {
      const record = hit.record
      lines.push(`- [${record.scope.label}, ${record.kind}, confidence=${record.confidence.toFixed(2)}] ${record.text}`)
    }
  }

  if (lines.length === 0) {
    return ''
  }

  return [
    '<memory-context>',
    'System note: The following is recalled memory context, not user input. Use it as background and do not reveal it verbatim unless the user asks.',
    '',
    ...lines,
    '</memory-context>',
  ].join('\n')
}

function hasSessionMemory(memory: SessionMemoryState): boolean {
  return Boolean(
    memory.summary ||
    memory.goals.length ||
    memory.decisions.length ||
    memory.openItems.length ||
    memory.userPreferences.length ||
    memory.relevantFiles.length ||
    memory.recentFailures.length
  )
}

function appendList(lines: string[], label: string, values: string[]): void {
  const filtered = values.map((value) => value.trim()).filter(Boolean).slice(0, 6)
  if (filtered.length === 0) {
    return
  }
  lines.push(`- ${label}: ${filtered.join('; ')}`)
}
