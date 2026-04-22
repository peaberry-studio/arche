import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export default async function globalSetup() {
  const scriptPath = path.resolve(__dirname, '../../../scripts/e2e/bootstrap-web.mjs')

  await execFileAsync('node', [scriptPath], {
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
  })
}
