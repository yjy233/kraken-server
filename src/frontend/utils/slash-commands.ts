import type { SkillInfo } from '../types.js'

export type SlashCommandStage = 'root' | 'skill'

export interface SlashCommandOption {
  id: string
  type: 'command' | 'skill'
  label: string
  description?: string
  value: string
}

export interface SlashContext {
  active: boolean
  stage: SlashCommandStage
  query: string
  replaceStart: number
  replaceEnd: number
  selectedCommand?: 'skill'
}

const ROOT_COMMANDS: SlashCommandOption[] = [
  {
    id: 'skill',
    type: 'command',
    label: 'skill',
    value: 'skill',
    description: 'Select and activate an available skill',
  },
]

export function getSlashContext(text: string, cursor: number): SlashContext {
  const safeCursor = Math.max(0, Math.min(cursor, text.length))
  const beforeCursor = text.slice(0, safeCursor)
  const match = beforeCursor.match(/^\/(.*)$/)
  if (!match) {
    return {
      active: false,
      stage: 'root',
      query: '',
      replaceStart: 0,
      replaceEnd: 0,
    }
  }

  const slashBody = match[1] || ''
  const trimmedLeft = slashBody.replace(/^\s+/, '')
  if (trimmedLeft.length === 0) {
    return {
      active: true,
      stage: 'root',
      query: '',
      replaceStart: 0,
      replaceEnd: safeCursor,
    }
  }

  const parts = slashBody.split(/\s+/).filter(Boolean)
  const first = parts[0]?.toLowerCase() || ''

  if ('skill'.startsWith(first) && parts.length <= 1 && !/\s$/.test(beforeCursor)) {
    return {
      active: true,
      stage: 'root',
      query: first,
      replaceStart: 0,
      replaceEnd: safeCursor,
    }
  }

  if (first === 'skill' || ('skill'.startsWith(first) && /\s$/.test(beforeCursor))) {
    const queryMatch = slashBody.match(/^\s*skill\s*(.*)$/i)
    return {
      active: true,
      stage: 'skill',
      query: (queryMatch?.[1] || '').trim(),
      replaceStart: 0,
      replaceEnd: safeCursor,
      selectedCommand: 'skill',
    }
  }

  return {
    active: false,
    stage: 'root',
    query: '',
    replaceStart: 0,
    replaceEnd: 0,
  }
}

export function getSlashOptions(context: SlashContext, skills: SkillInfo[]): SlashCommandOption[] {
  if (!context.active) {
    return []
  }
  if (context.stage === 'root') {
    const query = context.query.toLowerCase()
    return ROOT_COMMANDS.filter((option) => option.label.toLowerCase().includes(query))
  }

  const query = context.query.toLowerCase()
  return skills
    .filter((skill) => skill.name.toLowerCase().includes(query))
    .map((skill) => ({
      id: `skill:${skill.name}`,
      type: 'skill' as const,
      label: skill.name,
      value: skill.name,
      description: skill.description,
    }))
}

export function applySlashSelection(text: string, context: SlashContext, option: SlashCommandOption): { text: string; cursor: number } {
  const before = text.slice(0, context.replaceStart)
  const after = text.slice(context.replaceEnd)

  if (option.type === 'command' && option.value === 'skill') {
    const nextText = `${before}/skill ${after}`
    const cursor = `${before}/skill `.length
    return { text: nextText, cursor }
  }

  if (option.type === 'skill') {
    const nextText = `${before}/skill ${option.value} ${after}`
    const cursor = `${before}/skill ${option.value} `.length
    return { text: nextText, cursor }
  }

  return { text, cursor: context.replaceEnd }
}

export function transformComposerMessage(message: string): string {
  const trimmed = message.trim()
  if (!trimmed) {
    return trimmed
  }

  const match = trimmed.match(/^\/skill\s+([^\s]+)(?:\s+([\s\S]*))?$/i)
  if (!match) {
    return trimmed
  }

  const skillName = match[1]
  const remainder = (match[2] || '').trim()
  if (!remainder) {
    return `Please activate the skill "${skillName}" before continuing, then tell me how you will use it.`
  }

  return `Please activate the skill "${skillName}" before continuing.\n\nThen help with this request:\n${remainder}`
}
