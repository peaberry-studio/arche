import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPdfParse = vi.fn()
vi.mock('pdf-parse', () => ({
  default: (...args: unknown[]) => mockPdfParse(...args),
}))

describe('extractPdfText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns parsed text when extraction succeeds', async () => {
    mockPdfParse.mockResolvedValueOnce({ text: '  Hello PDF\n\n' })

    const { extractPdfText } = await import('@/lib/attachments/pdf-text-extractor')
    const result = await extractPdfText(Buffer.from('fake-pdf-binary'), 100)

    expect(result).toEqual({
      ok: true,
      text: 'Hello PDF',
      truncated: false,
      originalLength: 9,
    })
  })

  it('truncates extracted text when it exceeds the character budget', async () => {
    mockPdfParse.mockResolvedValueOnce({ text: 'abcdefghijklmnopqrstuvwxyz' })

    const { extractPdfText } = await import('@/lib/attachments/pdf-text-extractor')
    const result = await extractPdfText(Buffer.from('fake-pdf-binary'), 10)

    expect(result).toEqual({
      ok: true,
      text: 'abcdefghij\n\n[truncated]',
      truncated: true,
      originalLength: 26,
    })
  })

  it('returns a typed failure when parser yields no text', async () => {
    mockPdfParse.mockResolvedValueOnce({ text: '   ' })

    const { extractPdfText } = await import('@/lib/attachments/pdf-text-extractor')
    const result = await extractPdfText(Buffer.from('fake-pdf-binary'), 100)

    expect(result).toEqual({ ok: false, error: 'pdf_no_text' })
  })

  it('returns a typed failure when parser throws', async () => {
    mockPdfParse.mockRejectedValueOnce(new Error('bad pdf'))

    const { extractPdfText } = await import('@/lib/attachments/pdf-text-extractor')
    const result = await extractPdfText(Buffer.from('fake-pdf-binary'), 100)

    expect(result).toEqual({ ok: false, error: 'pdf_parse_failed' })
  })
})
