const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')

const { findAvailablePort } = require('../dist/runtime-network.js')

test('returns the preferred port when it is available', async () => {
  const port = await findAvailablePort(0, '127.0.0.1')
  assert.equal(Number.isInteger(port), true)
  assert.notEqual(port, 0)
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
