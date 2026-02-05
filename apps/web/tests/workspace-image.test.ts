import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('workspace image', () => {
  it('installs nodejs and npm in workspace image', () => {
    const containerfile = readFileSync(
      resolve(process.cwd(), '..', '..', 'infra', 'workspace-image', 'Containerfile'),
      'utf8'
    )

    expect(containerfile).toMatch(/apk add --no-cache .*nodejs.*npm/)
  })
})
