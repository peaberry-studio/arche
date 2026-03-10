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
          onSendMessage={async () => {}}
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
})
