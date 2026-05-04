/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SegmentedControl } from '@/components/workspace/segmented-control'

function TestIcon({ size, weight }: { size?: number; weight?: 'regular' | 'bold' | 'fill' }) {
  return <span aria-hidden="true" data-testid={`icon-${weight}`}>{size}</span>
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SegmentedControl', () => {
  it('renders options, marks the active value, and emits value changes', async () => {
    const onValueChange = vi.fn()

    render(
      <SegmentedControl
        className="custom-control"
        onValueChange={onValueChange}
        options={[
          { value: 'files', label: 'Files', icon: TestIcon },
          { value: 'graph', label: 'Graph', icon: TestIcon },
        ]}
        value="files"
      />
    )

    expect(screen.getByRole('button', { name: 'Files' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Graph' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('icon-fill')).toBeDefined()
    expect(screen.getByTestId('icon-bold')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Graph' }))

    expect(onValueChange).toHaveBeenCalledWith('graph')
    expect(screen.getByRole('button', { name: 'Files' }).className).toContain('transition-colors')
  })
})
