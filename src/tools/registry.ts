/**
 * 工具注册表
 *
 * 定义 Agent 可调用的本地工具，包括：
 * - project_overview   查看项目结构
 * - read_file          读取文件内容
 * - search_files       搜索文件内容
 * - write_file         写入文件（默认关闭）
 * - shell_command      执行 shell 命令（默认关闭）
 */

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ToolDefinition } from '../agent/types.js'
import { clampInteger } from '../utils/helpers.js'

export interface CreateRegistryOptions {
  rootDir: string
  allowShellTool: boolean
  allowFileWriteTool: boolean
}

/**
 * 创建工具注册表。
 * @param options.rootDir           项目根目录，用于限制文件和命令的作用范围
 * @param options.allowShellTool    是否启用 shell_command 工具
 * @param options.allowFileWriteTool 是否启用 write_file 工具
 */
export function createToolRegistry(options: CreateRegistryOptions): ToolDefinition[] {
  const { rootDir, allowShellTool, allowFileWriteTool } = options
  const tools: ToolDefinition[] = [
    {
      name: 'project_overview',
      description: 'Inspect the current project structure and return a concise overview of important files.',
      input_schema: {
        type: 'object',
        properties: {
          max_depth: {
            type: 'integer',
            minimum: 1,
            maximum: 5,
            description: 'Maximum directory traversal depth.',
          },
        },
        required: [],
      },
      execute: async (input) => {
        const maxDepth = clampInteger(input.max_depth, 2, 1, 5)
        const files = await collectFiles(rootDir, maxDepth)
        return {
          output: files.join('\n') || '(no files found)',
        }
      },
    },
    {
      name: 'read_file',
      description: 'Read a UTF-8 text file from the project and optionally limit the line range.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Project-relative file path.',
          },
          start_line: {
            type: 'integer',
            minimum: 1,
            description: 'Optional starting line number.',
          },
          end_line: {
            type: 'integer',
            minimum: 1,
            description: 'Optional ending line number.',
          },
        },
        required: ['path'],
      },
      execute: async (input) => {
        const filePath = resolveProjectPath(rootDir, input.path)
        const raw = await fs.readFile(filePath, 'utf8')
        const lines = raw.split(/\r?\n/)
        const start = clampInteger(input.start_line, 1, 1, lines.length || 1)
        const end = clampInteger(input.end_line, lines.length, start, lines.length || start)
        const snippet = lines
          .slice(start - 1, end)
          .map((line, index) => `${String(start + index).padStart(4, ' ')} | ${line}`)
          .join('\n')
        return {
          output: snippet || '(empty file)',
        }
      },
    },
    {
      name: 'search_files',
      description: 'Search the project for a text pattern and return matching lines with filenames.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Text or regular expression pattern to search for.',
          },
          max_results: {
            type: 'integer',
            minimum: 1,
            maximum: 200,
            description: 'Maximum number of matches to return.',
          },
        },
        required: ['pattern'],
      },
      execute: async (input) => {
        const pattern = String(input.pattern || '').trim()
        if (!pattern) {
          throw new Error('pattern is required')
        }
        const regex = new RegExp(pattern, 'i')
        const files = await collectFiles(rootDir, 4)
        const matches: string[] = []
        for (const relativeFile of files) {
          if (matches.length >= clampInteger(input.max_results, 50, 1, 200)) {
            break
          }
          const absoluteFile = path.join(rootDir, relativeFile)
          let raw = ''
          try {
            raw = await fs.readFile(absoluteFile, 'utf8')
          } catch {
            continue
          }
          const lines = raw.split(/\r?\n/)
          for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? ''
            if (regex.test(line)) {
              matches.push(`${relativeFile}:${index + 1}: ${line}`)
              if (matches.length >= clampInteger(input.max_results, 50, 1, 200)) {
                break
              }
            }
          }
        }
        return {
          output: matches.join('\n') || '(no matches)',
        }
      },
    },
    {
      name: 'write_file',
      description: 'Write UTF-8 content to a project file. Disabled unless ALLOW_FILE_WRITE_TOOL=true.',
      input_schema: {
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
      execute: async (input) => {
        if (!allowFileWriteTool) {
          throw new Error('write_file is disabled. Set ALLOW_FILE_WRITE_TOOL=true to enable it.')
        }
        const filePath = resolveProjectPath(rootDir, input.path)
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.writeFile(filePath, String(input.content || ''), 'utf8')
        return {
          output: `Wrote ${path.relative(rootDir, filePath)}`,
        }
      },
    },
    {
      name: 'shell_command',
      description: 'Run a shell command inside the project. Disabled unless ALLOW_SHELL_TOOL=true.',
      input_schema: {
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
      execute: async (input) => {
        if (!allowShellTool) {
          throw new Error('shell_command is disabled. Set ALLOW_SHELL_TOOL=true to enable it.')
        }
        const timeoutMs = clampInteger(input.timeout_ms, 15000, 1000, 120000)
        const result = await runShellCommand(rootDir, String(input.command || ''), timeoutMs)
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
    },
  ]
  return tools
}

/**
 * 执行单条 shell 命令，支持超时控制。
 */
async function runShellCommand(cwd: string, command: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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
      if (settled) {
        return
      }
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
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (exitCode) => {
      if (settled) {
        return
      }
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

/**
 * 将项目相对路径解析为绝对路径，并校验不越出项目根目录。
 */
function resolveProjectPath(rootDir: string, relativePath: unknown): string {
  const candidate = path.resolve(rootDir, String(relativePath || ''))
  if (!candidate.startsWith(rootDir)) {
    throw new Error('Path escapes project root')
  }
  return candidate
}

/**
 * 递归收集项目目录下的文件和文件夹列表。
 * @param maxDepth 最大递归深度
 */
async function collectFiles(rootDir: string, maxDepth: number): Promise<string[]> {
  const results: string[] = []
  async function visit(currentDir: string, depth: number) {
    if (depth > maxDepth) {
      return
    }
    const entries = await fs.readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      if (shouldSkipEntry(entry.name)) {
        continue
      }
      const absolute = path.join(currentDir, entry.name)
      const relative = path.relative(rootDir, absolute)
      if (entry.isDirectory()) {
        results.push(`${relative}/`)
        await visit(absolute, depth + 1)
      } else {
        results.push(relative)
      }
    }
  }
  await visit(rootDir, 0)
  return results.sort()
}

/** 遍历目录时需要跳过的目录名 */
function shouldSkipEntry(name: string): boolean {
  return ['.git', 'node_modules', '.sessions', 'dist'].includes(name)
}
