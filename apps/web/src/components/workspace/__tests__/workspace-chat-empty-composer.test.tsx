/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_COMPOSER_INTENTS } from '@/components/workspace/empty-composer-intents'
import { WorkspaceChatEmptyComposer } from '@/components/workspace/workspace-chat-empty-composer'
import { AgentCatalogItem } from '@/hooks/use-workspace'
import { SkillListItem } from '@/hooks/use-skills-catalog'
import type { AvailableModel } from '@/lib/opencode/types'

const sendMessageMock = vi.fn().mockResolvedValue(true)
const selectModelMock = vi.fn()

const agents: AgentCatalogItem[] = [
  { id: 'assistant', displayName: 'Assistant', isPrimary: true },
  { id: 'ads-scripts', displayName: 'Ads Scripts', isPrimary: false },
]

const skills: SkillListItem[] = [
  { name: 'writer', description: 'Write copy', assignedAgentIds: [], hasResources: false, resourcePaths: [] },
  { name: 'researcher', description: 'Find sources', assignedAgentIds: [], hasResources: false, resourcePaths: [] },
]

const models: AvailableModel[] = [
  {
    providerId: 'openai',
    providerName: 'OpenAI',
    modelId: 'gpt-5.2',
    modelName: 'GPT 5.2',
    isDefault: true,
  },
  {
    providerId: 'openai',
    providerName: 'OpenAI',
    modelId: 'gpt-5.4',
    modelName: 'GPT 5.4',
    isDefault: false,
  },
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

    const heading = screen.getByTestId('empty-composer-heading')
    expect(EMPTY_COMPOSER_INTENTS).toContain(heading.textContent)
    expect(screen.getByTestId('empty-composer-glyph')).toBeTruthy()
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

  it('renders the selected model and reports model picks', async () => {
    render(
      <WorkspaceChatEmptyComposer
        agents={agents}
        models={models}
        selectedModel={models[0]}
        skills={skills}
        onSendMessage={sendMessageMock}
        onSelectModel={selectModelMock}
      />
    )

    expect(screen.getByRole('button', { name: /GPT 5\.2/ })).toBeTruthy()

    fireEvent.pointerDown(screen.getByRole('button', { name: /GPT 5\.2/ }))
    fireEvent.click(await screen.findByText('GPT 5.4'))

    expect(selectModelMock).toHaveBeenCalledWith(models[1])
  })

  it('omits the model selector when no models are available', () => {
    render(
      <WorkspaceChatEmptyComposer
        agents={agents}
        skills={skills}
        onSendMessage={sendMessageMock}
      />
    )

    expect(screen.queryByRole('button', { name: /Select model/ })).toBeNull()
  })
})
