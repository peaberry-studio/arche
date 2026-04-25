import { readFileSync } from 'fs'
import { resolve } from 'path'

import { describe, expect, it } from 'vitest'

type PackageJson = {
  scripts?: Record<string, string>
}

describe('web dev scripts', () => {
  it('generates both Prisma clients before pnpm dev starts Next.js', () => {
    const packageJsonPath = resolve(process.cwd(), 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson

    expect(packageJson.scripts?.predev).toContain('pnpm prisma:generate')
    expect(packageJson.scripts?.predev).toContain('pnpm prisma:generate:desktop')
  })

  it('keeps local-dev compose generating the desktop Prisma client before dev starts', () => {
    const composeTemplatePath = resolve(
      process.cwd(),
      '..',
      '..',
      'infra',
      'deploy',
      'ansible',
      'roles',
      'app',
      'templates',
      'compose.yml.j2',
    )
    const composeTemplate = readFileSync(composeTemplatePath, 'utf8')

    expect(composeTemplate).toContain('pnpm prisma generate')
    expect(composeTemplate).toContain('pnpm prisma:generate:desktop')
    expect(composeTemplate).toContain('pnpm next dev -H 0.0.0.0 -p 3000')
    expect(composeTemplate).not.toContain('pnpm next dev --webpack')
    expect(composeTemplate).toContain('name: arche')
    expect(composeTemplate).toContain('arche-internal')
  })

  it('keeps local-dev env generation pinned to the shared workspace network', () => {
    const envTemplatePath = resolve(
      process.cwd(),
      '..',
      '..',
      'infra',
      'deploy',
      'ansible',
      'roles',
      'app',
      'templates',
      '.env.j2',
    )
    const envTemplate = readFileSync(envTemplatePath, 'utf8')

    expect(envTemplate).toContain('OPENCODE_NETWORK=arche-internal')
  })
})
