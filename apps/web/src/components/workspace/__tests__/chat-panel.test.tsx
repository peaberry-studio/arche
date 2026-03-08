import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ChatPanel } from '@/components/workspace/chat-panel'
import { WorkspaceThemeProvider } from '@/contexts/workspace-theme-context'

vi.mock('next/image', () => ({
  default: () => null,
}))

describe('ChatPanel', () => {
  it('shows a starting overlay and hides previous messages', () => {
    const html = renderToStaticMarkup(
      <WorkspaceThemeProvider storageScope={'alice'}>
        <ChatPanel
          slug={'alice'}
          sessions={[{ id: 's1', title: 'Old', status: 'idle', updatedAt: 'now', agent: 'OpenCode' }]}
          messages={[
            {
              id: 'm1',
              sessionId: 's1',
              role: 'assistant',
              content: 'OLD CHAT',
              timestamp: 'now',
            },
          ]}
          activeSessionId={'s1'}
          openFilePaths={[]}
          onCloseSession={() => {}}
          onOpenFile={() => {}}
          onSendMessage={async () => {}}
          isStartingNewSession={true}
        />
      </WorkspaceThemeProvider>
    )

    expect(html).toContain('Starting a new conversation')
    expect(html).not.toContain('OLD CHAT')
  })
})
