/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WebKickstartWizard } from '@/components/kickstart/web-kickstart-wizard'
import type {
  KickstartWizardLoadCatalogResult,
  KickstartWizardSubmitResult,
} from '@/components/kickstart/kickstart-wizard'
import type { KickstartApplyRequestPayload } from '@/kickstart/types'

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('@/components/kickstart/kickstart-wizard', () => ({
  KickstartWizard: ({
    loadCatalog,
    onSubmit,
  }: {
    loadCatalog: () => Promise<KickstartWizardLoadCatalogResult>
    onSubmit: (payload: KickstartApplyRequestPayload) => Promise<KickstartWizardSubmitResult>
  }) => (
    <div>
      <button type="button" onClick={() => void loadCatalog().then((result) => window.dispatchEvent(new CustomEvent('catalog-result', { detail: result })))}>
        Load catalog
      </button>
      <button
        type="button"
        onClick={() => void onSubmit({ companyDescription: 'Desc', companyName: 'Acme', selectedTemplateId: 'starter' }).then((result) => window.dispatchEvent(new CustomEvent('submit-result', { detail: result })))}
      >
        Submit wizard
      </button>
    </div>
  ),
}))

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  pushMock.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WebKickstartWizard', () => {
  it('loads templates/models and submits the apply payload', async () => {
    const catalogResults: KickstartWizardLoadCatalogResult[] = []
    const submitResults: KickstartWizardSubmitResult[] = []
    window.addEventListener('catalog-result', ((event: CustomEvent<KickstartWizardLoadCatalogResult>) => catalogResults.push(event.detail)) as EventListener)
    window.addEventListener('submit-result', ((event: CustomEvent<KickstartWizardSubmitResult>) => submitResults.push(event.detail)) as EventListener)
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ templates: [{ id: 'starter', name: 'Starter' }] }))
      .mockResolvedValueOnce(jsonResponse({ models: [{ id: 'model-1', label: 'Model 1' }] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))

    render(<WebKickstartWizard slug="alice" />)

    fireEvent.click(screen.getByRole('button', { name: 'Load catalog' }))
    await waitFor(() => expect(catalogResults).toHaveLength(1))
    expect(catalogResults[0]).toEqual({
      ok: true,
      catalog: { templates: [{ id: 'starter', name: 'Starter' }] },
      models: [{ id: 'model-1', label: 'Model 1' }],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Submit wizard' }))
    await waitFor(() => expect(submitResults).toEqual([{ ok: true }]))
    expect(pushMock).toHaveBeenCalledWith('/u/alice?setup=completed')
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      companyDescription: 'Desc',
      companyName: 'Acme',
      selectedTemplateId: 'starter',
    })
  })

  it('returns load and submit errors from failed requests', async () => {
    const catalogResults: KickstartWizardLoadCatalogResult[] = []
    const submitResults: KickstartWizardSubmitResult[] = []
    window.addEventListener('catalog-result', ((event: CustomEvent<KickstartWizardLoadCatalogResult>) => catalogResults.push(event.detail)) as EventListener)
    window.addEventListener('submit-result', ((event: CustomEvent<KickstartWizardSubmitResult>) => submitResults.push(event.detail)) as EventListener)
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'missing_templates' }, { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ models: [] }))
      .mockResolvedValueOnce(jsonResponse({ message: 'apply failed' }, { status: 400 }))

    render(<WebKickstartWizard slug="alice" />)

    fireEvent.click(screen.getByRole('button', { name: 'Load catalog' }))
    await waitFor(() => expect(catalogResults).toEqual([{ ok: false, error: 'missing_templates' }]))

    fireEvent.click(screen.getByRole('button', { name: 'Submit wizard' }))
    await waitFor(() => expect(submitResults).toEqual([{ ok: false, error: 'apply failed' }]))
    expect(pushMock).not.toHaveBeenCalled()
  })
})
