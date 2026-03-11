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

  it('shows a busy indicator on session tabs with running work', () => {
    const html = renderChatPanel({
      sessionTabs: [
        { id: 's1', title: 'Main', depth: 0, status: 'idle' },
        { id: 's2', title: 'Background', depth: 0, status: 'busy' },
      ],
      activeSessionId: 's1',
    })

    expect(html).toContain('Background')
    expect(html).toContain('animate-spin text-primary')
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
})
