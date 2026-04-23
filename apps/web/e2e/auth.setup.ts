import fs from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from '@playwright/test'

test('stores admin auth state', async ({ request }) => {
  const email = process.env.ARCHE_SEED_ADMIN_EMAIL ?? 'admin-e2e@arche.local'
  const password = process.env.ARCHE_SEED_ADMIN_PASSWORD ?? 'arche-e2e-admin'
  const authPath = path.resolve(__dirname, '../playwright/.auth/admin.json')

  await fs.mkdir(path.dirname(authPath), { recursive: true })

  const response = await request.post('/auth/login', {
    data: { email, password },
  })

  expect(response.ok()).toBeTruthy()

  const body = (await response.json()) as {
    ok?: boolean
    requires2FA?: boolean
    user?: {
      email?: string
    }
  }

  expect(body).toMatchObject({
    ok: true,
    requires2FA: false,
    user: { email },
  })

  const storageState = await request.storageState()
  const hasSessionCookie = storageState.cookies.some((cookie) => cookie.name === 'arche_session')

  expect(hasSessionCookie).toBeTruthy()

  await request.storageState({ path: authPath })
})
