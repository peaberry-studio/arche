import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

for (const scenario of ['success', 'migration failure', 'seed failure']) {
  test(`web startup uses installed binaries without pnpm: ${scenario}`, () => {
    const scratch = mkdtempSync(join(tmpdir(), 'arche-web-start-'))
    try {
      const bin = join(scratch, 'bin')
      const localBin = join(scratch, 'node_modules/.bin')
      mkdirSync(bin)
      mkdirSync(localBin, { recursive: true })
      const scripts = {
        'bin/node': 'echo database >> "$START_COMMANDS"',
        'bin/timeout': 'shift\nexec "$@"',
        'bin/pnpm': 'echo pnpm >> "$START_COMMANDS"\nexit 99',
        'node_modules/.bin/prisma': `echo "prisma $*" >> "$START_COMMANDS"
if [ "$1" = migrate ]; then exit "$MIGRATION_EXIT"; fi
tsx prisma/seed.ts`,
        'node_modules/.bin/tsx': 'echo "tsx $*" >> "$START_COMMANDS"\nexit "$SEED_EXIT"',
        'node_modules/.bin/next': 'echo "next $*" >> "$START_COMMANDS"',
      }
      for (const [path, script] of Object.entries(scripts)) {
        writeFileSync(join(scratch, path), `#!/bin/sh\n${script}\n`)
        chmodSync(join(scratch, path), 0o755)
      }
      const result = spawnSync('/bin/sh', [join(root, 'apps/web/start.sh')], {
        cwd: scratch,
        encoding: 'utf8',
        env: {
          PATH: bin,
          START_COMMANDS: join(scratch, 'commands'),
          MIGRATION_EXIT: scenario === 'migration failure' ? '42' : '0',
          SEED_EXIT: scenario === 'seed failure' ? '43' : '0',
        },
      })
      assert.equal(result.status, scenario === 'migration failure' ? 42 : 0, result.stdout + result.stderr)
      assert.deepEqual(readFileSync(join(scratch, 'commands'), 'utf8').trim().split('\n'), [
        'database',
        'prisma migrate deploy',
        ...(scenario === 'migration failure' ? [] : ['prisma db seed', 'tsx prisma/seed.ts', 'next start']),
      ])
      if (scenario === 'seed failure') assert.match(result.stdout, /Seed skipped/)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
}
