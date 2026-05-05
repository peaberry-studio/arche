/** @vitest-environment jsdom */

import { useRef, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgentMentionAutocomplete } from '@/hooks/use-agent-mention-autocomplete'
import type { AgentCatalogItem } from '@/hooks/use-workspace'

const agents: AgentCatalogItem[] = [
  {
    id: 'assistant',
    displayName: 'Assistant',
    model: 'openai/gpt-5.5',
    isPrimary: true,
  },
  {
    id: 'design',
    displayName: 'Design Expert',
    model: 'anthropic/claude-sonnet-4.5',
    isPrimary: false,
  },
  {
    id: 'linear',
    displayName: 'Linear Expert',
    model: 'openai/gpt-5.5',
    isPrimary: false,
  },
]

type HarnessProps = {
  initialValue?: string
  isReadOnly?: boolean
}

function Harness({ initialValue = '', isReadOnly = false }: HarnessProps) {
  const [inputValue, setInputValue] = useState(initialValue)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mention = useAgentMentionAutocomplete({
    agents,
    inputValue,
    isReadOnly,
    setInputValue,
    textareaRef,
  })

  return (
    <div>
      <textarea
        aria-label="Message"
        ref={textareaRef}
        value={inputValue}
        onBlur={mention.handleTextareaBlur}
        onChange={mention.handleInputChange}
        onKeyDown={(event) => {
          mention.handleMentionKeyDown(event)
        }}
        onKeyUp={mention.handleTextareaKeyUp}
        onSelect={mention.handleTextareaSelectionChange}
      />
      <div data-testid="value">{inputValue}</div>
      <div data-testid="selected-index">
        {mention.agentMentionAutocomplete?.selectedIndex ?? -1}
      </div>
      <button
        type="button"
        onClick={() => mention.insertComposerText('Prefix ', { from: -5, to: 0 })}
      >
        Insert prefix
      </button>
      {mention.agentMentionAutocomplete?.suggestions.map((agent) => (
        <button
          key={agent.id}
          type="button"
          onMouseDown={() => {
            mention.onAgentMentionSelect(agent, {
              from: mention.agentMentionAutocomplete?.from ?? 0,
              to: mention.agentMentionAutocomplete?.to ?? 0,
            })
          }}
        >
          Select {agent.displayName}
        </button>
      ))}
    </div>
  )
}

function prepareTextarea(value: string, selectionStart = value.length, selectionEnd = selectionStart) {
  const textarea = screen.getByLabelText('Message') as HTMLTextAreaElement
  Object.defineProperty(textarea, 'clientWidth', { configurable: true, value: 320 })
  textarea.getBoundingClientRect = () => ({
    bottom: 64,
    height: 40,
    left: 16,
    right: 336,
    top: 24,
    width: 320,
    x: 16,
    y: 24,
    toJSON: () => ({}),
  })
  fireEvent.change(textarea, {
    target: { value, selectionStart, selectionEnd },
  })
  return textarea
}

describe('useAgentMentionAutocomplete', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('navigates suggestions and inserts the selected agent mention', () => {
    render(<Harness />)

    const textarea = prepareTextarea('Ask @')

    expect(screen.getByRole('button', { name: 'Select Design Expert' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Select Linear Expert' })).toBeTruthy()

    fireEvent.keyDown(textarea, { key: 'ArrowDown' })
    expect(screen.getByTestId('selected-index').textContent).toBe('1')

    fireEvent.keyDown(textarea, { key: 'ArrowUp' })
    expect(screen.getByTestId('selected-index').textContent).toBe('0')

    fireEvent.keyDown(textarea, { key: 'ArrowDown' })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(screen.getByTestId('value').textContent).toBe('Ask @linear ')
    expect(screen.queryByRole('button', { name: 'Select Linear Expert' })).toBeNull()
  })

  it('supports mouse selection and explicit text insertion', () => {
    render(<Harness />)

    prepareTextarea('Ask @de')
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Select Design Expert' }))

    expect(screen.getByTestId('value').textContent).toBe('Ask @design ')

    fireEvent.click(screen.getByRole('button', { name: 'Insert prefix' }))

    expect(screen.getByTestId('value').textContent).toBe('Prefix Ask @design ')
  })

  it('clears suggestions for non-matches, blur, and read-only composers', () => {
    const { rerender } = render(<Harness />)

    const textarea = prepareTextarea('Ask @unknown')
    expect(screen.getByTestId('selected-index').textContent).toBe('-1')

    prepareTextarea('Ask @de')
    expect(screen.getByRole('button', { name: 'Select Design Expert' })).toBeTruthy()

    fireEvent.blur(textarea)
    expect(screen.queryByRole('button', { name: 'Select Design Expert' })).toBeNull()

    rerender(<Harness isReadOnly />)
    prepareTextarea('Ask @de')

    expect(screen.queryByRole('button', { name: 'Select Design Expert' })).toBeNull()
  })

  it('ignores reserved navigation keys during key-up handling', () => {
    render(<Harness />)

    const textarea = prepareTextarea('Ask @de')
    fireEvent.keyUp(textarea, { key: 'Escape' })

    expect(screen.getByRole('button', { name: 'Select Design Expert' })).toBeTruthy()
  })
})
