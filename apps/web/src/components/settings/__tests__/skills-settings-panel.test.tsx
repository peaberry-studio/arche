/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SkillsSettingsPanel } from '@/components/settings/skills-settings-panel'

const reloadMock = vi.fn()
const useSkillsCatalogMock = vi.fn()
const useAgentsCatalogMock = vi.fn()

vi.mock('@/hooks/use-skills-catalog', () => ({
  useSkillsCatalog: (...args: unknown[]) => useSkillsCatalogMock(...args),
}))

vi.mock('@/hooks/use-agents-catalog', () => ({
  useAgentsCatalog: (...args: unknown[]) => useAgentsCatalogMock(...args),
}))

const skillFormMock = vi.fn()
vi.mock('@/components/skills/skill-form', () => ({
  SkillForm: (props: {
    mode: 'create' | 'edit'
    onCancel?: () => void
    onSaved?: () => Promise<void>
    skillName?: string
  }) => {
    skillFormMock(props)
    return (
      <div>
        <p>Skill Form {props.mode}</p>
        <p>{props.skillName ?? 'new-skill'}</p>
        <button type="button" onClick={() => props.onSaved?.()}>
          Save form
        </button>
        <button type="button" onClick={() => props.onCancel?.()}>
          Cancel form
        </button>
      </div>
    )
  },
}))

vi.mock('@/components/skills/import-skill-dialog', () => ({
  ImportSkillDialog: () => <div>Import Skill Dialog</div>,
}))

describe('SkillsSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reloadMock.mockResolvedValue(undefined)
    useSkillsCatalogMock.mockReturnValue({
      skills: [
        {
          name: 'pdf-processing',
          description: 'Handle PDFs',
          assignedAgentIds: ['assistant'],
          hasResources: false,
          resourcePaths: [],
        },
      ],
      hash: 'hash-1',
      isLoading: false,
      loadError: null,
      reload: reloadMock,
    })
    useAgentsCatalogMock.mockReturnValue({
      agents: [
        { id: 'assistant', displayName: 'Assistant', isPrimary: true },
      ],
      isLoading: false,
      loadError: null,
      reload: vi.fn(),
    })
  })

  it('renders the skill catalog and opens the embedded editor', async () => {
    render(<SkillsSettingsPanel slug="local" />)

    expect(screen.getByRole('heading', { name: 'Skills' })).toBeTruthy()
    expect(screen.getByText('pdf-processing')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByText('Skill Form edit')).toBeTruthy()
    expect(screen.getByText('pdf-processing')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save form' }))

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('heading', { name: 'Skills' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create skill' }))
    expect(screen.getByText('Skill Form create')).toBeTruthy()
    expect(screen.getByText('new-skill')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel form' }))
    expect(screen.getByRole('heading', { name: 'Skills' })).toBeTruthy()
  })
})
