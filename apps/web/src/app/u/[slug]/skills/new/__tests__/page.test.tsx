/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}))

import NewSkillPage from '../page'

function renderPage(slug = 'alice') {
  return NewSkillPage({ params: Promise.resolve({ slug }) })
}

describe('NewSkillPage', () => {
  it('redirects to the skill create catalog view', async () => {
    await expect(renderPage()).rejects.toThrow('REDIRECT:/w/alice?catalog=skills&skill=new')
  })
})
