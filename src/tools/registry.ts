/**
 * 工具注册表
 *
 * 集中注册所有 Agent 可调用的本地工具。
 */

import type { Tool, ToolContext } from './types.js'
import type { ToolDefinition } from '../agent/types.js'
import { listDirectoryTool } from './list-directory.js'
import { readFileTool } from './read-file.js'
import { grepTool } from './grep.js'
import { globTool } from './glob.js'
import { writeFileTool } from './write-file.js'
import { shellCommandTool } from './shell-command.js'
import { webFetchTool } from './web-fetch.js'
import { todoTool } from './todo.js'
import { searchTool } from './search.js'
import { replaceTool } from './replace.js'
import { buildSessionSandboxPolicy } from './sandbox.js'
import type { SessionSandboxConfig } from './types.js'

export interface CreateRegistryOptions {
  rootDir: string
  allowShellTool: boolean
  allowFileWriteTool: boolean
  enablePathSandbox: boolean
  enableSeatbelt: boolean
  defaultWorkspaceRoot: string
  sensitivePaths: string[]
  enabledTools?: string[] | undefined // 若为空则启用全部（write_file/shell_command 仍受独立开关控制）
}

export function createToolRegistry(options: CreateRegistryOptions, request?: {
  sessionId?: string
  sessionSandbox?: SessionSandboxConfig | undefined
}): ToolDefinition[] {
  const enabledSet = options.enabledTools && options.enabledTools.length > 0
    ? new Set(options.enabledTools)
    : null

  // 所有工具在这里注册
  const allTools: Tool[] = [
    listDirectoryTool,
    readFileTool,
    grepTool,
    globTool,
    writeFileTool,
    shellCommandTool,
    webFetchTool,
    todoTool,
    searchTool,
    replaceTool,
  ]

  const tools = allTools.filter((tool) => {
    if (!enabledSet) return true
    return enabledSet.has(tool.name)
  })

  const sessionId = request?.sessionId || 'ephemeral-session'
  const sandboxPolicy = buildSessionSandboxPolicy({
    sessionId,
    sessionSandbox: request?.sessionSandbox,
    defaultWorkspaceRoot: options.defaultWorkspaceRoot,
    sensitivePaths: options.sensitivePaths,
    enablePathSandbox: options.enablePathSandbox,
  })

  const ctx: ToolContext = {
    rootDir: options.rootDir,
    allowShellTool: options.allowShellTool,
    allowFileWriteTool: options.allowFileWriteTool,
    enablePathSandbox: options.enablePathSandbox,
    enableSeatbelt: options.enableSeatbelt,
    sessionId,
    sessionSandbox: request?.sessionSandbox,
    sandboxPolicy,
  }

  // 注入上下文：包装 execute 方法，并映射为 ToolDefinition 格式
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
    execute: (input: Record<string, unknown>) => tool.execute(input, ctx),
  }))
}
