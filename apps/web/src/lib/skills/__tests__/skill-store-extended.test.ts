import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'

const getConfigRepoHashMock = vi.fn()
const listConfigRepoFilesMock = vi.fn()
const mutateConfigRepoMock = vi.fn()
const readConfigRepoSnapshotMock = vi.fn()

let repoDir: string | null = null

async function writeRepoFile(relativePath: string, content: string): Promise<void> {
  if (!repoDir) {
    throw new Error('repo_not_configured')
  }

  const filePath = join(repoDir, relativePath)
  await fs.mkdir(join(filePath, '..'), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
}

async function createSkillRepo(files: Record<string, string>): Promise<void> {
  repoDir = await fs.mkdtemp(join(tmpdir(), 'skill-store-'))
  await Promise.all(Object.entries(files).map(([relativePath, content]) => writeRepoFile(relativePath, content)))
}

function createWorkspaceConfig(skillName = 'pdf-processing'): string {
  return JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      default_agent: 'assistant',
      agent: {
        assistant: {
          mode: 'primary',
          tools: {
            skill: true,
          },
          permission: {
            skill: {
              '*': 'deny',
              [skillName]: 'allow',
            },
          },
        },
      },
    },
    null,
    2,
  )
}

function createSkillMarkdown(skillName = 'pdf-processing'): string {
  return [
    '---',
    `name: ${skillName}`,
    'description: Handle PDF workflows',
    '---',
    '## Workflow',
  ].join('\n')
}

async function loadSkillStoreModule() {
  vi.resetModules()
  vi.doMock('@/lib/config-repo-store', () => ({
    getConfigRepoHash: () => getConfigRepoHashMock(),
    listConfigRepoFiles: (...args: unknown[]) => listConfigRepoFilesMock(...args),
    mutateConfigRepo: (...args: unknown[]) => mutateConfigRepoMock(...args),
    readConfigRepoSnapshot: (
      reader: (context: { repoDir: string; hash: string | null }) => Promise<unknown>
    ) => readConfigRepoSnapshotMock(reader),
  }))

  return import('@/lib/skills/skill-store')
}

