import { promises as fs } from 'fs'
import path from 'path'

import {
  getConfigRepoHash,
  listConfigRepoFiles,
  mutateConfigRepo,
  readConfigRepoFileBuffer,
  type ConfigRepoFileEntry,
} from '@/lib/config-repo-store'
import {
  createDefaultCommonWorkspaceConfig,
  getAssignedAgentIdsForSkill,
  parseCommonWorkspaceConfig,
  setSkillAssignments,
  validateCommonWorkspaceConfig,
  type CommonWorkspaceConfig,
} from '@/lib/workspace-config'
import { createSkillMarkdown, parseSkillMarkdown } from '@/lib/skills/skill-markdown'
import {
  type SkillArchive,
  type SkillBundle,
  type SkillBundleFile,
  type SkillDetail,
  type SkillSummary,
  SKILL_MARKDOWN_FILE_NAME,
  SKILLS_CONFIG_DIRECTORY,
} from '@/lib/skills/types'

const COMMON_WORKSPACE_CONFIG_FILE = 'CommonWorkspaceConfig.json'

type SkillStoreResult<T> =
  | { ok: true; data: T; hash: string | null }
  | { ok: false; error: 'invalid_config' | 'kb_unavailable' | 'not_found' | 'read_failed' }

type SaveSkillDocumentInput = {
  assignedAgentIds: string[]
  body: string
  description: string
  expectedHash?: string
  mode: 'create' | 'update'
  name: string
}

type ImportSkillArchiveInput = {
  archive: SkillArchive
  assignedAgentIds: string[]
  expectedHash?: string
}

type SaveSkillResult =
  | { ok: true; hash: string }
  | {
      ok: false
      error:
        | 'conflict'
        | 'invalid_config'
        | 'kb_unavailable'
        | 'not_found'
        | 'skill_exists'
        | 'unknown_agent'
        | 'write_failed'
    }

class SkillStoreError extends Error {
  constructor(readonly code: 'invalid_config' | 'not_found' | 'skill_exists' | 'unknown_agent') {
    super(code)
  }
}

function getSkillConfigDirectory(name: string): string {
  return `${SKILLS_CONFIG_DIRECTORY}/${name}`
}

async function listFilesRecursive(rootDir: string, prefix = ''): Promise<SkillBundleFile[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true })
  const files: SkillBundleFile[] = []

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(rootDir, entry.name)
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(absolutePath, relativePath))
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    files.push({
      path: relativePath,
      content: new Uint8Array(await fs.readFile(absolutePath)),
    })
  }

  return files
}

async function loadWorkspaceConfigFromRepoDir(repoDir: string): Promise<CommonWorkspaceConfig> {
  const configPath = path.join(repoDir, COMMON_WORKSPACE_CONFIG_FILE)
  const raw = await fs.readFile(configPath, 'utf-8').catch((error: unknown) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }

    throw error
  })

  if (raw == null) {
    return createDefaultCommonWorkspaceConfig()
  }

  const parsed = parseCommonWorkspaceConfig(raw)
  if (!parsed.ok) {
    throw new SkillStoreError('invalid_config')
  }

  const validation = validateCommonWorkspaceConfig(parsed.config)
  if (!validation.ok) {
    throw new SkillStoreError('invalid_config')
  }

  return parsed.config
}

async function writeWorkspaceConfigToRepoDir(repoDir: string, config: CommonWorkspaceConfig): Promise<void> {
  const validation = validateCommonWorkspaceConfig(config)
  if (!validation.ok) {
    throw new SkillStoreError('invalid_config')
  }

  await fs.writeFile(
    path.join(repoDir, COMMON_WORKSPACE_CONFIG_FILE),
    JSON.stringify(config, null, 2),
    'utf-8'
  )
}

async function readSkillBundleFromRepoDir(repoDir: string, name: string): Promise<SkillBundle | null> {
  const skillDir = path.join(repoDir, getSkillConfigDirectory(name))
  const stats = await fs.stat(skillDir).catch(() => null)
  if (!stats?.isDirectory()) {
    return null
  }

  const files = await listFilesRecursive(skillDir)
  const skillMarkdown = files.find((file) => file.path === SKILL_MARKDOWN_FILE_NAME)
  if (!skillMarkdown) {
    return null
  }

  const parsed = parseSkillMarkdown(Buffer.from(skillMarkdown.content).toString('utf-8'), name)
  if (!parsed.ok) {
    return null
  }

  return {
    files,
    skill: parsed.skill,
  }
}

