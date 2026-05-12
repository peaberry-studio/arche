import { NextRequest, NextResponse } from 'next/server'

import { getSyncConflictDetail, resolveSyncConflict } from '@/lib/git/kb-github-sync'
import { withAuth } from '@/lib/runtime/with-auth'

import { requireAdmin } from '../../require-admin'

export const POST = withAuth(
  { csrf: true },
  async (request: NextRequest, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) return admin.response

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const { path, strategy, content } = body as {
      path?: unknown
      strategy?: unknown
      content?: unknown
    }

    if (typeof path !== 'string' || !path) {
      return NextResponse.json({ error: 'missing_path' }, { status: 400 })
    }

    if (strategy !== 'ours' && strategy !== 'theirs') {
      return NextResponse.json({ error: 'invalid_strategy' }, { status: 400 })
    }

    try {
      if (strategy === 'ours' || strategy === 'theirs') {
        await resolveSyncConflict(
          path,
          strategy,
          typeof content === 'string' ? content : undefined,
        )
      }
      return NextResponse.json({ ok: true })
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'resolution_failed' },
        { status: 500 },
      )
    }
  },
)

export const GET = withAuth(
  { csrf: false },
  async (request: NextRequest, { user }) => {
    const admin = requireAdmin(user)
    if (!admin.ok) return admin.response

    const url = new URL(request.url)
    const filePath = url.searchParams.get('path')
    if (!filePath) {
      return NextResponse.json({ error: 'missing_path' }, { status: 400 })
    }

    const detail = await getSyncConflictDetail(filePath)
    if (!detail) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    return NextResponse.json(detail)
  },
)
