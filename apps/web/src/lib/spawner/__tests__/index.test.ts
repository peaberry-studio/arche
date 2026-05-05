import { describe, expect, it } from 'vitest'

import * as spawner from '@/lib/spawner'

describe('spawner index exports', () => {
  it('exposes the public spawner helpers', () => {
    expect(spawner.getContainerProxyUrl).toBeTypeOf('function')
    expect(spawner.generatePassword).toBeTypeOf('function')
    expect(spawner.startInstance).toBeTypeOf('function')
    expect(spawner.startReaper).toBeTypeOf('function')
    expect(spawner.buildMcpConfigFromConnectors).toBeTypeOf('function')
  })
})
