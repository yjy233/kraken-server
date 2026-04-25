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

export interface CreateRegistryOptions {
  rootDir: string
  allowShellTool: boolean
  allowFileWriteTool: boolean
}

export function createToolRegistry(options: CreateRegistryOptions): ToolDefinition[] {
  const ctx: ToolContext = {
    rootDir: options.rootDir,
    allowShellTool: options.allowShellTool,
    allowFileWriteTool: options.allowFileWriteTool,
  }

  // 所有工具在这里注册
  const tools: Tool[] = [
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

  // 注入上下文：包装 execute 方法，并映射为 ToolDefinition 格式
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
    execute: (input: Record<string, unknown>) => tool.execute(input, ctx),
  }))
}
