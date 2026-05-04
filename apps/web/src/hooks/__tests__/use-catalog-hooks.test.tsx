/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgentsCatalog } from '@/hooks/use-agents-catalog'
import { useSkillsCatalog } from '@/hooks/use-skills-catalog'

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as Response
}

describe('catalog hooks', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads agents and supports manual reload', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({
        agents: [{ id: 'assistant', displayName: 'Assistant', isPrimary: true }],
      }))
      .mockResolvedValueOnce(jsonResponse({ agents: [] }))

    const { result } = renderHook(() => useAgentsCatalog('alice'))

    await waitFor(() => {
      expect(result.current.agents).toHaveLength(1)
    })
    expect(result.current.loadError).toBeNull()
    expect(fetch).toHaveBeenCalledWith('/api/u/alice/agents', { cache: 'no-store' })

    await act(async () => {
      await result.current.reload()
    })
    await waitFor(() => {
      expect(result.current.agents).toEqual([])
    })
  })

  it('captures agents load failures', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'load_failed' }, false))

    const { result } = renderHook(() => useAgentsCatalog('alice'))

    await waitFor(() => {
      expect(result.current.loadError).toBe('load_failed')
    })
    expect(result.current.isLoading).toBe(false)
  })

  it('loads skills with hash and captures network errors', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({
        hash: 'hash-1',
        skills: [
          {
            assignedAgentIds: ['assistant'],
            description: 'Draft messages',
            hasResources: false,
            name: 'writer',
            resourcePaths: [],
          },
        ],
      }))
      .mockRejectedValueOnce(new Error('network'))

    const { result } = renderHook(() => useSkillsCatalog('alice'))

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1)
    })
    expect(result.current.hash).toBe('hash-1')
    expect(fetch).toHaveBeenCalledWith('/api/u/alice/skills', { cache: 'no-store' })

    await act(async () => {
      await result.current.reload()
    })
    await waitFor(() => {
      expect(result.current.loadError).toBe('network_error')
    })
  })
})
