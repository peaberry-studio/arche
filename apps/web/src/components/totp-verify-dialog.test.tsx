/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TotpVerifyDialog } from '@/components/totp-verify-dialog'

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TotpVerifyDialog', () => {
  it('submits sanitized app codes and returns the verified user', async () => {
    const onSuccess = vi.fn()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, user: { id: 'user-1', email: 'a@example.com', slug: 'alice' } }))

    render(<TotpVerifyDialog challengeToken="challenge" onCancel={vi.fn()} onSuccess={onSuccess} open />)

    const input = screen.getByPlaceholderText('000000') as HTMLInputElement
    fireEvent.change(input, { target: { value: '12a345' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ id: 'user-1', email: 'a@example.com', slug: 'alice' }))
    expect(input.value).toBe('12345')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      challengeToken: 'challenge',
      code: '12345',
      isRecoveryCode: false,
    })
  })

  it('toggles recovery-code mode and displays mapped errors', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: 'challenge_expired' }))

    render(<TotpVerifyDialog challengeToken="challenge" onCancel={vi.fn()} onSuccess={vi.fn()} open />)

    fireEvent.click(screen.getByRole('button', { name: "Don't have access? Use a recovery code" }))
    const input = screen.getByPlaceholderText('XXXX-XXXX') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'ab12-cd34' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))

    expect(input.value).toBe('AB12-CD34')
    expect(await screen.findByText('Session expired. Sign in again.')).toBeDefined()
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      code: 'AB12-CD34',
      isRecoveryCode: true,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Use app code' }))
    expect((screen.getByPlaceholderText('000000') as HTMLInputElement).value).toBe('')
    expect(screen.queryByText('Session expired. Sign in again.')).toBeNull()
  })

  it('handles network failures and cancel events', async () => {
    const onCancel = vi.fn()
    fetchMock.mockRejectedValue(new Error('network'))

    render(<TotpVerifyDialog challengeToken="challenge" onCancel={onCancel} onSuccess={vi.fn()} open />)

    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await screen.findByText("We couldn't reach the server.")).toBeDefined()
  })
})