async function writeSkillBundleToRepoDir(repoDir: string, name: string, files: SkillBundleFile[]): Promise<void> {
  const skillDir = path.join(repoDir, getSkillConfigDirectory(name))
  await fs.rm(skillDir, { recursive: true, force: true })
  await fs.mkdir(skillDir, { recursive: true })

  for (const file of files) {
    const filePath = path.join(skillDir, file.path)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, Buffer.from(file.content))
  }
}

function groupSkillFiles(files: ConfigRepoFileEntry[]): Map<string, SkillBundleFile[]> {
  const grouped = new Map<string, SkillBundleFile[]>()

  for (const file of files) {
    const relativePath = file.path.slice(SKILLS_CONFIG_DIRECTORY.length + 1)
    const separatorIndex = relativePath.indexOf('/')
    if (separatorIndex <= 0) {
      continue
    }

    const skillName = relativePath.slice(0, separatorIndex)
    const skillRelativePath = relativePath.slice(separatorIndex + 1)
    const current = grouped.get(skillName) ?? []
    current.push({ path: skillRelativePath, content: new Uint8Array(file.content) })
    grouped.set(skillName, current)
  }

  return grouped
}

function createSkillSummary(bundle: SkillBundle, assignedAgentIds: string[]): SkillSummary {
  const resourcePaths = bundle.files
    .map((file) => file.path)
    .filter((filePath) => filePath !== SKILL_MARKDOWN_FILE_NAME)
    .sort((left, right) => left.localeCompare(right))

  return {
    assignedAgentIds,
    description: bundle.skill.frontmatter.description,
    hasResources: resourcePaths.length > 0,
    name: bundle.skill.frontmatter.name,
    resourcePaths,
  }
}

async function loadWorkspaceConfigForRead(): Promise<SkillStoreResult<CommonWorkspaceConfig>> {
  const result = await readConfigRepoFileBuffer(COMMON_WORKSPACE_CONFIG_FILE)
  if (!result.ok) {
    if (result.error === 'not_found') {
      return { ok: true, data: createDefaultCommonWorkspaceConfig(), hash: null }
    }

    return { ok: false, error: result.error }
  }

  const parsed = parseCommonWorkspaceConfig(result.content.toString('utf-8'))
  if (!parsed.ok) {
    return { ok: false, error: 'invalid_config' }
  }

  const validation = validateCommonWorkspaceConfig(parsed.config)
  if (!validation.ok) {
    return { ok: false, error: 'invalid_config' }
  }

  return { ok: true, data: parsed.config, hash: result.hash }
}

export async function listSkills(): Promise<SkillStoreResult<SkillSummary[]>> {
  const [skillsResult, configResult] = await Promise.all([
    listConfigRepoFiles(SKILLS_CONFIG_DIRECTORY),
    loadWorkspaceConfigForRead(),
  ])

  if (!skillsResult.ok) {
    return { ok: false, error: skillsResult.error }
  }

  if (!configResult.ok) {
    return configResult
  }

  const groupedFiles = groupSkillFiles(skillsResult.files)
  const skills: SkillSummary[] = []

  for (const [name, files] of groupedFiles) {
    const skillMarkdown = files.find((file) => file.path === SKILL_MARKDOWN_FILE_NAME)
    if (!skillMarkdown) {
      continue
    }

    const parsed = parseSkillMarkdown(Buffer.from(skillMarkdown.content).toString('utf-8'), name)
    if (!parsed.ok) {
      continue
    }

    skills.push(
      createSkillSummary(
        { files, skill: parsed.skill },
        getAssignedAgentIdsForSkill(configResult.data, parsed.skill.frontmatter.name)
      )
    )
  }

  skills.sort((left, right) => left.name.localeCompare(right.name))
  return { ok: true, data: skills, hash: skillsResult.hash }
}

