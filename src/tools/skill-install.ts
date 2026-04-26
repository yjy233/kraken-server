import { installSkillFromClawHub, installSkillFromGitHub } from '../skills/install.js'
import { getAvailableSkills, getSkillInstallRoot } from '../skills/manager.js'
import type { Tool } from './types.js'

export const skillInstallTool: Tool = {
  name: 'skill_install',
  description: 'Install a skill from ClawHub or from a GitHub repository path into the local skill registry and refresh available skills.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['install', 'inspect_installed'],
        description: 'Skill installation action.',
      },
      source: {
        type: 'string',
        enum: ['github', 'clawhub'],
        description: 'Install source. Use clawhub for ClawHub skill pages/slugs. Defaults to github.',
      },
      repo: {
        type: 'string',
        description: 'GitHub repository in owner/name format. Required for github installs.',
      },
      path: {
        type: 'string',
        description: 'Path to the skill directory inside the repo. Required for github installs.',
      },
      slug: {
        type: 'string',
        description: 'ClawHub skill slug or ClawHub skill page URL. Required for clawhub installs.',
      },
      ref: {
        type: 'string',
        description: 'Optional git ref. Defaults to main. Only used for github installs.',
      },
      name: {
        type: 'string',
        description: 'Installed skill name to inspect.',
      },
      force: {
        type: 'boolean',
        description: 'Overwrite an existing installed skill.',
      },
    },
    required: ['action'],
  },
  execute: async (input, ctx) => {
    const action = String(input.action || '').trim()

    if (action === 'install') {
      const source = String(input.source || 'github').trim()
      const installRoot = getSkillInstallRoot()
      const force = Boolean(input.force)
      let installed

      if (source === 'clawhub') {
        const slug = String(input.slug || '').trim()
        if (!slug) {
          throw new Error('slug is required for clawhub installs')
        }
        installed = await installSkillFromClawHub({
          clawhubSlug: slug,
          installRoot,
          force,
        })
      } else if (source === 'github') {
        const repo = String(input.repo || '').trim()
        const skillPath = String(input.path || '').trim()
        if (!repo) {
          throw new Error('repo is required for github installs')
        }
        if (!skillPath) {
          throw new Error('path is required for github installs')
        }

        const installParams: {
          repo: string
          skillPath: string
          installRoot: string
          force: boolean
          ref?: string
        } = {
          repo,
          skillPath,
          installRoot,
          force,
        }
        if (typeof input.ref === 'string' && input.ref.trim()) {
          installParams.ref = input.ref.trim()
        }

        installed = await installSkillFromGitHub(installParams)
      } else {
        throw new Error(`Unsupported install source: ${source}`)
      }

      const refreshed = ctx.refreshSkills()
      ctx.setAvailableSkills(refreshed)
      const installedSkill = refreshed.find((skill) => skill.name === installed.skill.name) || installed.skill

      return {
        output: [
          `Installed skill: ${installedSkill.name}`,
          `Source: ${source}`,
          `Description: ${installedSkill.description}`,
          `Install dir: ${installed.installDir}`,
          `Available skills: ${refreshed.map((skill) => skill.name).join(', ')}`,
        ].join('\n'),
      }
    }

    if (action === 'inspect_installed') {
      const name = String(input.name || '').trim()
      if (!name) {
        throw new Error('name is required')
      }
      const skill = getAvailableSkills().find((entry) => entry.name === name)
      if (!skill) {
        throw new Error(`Installed skill not found: ${name}`)
      }
      return {
        output: [
          `Skill: ${skill.name}`,
          `Description: ${skill.description}`,
          `Directory: ${skill.dirPath}`,
        ].join('\n'),
      }
    }

    throw new Error(`Unsupported skill_install action: ${action}`)
  },
}
