/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { KickstartWizard } from '@/components/kickstart/kickstart-wizard'
import type { KickstartApplyRequestPayload, KickstartTemplatesResponse } from '@/kickstart/types'

const catalog: KickstartTemplatesResponse = {
  templates: [
    {
      id: 'blank',
      label: 'Blank workspace',
      description: 'Start with core agents only.',
      recommendedAgentIds: ['writer'],
      agentOverrides: { writer: { model: 'anthropic/claude', prompt: 'Template writer prompt' } },
    },
    {
      id: 'growth',
      label: 'Growth team',
      description: 'For go-to-market teams.',
      recommendedAgentIds: ['analyst'],
      agentOverrides: {},
    },
  ],
  agents: [
    {
      id: 'assistant',
      displayName: 'Assistant',
      description: 'Generalist agent',
      systemPrompt: 'Help the user',
      recommendedModel: 'openai/gpt-5.2',
      temperature: 0.2,
      tools: ['read'],
    },
    {
      id: 'knowledge-curator',
      displayName: 'Knowledge Curator',
      description: 'Maintains KB structure',
      systemPrompt: 'Curate knowledge',
      recommendedModel: 'openai/gpt-5.2',
      temperature: 0.1,
      tools: ['read'],
    },
    {
      id: 'writer',
      displayName: 'Writer',
      description: 'Writes content',
      systemPrompt: 'Write clearly',
      recommendedModel: 'openai/gpt-5.2',
      temperature: 0.5,
      tools: ['write'],
    },
    {
      id: 'analyst',
      displayName: 'Analyst',
      description: 'Analyzes metrics',
      systemPrompt: 'Analyze data',
      recommendedModel: 'openai/gpt-5.2',
      temperature: 0.3,
      tools: ['grep'],
    },
  ],
}

const models = [
  { id: 'openai/gpt-5.2', label: 'OpenAI GPT 5.2' },
  { id: 'anthropic/claude', label: 'Claude' },
  { id: 'openrouter/custom', label: 'Custom model' },
]

afterEach(() => {
  cleanup()
})

function renderWizard(overrides?: Partial<Parameters<typeof KickstartWizard>[0]>) {
  const props = {
    loadCatalog: vi.fn().mockResolvedValue({ ok: true, catalog, models }),
    onSubmit: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  }

  const view = render(
    <KickstartWizard
      {...props}
    />
  )

  return { ...view, loadCatalog: props.loadCatalog, onSubmit: props.onSubmit }
}

function jsonFile(content: string) {
  const file = new File([], 'template.json', { type: 'application/json' })
  Object.defineProperty(file, 'text', {
    configurable: true,
    value: vi.fn().mockResolvedValue(content),
  })
  return file
}

function unreadableJsonFile() {
  const file = new File([], 'template.json', { type: 'application/json' })
  Object.defineProperty(file, 'text', {
    configurable: true,
    value: vi.fn().mockRejectedValue(new Error('read failed')),
  })
  return file
}

function importedTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'custom-template',
    label: 'Custom Template',
    description: 'Imported template',
    kbSkeleton: [{ type: 'file', path: 'README.md', content: '# {{companyName}}' }],
    agentsMdTemplate: '# Agents',
    recommendedAgentIds: ['writer'],
    agentOverrides: { writer: { model: 'anthropic/claude', prompt: 'Imported prompt' } },
    ...overrides,
  }
}

async function fillCompanyDetails() {
  fireEvent.change(await screen.findByLabelText('Company name'), { target: { value: '  Acme Labs  ' } })
  fireEvent.change(screen.getByLabelText('Short description'), { target: { value: '  Builds rockets  ' } })
}

