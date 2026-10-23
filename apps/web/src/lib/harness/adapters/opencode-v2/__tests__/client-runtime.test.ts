import { execFile as execFileCallback } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)

const testDir = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(testDir, '../../../../../..')

let scratchDir: string

beforeAll(() => {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arche-client-runtime-'))
})

afterAll(() => {
  fs.rmSync(scratchDir, { recursive: true, force: true })
})

function createRuntimeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.VITEST
  return env
}

describe('V2 client runtime loading', () => {
  it('loads the ESM-only client under the tsx CLI without CommonJS export errors', async () => {
    const clientUrl = pathToFileURL(path.resolve(testDir, '../client.ts')).href
    const eventsUrl = pathToFileURL(path.resolve(testDir, '../events.ts')).href

    // Same CommonJS compilation as the daemons. createConnectionClient only constructs a client;
    // the URL is never contacted.
    const scriptPath = path.join(scratchDir, 'load-client.ts')
    fs.writeFileSync(scriptPath, [
      `import { createConnectionClient } from ${JSON.stringify(clientUrl)}`,
      `import { subscribeOpenCodeEvents } from ${JSON.stringify(eventsUrl)}`,
      '',
      'async function main(): Promise<void> {',
      "  const client = await createConnectionClient({ baseUrl: 'http://127.0.0.1:4096', authHeader: 'Basic test' })",
      "  console.log(typeof client.server.info === 'function' && typeof subscribeOpenCodeEvents === 'function' ? 'OK' : 'MISSING')",
      '}',
      '',
      'main().catch((error) => { console.error(error); process.exit(1) })',
    ].join('\n'))

    // A failing child is reported through its stderr, not through the rejected error (it embeds source maps).
    const { stdout, stderr } = await execFile(path.join(appRoot, 'node_modules/.bin/tsx'), [scriptPath], {
      cwd: appRoot,
      env: createRuntimeEnv(),
      timeout: 30_000,
    }).catch((error: { stdout?: string; stderr?: string }) => ({ stdout: error.stdout ?? '', stderr: error.stderr ?? String(error) }))

    expect(stderr).not.toContain('ERR_PACKAGE_PATH_NOT_EXPORTED')
    expect(stdout).toContain('OK')
  }, 45_000)
})
