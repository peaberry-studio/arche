import { Buffer } from 'node:buffer'

import { expect, test, type APIRequestContext } from '@playwright/test'

import { adminSlug } from './support/test-data'

const runtimeBaseUrl = process.env.ARCHE_E2E_RUNTIME_BASE_URL ?? `http://127.0.0.1:${process.env.ARCHE_E2E_RUNTIME_PORT ?? '4210'}`
const runtimePassword = process.env.ARCHE_E2E_RUNTIME_PASSWORD ?? 'arche-e2e-runtime'
const runtimeAuthHeader = `Basic ${Buffer.from(`opencode:${runtimePassword}`).toString('base64')}`

async function uploadRuntimeFile(request: APIRequestContext, path: string, content: string) {
  const response = await request.post(`${runtimeBaseUrl}/files/upload?path=${encodeURIComponent(path)}`, {
    data: content,
    headers: {
      Authorization: runtimeAuthHeader,
      'Content-Type': path.endsWith('.md') ? 'text/markdown' : 'text/plain',
    },
  })

  expect(response.ok()).toBeTruthy()
}

test('explores Knowledge files through quickview, graph, and table controls', async ({ page, request }) => {
  const planPath = 'docs/e2e-plan.md'
  const researchPath = 'docs/e2e-research.md'

  await uploadRuntimeFile(
    request,
    planPath,
    [
      '# E2E Plan',
      '',
      'See [[docs/e2e-research.md]].',
      '',
      '| Metric | Status |',
      '| --- | --- |',
      '| Leads | Ready |',
    ].join('\n')
  )
  await uploadRuntimeFile(request, researchPath, '# E2E Research\n\nResearch note for graph navigation.\n')

  await page.goto(`/w/${adminSlug}`)

  const composer = page.getByPlaceholder('Type a message...')
  await expect(composer).toBeVisible({ timeout: 120_000 })

  await composer.fill(`E2E_READ_FILE:${planPath}`)
  await page.getByLabel('Send message').click()

  await expect(page.getByText(`E2E_FILE_READY: ${planPath}`, { exact: true })).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: 'Open' }).first().click()
  await expect(page.getByText('Quickview')).toBeVisible()

  await page.getByRole('button', { name: 'Edit file' }).click()
  await expect(page.getByRole('button', { name: 'Knowledge' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('E2E Plan')).toBeVisible()

  await page.getByRole('button', { name: 'Graph' }).click()
  await expect(page.getByLabel('Knowledge graph')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: researchPath }).press('Enter')
  await expect(page.getByText('E2E Research')).toBeVisible()

  await page.getByRole('button', { name: 'Tree' }).click()
  await page.getByRole('button', { name: /e2e-plan\.md/i }).click()
  await expect(page.getByText('Metric')).toBeVisible()

  const headerCell = page.locator('.workspace-tiptap table th').filter({ hasText: 'Metric' }).first()
  const rows = page.locator('.workspace-tiptap table tr')
  const firstRowCells = rows.first().locator('th,td')

  await headerCell.hover()
  await expect(page.getByRole('button', { name: 'Add row' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add column' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete row' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete column' })).toBeVisible()

  await expect(rows).toHaveCount(2)
  await page.getByRole('button', { name: 'Add row' }).click()
  await expect(rows).toHaveCount(3)

  await expect(firstRowCells).toHaveCount(2)
  await headerCell.hover()
  await page.getByRole('button', { name: 'Add column' }).click()
  await expect(firstRowCells).toHaveCount(3)
})
