import type { Tool } from './types.js'

export const memorySearchTool: Tool = {
  name: 'memory_search',
  description: 'Search scoped long-term memory for relevant preferences, facts, procedures, failures, or artifacts.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description: 'Maximum number of memory records to return.',
      },
    },
    required: ['query'],
  },
  execute: async (input, ctx) => {
    if (!ctx.memoryStore) {
      throw new Error('memory store is not configured')
    }
    const query = String(input.query || '').trim()
    if (!query) {
      throw new Error('query is required')
    }
    const scope = {
      type: 'workspace' as const,
      key: ctx.sandboxPolicy.workspaceRoot,
      label: `workspace:${ctx.sandboxPolicy.workspaceRoot}`,
    }
    const hits = await ctx.memoryStore.search({
      scope,
      query,
      limit: typeof input.limit === 'number' ? input.limit : 5,
    })
    if (hits.length === 0) {
      return { output: 'No matching memory found.' }
    }
    return {
      output: hits.map((hit, index) => {
        const record = hit.record
        return [
          `${index + 1}. [${record.kind}, confidence=${record.confidence.toFixed(2)}, score=${hit.score.toFixed(2)}]`,
          record.text,
          `scope=${record.scope.label}`,
        ].join('\n')
      }).join('\n\n'),
    }
  },
}

export const memoryRememberTool: Tool = {
  name: 'memory_remember',
  description: 'Save a user-confirmed memory into the current workspace scope. Do not use for secrets or low-confidence guesses.',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Memory text to save.',
      },
      kind: {
        type: 'string',
        enum: ['preference', 'fact', 'decision', 'procedure', 'failure', 'todo', 'artifact'],
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['text', 'kind'],
  },
  execute: async (input, ctx) => {
    if (!ctx.memoryStore) {
      throw new Error('memory store is not configured')
    }
    const text = String(input.text || '').trim()
    const kind = String(input.kind || '').trim() as any
    if (!text) {
      throw new Error('text is required')
    }
    const scope = {
      type: 'workspace' as const,
      key: ctx.sandboxPolicy.workspaceRoot,
      label: `workspace:${ctx.sandboxPolicy.workspaceRoot}`,
    }
    const record = await ctx.memoryStore.addCandidate({
      scope,
      kind,
      text,
      tags: Array.isArray(input.tags) ? input.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
      confidence: 0.95,
      importance: 0.8,
    })
    if (!record) {
      return { output: 'Memory was not saved. It may be empty, duplicate, or blocked by safety filters.' }
    }
    return { output: `Saved memory ${record.id}: ${record.text}` }
  },
}

export const proposalCreateTool: Tool = {
  name: 'proposal_create',
  description: 'Create a self-improvement proposal for long-term workspace memory, AGENTS.md guidance, or skills. This does not apply changes.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['memory_write', 'memory_merge', 'agents_patch', 'skill_create', 'skill_patch'],
      },
      title: { type: 'string' },
      rationale: { type: 'string' },
      suggestedChange: { type: 'string' },
      risk: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
      },
      payload: {
        type: 'object',
        description: 'Optional structured apply payload for workspace_memory, workspace_agents, or workspace_skill adapters.',
      },
    },
    required: ['type', 'title', 'rationale', 'suggestedChange'],
  },
  execute: async (input, ctx) => {
    if (!ctx.proposalStore) {
      throw new Error('proposal store is not configured')
    }
    const type = normalizeProposalType(input.type)
    const proposal = await ctx.proposalStore.create({
      type,
      title: String(input.title || '').trim(),
      rationale: String(input.rationale || '').trim(),
      suggestedChange: String(input.suggestedChange || '').trim(),
      payload: input.payload && typeof input.payload === 'object'
        ? input.payload as any
        : undefined,
      risk: input.risk === 'low' || input.risk === 'high' ? input.risk : 'medium',
    })
    return { output: `Created proposal ${proposal.id}: ${proposal.title}` }
  },
}

function normalizeProposalType(value: unknown): 'memory_write' | 'memory_merge' | 'agents_patch' | 'skill_create' | 'skill_patch' {
  const type = typeof value === 'string' && value.trim() ? value.trim() : 'memory_write'
  if (
    type === 'memory_write' ||
    type === 'memory_merge' ||
    type === 'agents_patch' ||
    type === 'skill_create' ||
    type === 'skill_patch'
  ) {
    return type
  }
  throw new Error(`Unsupported proposal type: ${type}`)
}
