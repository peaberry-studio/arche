'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DiffViewer } from '@/components/ui/diff-viewer'
import type { KbProposal } from '@/lib/git/kb-publication'

type KbPublicationReviewProps = { slug: string; onComplete?: () => void }

export function KbPublicationReview({ slug, onComplete }: KbPublicationReviewProps) {
  const [open, setOpen] = useState(false)
  const [proposal, setProposal] = useState<KbProposal | null>(null)
  const [canApprove, setCanApprove] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function review() {
    setOpen(true)
    setBusy(true)
    setProposal(null)
    setCanApprove(false)
    setMessage('')
    try {
      const response = await fetch(`/api/instances/${slug}/kb-proposal`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not load the proposal.')
      setProposal(data.proposal)
      setCanApprove(data.canApprove)
      if (!data.proposal) setMessage('No pending publication. Submit workspace changes first.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load the proposal.') }
    finally { setBusy(false) }
  }
  async function approve() {
    if (!proposal) return
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/instances/${slug}/kb-proposal`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commit: proposal.commit, base: proposal.base }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Approval failed.')
      setProposal(null)
      setMessage(data.githubStatus === 'error' ? `Published to the shared KB. ${data.message}` : 'Published to the shared Knowledge Base.')
      onComplete?.()
    } catch (error) {
      setCanApprove(false)
      setMessage(error instanceof Error ? error.message : 'Approval failed. Reload the proposal.')
    } finally { setBusy(false) }
  }
  async function exportApproved() {
    setBusy(true)
    try {
      const response = await fetch(`/api/instances/${slug}/kb-proposal`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'export' }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'GitHub export failed.')
      setMessage(data.configured ? 'Approved KB exported to GitHub.' : 'No GitHub repository is configured.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'GitHub export failed.') }
    finally { setBusy(false) }
  }
  async function download(path: string) {
    if (!proposal) return
    try {
      const query = new URLSearchParams({ path, commit: proposal.commit })
      const response = await fetch(`/api/instances/${slug}/kb-proposal?${query}`)
      if (!response.ok) throw new Error('The proposal changed. Reload it before downloading.')
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = path.split('/').at(-1) ?? 'file'
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Download failed.') }
  }
  return <>
    <Button size="sm" variant="outline" onClick={() => void review()}>Review publication</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review shared KB publication</DialogTitle>
          <DialogDescription>Only an administrator can approve these exact changes for the shared Knowledge Base. Later edits require another review.</DialogDescription>
        </DialogHeader>
        {busy ? <p>Working…</p> : null}
        {message ? <p role="status">{message}</p> : null}
        {proposal ? <>
          <p className="break-all text-xs text-muted-foreground">Commit {proposal.commit}</p>
          <DiffViewer diff={proposal.diff} />
          <div className="flex flex-wrap gap-2">
            {proposal.paths.map((path) => <Button key={path} variant="outline" size="sm" onClick={() => void download(path)}>Download {path}</Button>)}
          </div>
          <Button disabled={busy || !canApprove} onClick={() => void approve()}>Approve and publish</Button>
          {!canApprove ? <p>An administrator must review and approve this publication.</p> : null}
        </> : null}
        {canApprove ? <Button variant="outline" disabled={busy} onClick={() => void exportApproved()}>Export approved KB to GitHub</Button> : null}
      </DialogContent>
    </Dialog>
  </>
}
