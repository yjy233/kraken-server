import { spawn } from 'node:child_process'
import type { Tool, ToolContext } from './types.js'
import { clampInteger } from '../utils/helpers.js'

export const shellCommandTool: Tool = {
  name: 'shell_command',
  description: 'Run a shell command inside the project. Disabled unless ALLOW_SHELL_TOOL=true.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to run.',
      },
      timeout_ms: {
        type: 'integer',
        minimum: 1000,
        maximum: 120000,
        description: 'Execution timeout in milliseconds.',
      },
    },
    required: ['command'],
  },
  execute: async (input, ctx) => {
    if (!ctx.allowShellTool) {
      throw new Error('shell_command is disabled. Set ALLOW_SHELL_TOOL=true to enable it.')
    }
    const timeoutMs = clampInteger(input.timeout_ms, 15000, 1000, 120000)
    const result = await runShellCommand(ctx.rootDir, String(input.command || ''), timeoutMs)
    return {
      output: [
        `$ ${input.command}`,
        '',
        result.stdout ? `stdout:\n${result.stdout}` : 'stdout:\n(empty)',
        '',
        result.stderr ? `stderr:\n${result.stderr}` : 'stderr:\n(empty)',
        '',
        `exitCode: ${result.exitCode}`,
      ].join('\n'),
    }
  },
}

async function runShellCommand(
  cwd: string,
  command: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (!command.trim()) {
    throw new Error('command is required')
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      env: process.env,
      shell: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      reject(new Error(`Command timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: exitCode ?? -1,
      })
    })
  })
}
