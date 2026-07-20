import { expect, test, type Page } from '@playwright/test'

import { adminSlug } from './support/test-data'

const APP_ORIGIN = 'http://127.0.0.1:3000'

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getGithubConnectorIds(value: unknown): string[] {
  if (!isObjectRecord(value) || !Array.isArray(value.connectors)) {
    throw new Error('Invalid connectors list response')
  }

  return value.connectors.flatMap((connector) => {
    if (!isObjectRecord(connector) || connector.type !== 'github' || typeof connector.id !== 'string') {
      return []
    }

    return [connector.id]
  })
}

async function removeGithubConnectors(page: Page): Promise<void> {
  const response = await page.request.get(`/api/u/${adminSlug}/connectors`)
  expect(response.ok()).toBeTruthy()

  for (const connectorId of getGithubConnectorIds(await response.json())) {
    const deleteResponse = await page.request.delete(`/api/u/${adminSlug}/connectors/${connectorId}`, {
      headers: { origin: APP_ORIGIN },
    })
    expect(deleteResponse.ok()).toBeTruthy()
  }
}

async function openGithubConnectorDialog(page: Page) {
  await page.goto(`/u/${adminSlug}/connectors`)
  await expect(page.getByRole('heading', { name: 'Connectors' })).toBeVisible()

  const addFirstButton = page.getByRole('button', { name: 'Add your first connector' })
  if (await addFirstButton.isVisible()) {
    await addFirstButton.click()
  } else {
    await page.getByRole('button', { name: 'Add connector' }).click()
  }

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'GitHub' }).click()
  return dialog
}

test.beforeEach(async ({ page }) => {
  await removeGithubConnectors(page)
})

test.afterEach(async ({ page }) => {
  await removeGithubConnectors(page)
})

test('links a GitHub repository with a PAT', async ({ page }) => {
  const dialog = await openGithubConnectorDialog(page)

  await dialog.getByLabel('Personal access token').fill('github_pat_e2e_example')
  await dialog.getByLabel('Pinned repositories').fill('acme/api')
  await dialog.getByLabel('Pinned repositories').press('Enter')
  await dialog.getByRole('button', { name: 'Save connector' }).click()

  await expect(dialog).not.toBeVisible()
  await expect(page.getByText('GitHub', { exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByText('GitHub', { exact: true })).toBeVisible()
})
