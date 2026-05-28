/** @vitest-environment jsdom */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ArcLoader } from '@/components/workspace/arc-loader'

afterEach(() => {
  cleanup()
})

describe('ArcLoader', () => {
  it('renders the three-arc isologo with the wave animation hook', () => {
    const { container } = render(<ArcLoader className="mx-auto" />)
    const root = container.firstElementChild
    const svg = container.querySelector('svg')

    expect(root?.className).toContain('mx-auto')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('aria-label')).toBe('Connecting')
    expect(svg?.classList.contains('arc-wave')).toBe(true)
    expect(svg?.querySelectorAll('path')).toHaveLength(3)
  })
})
