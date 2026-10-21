/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_COMPOSER_INTENTS } from '@/components/workspace/empty-composer-intents'
import { WorkspaceChatEmptyComposer } from '@/components/workspace/workspace-chat-empty-composer'
import type { AvailableModel } from '@/types/workspace-runtime'

const sendMessageMock = vi.fn().mockResolvedValue(true)
const selectModelMock = vi.fn()

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
        onSendMessage={sendMessageMock}
      />
    )

    const heading = screen.getByTestId('empty-composer-heading')
    expect(EMPTY_COMPOSER_INTENTS).toContain(heading.textContent)
    expect(screen.getByTestId('empty-composer-glyph')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add knowledge files' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Experts' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Skills' })).toBeNull()
    expect(screen.getByPlaceholderText('Describe what you want to work on...')).toBeTruthy()
  })

  it('submits plain text via onSendMessage without sessionStorage', async () => {
    render(
      <WorkspaceChatEmptyComposer
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

  it('sends the knowledge files picked from + as context and wiki links', () => {
    render(
      <WorkspaceChatEmptyComposer
        onSendMessage={sendMessageMock}
        recentUpdates={[{ fileName: 'plan.md', filePath: 'docs/plan.md' }]}
      />
    )

    const addButton = screen.getByRole('button', { name: 'Add knowledge files' })
    fireEvent.click(addButton)
    expect(addButton.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /plan\.md/ }))
    expect(addButton.textContent).toContain('1')

    fireEvent.change(screen.getByPlaceholderText('Describe what you want to work on...'), {
      target: { value: 'Draft' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start working' }))

    expect(sendMessageMock).toHaveBeenCalledWith(
      '[[docs/plan.md]]\n\nDraft',
      undefined,
      { forceNewSession: true, contextPaths: ['docs/plan.md'] }
    )
  })

  it('disables the submit button when empty', () => {
    render(
      <WorkspaceChatEmptyComposer
        onSendMessage={sendMessageMock}
      />
    )

    expect((screen.getByRole('button', { name: 'Start working' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders the selected model and reports model picks', async () => {
    render(
      <WorkspaceChatEmptyComposer
        models={models}
        selectedModel={models[0]}
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
        onSendMessage={sendMessageMock}
      />
    )

    expect(screen.queryByRole('button', { name: /Select model/ })).toBeNull()
  })
})
