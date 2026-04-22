import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const DEFAULT_E2E_ENCRYPTION_KEY = 'ZGV2LWluc2VjdXJlLWtleS0zMi1ieXRlcy1sb25nISE='

export default async function globalSetup() {
  const scriptPath = path.resolve(__dirname, '../../../scripts/e2e/bootstrap-web.mjs')

  await execFileAsync('node', [scriptPath], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      ARCHE_ENCRYPTION_KEY: process.env.ARCHE_ENCRYPTION_KEY ?? DEFAULT_E2E_ENCRYPTION_KEY,
    },
  })
}
