import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'
import { Pool } from 'pg'

test.skip(process.env.ARCHE_E2E_PROFILE === 'real-runtime', 'Uses an isolated smoke-fake archive fixture')
test.setTimeout(90_000)

test('opens archived history without a live runtime and keeps it read-only after reload', async ({ page }) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const userId = randomUUID()
  const slug = `archive-e2e-${userId.slice(0, 8)}`
  const sessionId = `archived-${randomUUID()}`
  const title = 'Previous runtime conversation'
  const messages = [
    { id: 'archive-user', role: 'user', content: 'Remember this conversation' },
    { id: 'archive-assistant', role: 'assistant', content: 'Preserved previous runtime reply' },
  ].map((message) => ({
    ...message,
    sessionId,
    timestamp: '12:00',
    timestampRaw: 1_700_000_000_000,
    parts: [{ type: 'text', text: message.content }],
  }))

  try {
    await pool.query(
      `INSERT INTO users (id, email, slug, password_hash, updated_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [userId, `${slug}@arche.local`, slug, 'unused-e2e-password-hash'],
    )
    await pool.query(
      `INSERT INTO instances (id, slug, status, runtime_kind, server_password)
       VALUES ($1, $2, 'running', 'e2e-unavailable-runtime', $3)`,
      [randomUUID(), slug, 'unused-e2e-runtime-password'],
    )
    await pool.query(
      `INSERT INTO legacy_session_archives (id, slug, session_id, title, created_at, updated_at, messages)
       VALUES ($1, $2, $3, $4, NOW(), NOW(), $5::jsonb)`,
      [randomUUID(), slug, sessionId, title, JSON.stringify(messages)],
    )

    await page.goto(`/w/${slug}`)
    await expect(page.getByRole('heading', { name: 'Archived conversations', exact: true })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: new RegExp(`${title}.*Archived`, 'i') }).click()

    const notice = page.getByText('This conversation was created on the previous runtime and is archived. It is read-only.', { exact: true })
    await expect(notice).toBeVisible()
    await expect(page.getByText('Remember this conversation', { exact: true })).toBeVisible()
    await expect(page.getByText('Preserved previous runtime reply', { exact: true })).toBeVisible()
    await expect(page.getByPlaceholder('Type a message...')).toHaveCount(0)
    await expect(page.getByLabel('Describe what you want to work on')).toHaveCount(0)
    await expect(page.getByRole('button', { name: `Rename session ${title}`, exact: true })).toHaveCount(0)

    await page.getByRole('button', { name: `Session options for ${title}`, exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Export to MD', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Delete session', exact: true })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Learn from this session', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await expect(page).toHaveURL(new RegExp(`[?&]session=${sessionId}(?:&|$)`))
    await page.reload()
    await expect(notice).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Preserved previous runtime reply', { exact: true })).toBeVisible()
    await expect(page.getByPlaceholder('Type a message...')).toHaveCount(0)
  } finally {
    await page.close()
    try {
      await pool.query('DELETE FROM instances WHERE slug = $1', [slug])
      await pool.query('DELETE FROM users WHERE id = $1', [userId])
    } finally {
      await pool.end()
    }
  }
})