describe('skill-store extended', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutateConfigRepoMock.mockReset()
    readConfigRepoSnapshotMock.mockImplementation(
      async (
        reader: (context: { repoDir: string; hash: string | null }) => Promise<unknown>
      ) => {
        if (!repoDir) {
          throw new Error('repo_not_configured')
        }

        const hash = 'snapshot-hash'
        return {
          ok: true,
          hash,
          data: await reader({ repoDir, hash }),
        }
      }
    )
  })

  afterEach(async () => {
    if (repoDir) {
      await fs.rm(repoDir, { recursive: true, force: true })
      repoDir = null
    }

    vi.unmock('@/lib/config-repo-store')
    vi.resetModules()
  })

  it('returns empty list when skills directory does not exist', async () => {
    await createSkillRepo({
      'CommonWorkspaceConfig.json': createWorkspaceConfig(),
    })

    const { listSkills } = await loadSkillStoreModule()
    const result = await listSkills()

    expect(result).toEqual({
      ok: true,
      hash: 'snapshot-hash',
      data: [],
    })
  })

  it('returns not_found when reading a nonexistent skill', async () => {
    await createSkillRepo({
      'CommonWorkspaceConfig.json': createWorkspaceConfig(),
    })

    const { readSkill } = await loadSkillStoreModule()
    const result = await readSkill('nonexistent')

    expect(result).toEqual({
      ok: false,
      error: 'not_found',
    })
  })

  it('reads a skill bundle from listConfigRepoFiles', async () => {
    listConfigRepoFilesMock.mockResolvedValue({
      ok: true,
      files: [
        { path: 'skills/pdf-processing/SKILL.md', content: Buffer.from(createSkillMarkdown()) },
        { path: 'skills/pdf-processing/references/guide.md', content: Buffer.from('# Guide\n') },
      ],
      hash: 'bundle-hash',
    })

    const { readSkillBundle } = await loadSkillStoreModule()
    const result = await readSkillBundle('pdf-processing')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.files.map((f) => f.path)).toEqual([
      'SKILL.md',
      'references/guide.md',
    ])
    expect(result.hash).toBe('bundle-hash')
  })

  it('returns not_found when SKILL.md is missing in bundle', async () => {
    listConfigRepoFilesMock.mockResolvedValue({
      ok: true,
      files: [
        { path: 'skills/pdf-processing/README.md', content: Buffer.from('# README\n') },
      ],
      hash: 'bundle-hash',
    })

    const { readSkillBundle } = await loadSkillStoreModule()
    const result = await readSkillBundle('pdf-processing')

    expect(result).toEqual({
      ok: false,
      error: 'not_found',
    })
  })

  it('creates a new skill document successfully', async () => {
    await createSkillRepo({
      'CommonWorkspaceConfig.json': createWorkspaceConfig(),
    })

    mutateConfigRepoMock.mockImplementation(async ({ mutate }: { mutate: (ctx: { repoDir: string }) => Promise<string[]> }) => {
      if (!repoDir) throw new Error('repo_not_configured')
      await mutate({ repoDir })
      return { ok: true, hash: 'new-hash' }
    })

    const { saveSkillDocument } = await loadSkillStoreModule()
    const result = await saveSkillDocument({
      mode: 'create',
      name: 'pdf-processing',
      description: 'Handle PDF workflows',
      body: '## Workflow',
      assignedAgentIds: ['assistant'],
    })

    expect(result).toEqual({
      ok: true,
      hash: 'new-hash',
    })
  })

  it('rejects creating a skill that already exists', async () => {
    await createSkillRepo({
      'CommonWorkspaceConfig.json': createWorkspaceConfig(),
      'skills/pdf-processing/SKILL.md': createSkillMarkdown(),
    })

    mutateConfigRepoMock.mockImplementation(async ({ mutate }: { mutate: (ctx: { repoDir: string }) => Promise<string[]> }) => {
      if (!repoDir) throw new Error('repo_not_configured')
      await mutate({ repoDir })
      return { ok: true, hash: 'new-hash' }
    })

    const { saveSkillDocument } = await loadSkillStoreModule()
    const result = await saveSkillDocument({
      mode: 'create',
      name: 'pdf-processing',
      description: 'Handle PDF workflows',
      body: '## Workflow',
      assignedAgentIds: ['assistant'],
    })

    expect(result).toEqual({
      ok: false,
      error: 'skill_exists',
    })
  })

  it('updates an existing skill document', async () => {
    await createSkillRepo({
      'CommonWorkspaceConfig.json': createWorkspaceConfig(),
      'skills/pdf-processing/SKILL.md': createSkillMarkdown(),
    })

    mutateConfigRepoMock.mockImplementation(async ({ mutate }: { mutate: (ctx: { repoDir: string }) => Promise<string[]> }) => {
      if (!repoDir) throw new Error('repo_not_configured')
      await mutate({ repoDir })
      return { ok: true, hash: 'updated-hash' }
    })

    const { saveSkillDocument } = await loadSkillStoreModule()
    const result = await saveSkillDocument({
      mode: 'update',
      name: 'pdf-processing',
      description: 'Updated description',
      body: '## Updated Workflow',
      assignedAgentIds: ['assistant'],
    })

    expect(result).toEqual({
      ok: true,
      hash: 'updated-hash',
    })
  })

  it('rejects updating a nonexistent skill', async () => {
    await createSkillRepo({
      'CommonWorkspaceConfig.json': createWorkspaceConfig(),
    })

    mutateConfigRepoMock.mockImplementation(async ({ mutate }: { mutate: (ctx: { repoDir: string }) => Promise<string[]> }) => {
      if (!repoDir) throw new Error('repo_not_configured')
      await mutate({ repoDir })
      return { ok: true, hash: 'updated-hash' }
    })

    const { saveSkillDocument } = await loadSkillStoreModule()
    const result = await saveSkillDocument({
      mode: 'update',
      name: 'pdf-processing',
      description: 'Handle PDF workflows',
      body: '## Workflow',
      assignedAgentIds: ['assistant'],
    })

    expect(result).toEqual({
      ok: false,
      error: 'not_found',
    })
  })

  it('rejects unknown agent IDs', async () => {
    await createSkillRepo({
      'CommonWorkspaceConfig.json': createWorkspaceConfig(),
    })

    mutateConfigRepoMock.mockImplementation(async ({ mutate }: { mutate: (ctx: { repoDir: string }) => Promise<string[]> }) => {
      if (!repoDir) throw new Error('repo_not_configured')
      await mutate({ repoDir })
      return { ok: true, hash: 'new-hash' }
    })

    const { saveSkillDocument } = await loadSkillStoreModule()
    const result = await saveSkillDocument({
      mode: 'create',
      name: 'pdf-processing',
      description: 'Handle PDF workflows',
      body: '## Workflow',
      assignedAgentIds: ['unknown-agent'],
    })

    expect(result).toEqual({
      ok: false,
      error: 'unknown_agent',
    })
  })

  it('imports a skill archive', async () => {
    await createSkillRepo({
      'CommonWorkspaceConfig.json': createWorkspaceConfig(),
    })

    mutateConfigRepoMock.mockImplementation(async ({ mutate }: { mutate: (ctx: { repoDir: string }) => Promise<string[]> }) => {
      if (!repoDir) throw new Error('repo_not_configured')
      await mutate({ repoDir })
      return { ok: true, hash: 'import-hash' }
    })

    const { importSkillArchive } = await loadSkillStoreModule()
    const result = await importSkillArchive({
      archive: {
        skill: {
          frontmatter: { name: 'pdf-processing', description: 'Imported' },
          body: '## Imported',
          raw: '',
        },
        files: [
          { path: 'SKILL.md', content: new TextEncoder().encode('---\nname: pdf-processing\ndescription: Imported\n---\n## Imported') },
        ],
      },
      assignedAgentIds: ['assistant'],
    })

    expect(result).toEqual({
      ok: true,
      hash: 'import-hash',
    })
  })

  it('deletes an existing skill', async () => {
    await createSkillRepo({
      'CommonWorkspaceConfig.json': createWorkspaceConfig(),
      'skills/pdf-processing/SKILL.md': createSkillMarkdown(),
    })

    mutateConfigRepoMock.mockImplementation(async ({ mutate }: { mutate: (ctx: { repoDir: string }) => Promise<string[]> }) => {
      if (!repoDir) throw new Error('repo_not_configured')
      await mutate({ repoDir })
      return { ok: true, hash: 'delete-hash' }
    })

    const { deleteSkill } = await loadSkillStoreModule()
    const result = await deleteSkill('pdf-processing')

    expect(result).toEqual({
      ok: true,
      hash: 'delete-hash',
    })
  })

  it('returns not_found when deleting a nonexistent skill', async () => {
    await createSkillRepo({
      'CommonWorkspaceConfig.json': createWorkspaceConfig(),
    })

    mutateConfigRepoMock.mockImplementation(async ({ mutate }: { mutate: (ctx: { repoDir: string }) => Promise<string[]> }) => {
      if (!repoDir) throw new Error('repo_not_configured')
      await mutate({ repoDir })
      return { ok: true, hash: 'delete-hash' }
    })

    const { deleteSkill } = await loadSkillStoreModule()
    const result = await deleteSkill('nonexistent')

    expect(result).toEqual({
      ok: false,
      error: 'not_found',
    })
  })

  it('returns kb_unavailable when config repo snapshot fails', async () => {
    readConfigRepoSnapshotMock.mockResolvedValue({ ok: false, error: 'kb_unavailable' })

    const { listSkills } = await loadSkillStoreModule()
    const result = await listSkills()

    expect(result).toEqual({
      ok: false,
      error: 'kb_unavailable',
    })
  })

  it('propagates conflict from mutateConfigRepo', async () => {
    await createSkillRepo({
      'CommonWorkspaceConfig.json': createWorkspaceConfig(),
    })

    mutateConfigRepoMock.mockResolvedValue({ ok: false, error: 'conflict' })

    const { saveSkillDocument } = await loadSkillStoreModule()
    const result = await saveSkillDocument({
      mode: 'create',
      name: 'pdf-processing',
      description: 'Handle PDF workflows',
      body: '## Workflow',
      assignedAgentIds: ['assistant'],
    })

    expect(result).toEqual({
      ok: false,
      error: 'conflict',
    })
  })

  it('gets skills config hash', async () => {
    getConfigRepoHashMock.mockResolvedValue({ ok: true, hash: 'abc123' })

    const { getSkillsConfigHash } = await loadSkillStoreModule()
    const result = await getSkillsConfigHash()

    expect(result).toEqual({
      ok: true,
      hash: 'abc123',
    })
  })

  it('returns read_failed from getSkillsConfigHash', async () => {
    getConfigRepoHashMock.mockResolvedValue({ ok: false, error: 'read_failed' })

    const { getSkillsConfigHash } = await loadSkillStoreModule()
    const result = await getSkillsConfigHash()

    expect(result).toEqual({
      ok: false,
      error: 'read_failed',
    })
  })
})
