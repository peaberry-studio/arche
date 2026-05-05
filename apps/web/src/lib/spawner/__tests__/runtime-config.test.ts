import { describe, expect, it } from 'vitest'

import {
  getDefaultWebRuntimeConfigContent,
  parseRuntimeConfigContent,
  serializeRuntimeConfig,
} from '@/lib/spawner/runtime-config'

describe('runtime-config', () => {
  it('rejects parsed config content that is not an object', () => {
    expect(() => parseRuntimeConfigContent('[]')).toThrow('Invalid opencode config: expected a JSON object')
  })

  it('serializes nested config with deterministic object key ordering', () => {
    expect(serializeRuntimeConfig({ z: [{ b: 2, a: 1 }], a: true })).toBe('{"a":true,"z":[{"a":1,"b":2}]}')
  })

  it('builds default web runtime config content', () => {
    const parsed = parseRuntimeConfigContent(getDefaultWebRuntimeConfigContent())

    expect(parsed).toHaveProperty('provider')
    expect(parsed).toHaveProperty('permission')
  })
})
