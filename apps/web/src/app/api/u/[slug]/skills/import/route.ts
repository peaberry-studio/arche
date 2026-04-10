import { NextRequest, NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import { importSkillArchive, readSkill } from '@/lib/skills/skill-store'
import { MAX_SKILL_ARCHIVE_BYTES, parseSkillArchive } from '@/lib/skills/skill-zip'
import { withAuth } from '@/lib/runtime/with-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseAssignedAgentIds(value: FormDataEntryValue | null): string[] | null {
  if (typeof value !== 'string') {
    return null
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
      return null
    }

    const agentIds: string[] = []
    for (const entry of parsed) {
      if (typeof entry !== 'string' || !entry.trim()) {
        return null
      }

      agentIds.push(entry.trim())
    }

    return Array.from(new Set(agentIds)).sort((left, right) => left.localeCompare(right))
  } catch {
    return null
  }
}

export const POST = withAuth(
  { csrf: true },
  async (request: NextRequest, { user, slug }) => {
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'missing_file' }, { status: 400 })
    }

    if (file.size > MAX_SKILL_ARCHIVE_BYTES) {
      return NextResponse.json({ error: 'archive_too_large' }, { status: 413 })
    }

    const assignedAgentIds = parseAssignedAgentIds(formData.get('assignedAgentIds'))
    if (!assignedAgentIds) {
      return NextResponse.json({ error: 'invalid_assigned_agents' }, { status: 400 })
    }

    const parsedArchive = parseSkillArchive(new Uint8Array(await file.arrayBuffer()))
    if (!parsedArchive.ok) {
      const status = parsedArchive.error === 'archive_too_large' ? 413 : 400
      return NextResponse.json({ error: parsedArchive.error }, { status })
    }

    const result = await importSkillArchive({
      archive: parsedArchive.archive,
      assignedAgentIds,
      expectedHash: typeof formData.get('expectedHash') === 'string' ? String(formData.get('expectedHash')) : undefined,
    })
    if (!result.ok) {
      const status =
        result.error === 'conflict' ? 409
        : result.error === 'unknown_agent' ? 400
        : result.error === 'kb_unavailable' ? 503
        : 500
      return NextResponse.json({ error: result.error }, { status })
    }

    const imported = await readSkill(parsedArchive.archive.skill.frontmatter.name)
    if (!imported.ok) {
      return NextResponse.json({ error: 'read_failed' }, { status: 500 })
    }

    await auditEvent({
      actorUserId: user.id,
      action: 'skill.imported',
      metadata: { slug, skillName: parsedArchive.archive.skill.frontmatter.name },
    })

    return NextResponse.json({ skill: imported.data, hash: result.hash }, { status: 201 })
  }
)
