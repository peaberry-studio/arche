import { describe, expect, it } from 'vitest'

import {
  inferAttachmentMimeType,
  isWorkspaceAttachmentPath,
  isSpreadsheetMimeType,
  sanitizeAttachmentFilename,
} from '@/lib/workspace-attachments'

describe('workspace attachments spreadsheet helpers', () => {
  it('infers spreadsheet mime types for open formats', () => {
    expect(inferAttachmentMimeType('report.ods')).toBe(
      'application/vnd.oasis.opendocument.spreadsheet',
    )
    expect(inferAttachmentMimeType('table.tsv')).toBe('text/tab-separated-values')
  })

  it('detects spreadsheet mimes case-insensitively', () => {
    expect(
      isSpreadsheetMimeType(
        'APPLICATION/VND.OPENXMLFORMATS-OFFICEDOCUMENT.SPREADSHEETML.SHEET',
      ),
    ).toBe(true)
    expect(isSpreadsheetMimeType('text/plain')).toBe(false)
  })

  it('sanitizes unsafe filenames', () => {
    const withControlChars = `${String.fromCharCode(0)}bad${String.fromCharCode(7)}name.txt`

    expect(sanitizeAttachmentFilename('../../etc/passwd')).toBe('..-..-etc-passwd')
    expect(sanitizeAttachmentFilename(withControlChars)).toBe('badname.txt')
    expect(sanitizeAttachmentFilename('résumé.pdf')).toBe('r_sum_.pdf')
    expect(sanitizeAttachmentFilename('')).toBe('attachment')
    expect(sanitizeAttachmentFilename('.')).toBe('attachment')
    expect(sanitizeAttachmentFilename('..')).toBe('attachment')
  })

  it('caps very long filenames', () => {
    const longName = `${'a'.repeat(200)}.txt`
    expect(sanitizeAttachmentFilename(longName).length).toBe(120)
  })

  it('validates workspace attachment paths', () => {
    expect(isWorkspaceAttachmentPath('.arche/attachments/report.pdf')).toBe(true)
    expect(isWorkspaceAttachmentPath('/.arche/attachments//report.pdf')).toBe(true)
    expect(isWorkspaceAttachmentPath('.arche/other/report.pdf')).toBe(false)
    expect(isWorkspaceAttachmentPath('.arche/attachments/../secret.txt')).toBe(false)
    expect(isWorkspaceAttachmentPath('src/file.txt')).toBe(false)
  })
})
