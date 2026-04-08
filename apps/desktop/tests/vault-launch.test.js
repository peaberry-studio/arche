const test = require('node:test')
const assert = require('node:assert/strict')

const { buildLaunchArgs, resolveLaunchContext } = require('../dist/vault-launch.js')

test('resolves launcher mode when no vault is available', () => {
  assert.deepEqual(resolveLaunchContext([], null), { mode: 'launcher', vaultPath: null })
})

test('resolves an explicit vault path from argv', () => {
  assert.deepEqual(resolveLaunchContext(['--vault-path=/tmp/Arche'], null), {
    mode: 'vault',
    vaultPath: '/tmp/Arche',
  })
})

test('falls back to the last opened vault path', () => {
  assert.deepEqual(resolveLaunchContext([], '/tmp/Arche'), {
    mode: 'vault',
    vaultPath: '/tmp/Arche',
  })
})

test('builds argv for launching a specific vault', () => {
  assert.deepEqual(buildLaunchArgs(['dist/main.js', '--launcher'], {
    mode: 'vault',
    vaultPath: '/tmp/Arche',
  }), ['dist/main.js', '--vault-path=/tmp/Arche'])
})
