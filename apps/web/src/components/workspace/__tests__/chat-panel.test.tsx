import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ChatPanel } from '@/components/workspace/chat-panel'

vi.mock('next/image', () => ({
  default: () => null,
}))

describe('ChatPanel', () => {
  it('shows a starting overlay and hides previous messages', () => {
    const html = renderToStaticMarkup(
      <ChatPanel
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
        openFilesCount={0}
        onCloseSession={() => {}}
        onOpenFile={() => {}}
        onSendMessage={async () => {}}
        isStartingNewSession={true}
      />
    )

    expect(html).toContain('Starting a new conversation')
    expect(html).not.toContain('OLD CHAT')
  })
})
