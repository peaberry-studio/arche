import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'

import { createEventStrict as auditEvent } from '@/lib/services/audit'
import { syncKbGithub } from '@/lib/git/kb-github-broker'
import { approveKbProposal, getKbProposal, kbGit } from '@/lib/git/kb-publication'
import { markKnowledgeReviewChangesPublished } from '@/lib/learning/service'
import { getKbContentRoot } from '@/lib/runtime/paths'
import { withAuth } from '@/lib/runtime/with-auth'
import { findIdBySlug } from '@/lib/services/user'

export const GET = withAuth({}, async (request, { slug, user }) => {
  try {
    const proposal = await getKbProposal(getKbContentRoot(), slug)
    const path = request.nextUrl.searchParams.get('path')
    if (path !== null) {
      if (!proposal || request.nextUrl.searchParams.get('commit') !== proposal.commit || !proposal.paths.includes(path)) {
        return NextResponse.json({ error: 'proposal_changed' }, { status: 409 })
      }
      const content = await kbGit(getKbContentRoot(), ['show', `${proposal.commit}:${path}`])
      return new Response(new Uint8Array(content), { headers: {
        'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.split('/').at(-1) ?? 'file')}`,
      } })
    }
    return NextResponse.json({ proposal, canApprove: user.role === 'ADMIN' })
  } catch {
    return NextResponse.json({ error: 'Sync and submit the proposal again before reviewing.' }, { status: 409 })
  }
})

export const POST = withAuth({ csrf: true }, async (request, { slug, user }) => {
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const body: unknown = await request.json().catch(() => null)
  if (body && typeof body === 'object' && 'action' in body && body.action === 'export') {
    const result = await syncKbGithub('push', user.id)
    return NextResponse.json(result, { status: result.ok ? 200 : 502 })
  }
  if (!body || typeof body !== 'object' || !('commit' in body) || !('base' in body)
    || typeof body.commit !== 'string' || typeof body.base !== 'string'
    || !/^[a-f0-9]{40}$/.test(body.commit) || !/^[a-f0-9]{40}$/.test(body.base)) {
    return NextResponse.json({ error: 'invalid_approval' }, { status: 400 })
  }
  let publishedCommit: string | null = null
  try {
    await auditEvent({ actorUserId: user.id, action: 'kb.proposal_approval_requested', metadata: { slug, commit: body.commit, base: body.base } })
    const proposal = await approveKbProposal(getKbContentRoot(), slug, body.commit, body.base)
    publishedCommit = proposal.commit
    await auditEvent({ actorUserId: user.id, action: 'kb.proposal_approved', metadata: { slug, ref: proposal.ref, commit: proposal.commit, base: proposal.base, paths: proposal.paths } })
    const owner = await findIdBySlug(slug)
    if (owner) {
      const pathHashes: Record<string, string> = {}
      for (const path of proposal.paths) {
        const content = await kbGit(getKbContentRoot(), ['show', `${proposal.commit}:${path}`])
        pathHashes[path] = `sha256:${createHash('sha256').update(content).digest('hex')}`
      }
      await markKnowledgeReviewChangesPublished({ actor: user.id, commitSha: proposal.commit, paths: proposal.paths, pathHashes, userId: owner.id })
    }
    const github = await syncKbGithub('push', user.id)
    return NextResponse.json({ ok: true, status: 'published', commitHash: proposal.commit, githubStatus: github.ok ? 'success' : 'error', message: github.ok ? undefined : github.error })
  } catch (error) {
    if (publishedCommit) {
      console.error('[kb] Publication follow-up failed', { slug, commit: publishedCommit })
      return NextResponse.json({ ok: true, status: 'published', commitHash: publishedCommit, githubStatus: 'error', message: 'The shared KB was published, but follow-up bookkeeping or export failed. Check the audit log and retry the GitHub export.' })
    }
    return NextResponse.json({ error: error instanceof Error && error.message === 'kb_busy' ? 'KB publication is busy. Retry shortly.' : 'The proposal or shared KB changed. Review the latest proposal before approving.' }, { status: 409 })
  }
})
