const test = require('node:test')
const assert = require('node:assert/strict')

const { startRuntimeWithPortRetries } = require('../dist/runtime-start.js')

test('retries startup on another port after a failed first attempt', async () => {
  const acquired = []
  const started = []
  const retries = []
  const allocatedPorts = [3000, 4312]

  const port = await startRuntimeWithPortRetries({
    preferredPort: 3000,
    maxAttempts: 4,
    acquirePort: async (preferredPort, excludedPorts) => {
      acquired.push({ preferredPort, excludedPorts: [...excludedPorts] })
      return allocatedPorts.shift()
    },
    start: async (nextPort, attempt) => {
      started.push({ port: nextPort, attempt })
      if (nextPort === 3000) {
        throw new Error('desktop readiness validation failed')
      }
    },
    onRetry: (event) => {
      retries.push({
        attempt: event.attempt,
        previousPort: event.previousPort,
        message: event.error instanceof Error ? event.error.message : String(event.error),
      })
    },
  })

  assert.equal(port, 4312)
  assert.deepEqual(acquired, [
    { preferredPort: 3000, excludedPorts: [] },
    { preferredPort: 0, excludedPorts: [3000] },
  ])
  assert.deepEqual(started, [
    { port: 3000, attempt: 1 },
    { port: 4312, attempt: 2 },
  ])
  assert.deepEqual(retries, [
    {
      attempt: 2,
      previousPort: 3000,
      message: 'desktop readiness validation failed',
    },
  ])
})

test('throws an aggregate startup error after exhausting retries', async () => {
  const attempts = []

  await assert.rejects(
    startRuntimeWithPortRetries({
      preferredPort: 3000,
      maxAttempts: 2,
      acquirePort: async (preferredPort, excludedPorts) => {
        attempts.push({ preferredPort, excludedPorts: [...excludedPorts] })
        return preferredPort === 3000 ? 3000 : 4312
      },
      start: async (port) => {
        throw new Error(`failed:${port}`)
      },
    }),
    (error) => {
      assert.equal(error instanceof AggregateError, true)
      assert.equal(error.message, 'Failed to start the local desktop runtime after 2 attempts.')
      assert.deepEqual(
        error.errors.map((attemptError) => attemptError.message),
        ['failed:3000', 'failed:4312'],
      )
      return true
    },
  )

  assert.deepEqual(attempts, [
    { preferredPort: 3000, excludedPorts: [] },
    { preferredPort: 0, excludedPorts: [3000] },
  ])
})
