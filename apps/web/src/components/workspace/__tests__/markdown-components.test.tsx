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

type MarkdownCodeComponent = (props: {
  className?: string
  children?: ReactNode
  node?: unknown
}) => ReactElement | null

type MarkdownPreComponent = (props: {
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

vi.mock('@/components/workspace/markdown-chart', () => ({
  MarkdownChart: ({ source }: { source: string }) => (
    <div data-testid="markdown-chart" data-source={source} />
  ),
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

  describe('code', () => {
    it('renders MarkdownChart for vega-lite code blocks', () => {
      const CodeComponent = workspaceMarkdownComponents.code as MarkdownCodeComponent
      const source = '{"mark":"bar"}'
      const { container } = render(
        <CodeComponent className="language-vega-lite">{source}</CodeComponent>
      )

      const chart = container.querySelector('[data-testid="markdown-chart"]')
      expect(chart).toBeTruthy()
      expect(chart?.getAttribute('data-source')).toBe(source)
    })

    it('renders a native code element for non-vega-lite languages', () => {
      const CodeComponent = workspaceMarkdownComponents.code as MarkdownCodeComponent
      const { container } = render(
        <CodeComponent className="language-js">const x = 1</CodeComponent>
      )

      const code = container.querySelector('code')
      expect(code).toBeTruthy()
      expect(code?.classList.contains('language-js')).toBe(true)
      expect(code?.textContent).toBe('const x = 1')
    })

    it('renders a native code element when className is absent', () => {
      const CodeComponent = workspaceMarkdownComponents.code as MarkdownCodeComponent
      const { container } = render(
        <CodeComponent>plain inline code</CodeComponent>
      )

      const code = container.querySelector('code')
      expect(code).toBeTruthy()
      expect(code?.textContent).toBe('plain inline code')
    })

    it('renders a native code element for vega-lite substring without exact match (defensive)', () => {
      const CodeComponent = workspaceMarkdownComponents.code as MarkdownCodeComponent
      const { container } = render(
        <CodeComponent className="language-vega">{"not vega-lite"}</CodeComponent>
      )

      expect(container.querySelector('[data-testid="markdown-chart"]')).toBeNull()
      const code = container.querySelector('code')
      expect(code).toBeTruthy()
    })
  })

  describe('pre', () => {
    it('unwraps pre when the first child is a vega-lite code block', () => {
      const PreComponent = workspaceMarkdownComponents.pre as MarkdownPreComponent
      const node = {
        type: 'element',
        tagName: 'pre',
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: { className: ['language-vega-lite'] },
          },
        ],
      }
      const { container } = render(
        <PreComponent node={node}>code content</PreComponent>
      )

      expect(container.querySelector('pre')).toBeNull()
      expect(container.textContent).toBe('code content')
    })

    it('renders a normal pre for non-vega-lite code blocks', () => {
      const PreComponent = workspaceMarkdownComponents.pre as MarkdownPreComponent
      const node = {
        type: 'element',
        tagName: 'pre',
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: { className: ['language-js'] },
          },
        ],
      }
      const { container } = render(
        <PreComponent node={node}>code content</PreComponent>
      )

      const pre = container.querySelector('pre')
      expect(pre).toBeTruthy()
      expect(pre?.textContent).toBe('code content')
    })

    it('renders a normal pre when node is null', () => {
      const PreComponent = workspaceMarkdownComponents.pre as MarkdownPreComponent
      const { container } = render(
        <PreComponent node={null}>no node</PreComponent>
      )

      const pre = container.querySelector('pre')
      expect(pre).toBeTruthy()
    })

    it('renders a normal pre when first child has no className array', () => {
      const PreComponent = workspaceMarkdownComponents.pre as MarkdownPreComponent
      const node = {
        type: 'element',
        tagName: 'pre',
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: { className: 'language-vega-lite' },
          },
        ],
      }
      const { container } = render(
        <PreComponent node={node}>code content</PreComponent>
      )

      const pre = container.querySelector('pre')
      expect(pre).toBeTruthy()
    })
  })
})
