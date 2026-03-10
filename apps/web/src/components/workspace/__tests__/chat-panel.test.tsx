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
})