export async function listSkillBundles(): Promise<SkillStoreResult<SkillBundle[]>> {
  const skillsResult = await listConfigRepoFiles(SKILLS_CONFIG_DIRECTORY)
  if (!skillsResult.ok) {
    return { ok: false, error: skillsResult.error }
  }

  const groupedFiles = groupSkillFiles(skillsResult.files)
  const bundles: SkillBundle[] = []

  for (const [name, files] of groupedFiles) {
    const skillMarkdown = files.find((file) => file.path === SKILL_MARKDOWN_FILE_NAME)
    if (!skillMarkdown) {
      continue
    }

    const parsed = parseSkillMarkdown(Buffer.from(skillMarkdown.content).toString('utf-8'), name)
    if (!parsed.ok) {
      continue
    }

    bundles.push({ files, skill: parsed.skill })
  }

  bundles.sort((left, right) => left.skill.frontmatter.name.localeCompare(right.skill.frontmatter.name))
  return { ok: true, data: bundles, hash: skillsResult.hash }
}

export async function readSkill(name: string): Promise<SkillStoreResult<SkillDetail>> {
  const [bundleResult, configResult] = await Promise.all([
    listConfigRepoFiles(getSkillConfigDirectory(name)),
    loadWorkspaceConfigForRead(),
  ])

  if (!bundleResult.ok) {
    return { ok: false, error: bundleResult.error }
  }

  if (!configResult.ok) {
    return configResult
  }

  const skillMarkdown = bundleResult.files.find((file) => file.path === `${getSkillConfigDirectory(name)}/${SKILL_MARKDOWN_FILE_NAME}`)
  if (!skillMarkdown) {
    return { ok: false, error: 'not_found' }
  }

  const files = bundleResult.files.map((file) => ({
    path: file.path.slice(getSkillConfigDirectory(name).length + 1),
    content: new Uint8Array(file.content),
  }))
  const parsed = parseSkillMarkdown(skillMarkdown.content.toString('utf-8'), name)
  if (!parsed.ok) {
    return { ok: false, error: 'read_failed' }
  }

  const summary = createSkillSummary(
    { files, skill: parsed.skill },
    getAssignedAgentIdsForSkill(configResult.data, parsed.skill.frontmatter.name)
  )

  return {
    ok: true,
    data: {
      ...summary,
      body: parsed.skill.body,
    },
    hash: bundleResult.hash,
  }
}

export async function readSkillBundle(name: string): Promise<SkillStoreResult<SkillBundle>> {
  const bundleResult = await listConfigRepoFiles(getSkillConfigDirectory(name))
  if (!bundleResult.ok) {
    return { ok: false, error: bundleResult.error }
  }

  const skillMarkdown = bundleResult.files.find((file) => file.path === `${getSkillConfigDirectory(name)}/${SKILL_MARKDOWN_FILE_NAME}`)
  if (!skillMarkdown) {
    return { ok: false, error: 'not_found' }
  }

  const files = bundleResult.files.map((file) => ({
    path: file.path.slice(getSkillConfigDirectory(name).length + 1),
    content: new Uint8Array(file.content),
  }))
  const parsed = parseSkillMarkdown(skillMarkdown.content.toString('utf-8'), name)
  if (!parsed.ok) {
    return { ok: false, error: 'read_failed' }
  }

  return {
    ok: true,
    data: {
      files,
      skill: parsed.skill,
    },
    hash: bundleResult.hash,
  }
}

function normalizeAssignedAgentIds(config: CommonWorkspaceConfig, assignedAgentIds: string[]): string[] {
  const existingAgents = new Set(Object.keys(config.agent ?? {}))
  const uniqueAgentIds = Array.from(new Set(assignedAgentIds)).sort((left, right) => left.localeCompare(right))

  if (uniqueAgentIds.some((agentId) => !existingAgents.has(agentId))) {
    throw new SkillStoreError('unknown_agent')
  }

  return uniqueAgentIds
}

function mapSkillMutationError(error: unknown): SaveSkillResult {
  if (error instanceof SkillStoreError) {
    return { ok: false, error: error.code }
  }

  return { ok: false, error: 'write_failed' }
}

