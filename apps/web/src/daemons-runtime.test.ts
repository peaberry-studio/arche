import { execFile as execFileCallback } from 'node:child_process'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

type DaemonRun = {
  exitCode: number
  stderr: string
}

// Same invocation as the `start:flows` / `start:reaper` scripts and the compose
// services: tsx compiles the module graph to CommonJS require() calls. The
// environment carries no database or workspace paths, so the daemon fails fast
// at startup once module resolution has succeeded; nothing is ever contacted.
async function runDaemon(entrypoint: string, env: Record<string, string>): Promise<DaemonRun> {
  try {
    const { stderr } = await execFile(path.join(appRoot, 'node_modules/.bin/tsx'), [entrypoint], {
      cwd: appRoot,
      env: { NODE_ENV: 'test', HOME: process.env.HOME, PATH: process.env.PATH, ...env },
      timeout: 60_000,
    })
    return { exitCode: 0, stderr }
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string }
    return { exitCode: typeof failure.code === 'number' ? failure.code : -1, stderr: failure.stderr ?? String(error) }
  }
}

describe('daemon entrypoints under tsx', () => {
  it.each<{ entrypoint: string; failure: string; env: Record<string, string> }>([
    { entrypoint: 'src/reaper-daemon.ts', failure: '[reaper-daemon] Failed to start reaper daemon', env: {} },
    {
      entrypoint: 'src/flow-daemon.ts',
      failure: '[flow-daemon] Failed to start flow daemon',
      env: { ARCHE_FLOW_SCHEDULER_MODE: 'daemon' },
    },
  ])('$entrypoint resolves its whole module graph and fails only on missing runtime config', async ({ entrypoint, failure, env }) => {
    const run = await runDaemon(entrypoint, env)

    expect(run.stderr).not.toContain('ERR_PACKAGE_PATH_NOT_EXPORTED')
    expect(run.stderr).toContain(failure)
    expect(run.exitCode).toBe(1)
  }, 90_000)
})
