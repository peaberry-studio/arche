import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { readSkillBundle } from '@/lib/skills/skill-store'
import { createSkillArchive } from '@/lib/skills/skill-zip'
import { withAuth } from '@/lib/runtime/with-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SkillExportRouteParams = { name: string; slug: string }

export const GET = withAuth<{ error: string }, SkillExportRouteParams>(
  { csrf: false },
  async (_request, { user, slug, params: { name } }) => {
    const result = await readSkillBundle(name)
    if (!result.ok) {
      const status = result.error === 'not_found'
        ? 404
        : result.error === 'kb_unavailable'
          ? 503
          : 500
      return NextResponse.json({ error: result.error }, { status })
    }

    const archive = createSkillArchive(result.data)

    await auditEvent({
      actorUserId: user.id,
      action: 'skill.exported',
      metadata: { slug, skillName: name },
    })

    return new Response(Buffer.from(archive), {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${name}.zip"; filename*=UTF-8''${encodeURIComponent(`${name}.zip`)}`,
        'Content-Type': 'application/zip',
      },
    })
  }
)
