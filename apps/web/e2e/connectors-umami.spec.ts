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

async function removeUmamiConnectors(page: Page): Promise<void> {
  const response = await page.request.get(`/api/u/${adminSlug}/connectors`)
  expect(response.ok()).toBeTruthy()

  const body = parseConnectorListResponse(await response.json())
  for (const connector of body.connectors) {
    if (connector.type !== 'umami') {
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
  await dialog.getByRole('button', { name: 'Umami' }).click()
  return dialog
}

async function getUmamiConnectorDetail(page: Page): Promise<ConnectorDetailResponse> {
  const response = await page.request.get(`/api/u/${adminSlug}/connectors`)
  expect(response.ok()).toBeTruthy()

  const list = parseConnectorListResponse(await response.json())
  const connector = list.connectors.find((item) => item.type === 'umami')
  if (!connector) {
    throw new Error('Expected an Umami connector to exist')
  }

  const detailResponse = await page.request.get(`/api/u/${adminSlug}/connectors/${connector.id}`)
  expect(detailResponse.ok()).toBeTruthy()

  return parseConnectorDetailResponse(await detailResponse.json())
}

test.beforeEach(async ({ page }) => {
  await removeUmamiConnectors(page)
})

test.afterEach(async ({ page }) => {
  await removeUmamiConnectors(page)
})

test('creates an Umami Cloud connector with an API key', async ({ page }) => {
  const dialog = await openAddConnectorDialog(page)

  await expect(dialog.getByLabel('Authentication method')).toHaveValue('api-key')
  await expect(dialog.getByLabel('Base URL')).toHaveAttribute('placeholder', 'https://api.umami.is/v1')

  await dialog.getByLabel('Base URL').fill('https://api.umami.is/v1')
  await dialog.getByLabel('API key').fill('umami-cloud-key')
  await dialog.getByRole('button', { name: 'Save connector' }).click()

  await expect(dialog).not.toBeVisible()
  await expect(page.getByText('Umami', { exact: true })).toBeVisible()
  await expect(
    page.locator('div.rounded-xl').filter({ hasText: 'Umami' }).filter({ hasText: 'Working' }).first()
  ).toBeVisible()

  await page.reload()
  await expect(page.getByText('Umami', { exact: true })).toBeVisible()
  await expect(
    page.locator('div.rounded-xl').filter({ hasText: 'Umami' }).filter({ hasText: 'Working' }).first()
  ).toBeVisible()

  const detail = await getUmamiConnectorDetail(page)
  expect(detail.type).toBe('umami')
  expect(detail.name).toBe('Umami')
  expect(detail.config).toMatchObject({
    authMethod: 'api-key',
    apiKey: 'umami-cloud-key',
    baseUrl: 'https://api.umami.is/v1',
  })
})

test('creates a self-hosted Umami connector with login credentials', async ({ page }) => {
  const dialog = await openAddConnectorDialog(page)

  await dialog.getByLabel('Authentication method').selectOption('login')

  await expect(dialog.getByLabel('Base URL')).toHaveAttribute('placeholder', 'https://analytics.example.com')
  await expect(dialog.getByLabel('API key')).toHaveCount(0)
  await expect(dialog.getByLabel('Username')).toBeVisible()
  await expect(dialog.getByLabel('Password')).toBeVisible()

  await dialog.getByLabel('Base URL').fill('https://analytics.example.com')
  await dialog.getByLabel('Username').fill('admin')
  await dialog.getByLabel('Password').fill('umami-password')
  await dialog.getByRole('button', { name: 'Save connector' }).click()

  await expect(dialog).not.toBeVisible()
  await expect(page.getByText('Umami', { exact: true })).toBeVisible()
  await expect(
    page.locator('div.rounded-xl').filter({ hasText: 'Umami' }).filter({ hasText: 'Working' }).first()
  ).toBeVisible()

  const detail = await getUmamiConnectorDetail(page)
  expect(detail.type).toBe('umami')
  expect(detail.name).toBe('Umami')
  expect(detail.config).toMatchObject({
    authMethod: 'login',
    baseUrl: 'https://analytics.example.com',
    password: 'umami-password',
    username: 'admin',
  })
})
