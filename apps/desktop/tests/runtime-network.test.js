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
  await new Promise((resolve) => busyServer.listen(3000, '127.0.0.1', resolve))

  try {
    const port = await findAvailablePort(3000, '127.0.0.1')
    assert.notEqual(port, 3000)
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
