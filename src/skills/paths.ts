import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expandHomePath } from '../utils/helpers.js'

const DEFAULT_SKILL_INSTALL_ROOT = path.join(os.homedir(), 'kraken', 'skills')
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..', '..')

export function getDefaultSkillInstallRoot(): string {
  return path.resolve(DEFAULT_SKILL_INSTALL_ROOT)
}

export function resolveSkillInstallRoot(inputPath?: string | undefined): string {
  const raw = typeof inputPath === 'string' && inputPath.trim()
    ? inputPath.trim()
    : process.env.KRAKEN_SKILLS_DIR || DEFAULT_SKILL_INSTALL_ROOT
  return path.resolve(expandHomePath(raw))
}

export function resolveWorkspaceSkillRoot(workspaceRoot: string): string {
  return path.resolve(expandHomePath(workspaceRoot), 'skills')
}

export function getBuiltinSkillRoot(): string {
  return path.resolve(ROOT_DIR, 'skills')
}

export function getSkillDiscoveryDirs(extraDirs: string[] = []): string[] {
  return Array.from(new Set([
    ...extraDirs.map((dir) => path.resolve(expandHomePath(dir))),
    resolveSkillInstallRoot(process.env.KRAKEN_SKILLS_DIR),
    getBuiltinSkillRoot(),
    path.resolve(expandHomePath('~/.config/kraken/skills')),
    path.resolve(expandHomePath('~/.kraken/skills')),
  ]))
}
