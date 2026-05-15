import { discoverSkills } from './registry.js'
import type { Skill } from './types.js'
import { resolveSkillInstallRoot } from './paths.js'

const runtimeSkillDirs = new Set<string>()
let availableSkills: Skill[] = discoverSkills([...runtimeSkillDirs])

export function getAvailableSkills(): Skill[] {
  return availableSkills
}

export function refreshSkills(extraDirs: string[] = []): Skill[] {
  for (const dir of extraDirs) {
    if (dir.trim()) {
      runtimeSkillDirs.add(dir)
    }
  }
  availableSkills = discoverSkills([...runtimeSkillDirs])
  return availableSkills
}

export function getSkillInstallRoot(): string {
  return resolveSkillInstallRoot()
}
