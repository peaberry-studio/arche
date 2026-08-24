/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

import SkillsPage from '../page'

function renderPage(slug = 'alice') {
  return SkillsPage({ params: Promise.resolve({ slug }) })
}

describe('SkillsPage', () => {
  it('redirects to the skills catalog view', async () => {
    await expect(renderPage()).rejects.toThrow('REDIRECT:/w/alice?catalog=skills')
  })
})
