import path from 'node:path'

export const adminEmail = process.env.ARCHE_SEED_ADMIN_EMAIL ?? 'admin-e2e@arche.local'
export const adminPassword = process.env.ARCHE_SEED_ADMIN_PASSWORD ?? 'arche-e2e-admin'
export const adminSlug = process.env.ARCHE_SEED_ADMIN_SLUG ?? 'admin'
export const pdfToken = 'ARCHE_E2E_PDF_TOKEN'
export const samplePdfPath = path.resolve(__dirname, '../../../../scripts/e2e/fixtures/sample.pdf')

export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
