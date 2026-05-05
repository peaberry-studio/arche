import { describe, expect, it } from 'vitest'

import * as runtime from '@/lib/runtime'

describe('runtime index exports', () => {
  it('exposes the public runtime helpers', () => {
    expect(runtime.getRuntimeMode).toBeTypeOf('function')
    expect(runtime.getRuntimeCapabilities).toBeTypeOf('function')
    expect(runtime.getSession).toBeTypeOf('function')
    expect(runtime.getWorkspaceStatus).toBeTypeOf('function')
    expect(runtime.startWorkspace).toBeTypeOf('function')
    expect(runtime.stopWorkspace).toBeTypeOf('function')
  })
})
