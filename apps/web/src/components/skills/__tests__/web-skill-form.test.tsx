/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WebSkillForm } from '@/components/skills/web-skill-form'

const pushMock = vi.fn()

const skillFormMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('@/components/skills/skill-form', () => ({
  SkillForm: (props: {
    slug: string
    mode: 'create' | 'edit'
    skillName?: string
    onCancel?: () => void
    onDeleted?: () => void
    onSaved?: (result: { mode: 'create' | 'edit'; name: string }) => Promise<void>
  }) => {
    skillFormMock(props)
    return (
      <div data-testid="skill-form">
        <button type="button" onClick={() => props.onCancel?.()}>
          Cancel
        </button>
        <button type="button" onClick={() => props.onSaved?.({ mode: props.mode, name: 'skill-1' })}>
          Save
        </button>
        <button type="button" onClick={() => props.onDeleted?.()}>
          Delete
        </button>
      </div>
    )
  },
}))

describe('WebSkillForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders SkillForm with correct props', () => {
    render(<WebSkillForm slug="alice" mode="create" />)

    expect(screen.getByTestId('skill-form')).toBeDefined()
    expect(skillFormMock).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'alice',
        mode: 'create',
      })
    )
  })

  it('navigates to skills list on cancel', () => {
    render(<WebSkillForm slug="alice" mode="create" />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(pushMock).toHaveBeenCalledWith('/u/alice/skills')
  })

  it('navigates to skills list on delete', () => {
    render(<WebSkillForm slug="alice" mode="edit" skillName="skill-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(pushMock).toHaveBeenCalledWith('/u/alice/skills')
  })

  it('navigates to skills list on save when mode is create', () => {
    render(<WebSkillForm slug="alice" mode="create" />)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(pushMock).toHaveBeenCalledWith('/u/alice/skills')
  })

  it('does not navigate on save when mode is edit', () => {
    render(<WebSkillForm slug="alice" mode="edit" skillName="skill-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(pushMock).not.toHaveBeenCalled()
  })
})
