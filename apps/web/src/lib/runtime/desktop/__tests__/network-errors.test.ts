import type { AddressInfo } from 'net'

import { afterEach, describe, expect, it, vi } from 'vitest'

type ListenStep =
  | { type: 'address'; address: AddressInfo | string | null }
  | { type: 'error'; error: NodeJS.ErrnoException }

function mockListenSteps(steps: ListenStep[]) {
  const remainingSteps = [...steps]
  const createServer = vi.fn(() => {
    const step = remainingSteps.shift()
    let errorHandler: ((error: NodeJS.ErrnoException) => void) | null = null

    return {
      once(event: string, handler: (error: NodeJS.ErrnoException) => void) {
        if (event === 'error') {
          errorHandler = handler
        }
        return this
      },
      listen(_port: number, _host: string, callback: () => void) {
        if (!step) {
          throw new Error('Unexpected listen call')
        }

        if (step.type === 'error') {
          errorHandler?.(step.error)
          return this
        }

        callback()
        return this
      },
      address() {
        return step?.type === 'address' ? step.address : null
      },
      close(callback: () => void) {
        callback()
        return this
      },
    }
  })

  vi.doMock('net', () => ({ createServer }))
  return createServer
}

function address(port: number): AddressInfo {
  return { address: '127.0.0.1', family: 'IPv4', port }
}

describe('findAvailablePort error handling', () => {
  afterEach(() => {
    vi.doUnmock('net')
    vi.resetModules()
  })

  it('throws when the preferred listener cannot resolve its address', async () => {
    mockListenSteps([{ type: 'address', address: null }])
    const { findAvailablePort } = await import('@/lib/runtime/desktop/network')

    await expect(findAvailablePort(3000)).rejects.toThrow('Failed to resolve listening port')
  })

  it('throws when fallback probing fails', async () => {
    const fallbackError = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    mockListenSteps([
      { type: 'error', error: Object.assign(new Error('in use'), { code: 'EADDRINUSE' }) },
      { type: 'error', error: fallbackError },
    ])
    const { findAvailablePort } = await import('@/lib/runtime/desktop/network')

    await expect(findAvailablePort(3000)).rejects.toBe(fallbackError)
  })

  it('throws when every fallback port is excluded', async () => {
    mockListenSteps([
      { type: 'error', error: Object.assign(new Error('in use'), { code: 'EADDRINUSE' }) },
      ...Array.from({ length: 10 }, () => ({ type: 'address' as const, address: address(4000) })),
    ])
    const { findAvailablePort } = await import('@/lib/runtime/desktop/network')

    await expect(findAvailablePort(3000, [4000])).rejects.toThrow(
      'Failed to find an available port after 10 fallback attempts.',
    )
  })
})
