import { expect, test, type Page } from '@playwright/test'

import { adminSlug } from './support/test-data'

const APP_ORIGIN = 'http://127.0.0.1:3000'

type ConnectorListItem = {
  id: string
  type: string
  name: string
}

type ConnectorListResponse = {
  connectors: ConnectorListItem[]
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseConnectorListResponse(value: unknown): ConnectorListResponse {
  if (!isObjectRecord(value) || !Array.isArray(value.connectors)) {
    throw new Error('Invalid connectors list response')
  }

  const connectors = value.connectors.flatMap((connector) => {
    if (!isObjectRecord(connector)) {
      return []
    }

    const id = typeof connector.id === 'string' ? connector.id : null
    const type = typeof connector.type === 'string' ? connector.type : null
    const name = typeof connector.name === 'string' ? connector.name : null
    if (!id || !type || !name) {
      return []
    }

    return [{ id, type, name }]
  })

  return { connectors }
}

async function removeConnectorsByType(page: Page, type: string): Promise<void> {
  const response = await page.request.get(`/api/u/${adminSlug}/connectors`)
  expect(response.ok()).toBeTruthy()

  const body = parseConnectorListResponse(await response.json())
  for (const connector of body.connectors) {
    if (connector.type !== type) {
      continue
    }

    const deleteResponse = await page.request.delete(`/api/u/${adminSlug}/connectors/${connector.id}`, {
      headers: {
        origin: APP_ORIGIN,
      },
    })
    expect(deleteResponse.ok()).toBeTruthy()
  }
}

async function openAddConnectorDialog(page: Page) {
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
  return dialog
}

test.beforeEach(async ({ page }) => {
  await removeConnectorsByType(page, 'linear')
  await removeConnectorsByType(page, 'notion')
})

test.afterEach(async ({ page }) => {
  await removeConnectorsByType(page, 'linear')
  await removeConnectorsByType(page, 'notion')
})

test('completes Linear user OAuth through fake provider', async ({ page }) => {
  const dialog = await openAddConnectorDialog(page)
  await dialog.getByRole('button', { name: 'Linear' }).click()

  await dialog.getByRole('button', { name: 'Save connector' }).click()
  await expect(dialog).not.toBeVisible()

  await expect(page.getByText('Linear', { exact: true })).toBeVisible()
  await expect(page.getByText('Pending setup', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Connect OAuth' }).click()

  await page.waitForURL(`**/u/${adminSlug}/connectors?oauth=success`)

  await expect(page.getByText('Linear', { exact: true })).toBeVisible()
  await expect(
    page.locator('div.rounded-xl').filter({ hasText: 'Linear' }).filter({ hasText: 'Working' }).first()
  ).toBeVisible()
})

test('completes Notion OAuth through fake provider', async ({ page }) => {
  const dialog = await openAddConnectorDialog(page)
  await dialog.getByRole('button', { name: 'Notion' }).click()

  await dialog.getByRole('button', { name: 'Save connector' }).click()
  await expect(dialog).not.toBeVisible()

  await expect(page.getByText('Notion', { exact: true })).toBeVisible()
  await expect(page.getByText('Pending setup', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Connect OAuth' }).click()

  await page.waitForURL(`**/u/${adminSlug}/connectors?oauth=success`)

  await expect(page.getByText('Notion', { exact: true })).toBeVisible()
  await expect(
    page.locator('div.rounded-xl').filter({ hasText: 'Notion' }).filter({ hasText: 'Working' }).first()
  ).toBeVisible()
})