export async function saveSkillDocument(input: SaveSkillDocumentInput): Promise<SaveSkillResult> {
  try {
    const result = await mutateConfigRepo({
      expectedHash: input.expectedHash,
      commitMessage: input.mode === 'create'
        ? `Add skill ${input.name}`
        : `Update skill ${input.name}`,
      mutate: async ({ repoDir }) => {
        const config = await loadWorkspaceConfigFromRepoDir(repoDir)
        const assignedAgentIds = normalizeAssignedAgentIds(config, input.assignedAgentIds)
        const existingBundle = await readSkillBundleFromRepoDir(repoDir, input.name)

        if (input.mode === 'create' && existingBundle) {
          throw new SkillStoreError('skill_exists')
        }

        if (input.mode === 'update' && !existingBundle) {
          throw new SkillStoreError('not_found')
        }

        const skillMarkdown = createSkillMarkdown({
          name: input.name,
          description: input.description,
          body: input.body,
          existingFrontmatter: existingBundle?.skill.frontmatter,
        })
        const preservedFiles = existingBundle?.files.filter((file) => file.path !== SKILL_MARKDOWN_FILE_NAME) ?? []
        const nextFiles: SkillBundleFile[] = [
          { path: SKILL_MARKDOWN_FILE_NAME, content: new TextEncoder().encode(skillMarkdown) },
          ...preservedFiles,
        ]

        await writeSkillBundleToRepoDir(repoDir, input.name, nextFiles)

        const nextConfig = setSkillAssignments(config, input.name, assignedAgentIds)
        await writeWorkspaceConfigToRepoDir(repoDir, nextConfig)

        return [COMMON_WORKSPACE_CONFIG_FILE, getSkillConfigDirectory(input.name)]
      },
    })

    if (!result.ok) {
      return result
    }

    return { ok: true, hash: result.hash }
  } catch (error) {
    return mapSkillMutationError(error)
  }
}

export async function importSkillArchive(input: ImportSkillArchiveInput): Promise<SaveSkillResult> {
  const { archive } = input

  try {
    const result = await mutateConfigRepo({
      expectedHash: input.expectedHash,
      commitMessage: `Import skill ${archive.skill.frontmatter.name}`,
      mutate: async ({ repoDir }) => {
        const config = await loadWorkspaceConfigFromRepoDir(repoDir)
        const assignedAgentIds = normalizeAssignedAgentIds(config, input.assignedAgentIds)

        await writeSkillBundleToRepoDir(repoDir, archive.skill.frontmatter.name, archive.files)

        const nextConfig = setSkillAssignments(config, archive.skill.frontmatter.name, assignedAgentIds)
        await writeWorkspaceConfigToRepoDir(repoDir, nextConfig)

        return [COMMON_WORKSPACE_CONFIG_FILE, getSkillConfigDirectory(archive.skill.frontmatter.name)]
      },
    })

    if (!result.ok) {
      return result
    }

    return { ok: true, hash: result.hash }
  } catch (error) {
    return mapSkillMutationError(error)
  }
}

export async function deleteSkill(name: string, expectedHash?: string): Promise<SaveSkillResult> {
  try {
    const result = await mutateConfigRepo({
      expectedHash,
      commitMessage: `Delete skill ${name}`,
      mutate: async ({ repoDir }) => {
        const config = await loadWorkspaceConfigFromRepoDir(repoDir)
        const existingBundle = await readSkillBundleFromRepoDir(repoDir, name)
        if (!existingBundle) {
          throw new SkillStoreError('not_found')
        }

        await fs.rm(path.join(repoDir, getSkillConfigDirectory(name)), { recursive: true, force: true })

        const nextConfig = setSkillAssignments(config, name, [])
        await writeWorkspaceConfigToRepoDir(repoDir, nextConfig)

        return [COMMON_WORKSPACE_CONFIG_FILE, getSkillConfigDirectory(name)]
      },
    })

    if (!result.ok) {
      return result
    }

    return { ok: true, hash: result.hash }
  } catch (error) {
    return mapSkillMutationError(error)
  }
}

export async function getSkillsConfigHash(): Promise<
  | { ok: true; hash: string | null }
  | { ok: false; error: 'kb_unavailable' | 'read_failed' }
> {
  return getConfigRepoHash()
}
