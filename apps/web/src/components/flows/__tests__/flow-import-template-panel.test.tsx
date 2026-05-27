/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FlowImportTemplatePanel } from '@/components/flows/flow-import-template-panel'

describe('FlowImportTemplatePanel', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows warnings and imports selected JSON templates', async () => {
    const onImportTemplate = vi.fn().mockResolvedValue(undefined)
    const onImportError = vi.fn()
    const { container } = render(
      <FlowImportTemplatePanel
        importWarnings={[{ code: 'unknown_target_agent', message: 'Review target agents.' }]}
        isImporting={false}
        onImportError={onImportError}
        onImportTemplate={onImportTemplate}
      />,
    )

    expect(screen.getByText('Review target agents.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Import template' }))
    const input = container.querySelector('input[type="file"]')
    expect(input).toBeTruthy()

    const file = new File([''], 'flow.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(JSON.stringify({ format: 'arche-flow-template/v1' })) })
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } })

    await waitFor(() => expect(onImportTemplate).toHaveBeenCalledWith({ format: 'arche-flow-template/v1' }))
    expect(onImportError).not.toHaveBeenCalled()
  })

  it('surfaces invalid JSON import errors', async () => {
    const onImportTemplate = vi.fn()
    const onImportError = vi.fn()
    const { container } = render(
      <FlowImportTemplatePanel
        importWarnings={[]}
        isImporting={false}
        onImportError={onImportError}
        onImportTemplate={onImportTemplate}
      />,
    )
    const input = container.querySelector('input[type="file"]')
    expect(input).toBeTruthy()

    const file = new File([''], 'flow.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve('not json') })
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } })

    await waitFor(() => expect(onImportError).toHaveBeenCalledWith('invalid_json'))
    expect(onImportTemplate).not.toHaveBeenCalled()
  })
})
