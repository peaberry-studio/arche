import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('models-catalog', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('parses models.dev payload into provider/model entries', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        openai: {
          name: 'OpenAI',
          models: {
            'gpt-5': { name: 'GPT-5' },
          },
        },
        anthropic: {
          name: 'Anthropic',
          models: {
            'claude-sonnet-4': { name: 'Claude Sonnet 4' },
          },
        },
        'fireworks-ai': {
          name: 'Fireworks AI',
          models: {
            'accounts/fireworks/models/deepseek-v3p1': {
              name: 'DeepSeek V3.1',
            },
          },
        },
      }),
    })

    vi.stubGlobal('fetch', fetchMock)

    const { fetchModelsCatalog } = await import('@/lib/models-catalog')
    const result = await fetchModelsCatalog()

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.models).toEqual([
      { id: 'anthropic/claude-sonnet-4', label: 'Anthropic - Claude Sonnet 4' },
      {
        id: 'fireworks/accounts/fireworks/models/deepseek-v3p1',
        label: 'Fireworks AI - DeepSeek V3.1',
      },
      { id: 'openai/gpt-5', label: 'OpenAI - GPT-5' },
    ])
  })

  it('returns error when upstream is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failed')))

    const { fetchModelsCatalog } = await import('@/lib/models-catalog')
    const result = await fetchModelsCatalog()

    expect(result).toEqual({ ok: false, error: 'models_catalog_unavailable' })
  })
})
