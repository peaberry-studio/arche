/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MarkdownFrontmatterPanel } from '@/components/workspace/markdown-frontmatter-panel'
import type { ParsedMarkdownFrontmatter } from '@/components/workspace/markdown-frontmatter'

const structuredFrontmatter: ParsedMarkdownFrontmatter = {
  body: '# Note',
  hasFrontmatter: true,
  mode: 'structured',
  raw: 'title: Roadmap',
  properties: [
    { key: 'title', type: 'string', value: 'Roadmap' },
    { key: 'views', type: 'number', value: 42 },
    { key: 'published', type: 'boolean', value: true },
    { key: 'tags', type: 'string[]', value: ['strategy', 'launch'] },
    { key: 'emptyList', type: 'string[]', value: [] },
  ],
}

describe('MarkdownFrontmatterPanel', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders nothing for non-editable files without frontmatter', () => {
    const { container } = render(
      <MarkdownFrontmatterPanel
        frontmatter={{ body: '# Note', hasFrontmatter: false, mode: 'none', properties: [], raw: '' }}
      />
    )

    expect(container.firstChild).toBeNull()
  })

  it('renders raw frontmatter and toggles the help popover', () => {
    render(
      <MarkdownFrontmatterPanel
        frontmatter={{
          body: '# Note',
          hasFrontmatter: true,
          mode: 'raw',
          properties: [],
          raw: 'title: [',
          reason: 'invalid',
        }}
      />
    )

    expect(screen.getByText('Raw YAML')).toBeTruthy()
    expect(screen.getByText('title: [')).toBeTruthy()
    expect(screen.getByText('This YAML block is invalid, so it stays in raw mode until it parses cleanly.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'What are properties?' }))
    expect(screen.getByText(/Properties are optional metadata fields/)).toBeTruthy()

    fireEvent.mouseDown(document.body)
    expect(screen.queryByText(/Properties are optional metadata fields/)).toBeNull()
  })

  it('lets editable raw frontmatter change the YAML text', () => {
    const onRawChange = vi.fn()
    render(
      <MarkdownFrontmatterPanel
        editable
        frontmatter={{
          body: '# Note',
          hasFrontmatter: true,
          mode: 'raw',
          properties: [],
          raw: 'nested:\n  key: value',
          reason: 'unsupported',
        }}
        onRawChange={onRawChange}
      />
    )

    expect(screen.getByText('This YAML uses structures the properties UI does not support yet, so it stays in raw mode.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('YAML frontmatter'), { target: { value: 'title: Updated' } })

    expect(onRawChange).toHaveBeenCalledWith('title: Updated')
  })

  it('renders structured properties and collapses the list', () => {
    render(<MarkdownFrontmatterPanel frontmatter={structuredFrontmatter} />)

    expect(screen.getByText('(5)')).toBeTruthy()
    expect(screen.getByText('Roadmap')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.getByText('True')).toBeTruthy()
    expect(screen.getByText('strategy')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /Properties/ }))
    expect(screen.queryByText('Roadmap')).toBeNull()
  })

  it('edits, coerces, adds, and removes structured properties', () => {
    const onPropertiesChange = vi.fn()
    render(
      <MarkdownFrontmatterPanel
        editable
        frontmatter={structuredFrontmatter}
        onPropertiesChange={onPropertiesChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    fireEvent.change(screen.getByLabelText('Property 1 value'), { target: { value: 'Launch plan' } })
    expect(onPropertiesChange).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: 'title', value: 'Launch plan' }),
    ]))

    fireEvent.change(screen.getByLabelText('Property 2 value'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Property 2 value'), { target: { value: '100.5' } })
    expect(onPropertiesChange).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: 'views', value: 100.5 }),
    ]))

    fireEvent.click(screen.getByLabelText('Property 3 value'))
    expect(onPropertiesChange).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: 'published', value: false }),
    ]))

    fireEvent.click(screen.getAllByRole('button', { name: 'Add item' })[0])
    fireEvent.change(screen.getByLabelText('Property 4 list value 3'), { target: { value: 'ops' } })
    expect(onPropertiesChange).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: 'tags', value: ['strategy', 'launch', 'ops'] }),
    ]))

    fireEvent.click(screen.getByRole('button', { name: 'Remove item 1' }))
    expect(onPropertiesChange).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: 'tags', value: ['launch', 'ops'] }),
    ]))

    fireEvent.change(screen.getByLabelText('Property 1 type'), { target: { value: 'number' } })
    expect(onPropertiesChange).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: 'title', type: 'number', value: 0 }),
    ]))

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.change(screen.getByLabelText('Property 6 key'), { target: { value: 'owner' } })
    expect(onPropertiesChange).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: 'owner' }),
    ]))

    fireEvent.click(screen.getByRole('button', { name: 'Remove property 6' }))
    expect(onPropertiesChange).not.toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: 'owner' }),
    ]))

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByLabelText('Property 1 key')).toBeNull()
  })
})