async function advanceToReview() {
  await fillCompanyDetails()
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByRole('heading', { name: 'Template selection' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByRole('heading', { name: 'Agent selection' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Analyst/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

describe('KickstartWizard', () => {
  it('loads the catalog, walks the built-in template flow, and submits resolved agent values', async () => {
    const { onSubmit } = renderWizard({ initialStatus: 'setup_in_progress' })

    expect(await screen.findByText('Another setup operation is currently running. You can still review this wizard, but apply may return a conflict until the current run finishes.')).toBeTruthy()
    await advanceToReview()

    expect(screen.getByText('Company:')).toBeTruthy()
    expect(screen.getByText('Agents selected:')).toBeTruthy()
    fireEvent.change(screen.getByDisplayValue('anthropic/claude'), { target: { value: 'openrouter/custom' } })
    fireEvent.change(screen.getByDisplayValue('0.5'), { target: { value: '0.8' } })
    fireEvent.change(screen.getByDisplayValue('Template writer prompt'), { target: { value: 'Custom writer prompt' } })

    fireEvent.click(screen.getByRole('button', { name: 'Apply kickstart' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toEqual({
      companyName: 'Acme Labs',
      companyDescription: 'Builds rockets',
      templateId: 'blank',
      agents: [
        { id: 'assistant', model: 'openai/gpt-5.2', prompt: 'Help the user', temperature: 0.2 },
        { id: 'knowledge-curator', model: 'openai/gpt-5.2', prompt: 'Curate knowledge', temperature: 0.1 },
        { id: 'writer', model: 'openrouter/custom', prompt: 'Custom writer prompt', temperature: 0.8 },
        { id: 'analyst', model: 'openai/gpt-5.2', prompt: 'Analyze data', temperature: 0.3 },
      ],
    })
  })

  it('shows submit errors and allows navigating back', async () => {
    const onBack = vi.fn()
    const { onSubmit } = renderWizard({
      onBack,
      onSubmit: vi.fn().mockResolvedValue({ ok: false, error: 'conflict' }),
      submitLabel: 'Start setup',
      submittingLabel: 'Starting',
    })

    await advanceToReview()
    fireEvent.click(screen.getByRole('button', { name: 'Start setup' }))

    expect(await screen.findByText('conflict')).toBeTruthy()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Agent selection' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('imports a valid template JSON and submits the imported template payload', async () => {
    const { container, onSubmit } = renderWizard()
    await fillCompanyDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(await screen.findByRole('button', { name: /Import/ }))

    const input = container.querySelector('input[type="file"]')
    expect(input).toBeTruthy()
    const importedTemplate = {
      id: 'custom-template',
      label: 'Custom Template',
      description: 'Imported template',
      kbSkeleton: [{ type: 'file', path: 'README.md', content: '# {{companyName}}' }],
      agentsMdTemplate: '# Agents',
      recommendedAgentIds: ['writer', 'writer'],
      agentOverrides: { writer: { model: 'anthropic/claude', prompt: 'Imported prompt' } },
    }
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [jsonFile(JSON.stringify(importedTemplate))] },
    })

    expect(await screen.findByText('Imported template ID:')).toBeTruthy()
    expect(screen.getByText('custom-template')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply kickstart' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const payload = onSubmit.mock.calls[0][0] as KickstartApplyRequestPayload
    expect('template' in payload ? payload.template.id : null).toBe('custom-template')
    expect(payload.agents.map((agent) => agent.id)).toEqual(['assistant', 'writer'])
  })

  it('shows import validation errors for invalid JSON and unknown agents', async () => {
    const { container } = renderWizard()
    await fillCompanyDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const input = container.querySelector('input[type="file"]')
    expect(input).toBeTruthy()

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [jsonFile('not json')] },
    })
    expect(await screen.findByText('Invalid JSON file.')).toBeTruthy()

    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [jsonFile(JSON.stringify({
          id: 'bad',
          label: 'Bad',
          description: 'Bad',
          kbSkeleton: [{ type: 'dir', path: 'Docs' }],
          agentsMdTemplate: '# Agents',
          recommendedAgentIds: ['unknown-agent'],
          agentOverrides: {},
        }))],
      },
    })
    expect(await screen.findByText('Unknown agent id in recommendedAgentIds: unknown-agent')).toBeTruthy()
  })

  it('shows detailed import validation errors for malformed templates', async () => {
    const { container } = renderWizard()
    await fillCompanyDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const input = container.querySelector('input[type="file"]')
    expect(input).toBeTruthy()

    const cases: Array<{ value: unknown; error: string }> = [
      { value: [], error: 'Template JSON must be an object.' },
      { value: importedTemplate({ extra: true }), error: 'Unsupported template field: extra' },
      { value: importedTemplate({ label: '' }), error: 'label must be a non-empty string.' },
      { value: importedTemplate({ kbSkeleton: [] }), error: 'kbSkeleton must be a non-empty array.' },
      { value: importedTemplate({ kbSkeleton: ['bad'] }), error: 'kbSkeleton entries must be objects.' },
      { value: importedTemplate({ kbSkeleton: [{ type: 'link', path: 'README.md' }] }), error: 'kbSkeleton entry type must be "dir" or "file".' },
      { value: importedTemplate({ kbSkeleton: [{ type: 'dir', path: '' }] }), error: 'kbSkeleton entry path must be a non-empty string.' },
      { value: importedTemplate({ kbSkeleton: [{ type: 'file', path: 'README.md' }] }), error: 'kbSkeleton file entry content must be a string.' },
      { value: importedTemplate({ recommendedAgentIds: [] }), error: 'recommendedAgentIds must be a non-empty array.' },
      { value: importedTemplate({ recommendedAgentIds: [''] }), error: 'Each recommendedAgentId must be a non-empty string.' },
      { value: importedTemplate({ agentOverrides: [] }), error: 'agentOverrides must be an object.' },
      { value: importedTemplate({ agentOverrides: { unknown: { model: 'openai/gpt-5.2' } } }), error: 'Unknown agent id in agentOverrides: unknown' },
      { value: importedTemplate({ agentOverrides: { writer: 'bad' } }), error: 'agentOverrides.writer must be an object.' },
      { value: importedTemplate({ agentOverrides: { writer: { temperature: 0.2 } } }), error: 'agentOverrides.writer supports only "model" and "prompt".' },
      { value: importedTemplate({ agentOverrides: { writer: { model: '' } } }), error: 'agentOverrides.writer.model must be a non-empty string.' },
      { value: importedTemplate({ agentOverrides: { writer: { prompt: '' } } }), error: 'agentOverrides.writer.prompt must be a non-empty string.' },
      { value: importedTemplate({ agentOverrides: { assistant: { prompt: 'Do more' } } }), error: 'Prompt overrides are not allowed for core agent: assistant' },
      { value: importedTemplate({ agentOverrides: { writer: {} } }), error: 'agentOverrides.writer must define at least one field.' },
    ]

    for (const { value, error } of cases) {
      fireEvent.change(input as HTMLInputElement, {
        target: { files: [jsonFile(JSON.stringify(value))] },
      })
      expect(await screen.findByText(error)).toBeTruthy()
    }

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [unreadableJsonFile()] },
    })
    expect(await screen.findByText('Failed to read selected template file.')).toBeTruthy()
  })

  it('uses the requested initial template when available', async () => {
    renderWizard({ initialTemplateId: 'growth' })
    await fillCompanyDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect((await screen.findByRole('button', { name: /Growth team/ })).className).toContain('border-primary/55')
    expect(screen.getByText('For go-to-market teams.')).toBeTruthy()
  })

  it('keeps step one blocked when the ready override is false', async () => {
    renderWizard({ stepOneReadyOverride: false })
    await fillCompanyDetails()

    expect(screen.getByRole('button', { name: 'Continue' })).toHaveProperty('disabled', true)
  })

  it('renders generic load and submit failures when promises reject', async () => {
    const { unmount } = renderWizard({
      loadCatalog: vi.fn().mockRejectedValue(new Error('load failed')),
    })

    expect(await screen.findByText('Kickstart unavailable')).toBeTruthy()
    expect(screen.getByText('Failed to load kickstart templates')).toBeTruthy()
    unmount()

    renderWizard({ onSubmit: vi.fn().mockRejectedValue(new Error('apply failed')) })
    await advanceToReview()
    fireEvent.click(screen.getByRole('button', { name: 'Apply kickstart' }))

    expect(await screen.findByText('Kickstart apply failed')).toBeTruthy()
  })

  it('renders load errors for failed or empty catalogs', async () => {
    const { unmount } = renderWizard({
      loadCatalog: vi.fn().mockResolvedValue({ ok: false, error: 'catalog unavailable' }),
    })

    expect(await screen.findByText('Kickstart unavailable')).toBeTruthy()
    expect(screen.getByText('catalog unavailable')).toBeTruthy()
    unmount()

    renderWizard({
      loadCatalog: vi.fn().mockResolvedValue({ ok: true, catalog: { templates: [], agents: [] }, models: [] }),
    })

    expect(await screen.findByText('No kickstart templates available')).toBeTruthy()
  })
})
