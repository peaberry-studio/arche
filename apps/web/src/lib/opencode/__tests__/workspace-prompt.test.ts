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
  normalizeMessageAttachments,
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

  it('limits context references and normalizes attachment inputs', () => {
    const paths = Array.from({ length: 25 }, (_, index) => `notes/${index}.md`)

    expect(normalizeContextPaths('notes/a.md')).toEqual([])
    expect(normalizeContextPaths(paths)).toHaveLength(20)
    expect(normalizeMessageAttachments('not-array')).toEqual([])
    expect(normalizeMessageAttachments([
      { path: ' .arche/attachments/a.txt ', filename: 'a.txt', mime: 'text/plain' },
      { filename: 'missing-path.txt' },
      null,
    ])).toEqual([
      { path: ' .arche/attachments/a.txt ', filename: 'a.txt', mime: 'text/plain' },
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

  it('returns validation errors for empty prompts and invalid attachment paths', async () => {
    await expect(buildWorkspacePromptParts({
      agent: { baseUrl: 'http://agent', authHeader: 'Basic secret' },
      attachments: [],
      contextPaths: [],
    })).resolves.toEqual({ ok: false, error: 'missing_fields' })

    mocks.isWorkspaceAttachmentPath.mockReturnValue(false)
    await expect(buildWorkspacePromptParts({
      agent: { baseUrl: 'http://agent', authHeader: 'Basic secret' },
      attachments: [{ path: '/tmp/nope.txt' }],
      contextPaths: [],
      text: 'Hi',
    })).resolves.toEqual({ ok: false, error: 'invalid_attachment_path' })
  })

  it('adds fallback text for PDFs and specialized attachment tool hints', async () => {
    mocks.isPdfMime.mockImplementation((mime: string) => mime === 'application/pdf')
    mocks.isSpreadsheetMimeType.mockImplementation((mime: string) => mime === 'text/csv')
    mocks.isDocumentMimeType.mockImplementation((mime: string) => mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    mocks.isPresentationMimeType.mockImplementation((mime: string) => mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    mocks.extractPdfText.mockResolvedValue({ ok: false })
    mocks.workspaceAgentFetch
      .mockResolvedValueOnce({ ok: false, data: { ok: false } })
      .mockResolvedValueOnce({ ok: true, data: { ok: true, content: 'pdf bytes', encoding: 'utf-8' } })

    const result = await buildWorkspacePromptParts({
      agent: { baseUrl: 'http://agent', authHeader: 'Basic secret' },
      attachments: [
        { path: '.arche/attachments/missing.pdf', mime: 'application/pdf' },
        { path: '.arche/attachments/scanned.pdf', mime: 'application/pdf' },
        { path: '.arche/attachments/data.csv', mime: 'text/csv' },
        { path: '.arche/attachments/brief.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { path: '.arche/attachments/deck.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
      ],
      contextPaths: [],
      text: 'Review these files',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const promptText = result.parts.map((part) => ('text' in part ? part.text : '')).join('\n')
    expect(promptText).toContain('Attached PDF could not be extracted automatically')
    expect(promptText).toContain('You must use spreadsheet_inspect first')
    expect(promptText).toContain('Use document_inspect')
    expect(promptText).toContain('Use presentation_inspect')
  })

  it('falls back to workspace file urls for unreadable attachments when available', async () => {
    mocks.workspaceAgentFetch.mockResolvedValue({ ok: true, data: { ok: true, content: 'ignored', encoding: 'binary' } })
    mocks.inferAttachmentMimeType.mockImplementation((filename: string) => filename.endsWith('.png') ? 'image/png' : 'text/plain')

    const result = await buildWorkspacePromptParts({
      agent: { baseUrl: 'http://agent', authHeader: 'Basic secret' },
      attachments: [
        { path: '.arche/attachments/missing.png' },
        { path: '.arche/attachments/notes.txt' },
      ],
      contextPaths: [],
      text: 'Open these',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.parts).toContainEqual({
      type: 'file',
      mime: 'image/png',
      filename: 'missing.png',
      url: 'file:///workspace/.arche/attachments/missing.png',
    })
    expect(result.parts).toContainEqual({
      type: 'file',
      mime: 'text/plain',
      filename: 'notes.txt',
      url: 'file:///workspace/.arche/attachments/notes.txt',
    })
  })

  it('omits file urls in desktop mode while keeping attachment hints', async () => {
    mocks.isDesktop.mockReturnValue(true)
    mocks.workspaceAgentFetch.mockResolvedValue({ ok: false, data: { ok: false } })

    const result = await buildWorkspacePromptParts({
      agent: { baseUrl: 'http://agent', authHeader: 'Basic secret' },
      attachments: [{ path: '.arche/attachments/notes.txt' }],
      contextPaths: [],
      text: 'Open this',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.parts.some((part) => part.type === 'file')).toBe(false)
    expect(result.parts.map((part) => ('text' in part ? part.text : '')).join('\n')).toContain('- .arche/attachments/notes.txt')
  })
})
