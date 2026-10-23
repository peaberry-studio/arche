import { timingSafeEqual } from 'node:crypto'

import { createEventStrict as auditEvent } from '@/lib/services/audit'
import { serveKbGit } from '@/lib/git/kb-http-backend'
import { getKbContentRoot } from '@/lib/runtime/paths'
import { instanceService } from '@/lib/services'
import { decryptPassword } from '@/lib/spawner/crypto'
import { validateSlug } from '@/lib/validation/slug'

export const runtime = 'nodejs'

async function handle(request: Request, context: { params: Promise<{ slug: string; path: string[] }> }): Promise<Response> {
  const { slug, path } = await context.params
  if (!validateSlug(slug).valid) return Response.json({ error: 'invalid_slug' }, { status: 400 })
  const instance = await instanceService.findCredentialsBySlug(slug)
  const authorization = request.headers.get('authorization') ?? ''
  if (!instance || !['starting', 'running'].includes(instance.status)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const expected = Buffer.from(`Basic ${Buffer.from(`opencode:${decryptPassword(instance.serverPassword)}`).toString('base64')}`)
  const actual = Buffer.from(authorization)
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    return await serveKbGit(request, getKbContentRoot(), path.join('/'), slug, async (event) => {
      await auditEvent({ action: 'kb.workspace_push', metadata: { slug, ...event } })
    })
  } catch (error) {
    console.error('[kb] Git backend failed', { slug, error })
    return Response.json({ error: error instanceof Error && error.message === 'kb_busy' ? 'kb_busy' : 'push_rejected' }, { status: error instanceof Error && error.message === 'kb_busy' ? 429 : 400 })
  }
}

export const GET = handle
export const POST = handle
