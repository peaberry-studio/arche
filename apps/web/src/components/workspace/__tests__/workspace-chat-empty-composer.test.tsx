/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceChatEmptyComposer } from '@/components/workspace/workspace-chat-empty-composer'
import { AgentCatalogItem } from '@/hooks/use-workspace'
import { SkillListItem } from '@/hooks/use-skills-catalog'

const sendMessageMock = vi.fn().mockResolvedValue(true)

const agents: AgentCatalogItem[] = [
  { id: 'assistant', displayName: 'Assistant', isPrimary: true },
  { id: 'ads-scripts', displayName: 'Ads Scripts', isPrimary: false },
]

const skills: SkillListItem[] = [
  { name: 'writer', description: 'Write copy' },
  { name: 'researcher', description: 'Find sources' },
]

describe('WorkspaceChatEmptyComposer', () => {
  beforeEach(() => {
    sendMessageMock.mockClear()
    sendMessageMock.mockResolvedValue(true)
    window.sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the dashboard composer and submit send in place', () => {
    render(
      <WorkspaceChatEmptyComposer
        agents={agents}
        skills={skills}
        onSendMessage={sendMessageMock}
      />
    )

    expect(screen.getByText('What do you want to work on today?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Knowledge' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Experts' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Skills' })).toBeTruthy()
    expect(screen.getByPlaceholderText('Describe what you want to work on...')).toBeTruthy()
  })

  it('submits plain text via onSendMessage without sessionStorage', async () => {
    render(
      <WorkspaceChatEmptyComposer
        agents={agents}
        skills={skills}
        onSendMessage={sendMessageMock}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('Describe what you want to work on...'), {
      target: { value: 'Review the plan' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start working' }))

    expect(sendMessageMock).toHaveBeenCalledWith('Review the plan', undefined, {
      forceNewSession: true,
      contextPaths: [],
    })
    expect(window.sessionStorage.getItem('arche.workspace.alice.start-prompt')).toBeNull()
  })

  it('composes a mention and slash command prompt', () => {
    render(
      <WorkspaceChatEmptyComposer
        agents={agents}
        skills={skills}
        onSendMessage={sendMessageMock}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Experts' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Ads Scripts/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /writer/ }))

    fireEvent.change(screen.getByPlaceholderText('Describe what you want to work on...'), {
      target: { value: 'Draft' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start working' }))

    expect(sendMessageMock).toHaveBeenCalledWith(
      '@ads-scripts /writer\n\nDraft',
      undefined,
      { forceNewSession: true, contextPaths: [] }
    )
  })

  it('disables the submit button when empty', () => {
    render(
      <WorkspaceChatEmptyComposer
        agents={agents}
        skills={skills}
        onSendMessage={sendMessageMock}
      />
    )

    expect((screen.getByRole('button', { name: 'Start working' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
