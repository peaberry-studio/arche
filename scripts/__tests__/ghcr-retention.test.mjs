import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const workflow = readFileSync(join(root, '.github/workflows/ghcr-retention.yml'), 'utf8')
const script = workflow.split('        run: |\n')[1].split('\n').map(line => line.replace(/^ {10}/, '')).join('\n')

for (const open of [true, false]) {
  test(`retention preserves each legacy/current PR architecture only while the PR is ${open ? 'open' : 'closed'}`, () => {
    const scratch = mkdtempSync(join(tmpdir(), 'arche-retention-'))
    try {
      const bin = join(scratch, 'bin')
      mkdirSync(bin)
      const versions = [
        { id: 1, tags: ['pr-504', 'pr-504-amd64'] },
        { id: 2, tags: ['opencode-v1-1.18.18-pr-504-amd64'] },
        { id: 3, tags: ['opencode-v1-1.18.18-pr-504-amd64'], updated_at: '2026-10-19T00:00:00Z' },
        { id: 4, tags: ['opencode-v1-1.18.18-pr-504-arm64'] },
        { id: 5, tags: ['pr-504-arm64'] },
        { id: 6, tags: ['opencode-v1-1.18.18-pr-505-amd64'] },
        { id: 7, tags: ['pr-505'] },
        { id: 8, tags: ['opencode-v1-1.18.18-arm64'] },
        { id: 9, tags: ['latest'] },
        { id: 10, tags: ['v1.2.3'] },
        { id: 11, tags: [] },
      ].map(version => ({ updated_at: '2026-10-20T00:00:00Z', ...version }))
      writeFileSync(join(scratch, 'versions.jsonl'), versions.map(version => JSON.stringify(version)).join('\n'))
      writeFileSync(join(scratch, 'open-prs.txt'), open ? '504\n' : '')
      writeFileSync(join(scratch, 'retention.sh'), script)
      writeFileSync(join(bin, 'gh'), `#!/bin/sh
if [ "$1" = pr ]; then
  cat "$RETENTION_OPEN_PRS"
elif [ "$1" = api ] && [ "$2" = --paginate ]; then
  cat "$RETENTION_VERSIONS"
elif [ "$1" = api ] && [ "$2" = --method ] && [ "$3" = DELETE ]; then
  printf '%s\\n' "$4" >> "$RETENTION_DELETIONS"
else
  exit 1
fi
`)
      chmodSync(join(bin, 'gh'), 0o755)
      const result = spawnSync('bash', [join(scratch, 'retention.sh')], {
        encoding: 'utf8',
        env: {
          ...process.env, PATH: `${bin}:${process.env.PATH}`, OWNER: 'fixture', REPO: 'arche', GH_TOKEN: 'fixture',
          RETENTION_OPEN_PRS: join(scratch, 'open-prs.txt'), RETENTION_VERSIONS: join(scratch, 'versions.jsonl'),
          RETENTION_DELETIONS: join(scratch, 'deletions.txt'),
        },
      })
      assert.equal(result.status, 0, result.stderr)
      const deletions = readFileSync(join(scratch, 'deletions.txt'), 'utf8').trim().split('\n')
      for (const name of ['web', 'workspace']) {
        const ids = deletions.filter(path => path.includes(`arche%2F${name}/`)).map(path => Number(path.split('/').at(-1))).sort((a, b) => a - b)
        assert.deepEqual(ids, open ? [3, 6, 7, 11] : [1, 2, 3, 4, 5, 6, 7, 11])
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
}
