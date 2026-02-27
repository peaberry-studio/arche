import { describe, expect, it } from 'vitest'

import { filterModelsByEnabledProviders } from '@/lib/providers/model-visibility'
import type { AvailableModel } from '@/lib/opencode/types'

const MODELS: AvailableModel[] = [
  {
    providerId: 'openai',
    providerName: 'OpenAI',
    modelId: 'gpt-5.2',
    modelName: 'GPT-5.2',
    isDefault: false,
  },
  {
    providerId: 'opencode',
    providerName: 'OpenCode Zen',
    modelId: 'scene-free',
    modelName: 'Scene Free',
    isDefault: true,
  },
]

describe('filterModelsByEnabledProviders', () => {
  it('keeps OpenCode Zen models visible even when there are no enabled credentials', () => {
    const result = filterModelsByEnabledProviders(MODELS, new Set())

    expect(result).toEqual([
      expect.objectContaining({ providerId: 'opencode', modelId: 'scene-free' }),
    ])
  })

  it('keeps paid-provider models only when that provider is enabled', () => {
    const result = filterModelsByEnabledProviders(MODELS, new Set(['openai']))

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'openai', modelId: 'gpt-5.2' }),
        expect.objectContaining({ providerId: 'opencode', modelId: 'scene-free' }),
      ]),
    )
  })
})
