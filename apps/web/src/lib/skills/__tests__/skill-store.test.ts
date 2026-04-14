import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getConfigRepoHashMock = vi.fn()
const listConfigRepoFilesMock = vi.fn()
const mutateConfigRepoMock = vi.fn()
const readConfigRepoSnapshotMock = vi.fn()

let repoDir: string | null = null

async function writeRepoFile(relativePath: string, content: string): Promise<void> {
  if (!repoDir) {
    throw new Error('repo_not_configured')
  }

  const filePath = path.join(repoDir, relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
}

async function createSkillRepo(files: Record<string, string>): Promise<void> {
  repoDir = await fs.mkdtemp(path.join(tmpdir(), 'skill-store-'))
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

describe('skill-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('lists skills from a single config repo snapshot', async () => {
    await createSkillRepo({
      'CommonWorkspaceConfig.json': createWorkspaceConfig(),
      'skills/pdf-processing/SKILL.md': createSkillMarkdown(),
      'skills/pdf-processing/references/guide.md': '# Guide\n',
    })

    const { listSkills } = await loadSkillStoreModule()
    const result = await listSkills()

    expect(result).toEqual({
      ok: true,
      hash: 'snapshot-hash',
      data: [
        {
          assignedAgentIds: ['assistant'],
          description: 'Handle PDF workflows',
          hasResources: true,
          name: 'pdf-processing',
          resourcePaths: ['references/guide.md'],
        },
      ],
    })
    expect(readConfigRepoSnapshotMock).toHaveBeenCalledTimes(1)
    expect(listConfigRepoFilesMock).not.toHaveBeenCalled()
  })

  it('reads a skill from a single config repo snapshot', async () => {
    await createSkillRepo({
      'CommonWorkspaceConfig.json': createWorkspaceConfig(),
      'skills/pdf-processing/SKILL.md': createSkillMarkdown(),
    })

    const { readSkill } = await loadSkillStoreModule()
    const result = await readSkill('pdf-processing')

    expect(result).toEqual({
      ok: true,
      hash: 'snapshot-hash',
      data: {
        assignedAgentIds: ['assistant'],
        body: '## Workflow',
        description: 'Handle PDF workflows',
        hasResources: false,
        name: 'pdf-processing',
        resourcePaths: [],
      },
    })
    expect(readConfigRepoSnapshotMock).toHaveBeenCalledTimes(1)
    expect(listConfigRepoFilesMock).not.toHaveBeenCalled()
  })

  it('fails bundle listing when a skill directory is malformed', async () => {
    await createSkillRepo({
      'CommonWorkspaceConfig.json': createWorkspaceConfig(),
      'skills/pdf-processing/README.md': '# Missing skill markdown\n',
    })

    const { listSkillBundles } = await loadSkillStoreModule()

    await expect(listSkillBundles()).resolves.toEqual({
      ok: false,
      error: 'read_failed',
    })
  })
})
