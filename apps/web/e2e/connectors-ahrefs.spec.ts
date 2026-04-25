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

type ConnectorDetailResponse = {
  id: string
  type: string
  name: string
  config: Record<string, unknown>
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

function parseConnectorDetailResponse(value: unknown): ConnectorDetailResponse {
  if (!isObjectRecord(value)) {
    throw new Error('Invalid connector detail response')
  }

  const id = typeof value.id === 'string' ? value.id : null
  const type = typeof value.type === 'string' ? value.type : null
  const name = typeof value.name === 'string' ? value.name : null
  if (!id || !type || !name || !isObjectRecord(value.config)) {
    throw new Error('Invalid connector detail response')
  }

  return {
    id,
    type,
    name,
    config: value.config,
  }
}

async function removeAhrefsConnectors(page: Page): Promise<void> {
  const response = await page.request.get(`/api/u/${adminSlug}/connectors`)
  expect(response.ok()).toBeTruthy()

  const body = parseConnectorListResponse(await response.json())
  for (const connector of body.connectors) {
    if (connector.type !== 'ahrefs') {
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
  await dialog.getByRole('button', { name: 'Ahrefs' }).click()
  return dialog
}

async function getAhrefsConnectorDetail(page: Page): Promise<ConnectorDetailResponse> {
  const response = await page.request.get(`/api/u/${adminSlug}/connectors`)
  expect(response.ok()).toBeTruthy()

  const list = parseConnectorListResponse(await response.json())
  const connector = list.connectors.find((item) => item.type === 'ahrefs')
  if (!connector) {
    throw new Error('Expected an Ahrefs connector to exist')
  }

  const detailResponse = await page.request.get(`/api/u/${adminSlug}/connectors/${connector.id}`)
  expect(detailResponse.ok()).toBeTruthy()

  return parseConnectorDetailResponse(await detailResponse.json())
}

test.beforeEach(async ({ page }) => {
  await removeAhrefsConnectors(page)
})

test.afterEach(async ({ page }) => {
  await removeAhrefsConnectors(page)
})

test('creates an Ahrefs connector with an API key', async ({ page }) => {
  const dialog = await openAddConnectorDialog(page)

  await dialog.getByLabel('API Key').fill('ahrefs-api-key-123')
  await dialog.getByRole('button', { name: 'Save connector' }).click()

  await expect(dialog).not.toBeVisible()
  await expect(page.getByText('Ahrefs', { exact: true })).toBeVisible()
  await expect(
    page.locator('div.rounded-xl').filter({ hasText: 'Ahrefs' }).filter({ hasText: 'Working' }).first()
  ).toBeVisible()

  await page.reload()
  await expect(page.getByText('Ahrefs', { exact: true })).toBeVisible()
  await expect(
    page.locator('div.rounded-xl').filter({ hasText: 'Ahrefs' }).filter({ hasText: 'Working' }).first()
  ).toBeVisible()

  const detail = await getAhrefsConnectorDetail(page)
  expect(detail.type).toBe('ahrefs')
  expect(detail.name).toBe('Ahrefs')
  expect(detail.config).toMatchObject({
    apiKey: 'ahrefs-api-key-123',
  })
})
