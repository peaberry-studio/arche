import { describe, expect, it, vi } from 'vitest'

import {
  MAX_ATTACHMENT_UPLOAD_MEGABYTES,
  ensureUniqueAttachmentFilename,
  formatAttachmentSize,
  inferAttachmentMimeType,
  isDocumentMimeType,
  isPresentationMimeType,
  isWorkspaceAttachmentPath,
  isSpreadsheetMimeType,
  normalizeAttachmentPath,
  sanitizeAttachmentFilename,
} from '@/lib/workspace-attachments'

describe('workspace attachments helpers', () => {
  it('infers spreadsheet mime types for open formats', () => {
    expect(inferAttachmentMimeType('report.ods')).toBe(
      'application/vnd.oasis.opendocument.spreadsheet',
    )
    expect(inferAttachmentMimeType('table.tsv')).toBe('text/tab-separated-values')
  })

  it('infers document and presentation mime types for open formats', () => {
    expect(inferAttachmentMimeType('brief.odt')).toBe(
      'application/vnd.oasis.opendocument.text',
    )
    expect(inferAttachmentMimeType('deck.odp')).toBe(
      'application/vnd.oasis.opendocument.presentation',
    )
  })

  it('infers common mime types and falls back to text/plain', () => {
    expect(inferAttachmentMimeType('photo.JPG')).toBe('image/jpeg')
    expect(inferAttachmentMimeType('archive.zip')).toBe('application/zip')
    expect(inferAttachmentMimeType('README')).toBe('text/plain')
    expect(inferAttachmentMimeType('file.unknown')).toBe('text/plain')
  })

  it('detects spreadsheet mimes case-insensitively', () => {
    expect(
      isSpreadsheetMimeType(
        'APPLICATION/VND.OPENXMLFORMATS-OFFICEDOCUMENT.SPREADSHEETML.SHEET',
      ),
    ).toBe(true)
    expect(isSpreadsheetMimeType('text/plain')).toBe(false)
  })

  it('detects document and presentation mimes case-insensitively', () => {
    expect(
      isDocumentMimeType(
        'APPLICATION/VND.OPENXMLFORMATS-OFFICEDOCUMENT.WORDPROCESSINGML.DOCUMENT',
      ),
    ).toBe(true)
    expect(isDocumentMimeType('application/msword')).toBe(false)

    expect(
      isPresentationMimeType(
        'APPLICATION/VND.OASIS.OPENDOCUMENT.PRESENTATION',
      ),
    ).toBe(true)
    expect(isPresentationMimeType('application/vnd.ms-powerpoint')).toBe(false)
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

  it('deduplicates attachment filenames while preserving extensions', () => {
    expect(ensureUniqueAttachmentFilename('new.pdf', new Set(['report.pdf']))).toBe('new.pdf')
    expect(ensureUniqueAttachmentFilename('report.pdf', new Set(['report.pdf', 'report (1).pdf']))).toBe('report (2).pdf')
    expect(ensureUniqueAttachmentFilename('README', new Set(['README']))).toBe('README (1)')
  })

  it('falls back to a timestamp when all numbered attachment names are exhausted', () => {
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(42)
    const usedNames = new Set<string>(['report.pdf'])
    for (let index = 1; index < 10000; index += 1) {
      usedNames.add(`report (${index}).pdf`)
    }

    expect(ensureUniqueAttachmentFilename('report.pdf', usedNames)).toBe('report-42.pdf')

    dateSpy.mockRestore()
  })

  it('normalizes attachment paths and formats sizes', () => {
    expect(normalizeAttachmentPath('/.arche//attachments/report.pdf')).toBe('.arche/attachments/report.pdf')
    expect(formatAttachmentSize(512)).toBe('512 B')
    expect(formatAttachmentSize(1536)).toBe('1.5 KB')
    expect(formatAttachmentSize(2 * 1024 * 1024)).toBe('2.0 MB')
    expect(MAX_ATTACHMENT_UPLOAD_MEGABYTES).toBe(100)
  })

  it('validates workspace attachment paths', () => {
    expect(isWorkspaceAttachmentPath('.arche/attachments/report.pdf')).toBe(true)
    expect(isWorkspaceAttachmentPath('/.arche/attachments//report.pdf')).toBe(true)
    expect(isWorkspaceAttachmentPath('.arche/other/report.pdf')).toBe(false)
    expect(isWorkspaceAttachmentPath('.arche/attachments/../secret.txt')).toBe(false)
    expect(isWorkspaceAttachmentPath('src/file.txt')).toBe(false)
  })
})
