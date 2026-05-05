/**
 * @vitest-environment jsdom
 */
import type { ReactElement, ReactNode } from 'react'

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { workspaceMarkdownComponents } from '../markdown-components'

type ClassValue = string | false | null | undefined

type MarkdownInputComponent = (props: {
  checked?: boolean
  type?: string
}) => ReactElement | null

type MarkdownParagraphComponent = (props: {
  children?: ReactNode
  node?: unknown
}) => ReactElement | null

afterEach(() => {
  cleanup()
})

vi.mock('@phosphor-icons/react', () => ({
  Check: () => <span data-testid="check-icon" />,
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: ClassValue[]) => args.filter(Boolean).join(' '),
}))

describe('workspaceMarkdownComponents', () => {
  describe('input', () => {
    it('renders task checkbox when type is checkbox', () => {
      const InputComponent = workspaceMarkdownComponents.input as MarkdownInputComponent
      const { container } = render(
        <InputComponent type="checkbox" checked={false} />
      )

      const span = container.querySelector('span')
      expect(span).toBeTruthy()
      expect(span?.classList.contains('markdown-task-checkbox')).toBe(true)
    })

    it('renders checked task checkbox with Check icon', () => {
      const InputComponent = workspaceMarkdownComponents.input as MarkdownInputComponent
      const { container } = render(
        <InputComponent type="checkbox" checked={true} />
      )

      const span = container.querySelector('span')
      expect(span).toBeTruthy()
      expect(span?.classList.contains('is-checked')).toBe(true)
      expect(container.querySelector('[data-testid="check-icon"]')).toBeTruthy()
    })

    it('renders native input for non-checkbox types', () => {
      const InputComponent = workspaceMarkdownComponents.input as MarkdownInputComponent
      const { container } = render(
        <InputComponent type="text" />
      )

      const input = container.querySelector('input[type="text"]')
      expect(input).toBeTruthy()
    })
  })

  describe('p', () => {
    it('renders task line span when paragraph contains task checkbox', () => {
      const PComponent = workspaceMarkdownComponents.p as MarkdownParagraphComponent
      const node = {
        children: [
          { type: 'element', tagName: 'input', properties: { type: 'checkbox' } },
        ],
      }
      const { container } = render(
        <PComponent node={node}>Task content</PComponent>
      )

      const span = container.querySelector('span.markdown-task-line')
      expect(span).toBeTruthy()
      expect(span?.textContent).toBe('Task content')
    })

    it('renders normal paragraph when no task checkbox', () => {
      const PComponent = workspaceMarkdownComponents.p as MarkdownParagraphComponent
      const node = {
        children: [{ type: 'element', tagName: 'span', properties: {} }],
      }
      const { container } = render(
        <PComponent node={node}>Regular paragraph</PComponent>
      )

      const p = container.querySelector('p')
      expect(p).toBeTruthy()
      expect(p?.textContent).toBe('Regular paragraph')
    })

    it('renders normal paragraph when node has no children array', () => {
      const PComponent = workspaceMarkdownComponents.p as MarkdownParagraphComponent
      const { container } = render(
        <PComponent node={{}}>No children</PComponent>
      )

      const p = container.querySelector('p')
      expect(p).toBeTruthy()
    })

    it('renders normal paragraph when node is null', () => {
      const PComponent = workspaceMarkdownComponents.p as MarkdownParagraphComponent
      const { container } = render(
        <PComponent node={null}>Null node</PComponent>
      )

      const p = container.querySelector('p')
      expect(p).toBeTruthy()
    })
  })
})
