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

describe('chat prompt attachment forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.extractPdfText.mockResolvedValue({ ok: true, text: 'Extracted report body', truncated: false })
    mocks.inferAttachmentMimeType.mockReturnValue('text/plain')
    mocks.isDesktop.mockReturnValue(false)
    mocks.isPdfMime.mockReturnValue(false)
    mocks.isSpreadsheetMimeType.mockReturnValue(false)
    mocks.isDocumentMimeType.mockReturnValue(false)
    mocks.isPresentationMimeType.mockReturnValue(false)
    mocks.isWorkspaceAttachmentPath.mockReturnValue(true)
    mocks.normalizeAttachmentPath.mockImplementation((path: string) => path)
    mocks.normalizeWorkspacePath.mockImplementation((path: string) => path)
    mocks.workspaceAgentFetch.mockResolvedValue({ ok: false, data: { ok: false } })
  })

  it('adds deduplicated auto-context references as @path text', async () => {
    mocks.normalizeWorkspacePath.mockImplementation((path: string) => path.replace(/^\//, '').trim())
    mocks.isValidContextReferencePath.mockImplementation((path: string) => path.length > 0 && !path.includes('..') && !path.startsWith('.arche/'))

    const contextPaths = normalizeContextPaths([
      '/src/app/page.tsx',
      'src/app/page.tsx',
      'src/lib/utils.ts',
      '.arche/secrets.txt',
      '../etc/passwd',
      '',
    ])
    const result = await buildWorkspacePromptParts({
      agent: { baseUrl: 'http://agent', authHeader: 'Basic secret' },
      attachments: [],
      contextPaths,
      text: 'Please help with these files',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.parts).toEqual([
      { type: 'text', text: 'Please help with these files' },
      {
        type: 'text',
        text:
          'Workspace context references (open files):\n@src/app/page.tsx\n@src/lib/utils.ts\nThese are references only; inspect files with tools when needed.',
      },
    ])
  })

  it('limits auto-context references to 20 paths', () => {
    const contextPaths = Array.from({ length: 25 }, (_, index) => `src/file-${index + 1}.ts`)
    const normalized = normalizeContextPaths(contextPaths)

    expect(normalized).toHaveLength(20)
    expect(normalized[0]).toBe('src/file-1.ts')
    expect(normalized[19]).toBe('src/file-20.ts')
    expect(normalized).not.toContain('src/file-21.ts')
  })

  it('extracts PDF attachments before sending prompt parts', async () => {
    mocks.isPdfMime.mockImplementation((mime: string) => mime === 'application/pdf')
    mocks.workspaceAgentFetch.mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        content: Buffer.from('pdf bytes').toString('base64'),
        encoding: 'base64',
      },
    })

    const result = await buildWorkspacePromptParts({
      agent: { baseUrl: 'http://agent', authHeader: 'Basic secret' },
      attachments: [
        { path: '.arche/attachments/report.pdf', filename: 'report.pdf', mime: 'application/pdf' },
      ],
      contextPaths: [],
      text: 'Summarize this',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const promptText = result.parts.map((part) => ('text' in part ? part.text : '')).join('\n')
    expect(promptText).toContain('Extracted text from attached PDF')
    expect(promptText).toContain('Extracted report body')
  })

  it('rejects invalid attachment paths before prompt start', async () => {
    mocks.isWorkspaceAttachmentPath.mockReturnValue(false)

    await expect(buildWorkspacePromptParts({
      agent: { baseUrl: 'http://agent', authHeader: 'Basic secret' },
      attachments: [{ path: '../secret.txt', filename: 'secret.txt' }],
      contextPaths: [],
      text: undefined,
    })).resolves.toEqual({ ok: false, error: 'invalid_attachment_path' })
  })
})
