/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ImportSkillDialog } from '@/components/skills/import-skill-dialog'

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
const mockNotifyWorkspaceConfigChanged = vi.fn()

vi.mock('@/lib/runtime/config-status-events', () => ({
  notifyWorkspaceConfigChanged: () => mockNotifyWorkspaceConfigChanged(),
}))

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

const agents = [
  { id: 'secondary', displayName: 'Secondary Agent', isPrimary: false },
  { id: 'primary', displayName: 'Primary Agent', isPrimary: true },
]

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  mockNotifyWorkspaceConfigChanged.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ImportSkillDialog', () => {
  it('imports a selected bundle with assigned agents and expected hash', async () => {
    const onImported = vi.fn()
    const onOpenChange = vi.fn()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    render(
      <ImportSkillDialog
        agents={agents}
        expectedHash="hash-1"
        onImported={onImported}
        onOpenChange={onOpenChange}
        open
        slug="alice"
      />
    )

    const file = new File(['zip'], 'skill.zip', { type: 'application/zip' })
    const fileInput = document.querySelector('input[type="file"]')
    if (!(fileInput instanceof HTMLInputElement)) throw new Error('missing file input')

    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.click(screen.getByText('Primary Agent').closest('label') ?? screen.getByText('Primary Agent'))
    fireEvent.click(screen.getByRole('button', { name: 'Import skill' }))

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mockNotifyWorkspaceConfigChanged).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/u/alice/skills/import')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')

    const body = fetchMock.mock.calls[0][1]?.body
    if (!(body instanceof FormData)) throw new Error('missing form data')
    expect(body.get('file')).toBe(file)
    expect(body.get('assignedAgentIds')).toBe(JSON.stringify(['primary']))
    expect(body.get('expectedHash')).toBe('hash-1')
  })

  it('shows import errors and resets when closed', async () => {
    const onOpenChange = vi.fn()
    fetchMock.mockResolvedValue(jsonResponse({ error: 'conflict' }, { status: 409 }))

    const { rerender } = render(
      <ImportSkillDialog
        agents={agents}
        onImported={vi.fn()}
        onOpenChange={onOpenChange}
        open
        slug="alice"
      />
    )

    const fileInput = document.querySelector('input[type="file"]')
    if (!(fileInput instanceof HTMLInputElement)) throw new Error('missing file input')

    fireEvent.change(fileInput, { target: { files: [new File(['zip'], 'skill.zip')] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import skill' }))

    expect(await screen.findByText('Error: conflict')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)

    rerender(
      <ImportSkillDialog
        agents={agents}
        onImported={vi.fn()}
        onOpenChange={onOpenChange}
        open={false}
        slug="alice"
      />
    )
  })

  it('shows a network error when upload fails before a response', async () => {
    fetchMock.mockRejectedValue(new Error('network'))

    render(
      <ImportSkillDialog agents={agents} onImported={vi.fn()} onOpenChange={vi.fn()} open slug="alice" />
    )

    const fileInput = document.querySelector('input[type="file"]')
    if (!(fileInput instanceof HTMLInputElement)) throw new Error('missing file input')

    fireEvent.change(fileInput, { target: { files: [new File(['zip'], 'skill.zip')] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import skill' }))

    expect(await screen.findByText('Error: network_error')).toBeDefined()
  })
})
