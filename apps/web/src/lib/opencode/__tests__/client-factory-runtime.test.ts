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

describe('createConfiguredOpencodeClient runtime loading', () => {
  it('loads the SDK client subpath under tsx without CommonJS export errors', async () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url))
    const appRoot = path.resolve(testDir, '../../../..')
    const factoryUrl = pathToFileURL(path.resolve(testDir, '../client-factory.ts')).href

    // createOpencodeClient only constructs a client; this URL is never contacted.
    const script = [
      '(async () => {',
      `const clientFactory = await import(${JSON.stringify(factoryUrl)})`,
      'const { createConfiguredOpencodeClient } = clientFactory.default ?? clientFactory',
      "await createConfiguredOpencodeClient({ baseUrl: 'http://127.0.0.1:4096', authHeader: 'Basic test' })",
      "console.log('OK')",
      '})().catch((error) => { console.error(error); process.exit(1) })',
    ].join('; ')

    const { stdout, stderr } = await execFile('pnpm', ['exec', 'tsx', '-e', script], {
      cwd: appRoot,
      env: createRuntimeEnv(),
      timeout: 15_000,
    })

    expect(stdout).toContain('OK')
    expect(stderr).not.toContain('ERR_PACKAGE_PATH_NOT_EXPORTED')
  })
})
