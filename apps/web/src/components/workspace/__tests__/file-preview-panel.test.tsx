/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FilePreviewPanel } from '@/components/workspace/file-preview-panel'

describe('FilePreviewPanel', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders loading state and disables copying empty content', () => {
    render(
      <FilePreviewPanel
        path="Notes/Empty.md"
        content=""
        isLoading
        onClose={vi.fn()}
        onEdit={vi.fn()}
      />
    )

    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy as markdown' }).hasAttribute('disabled')).toBe(true)
  })

  it('renders markdown preview and invokes edit and close actions', () => {
    const onClose = vi.fn()
    const onEdit = vi.fn()

    render(
      <FilePreviewPanel
        path="Notes/Plan.md"
        content="# Plan\n\nShip the update."
        onClose={onClose}
        onEdit={onEdit}
      />
    )

    expect(screen.getByText('Quickview')).toBeTruthy()
    expect(screen.getByText('Plan.md')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Plan/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Edit file' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps markdown properties inside the scrollable preview content', () => {
    render(
      <FilePreviewPanel
        path="Notes/Plan.md"
        content={['---', 'owner: Ops', '---', '# Plan'].join('\n')}
        onClose={vi.fn()}
        onEdit={vi.fn()}
      />
    )

    const scroller = screen.getByTestId('file-preview-scroller')
    const header = screen.getByText('Quickview').closest('div') as HTMLElement

    expect(scroller.textContent).toContain('owner')
    expect(scroller.textContent).toContain('Ops')
    expect(header.textContent).not.toContain('owner')
  })

  it('copies with navigator clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    render(
      <FilePreviewPanel
        path="Notes/Copy.md"
        content="Copy this"
        onClose={vi.fn()}
        onEdit={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy as markdown' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Copy this'))
    expect(screen.getByText('Copied')).toBeTruthy()
  })

  it('falls back to execCommand when clipboard writing fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    const execCommand = vi.fn().mockReturnValue(true)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    })

    render(
      <FilePreviewPanel
        path="Notes/Fallback.txt"
        content="plain text"
        onClose={vi.fn()}
        onEdit={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy as markdown' }))

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'))
    expect(screen.getByText('plain text')).toBeTruthy()
    expect(screen.getByText('Copied')).toBeTruthy()
  })
})
