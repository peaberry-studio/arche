/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { downloadWorkspaceFile } from '../workspace-file-download'

describe('downloadWorkspaceFile in the browser', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates, clicks, and removes a temporary download link', () => {
    const originalCreateElement = document.createElement.bind(document)
    const clickMock = vi.fn()
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName)
      if (tagName === 'a') {
        element.click = clickMock
      }
      return element
    })

    expect(downloadWorkspaceFile('alice', 'docs/readme.md')).toBe(true)

    expect(clickMock).toHaveBeenCalledTimes(1)
    expect(document.body.querySelector('a')).toBeNull()
  })
})
