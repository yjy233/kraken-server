import { collapseWhitespace, truncate } from '../utils/helpers.js'
import type { CompletedRunForMemory, MemoryCandidate } from './types.js'

export function extractMemoryCandidates(input: CompletedRunForMemory): MemoryCandidate[] {
  const userText = messageContentToText(input.userMessage.content)
  const assistantText = input.assistantMessages.map((message) => messageContentToText(message.content)).join('\n')
  const combined = `${userText}\n${assistantText}`
  const candidates: MemoryCandidate[] = []

  for (const preference of extractPreferenceItems(userText)) {
    candidates.push({
      scope: input.scope,
      kind: 'preference',
      text: preference,
      tags: ['preference'],
      confidence: 0.86,
      importance: 0.72,
      sourceSessionId: input.sessionId,
      sourceRunId: input.runId,
      sourceMessageIds: [input.userMessage.id],
    })
  }

  for (const filePath of extractFilePaths(combined)) {
    candidates.push({
      scope: input.scope,
      kind: 'artifact',
      text: `Relevant project path: ${filePath}`,
      tags: ['file', 'artifact'],
      confidence: 0.72,
      importance: 0.45,
      sourceSessionId: input.sessionId,
      sourceRunId: input.runId,
      sourceMessageIds: [input.userMessage.id],
    })
  }

  for (const execution of input.toolExecutions.filter((item) => item.isError)) {
    candidates.push({
      scope: input.scope,
      kind: 'failure',
      text: `Tool ${execution.toolName} failed: ${truncate(collapseWhitespace(execution.output), 260)}`,
      tags: ['failure', execution.toolName],
      confidence: 0.8,
      importance: 0.62,
      sourceSessionId: input.sessionId,
      sourceRunId: input.runId,
      sourceMessageIds: [input.userMessage.id],
    })
  }

  for (const procedure of extractProcedureItems(assistantText)) {
    candidates.push({
      scope: input.scope,
      kind: 'procedure',
      text: procedure,
      tags: ['procedure'],
      confidence: 0.7,
      importance: 0.58,
      sourceSessionId: input.sessionId,
      sourceRunId: input.runId,
      sourceMessageIds: [input.userMessage.id],
    })
  }

  return candidates.filter((candidate) => candidate.text.length >= 12)
}

function extractPreferenceItems(text: string): string[] {
  const patterns = [
    /(?:我希望|我想要|我更喜欢|偏好|以后都|记住|不要|先不要)[^。.\n]{4,160}/gi,
    /(?:prefer|remember that|do not|don't|always|never)[^.\n]{4,160}/gi,
  ]
  return patterns.flatMap((pattern) => text.match(pattern) || [])
    .map((item) => truncate(collapseWhitespace(item), 180))
    .slice(0, 4)
}

function extractProcedureItems(text: string): string[] {
  const matches = text.match(/(?:实现|修复|新增|验证|运行|build|implemented|fixed|added|validated)[^。.\n]{8,180}/gi)
  return matches
    ? matches.map((item) => truncate(collapseWhitespace(item), 200)).slice(0, 4)
    : []
}

function extractFilePaths(text: string): string[] {
  const matches = text.match(/(?:^|\s)(?:\.{0,2}\/)?[\w.-]+(?:\/[\w.@()[\]-]+)+/g)
  return Array.from(new Set((matches || []).map((item) => item.trim()))).slice(0, 8)
}

function messageContentToText(content: CompletedRunForMemory['userMessage']['content']): string {
  if (typeof content === 'string') {
    return content
  }
  return content.map((block) => {
    if (block.type === 'text') return block.text
    if (block.type === 'image') return `[image${block.filename ? `: ${block.filename}` : ''}]`
    if (block.type === 'tool_use') return `Tool call ${block.name}: ${JSON.stringify(block.input)}`
    return `Tool result ${block.tool_name || block.tool_use_id}: ${block.content}`
  }).join('\n')
}
