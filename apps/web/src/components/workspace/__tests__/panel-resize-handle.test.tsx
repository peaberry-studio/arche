/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PanelResizeHandle } from '@/components/workspace/panel-resize-handle'

describe('PanelResizeHandle', () => {
  it('renders with left position aria-label', () => {
    const { container } = render(
      <PanelResizeHandle onPointerDown={() => {}} position="left" />
    )

    const separator = container.querySelector('[role="separator"]')
    expect(separator).toBeDefined()
    expect(separator?.getAttribute('aria-label')).toBe('Resize left panel')
  })

  it('renders with right position aria-label', () => {
    const { container } = render(
      <PanelResizeHandle onPointerDown={() => {}} position="right" />
    )

    const separator = container.querySelector('[role="separator"]')
    expect(separator).toBeDefined()
    expect(separator?.getAttribute('aria-label')).toBe('Resize right panel')
  })

  it('returns null when hidden', () => {
    const { container } = render(
      <PanelResizeHandle onPointerDown={() => {}} position="left" hidden />
    )

    expect(container.querySelector('[role="separator"]')).toBeNull()
  })
})
