/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SkillForm } from '@/components/skills/skill-form'
import type { AgentListItem } from '@/hooks/use-agents-catalog'

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
const mockNotifyWorkspaceConfigChanged = vi.fn()
const mockUseAgentsCatalog = vi.fn<() => {
  agents: AgentListItem[]
  isLoading: boolean
  loadError: string | null
  reload: () => Promise<void>
}>()

vi.mock('@/hooks/use-agents-catalog', () => ({
  useAgentsCatalog: () => mockUseAgentsCatalog(),
}))

vi.mock('@/lib/runtime/config-status-events', () => ({
  notifyWorkspaceConfigChanged: () => mockNotifyWorkspaceConfigChanged(),
}))

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function submitForm(buttonName: string) {
  const button = screen.getByRole('button', { name: buttonName })
  const form = button.closest('form')
  if (!form) throw new Error('missing form')
  fireEvent.submit(form)
}

function requestBody(callIndex: number) {
  const init = fetchMock.mock.calls[callIndex]?.[1]
  if (!init?.body || typeof init.body !== 'string') throw new Error('missing request body')
  return JSON.parse(init.body) as Record<string, unknown>
}

const agents: AgentListItem[] = [
  { id: 'agent-secondary', displayName: 'Secondary Agent', isPrimary: false },
  { id: 'agent-primary', displayName: 'Primary Agent', isPrimary: true },
]

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  mockNotifyWorkspaceConfigChanged.mockReset()
  mockUseAgentsCatalog.mockReturnValue({
    agents,
    isLoading: false,
    loadError: null,
    reload: async () => {},
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SkillForm', () => {
  it('creates a skill with assigned agents', async () => {
    const onSaved = vi.fn()
    fetchMock.mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') return jsonResponse({ hash: 'hash-next' })
      return jsonResponse({ hash: 'hash-current' })
    })

    render(<SkillForm slug="alice" mode="create" onSaved={onSaved} />)

    fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'research-helper' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Research things' } })
    fireEvent.change(screen.getByLabelText('SKILL.md body'), { target: { value: '# Research\nUse sources.' } })
    fireEvent.click(screen.getByLabelText(/Primary Agent/))
    submitForm('Create skill')

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ name: 'research-helper', mode: 'create' }))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/u/alice/skills', expect.objectContaining({ method: 'POST' }))
    expect(requestBody(1)).toEqual({
      name: 'research-helper',
      description: 'Research things',
      body: '# Research\nUse sources.',
      assignedAgentIds: ['agent-primary'],
    })
    expect(mockNotifyWorkspaceConfigChanged).toHaveBeenCalledTimes(1)
  })

  it('validates required create fields before saving', () => {
    fetchMock.mockResolvedValue(jsonResponse({ hash: 'hash-current' }))

    render(<SkillForm slug="alice" mode="create" />)
    submitForm('Create skill')

    expect(screen.getByText('Error: Skill name is required.')).toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('loads and updates an existing skill', async () => {
    const onSaved = vi.fn()
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (init?.method === 'PATCH') return jsonResponse({ hash: 'hash-updated' })
      if (url.endsWith('/skills/seo-audit')) {
        return jsonResponse({
          hash: 'hash-existing',
          skill: {
            name: 'seo-audit',
            description: 'Audit SEO',
            body: '# Audit',
            assignedAgentIds: ['agent-secondary'],
            hasResources: true,
            resourcePaths: ['templates/checklist.md', 'data/sample.json'],
          },
        })
      }
      return jsonResponse({ hash: 'hash-current' })
    })

    render(<SkillForm slug="alice" mode="edit" skillName="seo-audit" onSaved={onSaved} />)

    expect(await screen.findByDisplayValue('seo-audit')).toBeDefined()
    expect(
      screen.getAllByText((_content, element) =>
        element?.textContent?.includes('This skill includes 2 bundled files.') ?? false
      ).length
    ).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Updated SEO audit' } })
    fireEvent.click(screen.getByLabelText(/Secondary Agent/))
    fireEvent.click(screen.getByLabelText(/Primary Agent/))
    submitForm('Save changes')

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ name: 'seo-audit', mode: 'edit' }))
    expect(requestBody(1)).toEqual({
      description: 'Updated SEO audit',
      body: '# Audit',
      assignedAgentIds: ['agent-primary'],
      expectedHash: 'hash-existing',
    })
    expect(mockNotifyWorkspaceConfigChanged).toHaveBeenCalledTimes(1)
  })

  it('deletes an existing skill after confirmation', async () => {
    const onDeleted = vi.fn()
    const confirmMock = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmMock)
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === 'DELETE') return jsonResponse({})
      if (String(input).endsWith('/skills/seo-audit')) {
        return jsonResponse({
          hash: 'hash-existing',
          skill: {
            name: 'seo-audit',
            description: 'Audit SEO',
            body: '# Audit',
            assignedAgentIds: [],
            hasResources: false,
            resourcePaths: [],
          },
        })
      }
      return jsonResponse({ hash: 'hash-current' })
    })

    render(<SkillForm slug="alice" mode="edit" skillName="seo-audit" onDeleted={onDeleted} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete skill' }))

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith({ name: 'seo-audit' }))
    expect(confirmMock).toHaveBeenCalledWith('Delete the skill "seo-audit"?')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/u/alice/skills/seo-audit', expect.objectContaining({ method: 'DELETE' }))
    expect(mockNotifyWorkspaceConfigChanged).toHaveBeenCalledTimes(1)
  })

  it('renders load errors from the skill or agents catalog', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'missing_skill' }, { status: 404 }))

    render(<SkillForm slug="alice" mode="edit" skillName="missing" />)
    expect(await screen.findByText('Failed to load: missing_skill')).toBeDefined()

    cleanup()
    mockUseAgentsCatalog.mockReturnValue({
      agents: [],
      isLoading: false,
      loadError: 'agents_failed',
      reload: async () => {},
    })
    fetchMock.mockResolvedValueOnce(jsonResponse({ hash: 'hash-current' }))

    render(<SkillForm slug="alice" mode="create" />)
    expect(screen.getByText('Failed to load: agents_failed')).toBeDefined()
  })
})
