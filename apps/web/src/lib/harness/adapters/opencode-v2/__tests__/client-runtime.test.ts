import { execFile as execFileCallback } from 'node:child_process'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)

function createRuntimeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.VITEST
  return env
}

describe('V2 client runtime loading', () => {
  it('loads the ESM-only client under tsx without CommonJS export errors', async () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url))
    const appRoot = path.resolve(testDir, '../../../../../..')
    const clientUrl = pathToFileURL(path.resolve(testDir, '../client.ts')).href
    const eventsUrl = pathToFileURL(path.resolve(testDir, '../events.ts')).href

    // createConnectionClient only constructs a client; this URL is never contacted.
    const script = [
      '(async () => {',
      `const clientModule = await import(${JSON.stringify(clientUrl)})`,
      `await import(${JSON.stringify(eventsUrl)})`,
      'const { createConnectionClient } = clientModule.default ?? clientModule',
      "const client = await createConnectionClient({ baseUrl: 'http://127.0.0.1:4096', authHeader: 'Basic test' })",
      "console.log(typeof client.server.info === 'function' ? 'OK' : 'MISSING')",
      '})().catch((error) => { console.error(error); process.exit(1) })',
    ].join('; ')

    // A failing child is reported through its stderr, not through the rejected error (it embeds source maps).
    const { stdout, stderr } = await execFile(process.execPath, ['--import', 'tsx', '-e', script], {
      cwd: appRoot,
      env: createRuntimeEnv(),
      timeout: 15_000,
    }).catch((error: { stdout?: string; stderr?: string }) => ({ stdout: error.stdout ?? '', stderr: error.stderr ?? String(error) }))

    expect(stderr).not.toContain('ERR_PACKAGE_PATH_NOT_EXPORTED')
    expect(stdout).toContain('OK')
  })
})
