/**
 * 工具接口定义
 */

export interface ToolContext {
  rootDir: string
  allowShellTool: boolean
  allowFileWriteTool: boolean
}

export interface ToolResult {
  output: string
}

export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
}
