import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/skills/skill-store', () => ({
  listSkills: vi.fn(),
  readSkill: vi.fn(),
  readSkillBundle: vi.fn(),
}))

import {
  listSkills,
  readSkill,
  readSkillBundle,
} from '@/lib/skills/skill-store'
import {
  listSkillsForMcp,
  readSkillForMcp,
  readSkillResource,
} from '../skills'

const mockListSkills = vi.mocked(listSkills)
const mockReadSkill = vi.mocked(readSkill)
const mockReadSkillBundle = vi.mocked(readSkillBundle)

describe('mcp skill tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists skills through the shared skill store', async () => {
    mockListSkills.mockResolvedValue({
      ok: true,
      data: [
        {
          assignedAgentIds: ['assistant'],
          description: 'Run lint before coding',
          hasResources: true,
          name: 'lint',
          resourcePaths: ['scripts/check.sh'],
        },
      ],
      hash: 'hash-1',
    })

    await expect(listSkillsForMcp()).resolves.toEqual({
      ok: true,
      data: [
        {
          assignedAgentIds: ['assistant'],
          description: 'Run lint before coding',
          hasResources: true,
          name: 'lint',
          resourcePaths: ['scripts/check.sh'],
        },
      ],
      hash: 'hash-1',
    })
  })

  it('reads a skill through the shared skill store', async () => {
    mockReadSkill.mockResolvedValue({
      ok: true,
      data: {
        assignedAgentIds: ['assistant'],
        body: 'Always lint first.',
        description: 'Run lint before coding',
        hasResources: false,
        name: 'lint',
        resourcePaths: [],
      },
      hash: 'hash-2',
    })

    await expect(readSkillForMcp('lint')).resolves.toEqual({
      ok: true,
      data: {
        assignedAgentIds: ['assistant'],
        body: 'Always lint first.',
        description: 'Run lint before coding',
        hasResources: false,
        name: 'lint',
        resourcePaths: [],
      },
      hash: 'hash-2',
    })
  })

  it('reads text resources and truncates them by line count', async () => {
    mockReadSkillBundle.mockResolvedValue({
      ok: true,
      data: {
        files: [
          {
            path: 'scripts/check.sh',
            content: new TextEncoder().encode('one\ntwo\nthree\n'),
          },
        ],
        skill: {
          body: 'Always lint first.',
          frontmatter: {
            description: 'Run lint before coding',
            name: 'lint',
          },
          raw: 'raw',
        },
      },
      hash: 'hash-3',
    })

    await expect(readSkillResource({
      name: 'lint',
      path: 'scripts/check.sh',
      maxLines: 2,
    })).resolves.toEqual({
      ok: true,
      content: 'one\ntwo\n[truncated - 3 lines total]',
      hash: 'hash-3',
      kind: 'text',
      metadata: {
        name: 'check.sh',
        path: 'scripts/check.sh',
        size: 14,
      },
      truncated: true,
    })
  })

  it('returns metadata for binary resources', async () => {
    mockReadSkillBundle.mockResolvedValue({
      ok: true,
      data: {
        files: [
          {
            path: 'images/logo.png',
            content: Uint8Array.of(0, 1, 2, 3),
          },
        ],
        skill: {
          body: 'Always lint first.',
          frontmatter: {
            description: 'Run lint before coding',
            name: 'lint',
          },
          raw: 'raw',
        },
      },
      hash: 'hash-4',
    })

    await expect(readSkillResource({
      name: 'lint',
      path: 'images/logo.png',
    })).resolves.toEqual({
      ok: true,
      hash: 'hash-4',
      kind: 'binary',
      metadata: {
        name: 'logo.png',
        path: 'images/logo.png',
        size: 4,
      },
    })
  })

  it('rejects unsafe resource paths', async () => {
    await expect(readSkillResource({
      name: 'lint',
      path: '../secrets.txt',
    })).resolves.toEqual({ ok: false, error: 'invalid_path' })
  })
})
