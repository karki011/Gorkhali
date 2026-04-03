// =============================================================================
// Straw Hat Board — Arsenal Data Loader (Server)
// Author: Subash Karki
//
// Reads the user's Claude Code setup from the filesystem:
// hooks, skills, agents, plugins, memory, and config.
// =============================================================================

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArsenalData {
  hooks: Array<{ event: string; matcher: string; command: string }>
  skills: {
    project: Array<{ name: string; path: string }>
    global: Array<{ name: string; path: string }>
    plugins: Array<{ name: string; source: string }>
  }
  agents: {
    core: Array<{ name: string; role: string; emoji: string; model: string }>
    allies: Array<{ name: string; role: string; emoji: string }>
    marines: Array<{ name: string; role: string; emoji: string }>
  }
  plugins: Array<{ name: string; marketplace: string; enabled: boolean }>
  memory: {
    entries: number
    summary: string
  }
  config: {
    model: string | null
    permissions: string | null
    effortLevel: string | null
    teammateMode: string | null
    mcpServers: string[]
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOME = homedir()
const CLAUDE_DIR = join(HOME, '.claude')

const readText = async (path: string): Promise<string> => {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return ''
  }
}

const readJson = async (path: string): Promise<Record<string, unknown>> => {
  try {
    const text = await readFile(path, 'utf-8')
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {}
  }
}

const safeReaddir = async (dir: string): Promise<string[]> => {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

const isDirectory = async (path: string): Promise<boolean> => {
  try {
    const s = await stat(path)
    return s.isDirectory()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// 1. Hooks — from settings.json
// ---------------------------------------------------------------------------

interface HookEntry {
  type?: string
  command?: string
  timeout?: number
}

interface HookGroup {
  matcher?: string
  hooks?: HookEntry[]
}

const gatherHooks = (settings: Record<string, unknown>): ArsenalData['hooks'] => {
  const hooks = settings.hooks as Record<string, HookGroup[]> | undefined
  if (!hooks || typeof hooks !== 'object') return []

  const result: ArsenalData['hooks'] = []

  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      const matcher = group.matcher ?? ''
      const hookList = group.hooks ?? []
      for (const hook of hookList) {
        if (hook.command) {
          result.push({
            event,
            matcher,
            command: hook.command,
          })
        }
      }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// 2. Skills — project, global, plugins
// ---------------------------------------------------------------------------

const gatherProjectSkills = async (repo: string): Promise<Array<{ name: string; path: string }>> => {
  // Try common repo locations
  const candidates = [
    join(HOME, 'CZ', repo, '.claude', 'skills'),
    join(HOME, 'cz', repo, '.claude', 'skills'),
    join(HOME, repo, '.claude', 'skills'),
  ]

  for (const dir of candidates) {
    if (!existsSync(dir)) continue
    const entries = await safeReaddir(dir)
    const skills: Array<{ name: string; path: string }> = []
    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const entryPath = join(dir, entry)
      if (await isDirectory(entryPath)) {
        skills.push({ name: entry, path: entryPath })
      }
    }
    if (skills.length > 0) return skills
  }

  return []
}

const gatherGlobalSkills = async (): Promise<Array<{ name: string; path: string }>> => {
  const commandsDir = join(CLAUDE_DIR, 'commands')
  const entries = await safeReaddir(commandsDir)
  const skills: Array<{ name: string; path: string }> = []

  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const entryPath = join(commandsDir, entry)
    if (entry.endsWith('.md')) {
      skills.push({ name: entry.replace('.md', ''), path: entryPath })
    } else if (await isDirectory(entryPath)) {
      skills.push({ name: entry, path: entryPath })
    }
  }

  return skills
}

const gatherPluginSkills = async (): Promise<Array<{ name: string; source: string }>> => {
  const marketplacesDir = join(CLAUDE_DIR, 'plugins', 'marketplaces')
  const marketplaces = await safeReaddir(marketplacesDir)
  const skills: Array<{ name: string; source: string }> = []

  for (const marketplace of marketplaces) {
    if (marketplace.startsWith('.')) continue
    const pluginsDir = join(marketplacesDir, marketplace, 'plugins')
    const plugins = await safeReaddir(pluginsDir)

    for (const plugin of plugins) {
      if (plugin.startsWith('.')) continue
      const skillsDir = join(pluginsDir, plugin, 'skills')
      const skillEntries = await safeReaddir(skillsDir)

      for (const skill of skillEntries) {
        if (skill.startsWith('.')) continue
        if (await isDirectory(join(skillsDir, skill))) {
          skills.push({ name: skill, source: `${plugin}@${marketplace}` })
        }
      }
    }
  }

  return skills
}

// ---------------------------------------------------------------------------
// 3. Agents — from ~/.claude/team/agents/
// ---------------------------------------------------------------------------

const gatherAgents = async (): Promise<ArsenalData['agents']> => {
  const agentsDir = join(CLAUDE_DIR, 'team', 'agents')

  const parseAgentFile = async (filePath: string): Promise<{ name: string; role: string; emoji: string; model: string }> => {
    const content = await readText(filePath)
    const name = basename(filePath, '.md')

    // Try to parse YAML frontmatter
    let role = ''
    let emoji = ''
    let model = 'sonnet'

    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
    if (frontmatterMatch) {
      const fm = frontmatterMatch[1]
      const roleMatch = fm.match(/role:\s*(.+)/)
      const modelMatch = fm.match(/model:\s*(.+)/)
      if (roleMatch) role = roleMatch[1].trim()
      if (modelMatch) model = modelMatch[1].trim()
    }

    // Fallback: look for role in first heading or first line
    if (!role) {
      const headingMatch = content.match(/^#\s+(.+)/m)
      if (headingMatch) role = headingMatch[1].trim()
    }

    return { name, role, emoji, model }
  }

  const core: ArsenalData['agents']['core'] = []
  const allies: ArsenalData['agents']['allies'] = []
  const marines: ArsenalData['agents']['marines'] = []

  // Core agents — .md files at root of agents dir
  const rootEntries = await safeReaddir(agentsDir)
  for (const entry of rootEntries) {
    if (entry.startsWith('.') || !entry.endsWith('.md')) continue
    if (entry === 'CHANGELOG.md' || entry === 'crew-handbook.md') continue
    const agent = await parseAgentFile(join(agentsDir, entry))
    core.push(agent)
  }

  // Allies
  const allyEntries = await safeReaddir(join(agentsDir, 'allies'))
  for (const entry of allyEntries) {
    if (entry.startsWith('.') || !entry.endsWith('.md')) continue
    const agent = await parseAgentFile(join(agentsDir, 'allies', entry))
    allies.push({ name: agent.name, role: agent.role, emoji: agent.emoji })
  }

  // Marines
  const marineEntries = await safeReaddir(join(agentsDir, 'marines'))
  for (const entry of marineEntries) {
    if (entry.startsWith('.') || !entry.endsWith('.md')) continue
    const agent = await parseAgentFile(join(agentsDir, 'marines', entry))
    marines.push({ name: agent.name, role: agent.role, emoji: agent.emoji })
  }

  return { core, allies, marines }
}

// ---------------------------------------------------------------------------
// 4. Plugins — from enabledPlugins in settings.json
// ---------------------------------------------------------------------------

const gatherPlugins = (settings: Record<string, unknown>): ArsenalData['plugins'] => {
  const enabled = settings.enabledPlugins as Record<string, boolean> | undefined
  if (!enabled || typeof enabled !== 'object') return []

  return Object.entries(enabled).map(([key, isEnabled]) => {
    const [name, marketplace] = key.includes('@') ? key.split('@', 2) : [key, 'unknown']
    return { name, marketplace, enabled: isEnabled }
  })
}

// ---------------------------------------------------------------------------
// 5. Memory — from ~/.claude/projects/*/memory/MEMORY.md
// ---------------------------------------------------------------------------

const gatherMemory = async (repo: string): Promise<ArsenalData['memory']> => {
  const projectsDir = join(CLAUDE_DIR, 'projects')
  const projectDirs = await safeReaddir(projectsDir)

  // Find project dir matching the repo name
  const matchingDir = projectDirs.find((d) => d.includes(repo))
  if (!matchingDir) return { entries: 0, summary: '' }

  const memoryPath = join(projectsDir, matchingDir, 'memory', 'MEMORY.md')
  const content = await readText(memoryPath)
  if (!content) return { entries: 0, summary: '' }

  // Count ## headings as entries
  const headings = content.match(/^##\s+/gm)
  const entries = headings?.length ?? 0

  // Return first 500 chars as summary
  const summary = content.slice(0, 500)

  return { entries, summary }
}

// ---------------------------------------------------------------------------
// 6. Config — from settings.json
// ---------------------------------------------------------------------------

const gatherConfig = (settings: Record<string, unknown>): ArsenalData['config'] => {
  const permAllow = settings.permissions as { allow?: string[] } | undefined
  const allowCount = permAllow?.allow?.length ?? 0

  return {
    model: (settings.model as string) ?? null,
    permissions: allowCount > 0 ? `${allowCount} rules` : null,
    effortLevel: (settings.effortLevel as string) ?? null,
    teammateMode: (settings.teammateMode as string) ?? null,
    mcpServers: Array.isArray(settings.enabledMcpjsonServers)
      ? (settings.enabledMcpjsonServers as string[])
      : [],
  }
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

export const loadArsenal = async (repo: string): Promise<ArsenalData> => {
  const settingsPath = join(CLAUDE_DIR, 'settings.json')
  const settings = await readJson(settingsPath)

  const [projectSkills, globalSkills, pluginSkills, agents, memory] = await Promise.all([
    gatherProjectSkills(repo),
    gatherGlobalSkills(),
    gatherPluginSkills(),
    gatherAgents(),
    gatherMemory(repo),
  ])

  return {
    hooks: gatherHooks(settings),
    skills: {
      project: projectSkills,
      global: globalSkills,
      plugins: pluginSkills,
    },
    agents,
    plugins: gatherPlugins(settings),
    memory,
    config: gatherConfig(settings),
  }
}
