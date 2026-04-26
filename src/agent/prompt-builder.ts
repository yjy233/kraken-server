import type { Skill } from '../skills/types.js'
import type { ToolDefinition } from './types.js'

/**
 * PromptBuilder —— 根据可用工具动态构建 System Prompt
 *
 * 职责：
 * - 接收基础 prompt 和工具列表
 * - 按固定结构拼接：基础 prompt → 工作流指导 → 可用工具列表 → 针对性工具指南
 */

export class PromptBuilder {
  constructor(
    private basePrompt: string,
    private tools: ToolDefinition[],
    private skills: Skill[] = []
  ) {}

  /** 构建完整的 System Prompt */
  build(): string {
    const sections: string[] = [
      this.basePrompt,
      '',
      this.buildWorkingProcess(),
      '',
      this.buildAvailableTools(),
    ]

    const skillsMetaSection = this.buildAvailableSkills()
    if (skillsMetaSection) {
      sections.push('', skillsMetaSection)
    }

    const todoSection = this.buildTodoGuidelines()
    if (todoSection) {
      sections.push('', todoSection)
    }

    const webSection = this.buildWebToolsGuidelines()
    if (webSection) {
      sections.push('', webSection)
    }

    const replaceSection = this.buildReplaceGuidelines()
    if (replaceSection) {
      sections.push('', replaceSection)
    }

    return sections.join('\n')
  }

  /** 通用工作流指导 */
  private buildWorkingProcess(): string {
    return [
      '## Working Process',
      '1. For multi-step tasks, first use `todo` to create a task list.',
      '2. Gather information using available tools.',
      '3. Mark todos as done when steps complete.',
      '4. Provide a concise final answer.',
    ].join('\n')
  }

  /** 可用工具列表 */
  private buildAvailableTools(): string {
    const lines = ['## Available Tools']
    for (const tool of this.tools) {
      lines.push(`- ${tool.name}: ${tool.description}`)
    }
    return lines.join('\n')
  }

  /** todo 工具使用指南（当 todo 开启时追加） */
  private buildTodoGuidelines(): string | null {
    if (!this.hasTool('todo')) return null
    return [
      '## Todo Tool Guidelines',
      '- ALWAYS create a todo list before starting complex tasks with multiple steps.',
      '- Update todos as you progress through the task.',
      '- Mark todos as done when each step is finished.',
      '- Use todos to stay organized and avoid losing track of sub-tasks.',
    ].join('\n')
  }

  /** web 工具使用指南（当 web_fetch/search 开启时追加） */
  private buildWebToolsGuidelines(): string | null {
    const hasWebFetch = this.hasTool('web_fetch')
    const hasSearch = this.hasTool('search')
    if (!hasWebFetch && !hasSearch) return null

    const lines = ['## Web Tools Guidelines']
    if (hasSearch) {
      lines.push('- Use `search` when you need up-to-date information from the internet.')
    }
    if (hasWebFetch) {
      lines.push('- Use `web_fetch` when you need to read a specific webpage in detail.')
    }
    lines.push('- Prefer local tools (read_file, grep) over web tools when the information is already in the project.')
    return lines.join('\n')
  }

  /** replace 工具使用指南（当 replace 开启时追加） */
  private buildReplaceGuidelines(): string | null {
    if (!this.hasTool('replace')) return null
    return [
      '## Replace Tool Guidelines',
      '- Use `replace` for precise text substitutions in existing files.',
      '- For large rewrites, use `write_file` instead.',
    ].join('\n')
  }

  /** 可用 Skill 元数据列表（常驻上下文） */
  private buildAvailableSkills(): string | null {
    if (this.skills.length === 0) return null
    const lines = ['## Available Skills']
    for (const skill of this.skills) {
      lines.push(`- **${skill.name}**: ${skill.description}`)
    }
    lines.push('')
    lines.push('When a skill is needed, call the `skill` tool with `action="activate"`.')
    lines.push('When you need a file from a loaded skill, call the `skill` tool with `action="read_reference"`.')
    return lines.join('\n')
  }

  private hasTool(name: string): boolean {
    return this.tools.some((t) => t.name === name)
  }
}
