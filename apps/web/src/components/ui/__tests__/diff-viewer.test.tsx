/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DiffViewer } from '@/components/ui/diff-viewer'

afterEach(() => {
  cleanup()
})

describe('DiffViewer', () => {
  it('renders an empty state for blank diffs', () => {
    render(<DiffViewer diff="" className="custom-class" />)

    expect(screen.getByText('No diff available for this file.')).toBeDefined()
  })

  it('renders metadata, hunks, line numbers, additions, deletions, and context', () => {
    render(
      <DiffViewer
        diff={[
          'diff --git a/file.txt b/file.txt',
          'index 123..456 100644',
          '--- a/file.txt',
          '+++ b/file.txt',
          '@@ -2,2 +2,3 @@',
          ' unchanged',
          '-removed',
          '+added',
          ' another',
          '\\ No newline at end of file',
        ].join('\n')}
      />
    )

    expect(screen.getByText('diff --git a/file.txt b/file.txt')).toBeDefined()
    expect(screen.getByText('@@ -2,2 +2,3 @@')).toBeDefined()
    expect(screen.getByText('unchanged')).toBeDefined()
    expect(screen.getByText('-removed')).toBeDefined()
    expect(screen.getByText('+added')).toBeDefined()
    expect(screen.getByText('\\ No newline at end of file')).toBeDefined()
    expect(screen.getAllByText('2').length).toBeGreaterThan(1)
  })

  it('marks conflict lines and preserves their content', () => {
    const { container } = render(
      <DiffViewer
        diff={[
          '@@ -1,1 +1,5 @@',
          '+<<<<<<< ours',
          '+current value',
          '+=======',
          '+incoming value',
          '+>>>>>>> theirs',
        ].join('\n')}
      />
    )

    expect(screen.getByText('+<<<<<<< ours')).toBeDefined()
    expect(screen.getByText('+current value')).toBeDefined()
    expect(screen.getByText('+incoming value')).toBeDefined()
    const classNames = Array.from(container.querySelectorAll('div')).map((element) => element.className)
    expect(classNames.some((className) => className.includes('bg-amber-500/25'))).toBe(true)
    expect(classNames.some((className) => className.includes('bg-sky-500/15'))).toBe(true)
  })

  it('collapses long diffs and calls onExpand', () => {
    const onExpand = vi.fn()
    render(
      <DiffViewer
        diff={['@@ -1,5 +1,5 @@', ' one', ' two', ' three', ' four'].join('\n')}
        collapsed
        maxLinesCollapsed={2}
        onExpand={onExpand}
      />
    )

    expect(screen.getByText(/3 hidden lines/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'View full diff' }))
    expect(onExpand).toHaveBeenCalledTimes(1)
  })
})
