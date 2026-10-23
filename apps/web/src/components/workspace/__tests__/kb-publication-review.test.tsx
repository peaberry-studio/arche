// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KbPublicationReview } from '@/components/workspace/kb-publication-review'

const proposal = { commit: 'a'.repeat(40), base: 'b'.repeat(40), paths: ['note.md'], diff: '+reviewed content' }
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
describe('KB publication review', () => {
  it('shows the immutable diff and submits the exact reviewed commit and base', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ proposal, canApprove: true })).mockResolvedValueOnce(Response.json({ ok: true, status: 'published' }))
    render(<KbPublicationReview slug="alice" />)
    fireEvent.click(screen.getByRole('button', { name: 'Review publication' }))
    await screen.findByText(`Commit ${proposal.commit}`)
    fireEvent.click(screen.getByRole('button', { name: 'Approve and publish' }))
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith('/api/instances/alice/kb-proposal', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ commit: proposal.commit, base: proposal.base }),
    })))
    await screen.findByText('Published to the shared Knowledge Base.')
  })
  it('does not offer approval to ordinary users', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ proposal, canApprove: false }))
    render(<KbPublicationReview slug="alice" />)
    fireEvent.click(screen.getByRole('button', { name: 'Review publication' }))
    const button = await screen.findByRole('button', { name: 'Approve and publish' })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Export approved KB to GitHub' })).toBeNull()
  })
  it('requires a new review after a stale approval', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ proposal, canApprove: true }))
      .mockResolvedValueOnce(Response.json({ error: 'Proposal changed' }, { status: 409 }))
    render(<KbPublicationReview slug="alice" />)
    fireEvent.click(screen.getByRole('button', { name: 'Review publication' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Approve and publish' }))
    await screen.findByText('Proposal changed')
    expect(screen.getByRole('button', { name: 'Approve and publish' }).hasAttribute('disabled')).toBe(true)
  })
})
