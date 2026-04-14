import { afterEach, describe, expect, it, vi } from 'vitest'

describe('docker module import', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/common-workspace-config-store')
    vi.doUnmock('fs/promises')
    vi.doUnmock('node:fs/promises')
    vi.doUnmock('path')
    vi.resetModules()
  })

  it('does not load node builtins eagerly on module import', async () => {
    vi.doMock('@/lib/common-workspace-config-store', () => {
      throw new Error('common-workspace-config-store should not load during docker module import')
    })
    vi.doMock('fs/promises', () => {
      throw new Error('fs/promises should not load during docker module import')
    })
    vi.doMock('node:fs/promises', () => {
      throw new Error('node:fs/promises should not load during docker module import')
    })
    vi.doMock('path', () => {
      throw new Error('path should not load during docker module import')
    })

    await expect(import('../docker')).resolves.toBeTruthy()
  })
})
