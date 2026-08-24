const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')

const { findAvailablePort } = require('@arche/desktop-runtime/network')

test('returns the preferred port when it is available', async () => {
  const port = await findAvailablePort(0, '127.0.0.1')
  assert.equal(Number.isInteger(port), true)
  assert.notEqual(port, 0)
})

test('does not reuse an excluded preferred port', async () => {
  const preferredPort = await findAvailablePort(0, '127.0.0.1')
  const port = await findAvailablePort(preferredPort, '127.0.0.1', [preferredPort])

  assert.notEqual(port, preferredPort)
})

test('falls back when the preferred port is already in use', async () => {
  const busyServer = net.createServer()
  // Use port 0 to let the OS pick an available ephemeral port, avoiding
  // conflicts with running dev servers (e.g. Next.js on 3000).
  await new Promise((resolve) => busyServer.listen(0, '127.0.0.1', resolve))
  const busyPort = busyServer.address().port

  try {
    const port = await findAvailablePort(busyPort, '127.0.0.1')
    assert.notEqual(port, busyPort)
  } finally {
    await new Promise((resolve, reject) => {
      busyServer.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }
})

function mockListenSteps(steps) {
  const originalCreateServer = net.createServer
  const remainingSteps = [...steps]

  net.createServer = () => {
    const step = remainingSteps.shift()
    let errorHandler = null

    return {
      once(event, handler) {
        if (event === 'error') {
          errorHandler = handler
        }
        return this
      },
      listen(_port, _host, callback) {
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
        return step.type === 'address' ? step.address : null
      },
      close(callback) {
        callback()
        return this
      },
    }
  }

  return () => {
    net.createServer = originalCreateServer
  }
}

test('throws when the preferred listener cannot resolve its address', async () => {
  const restore = mockListenSteps([{ type: 'address', address: null }])

  try {
    await assert.rejects(
      () => findAvailablePort(3000),
      /Failed to resolve listening port/,
    )
  } finally {
    restore()
  }
})

test('throws when fallback probing fails', async () => {
  const fallbackError = Object.assign(new Error('permission denied'), { code: 'EACCES' })
  const restore = mockListenSteps([
    { type: 'error', error: Object.assign(new Error('in use'), { code: 'EADDRINUSE' }) },
    { type: 'error', error: fallbackError },
  ])

  try {
    await assert.rejects(() => findAvailablePort(3000), fallbackError)
  } finally {
    restore()
  }
})

test('throws when every fallback port is excluded', async () => {
  const restore = mockListenSteps([
    { type: 'error', error: Object.assign(new Error('in use'), { code: 'EADDRINUSE' }) },
    ...Array.from({ length: 10 }, () => ({
      type: 'address',
      address: { address: '127.0.0.1', family: 'IPv4', port: 4000 },
    })),
  ])

  try {
    await assert.rejects(
      () => findAvailablePort(3000, [4000]),
      /Failed to find an available port after 10 fallback attempts/,
    )
  } finally {
    restore()
  }
})
