import os from 'node:os'
import path from 'node:path'
import { discoverSkills } from './registry.js'
import type { Skill } from './types.js'

let availableSkills: Skill[] = discoverSkills()
const defaultInstallRoot = path.join(os.homedir(), 'kraken', 'skills')

export function getAvailableSkills(): Skill[] {
  return availableSkills
}

export function refreshSkills(): Skill[] {
  availableSkills = discoverSkills()
  return availableSkills
}

export function getSkillInstallRoot(): string {
  return path.resolve(process.env.KRAKEN_SKILLS_DIR || defaultInstallRoot)
}
