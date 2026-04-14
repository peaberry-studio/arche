import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import {
  getConfigRepoHash,
  mutateConfigRepo,
  listConfigRepoFiles,
  readConfigRepoSnapshot,
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

type SkillStoreReadErrorCode = 'invalid_config' | 'kb_unavailable' | 'not_found' | 'read_failed'

class SkillStoreReadError extends Error {
  constructor(readonly code: SkillStoreReadErrorCode) {
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

async function loadSkillBundleFromRepoDir(repoDir: string, name: string): Promise<
  | { ok: true; bundle: SkillBundle }
  | { ok: false; error: 'not_found' | 'read_failed' }
> {
  const skillDir = path.join(repoDir, getSkillConfigDirectory(name))
  const stats = await fs.stat(skillDir).catch(() => null)
  if (!stats?.isDirectory()) {
    return { ok: false, error: 'not_found' }
  }

  const files = await listFilesRecursive(skillDir)
  const skillMarkdown = files.find((file) => file.path === SKILL_MARKDOWN_FILE_NAME)
  if (!skillMarkdown) {
    return { ok: false, error: 'read_failed' }
  }

  const parsed = parseSkillMarkdown(Buffer.from(skillMarkdown.content).toString('utf-8'), name)
  if (!parsed.ok) {
    return { ok: false, error: 'read_failed' }
  }

  return {
    ok: true,
    bundle: {
      files,
      skill: parsed.skill,
    },
  }
}

async function readSkillBundleFromRepoDir(repoDir: string, name: string): Promise<SkillBundle | null> {
  const result = await loadSkillBundleFromRepoDir(repoDir, name)
  return result.ok ? result.bundle : null
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

async function listSkillNamesFromRepoDir(repoDir: string): Promise<string[]> {
  const skillsDir = path.join(repoDir, SKILLS_CONFIG_DIRECTORY)
  const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }

    throw error
  })

  if (!entries) {
    return []
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
}

export async function readSkillBundlesFromRepoDir(
  repoDir: string,
  options: { strict?: boolean } = {}
): Promise<SkillBundle[]> {
  const skillNames = await listSkillNamesFromRepoDir(repoDir)
  const bundles: SkillBundle[] = []

  for (const name of skillNames) {
    const result = await loadSkillBundleFromRepoDir(repoDir, name)
    if (!result.ok) {
      if (options.strict) {
        throw new SkillStoreReadError(result.error === 'not_found' ? 'read_failed' : result.error)
      }

      continue
    }

    bundles.push(result.bundle)
  }

  return bundles
}

function mapSkillStoreReadError(error: unknown): SkillStoreReadErrorCode {
  if (error instanceof SkillStoreError && error.code === 'invalid_config') {
    return 'invalid_config'
  }

  if (error instanceof SkillStoreReadError) {
    return error.code
  }

  return 'read_failed'
}

async function readSkillStoreSnapshot<T>(
  reader: (repoDir: string) => Promise<T>
): Promise<{ ok: true; data: T; hash: string | null } | { ok: false; error: SkillStoreReadErrorCode }> {
  try {
    const snapshot = await readConfigRepoSnapshot(async ({ repoDir }) => reader(repoDir))
    if (!snapshot.ok) {
      return { ok: false, error: snapshot.error }
    }

    return snapshot
  } catch (error) {
    return { ok: false, error: mapSkillStoreReadError(error) }
  }
}

export async function listSkills(): Promise<SkillStoreResult<SkillSummary[]>> {
  const snapshot = await readSkillStoreSnapshot(async (repoDir) => {
    const config = await loadWorkspaceConfigFromRepoDir(repoDir)
    const bundles = await readSkillBundlesFromRepoDir(repoDir, { strict: true })

    return bundles.map((bundle) =>
      createSkillSummary(
        bundle,
        getAssignedAgentIdsForSkill(config, bundle.skill.frontmatter.name)
      )
    )
  })

  if (!snapshot.ok) {
    return snapshot
  }

  return { ok: true, data: snapshot.data, hash: snapshot.hash }
}

export async function listSkillBundles(): Promise<SkillStoreResult<SkillBundle[]>> {
  const snapshot = await readSkillStoreSnapshot(async (repoDir) =>
    readSkillBundlesFromRepoDir(repoDir, { strict: true })
  )

  if (!snapshot.ok) {
    return snapshot
  }

  return { ok: true, data: snapshot.data, hash: snapshot.hash }
}

export async function readSkill(name: string): Promise<SkillStoreResult<SkillDetail>> {
  const snapshot = await readSkillStoreSnapshot(async (repoDir) => {
    const config = await loadWorkspaceConfigFromRepoDir(repoDir)
    const bundleResult = await loadSkillBundleFromRepoDir(repoDir, name)
    if (!bundleResult.ok) {
      throw new SkillStoreReadError(bundleResult.error)
    }

    const summary = createSkillSummary(
      bundleResult.bundle,
      getAssignedAgentIdsForSkill(config, bundleResult.bundle.skill.frontmatter.name)
    )

    return {
      ...summary,
      body: bundleResult.bundle.skill.body,
    }
  })

  if (!snapshot.ok) {
    return snapshot
  }

  return {
    ok: true,
    data: snapshot.data,
    hash: snapshot.hash,
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
