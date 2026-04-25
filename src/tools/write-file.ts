import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Tool, ToolContext } from './types.js'

export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Write UTF-8 content to a project file. Disabled unless ALLOW_FILE_WRITE_TOOL=true.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Project-relative file path.',
      },
      content: {
        type: 'string',
        description: 'Full file content to write.',
      },
    },
    required: ['path', 'content'],
  },
  execute: async (input, ctx) => {
    if (!ctx.allowFileWriteTool) {
      throw new Error('write_file is disabled. Set ALLOW_FILE_WRITE_TOOL=true to enable it.')
    }
    const filePath = resolveProjectPath(ctx.rootDir, input.path)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, String(input.content || ''), 'utf8')
    return {
      output: `Wrote ${path.relative(ctx.rootDir, filePath)}`,
    }
  },
}

function resolveProjectPath(rootDir: string, relativePath: unknown): string {
  const candidate = path.resolve(rootDir, String(relativePath || ''))
  if (!candidate.startsWith(rootDir)) {
    throw new Error('Path escapes project root')
  }
  return candidate
}
