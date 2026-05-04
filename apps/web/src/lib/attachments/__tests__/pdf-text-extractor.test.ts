import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPdfParse = vi.fn()

vi.mock('pdf-parse', () => ({
  default: (...args: unknown[]) => mockPdfParse(...args),
}))

import { extractPdfText, isPdfMime } from '../pdf-text-extractor'

describe('extractPdfText', () => {
  beforeEach(() => {
    mockPdfParse.mockReset()
  })

  it('returns error when buffer is empty', async () => {
    const result = await extractPdfText(Buffer.alloc(0), 1000)
    expect(result).toEqual({ ok: false, error: 'pdf_empty' })
  })

  it('returns extracted text when pdf parses successfully', async () => {
    mockPdfParse.mockResolvedValue({ text: ' hello world ' })
    const result = await extractPdfText(Buffer.from('fake'), 1000)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.text).toBe('hello world')
      expect(result.truncated).toBe(false)
      expect(result.originalLength).toBe(11)
    }
  })

  it('normalizes line endings and null characters', async () => {
    mockPdfParse.mockResolvedValue({ text: 'line1\r\nline2\rline3\u0000end' })
    const result = await extractPdfText(Buffer.from('fake'), 1000)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.text).toBe('line1\nline2\nline3end')
    }
  })

  it('truncates text when it exceeds maxChars', async () => {
    mockPdfParse.mockResolvedValue({ text: 'a'.repeat(100) })
    const result = await extractPdfText(Buffer.from('fake'), 50)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.text).toBe(`${'a'.repeat(50)}\n\n[truncated]`)
      expect(result.truncated).toBe(true)
      expect(result.originalLength).toBe(100)
    }
  })

  it('does not truncate when maxChars is zero or negative', async () => {
    mockPdfParse.mockResolvedValue({ text: 'hello' })
    const result = await extractPdfText(Buffer.from('fake'), 0)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.text).toBe('hello')
      expect(result.truncated).toBe(false)
      expect(result.originalLength).toBe(5)
    }
  })

  it('returns error when parsed text is empty', async () => {
    mockPdfParse.mockResolvedValue({ text: '' })
    const result = await extractPdfText(Buffer.from('fake'), 1000)
    expect(result).toEqual({ ok: false, error: 'pdf_no_text' })
  })

  it('returns error when parsed text is not a string', async () => {
    mockPdfParse.mockResolvedValue({ text: null })
    const result = await extractPdfText(Buffer.from('fake'), 1000)
    expect(result).toEqual({ ok: false, error: 'pdf_no_text' })
  })

  it('returns error when pdf parse throws', async () => {
    mockPdfParse.mockRejectedValue(new Error('parse error'))
    const result = await extractPdfText(Buffer.from('fake'), 1000)
    expect(result).toEqual({ ok: false, error: 'pdf_parse_failed' })
  })
})

describe('isPdfMime', () => {
  it('returns true for application/pdf', () => {
    expect(isPdfMime('application/pdf')).toBe(true)
  })

  it('returns true for uppercase mime', () => {
    expect(isPdfMime('Application/PDF')).toBe(true)
  })

  it('returns false for other mime types', () => {
    expect(isPdfMime('text/plain')).toBe(false)
    expect(isPdfMime('application/json')).toBe(false)
  })
})
