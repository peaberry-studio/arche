import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const containerfilePath = resolve(process.cwd(), '..', '..', 'infra', 'workspace-image', 'Containerfile')

describe.runIf(existsSync(containerfilePath))('workspace image', () => {
  it('installs nodejs and npm in workspace image', () => {
    const containerfile = readFileSync(containerfilePath, 'utf8')
    expect(containerfile).toMatch(/apk add --no-cache .*nodejs.*npm/)
  })

  it('copies the email_draft custom tool into the workspace image', () => {
    const containerfile = readFileSync(containerfilePath, 'utf8')
    expect(containerfile).toContain('opencode-config/tools/email.js')
  })
})
