import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const governance = await readFile(new URL('./pr-governance.yml', import.meta.url), 'utf8')
const checks = await readFile(new URL('./pr-checks.yml', import.meta.url), 'utf8')

test('SC-2: security scanning matches single-quoted secret assignments', () => {
  const start = governance.indexOf('          secret_patterns=(')
  const end = governance.indexOf('          )', start) + '          )'.length
  const secretPatterns = governance.slice(start, end)
  const script = `${secretPatterns}
for pattern in "\${secret_patterns[@]}"; do
  if printf '%s\\n' "$1" | grep -iE "$pattern" >/dev/null; then
    exit 0
  fi
done
exit 1`

  for (const assignment of ["password = 'hunter2secret'", 'password = "hunter2secret"']) {
    const result = spawnSync('bash', ['-c', script, '--', assignment])
    assert.equal(result.status, 0, `secret scanner must match ${assignment}`)
  }
})

test('SC-2: sensitive-file scanning includes modified paths', () => {
  assert.match(governance, /--diff-filter=ACMR/)
})

test('SC-4: PR-controlled filenames are passed to security scan steps through the environment', () => {
  assert.doesNotMatch(governance, /changed_files="\$\{\{ steps\.changes\.outputs\.files \}\}"/)
  assert.equal(
    governance.match(/CHANGED_FILES: \$\{\{ steps\.changes\.outputs\.files \}\}/g)?.length,
    2,
  )
  assert.match(governance, /"\$CHANGED_FILES"/)
})

test('SC-6: manual PR-check runs enable both application suites and do not hide diff failures', () => {
  assert.match(checks, /\$GITHUB_EVENT_NAME" == "workflow_dispatch"/)
  assert.doesNotMatch(checks, /git diff --name-only origin\/main\.\.\.HEAD 2>\/dev\/null \|\| echo ""/)
})

test('SC-10: malformed manifests warn without failing the pinned-version check', () => {
  const marker = '      - name: Check dependency version pinning\n        run: |\n'
  const start = governance.indexOf(marker) + marker.length
  const end = governance.indexOf('\n\n  security-scan:', start)
  const script = governance.slice(start, end).replace(/^          /gm, '')
  const fixtureDirectory = mkdtempSync(join(process.cwd(), '.pr-workflows-test-'))

  try {
    writeFileSync(join(fixtureDirectory, 'package.json'), '{"dependencies":')

    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      cwd: fixtureDirectory,
      encoding: 'utf8',
    })

    assert.equal(
      result.status,
      0,
      `expected malformed manifests to be non-fatal; stdout: ${result.stdout || '<empty>'}; stderr: ${result.stderr || '<empty>'}`,
    )
    assert.match(result.stdout, /::warning file=\.\/package\.json::Malformed package\.json — skipped/)
  } finally {
    rmSync(fixtureDirectory, { force: true, recursive: true })
  }
})
