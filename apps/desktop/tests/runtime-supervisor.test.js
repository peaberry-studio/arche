const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

class MockStream extends EventEmitter {}

class MockChildProcess extends EventEmitter {
  constructor(pid = 4242) {
    super()
    this.pid = pid
    this.killed = false
    this.stdout = new MockStream()
    this.stderr = new MockStream()
    this.killCalls = []
  }

  kill(signal) {
    this.killed = true
    this.killCalls.push(signal)
    return true
  }
}

function createSupervisor(overrides = {}) {
  const logs = []
  const child = overrides.child ?? new MockChildProcess()
  const options = {
    command: 'pnpm',
    args: ['dev'],
    cwd: '/tmp/arche',
    env: { PORT: '3000' },
    componentName: 'next',
    readyTimeoutMs: 100,
    readyPollIntervalMs: 1,
    shutdownTimeoutMs: 20,
    platform: 'darwin',
    spawnProcess: () => child,
    probeReadiness: async () => true,
    log: (event) => logs.push(event),
    ...overrides,
  }

  const { RuntimeSupervisor } = require('../dist/runtime-supervisor.js')

  return {
    child,
    logs,
    supervisor: new RuntimeSupervisor(options),
  }
}

test('transitions to running after readiness succeeds', async () => {
  const { supervisor, logs } = createSupervisor()

  await supervisor.start()

  assert.equal(supervisor.getState(), 'running')
  assert.equal(logs.some((event) => event.event === 'state_changed' && event.state === 'starting'), true)
  assert.equal(logs.some((event) => event.event === 'state_changed' && event.state === 'running'), true)
})

test('fails startup when the process exits before readiness', async () => {
  const child = new MockChildProcess()
  const { supervisor } = createSupervisor({
    child,
    probeReadiness: async () => false,
    readyTimeoutMs: 50,
  })

  setImmediate(() => {
    child.emit('exit', 1, null)
  })

  await assert.rejects(supervisor.start(), /exited before readiness/)
  assert.equal(supervisor.getState(), 'error')
})

test('kills the child when readiness times out during startup', async () => {
  const child = new MockChildProcess(3030)
  const signals = []
  const originalKill = process.kill
  process.kill = (pid, signal) => {
    signals.push([pid, signal])
    setImmediate(() => {
      child.killed = true
      child.emit('exit', 0, signal)
    })
  }

  try {
    const { supervisor } = createSupervisor({
      child,
      probeReadiness: async () => false,
      readyTimeoutMs: 5,
      shutdownTimeoutMs: 5,
    })

    await assert.rejects(supervisor.start(), /readiness timeout/)
    assert.deepEqual(signals[0], [-3030, 'SIGTERM'])
    assert.equal(supervisor.getState(), 'error')
  } finally {
    process.kill = originalKill
  }
})

test('stops the detached process group on shutdown', async () => {
  const child = new MockChildProcess(9999)
  const signals = []
  const originalKill = process.kill
  process.kill = (pid, signal) => {
    signals.push([pid, signal])
    setImmediate(() => {
      child.killed = true
      child.emit('exit', 0, signal)
    })
  }

  try {
    const { supervisor } = createSupervisor({ child })
    await supervisor.start()
    await supervisor.stop()

    assert.deepEqual(signals[0], [-9999, 'SIGTERM'])
    assert.equal(supervisor.getState(), 'stopped')
  } finally {
    process.kill = originalKill
  }
})

test('escalates shutdown when the process does not exit after SIGTERM', async () => {
  const child = new MockChildProcess(2222)
  const signals = []
  const originalKill = process.kill
  process.kill = (pid, signal) => {
    signals.push([pid, signal])
    if (signal === 'SIGKILL') {
      setImmediate(() => {
        child.killed = true
        child.emit('exit', 0, signal)
      })
    }
  }

  try {
    const { supervisor } = createSupervisor({ child, shutdownTimeoutMs: 5 })
    await supervisor.start()
    await supervisor.stop()

    assert.deepEqual(signals, [
      [-2222, 'SIGTERM'],
      [-2222, 'SIGKILL'],
    ])
    assert.equal(supervisor.getState(), 'stopped')
  } finally {
    process.kill = originalKill
  }
})
