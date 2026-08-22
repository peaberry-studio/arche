/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

import EditSkillPage from '../page'

function renderPage(slug = 'alice', name = 'writer') {
  return EditSkillPage({ params: Promise.resolve({ slug, name }) })
}

describe('EditSkillPage', () => {
  it('redirects to the skill edit catalog view', async () => {
    await expect(renderPage()).rejects.toThrow('REDIRECT:/w/alice?catalog=skills&skill=writer')
  })
})
