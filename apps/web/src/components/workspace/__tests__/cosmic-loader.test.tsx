/** @vitest-environment jsdom */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { CosmicLoader } from '@/components/workspace/cosmic-loader'

afterEach(() => {
  cleanup()
})

describe('CosmicLoader', () => {
  it('renders the decorative orbital loader and starfield', () => {
    const { container } = render(<CosmicLoader className="mx-auto" />)
    const root = container.firstElementChild
    const stars = Array.from(container.querySelectorAll('div')).filter(
      (element) => (element as HTMLElement).style.animationDuration === '3s'
    )

    expect(root?.className).toContain('mx-auto')
    expect(container.querySelector('.h-48.w-48')).toBeDefined()
    expect(stars).toHaveLength(12)
    expect(container.querySelectorAll('[style*="box-shadow"]').length).toBeGreaterThan(3)
  })
})
