import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ChatPanel } from '@/components/workspace/chat-panel'
import { WorkspaceThemeProvider } from '@/contexts/workspace-theme-context'

vi.mock('next/image', () => ({
  default: () => null,
}))

describe('ChatPanel', () => {
  function renderChatPanel(overrides?: Partial<ComponentProps<typeof ChatPanel>>) {
    return renderToStaticMarkup(
      <WorkspaceThemeProvider storageScope={'alice'}>
        <ChatPanel
          slug={'alice'}
          sessions={[{ id: 's1', title: 'Old', status: 'idle', updatedAt: 'now', agent: 'OpenCode' }]}
          messages={[]}
          activeSessionId={'s1'}
          openFilePaths={[]}
          onCloseSession={() => {}}
          onOpenFile={() => {}}
          onSendMessage={async () => true}
          {...overrides}
        />
      </WorkspaceThemeProvider>
    )
  }

  it('shows a starting overlay and hides previous messages', () => {
    const html = renderChatPanel({
      messages: [
        {
          id: 'm1',
          sessionId: 's1',
          role: 'assistant',
          content: 'OLD CHAT',
          timestamp: 'now',
        },
      ],
      isStartingNewSession: true,
    })

    expect(html).toContain('Starting a new conversation')
    expect(html).not.toContain('OLD CHAT')
  })

  it('shows only the active session title when session tabs are available', () => {
    const html = renderChatPanel({
      sessions: [
        { id: 's1', title: 'Main conversation', status: 'idle', updatedAt: 'now', agent: 'OpenCode' },
        { id: 's2', title: 'Linear subagent', status: 'active', updatedAt: 'now', agent: 'OpenCode' },
      ],
      sessionTabs: [
        { id: 's1', title: 'Main', depth: 0, status: 'idle' },
        { id: 's2', title: 'Linear', depth: 1, status: 'busy' },
      ],
      activeSessionId: 's2',
    })

    expect(html).toContain('Linear subagent')
    expect(html).not.toContain('Main conversation')
  })

  it('renders connector tool calls with friendly labels', () => {
    const html = renderChatPanel({
      messages: [
        {
          id: 'm1',
          sessionId: 's1',
          role: 'assistant',
          content: '',
          timestamp: 'now',
          parts: [
            {
              type: 'tool',
              id: 'tool-1',
              name: 'arche_notion_conn123_list_teams',
              state: { status: 'completed', input: {}, output: '', title: 'list teams' },
            },
          ],
        },
      ],
    })

    expect(html).toContain('Using Notion')
    expect(html).toContain('list teams')
    expect(html).not.toContain('arche_notion_conn123_list_teams')
  })

  it('renders streaming connector status with friendly labels', () => {
    const html = renderChatPanel({
      messages: [
        {
          id: 'm1',
          sessionId: 's1',
          role: 'assistant',
          content: '',
          timestamp: 'now',
          pending: true,
          statusInfo: {
            status: 'tool-calling',
            toolName: 'arche_linear_conn123_get_issue',
          },
        },
      ],
    })

    expect(html).toContain('Using Linear -&gt; get issue...')
    expect(html).not.toContain('arche_linear_conn123_get_issue')
  })

  it('renders assistant errors as a friendly inline notice', () => {
    const html = renderChatPanel({
      messages: [
        {
          id: 'm1',
          sessionId: 's1',
          role: 'assistant',
          content: '',
          timestamp: 'now',
          parts: [],
          pending: false,
          statusInfo: {
            status: 'error',
            detail: 'rate_limited',
          },
        },
      ],
    })

    expect(html).toContain('Rate limited')
    expect(html).toContain('Too many requests were sent at once. Try again in a moment.')
  })

  it('renders task delegation with friendly labels instead of agent=', () => {
    const html = renderChatPanel({
      messages: [
        {
          id: 'm1',
          sessionId: 's1',
          role: 'assistant',
          content: '',
          timestamp: 'now',
          parts: [
            {
              type: 'tool',
              id: 'tool-1',
              name: 'task',
              state: {
                status: 'running',
                input: {
                  subagent_type: 'linear',
                  description: 'Resumen proyectos Linear',
                },
              },
            },
          ],
        },
      ],
    })

    expect(html).toContain('Delegated to Linear')
    expect(html).toContain('Resumen proyectos Linear')
    expect(html).not.toContain('agent=')
  })

  it('shows a View button when a matching subagent session tab exists', () => {
    const html = renderChatPanel({
      sessionTabs: [
        { id: 's1', title: 'Main', depth: 0, status: 'idle' },
        { id: 's-linear', title: 'Linear task', depth: 1, status: 'busy' },
      ],
      onSelectSessionTab: () => {},
      messages: [
        {
          id: 'm1',
          sessionId: 's1',
          role: 'assistant',
          content: '',
          timestamp: 'now',
          parts: [
            {
              type: 'tool',
              id: 'tool-1',
              name: 'task',
              state: {
                status: 'running',
                input: {
                  subagent_type: 'linear',
                  description: 'Fetch issues',
                },
              },
            },
          ],
        },
      ],
    })

    expect(html).toContain('View')
    expect(html).toContain('Delegated to Linear')
  })

  it('renders completed delegation without View button when no session tabs', () => {
    const html = renderChatPanel({
      messages: [
        {
          id: 'm1',
          sessionId: 's1',
          role: 'assistant',
          content: '',
          timestamp: 'now',
          parts: [
            {
              type: 'tool',
              id: 'tool-1',
              name: 'task',
              state: {
                status: 'completed',
                input: {
                  subagent_type: 'linear',
                  description: 'Done with issues',
                },
                output: 'result',
                title: 'task done',
              },
            },
          ],
        },
      ],
    })

    expect(html).toContain('Delegated to Linear')
    expect(html).toContain('Done with issues')
    expect(html).not.toContain('View')
    expect(html).not.toContain('agent=')
  })

  it('renders a dedicated email draft card for email_draft tool output', () => {
    const html = renderChatPanel({
      messages: [
        {
          id: 'm1',
          sessionId: 's1',
          role: 'assistant',
          content: '',
          timestamp: 'now',
          parts: [
            {
              type: 'tool',
              id: 'tool-email-1',
              name: 'email_draft',
              state: {
                status: 'completed',
                input: {},
                output: JSON.stringify({
                  ok: true,
                  format: 'email-draft',
                  subject: 'Follow-up on Q2 proposal',
                  body: 'Hi Ana,\n\nThanks for your time today.',
                  to: ['ana@example.com'],
                }),
                title: 'email draft',
              },
            },
            {
              type: 'text',
              text: 'If you want, I can make it more formal.',
            },
          ],
        },
      ],
    })

    expect(html).toContain('Email draft')
    expect(html).toContain('Follow-up on Q2 proposal')
    expect(html).toContain('ana@example.com')
    expect(html).toContain('If you want, I can make it more formal.')
  })

  it('renders unknown parts even when their debug payload contains bigint-like values', () => {
    const html = renderChatPanel({
      messages: [
        {
          id: 'm1',
          sessionId: 's1',
          role: 'assistant',
          content: '',
          timestamp: 'now',
          parts: [
            {
              type: 'unknown',
              originalType: 'mystery',
              data: {
                id: '42',
                nested: { count: '3' },
              },
            },
          ],
        },
      ],
    })

    expect(html).toContain('Unknown type: mystery')
    expect(html).toContain('&quot;id&quot;: &quot;42&quot;')
  })
})
