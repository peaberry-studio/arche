const PDF_MIME = 'application/pdf'

export type PdfExtractResult =
  | {
      ok: true
      text: string
      truncated: boolean
      originalLength: number
    }
  | {
      ok: false
      error: string
    }

type PdfParseResult = {
  text?: unknown
}

type PdfParseFn = (dataBuffer: Buffer) => Promise<PdfParseResult>

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .trim()
}

export async function extractPdfText(buffer: Buffer, maxChars: number): Promise<PdfExtractResult> {
  if (buffer.length === 0) {
    return { ok: false, error: 'pdf_empty' }
  }

  let parsePdf: PdfParseFn
  try {
    const pdfModule = await import('pdf-parse')
    const candidate = pdfModule.default
    if (typeof candidate !== 'function') {
      return { ok: false, error: 'pdf_parser_unavailable' }
    }
    parsePdf = candidate as PdfParseFn
  } catch {
    return { ok: false, error: 'pdf_parser_unavailable' }
  }

  try {
    const parsed = await parsePdf(buffer)
    const extracted = typeof parsed.text === 'string' ? normalizeExtractedText(parsed.text) : ''
    if (extracted.length === 0) {
      return { ok: false, error: 'pdf_no_text' }
    }

    if (maxChars <= 0 || extracted.length <= maxChars) {
      return {
        ok: true,
        text: extracted,
        truncated: false,
        originalLength: extracted.length,
      }
    }

    return {
      ok: true,
      text: `${extracted.slice(0, maxChars)}\n\n[truncated]`,
      truncated: true,
      originalLength: extracted.length,
    }
  } catch {
    return { ok: false, error: 'pdf_parse_failed' }
  }
}

export function isPdfMime(mime: string): boolean {
  return mime.toLowerCase() === PDF_MIME
}
