/**
 * 工具接口定义
 */

export interface SessionSandboxConfig {
  workspaceRoot?: string
  readRoots?: string[]
}

export type SessionSandboxReadMode = 'allowlist' | 'host-read'

export interface SessionSandboxPolicy {
  sessionId: string
  workspaceRoot: string
  readMode: SessionSandboxReadMode
  readRoots: string[]
  writeRoots: string[]
  sensitiveRoots: string[]
  sandboxDir: string
  tmpDir: string
  profileDir: string
  enablePathSandbox: boolean
}

export interface ToolContext {
  rootDir: string
  allowShellTool: boolean
  allowFileWriteTool: boolean
  enablePathSandbox: boolean
  enableSeatbelt: boolean
  sessionId: string
  sessionSandbox?: SessionSandboxConfig | undefined
  sandboxPolicy: SessionSandboxPolicy
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
