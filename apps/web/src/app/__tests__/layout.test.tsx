/** @vitest-environment jsdom */

import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import RootLayout, { metadata, viewport } from '@/app/layout'

const headersMock = vi.hoisted(() => vi.fn())

vi.mock('next/headers', () => ({
  headers: () => headersMock(),
}))

function getElementProps<TProps>(element: ReactNode): TProps {
  if (!isReactElement<TProps>(element)) {
    throw new Error('Expected React element')
  }

  return element.props
}

function isReactElement<TProps>(element: ReactNode): element is ReactElement<TProps> {
  return typeof element === 'object' && element !== null && 'props' in element
}

describe('RootLayout', () => {
  it('exports app metadata and viewport settings', () => {
    expect(metadata.title).toBe('Archē')
    expect(metadata.manifest).toBe('/site.webmanifest?v=2')
    expect(viewport).toMatchObject({
      initialScale: 1,
      maximumScale: 1,
      userScalable: false,
      width: 'device-width',
    })
  })

  it('awaits headers and wraps children with the app body class', async () => {
    const element = await RootLayout({ children: <span>Layout child</span> })
    const htmlProps = getElementProps<{
      children: ReactElement
      lang: string
      suppressHydrationWarning: boolean
    }>(element)
    const bodyProps = getElementProps<{ children: ReactNode; className: string }>(htmlProps.children)

    expect(headersMock).toHaveBeenCalledTimes(1)
    expect(htmlProps.lang).toBe('en')
    expect(htmlProps.suppressHydrationWarning).toBe(true)
    expect(bodyProps.className).toBe('antialiased')
    expect(bodyProps.children).toEqual(<span>Layout child</span>)
  })
})
