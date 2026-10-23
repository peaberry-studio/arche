import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const containerfilePath = resolve(process.cwd(), '..', '..', 'infra', 'workspace-image', 'Containerfile')

describe.runIf(existsSync(containerfilePath))('workspace image', () => {
  it('installs nodejs in the workspace image and uses pnpm for tool dependencies', () => {
    const containerfile = readFileSync(containerfilePath, 'utf8')
    expect(containerfile).toMatch(/apk add --no-cache .*nodejs/)
    expect(containerfile).toContain('RUN pnpm install --frozen-lockfile --prod --ignore-scripts')
  })

  it('copies the custom tool directory into the workspace image', () => {
    const containerfile = readFileSync(containerfilePath, 'utf8')
    expect(containerfile).toContain('arche-tools/tools/*.js')
    expect(containerfile).toContain('arche-tools/server.js')
    expect(containerfile).not.toContain('@opencode-ai/plugin')
  })

  it('copies office document and presentation tools into the workspace image', () => {
    const containerfile = readFileSync(containerfilePath, 'utf8')
    expect(containerfile).toContain('arche-tools/tools/*.js')
    expect(containerfile).toContain('arche-tools/shared/*.js')
  })
})
