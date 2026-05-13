import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  extractPdfText: vi.fn(),
  inferAttachmentMimeType: vi.fn(() => 'text/plain'),
  isDesktop: vi.fn(() => false),
  isDocumentMimeType: vi.fn(() => false),
  isPdfMime: vi.fn(() => false),
  isPresentationMimeType: vi.fn(() => false),
  isSpreadsheetMimeType: vi.fn(() => false),
  isValidContextReferencePath: vi.fn(() => true),
  isWorkspaceAttachmentPath: vi.fn(() => true),
  normalizeAttachmentPath: vi.fn((path: string) => path),
  normalizeWorkspacePath: vi.fn((path: string) => path),
  workspaceAgentFetch: vi.fn(),
}))

vi.mock('@/lib/attachments/pdf-text-extractor', () => ({
  extractPdfText: mocks.extractPdfText,
  isPdfMime: mocks.isPdfMime,
}))
vi.mock('@/lib/runtime/mode', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@/lib/workspace-agent-client', () => ({ workspaceAgentFetch: mocks.workspaceAgentFetch }))
vi.mock('@/lib/workspace-attachments', () => ({
  inferAttachmentMimeType: mocks.inferAttachmentMimeType,
  isDocumentMimeType: mocks.isDocumentMimeType,
  isPresentationMimeType: mocks.isPresentationMimeType,
  isSpreadsheetMimeType: mocks.isSpreadsheetMimeType,
  isWorkspaceAttachmentPath: mocks.isWorkspaceAttachmentPath,
}))
vi.mock('@/lib/workspace-paths', () => ({
  isValidContextReferencePath: mocks.isValidContextReferencePath,
  normalizeAttachmentPath: mocks.normalizeAttachmentPath,
  normalizeWorkspacePath: mocks.normalizeWorkspacePath,
}))

import {
  buildWorkspacePromptParts,
  normalizeContextPaths,
} from '@/lib/opencode/workspace-prompt'

describe('workspace prompt builder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.extractPdfText.mockResolvedValue({ ok: true, text: 'PDF body', truncated: true })
    mocks.inferAttachmentMimeType.mockReturnValue('text/plain')
    mocks.isPdfMime.mockReturnValue(false)
    mocks.isSpreadsheetMimeType.mockReturnValue(false)
    mocks.isDocumentMimeType.mockReturnValue(false)
    mocks.isPresentationMimeType.mockReturnValue(false)
    mocks.isWorkspaceAttachmentPath.mockReturnValue(true)
    mocks.workspaceAgentFetch.mockResolvedValue({ ok: false, data: { ok: false } })
  })

  it('deduplicates valid context paths', () => {
    mocks.normalizeWorkspacePath.mockImplementation((path: string) => path.trim())
    mocks.isValidContextReferencePath.mockImplementation((path: string) => !path.includes('bad'))

    expect(normalizeContextPaths([' notes/a.md ', 'notes/a.md', 'bad/../path'])).toEqual([
      'notes/a.md',
    ])
  })

  it('builds prompt parts for PDFs, images, and attachment hints', async () => {
    mocks.isPdfMime.mockImplementation((mime: string) => mime === 'application/pdf')
    mocks.workspaceAgentFetch
      .mockResolvedValueOnce({
        ok: true,
        data: {
          ok: true,
          content: Buffer.from('pdf bytes').toString('base64'),
          encoding: 'base64',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          ok: true,
          content: 'image bytes',
          encoding: 'utf-8',
        },
      })

    const result = await buildWorkspacePromptParts({
      agent: { baseUrl: 'http://agent', authHeader: 'Basic secret' },
      attachments: [
        { path: '.arche/attachments/report.pdf', filename: 'report.pdf', mime: 'application/pdf' },
        { path: '.arche/attachments/screenshot.png', filename: 'screenshot.png', mime: 'image/png' },
      ],
      contextPaths: ['notes/a.md'],
      text: 'Hi',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const promptText = result.parts.map((part) => ('text' in part ? part.text : '')).join('\n')
    expect(promptText).toContain('Workspace context references')
    expect(promptText).toContain('Extracted text from attached PDF')
    expect(promptText).toContain('PDF body')
    expect(promptText).toContain('truncated to fit the prompt window')
    expect(promptText).toContain('Attached workspace files:')
    expect(result.parts).toContainEqual({
      type: 'file',
      mime: 'image/png',
      filename: 'screenshot.png',
      url: `data:image/png;base64,${Buffer.from('image bytes').toString('base64')}`,
    })
  })
})
