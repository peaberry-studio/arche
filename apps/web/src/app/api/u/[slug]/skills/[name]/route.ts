import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import {
  deleteSkill,
  readSkill,
  saveSkillDocument,
} from '@/lib/skills/skill-store'
import { withAuth } from '@/lib/runtime/with-auth'

type SkillDetailResponse = {
  hash?: string | null
  skill: {
    assignedAgentIds: string[]
    body: string
    description: string
    hasResources: boolean
    name: string
    resourcePaths: string[]
  }
}

type UpdateSkillRequest = {
  assignedAgentIds?: unknown
  body?: unknown
  description?: unknown
  expectedHash?: unknown
}

function parseAssignedAgentIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const agentIds: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) {
      return null
    }

    agentIds.push(entry.trim())
  }

  return Array.from(new Set(agentIds)).sort((left, right) => left.localeCompare(right))
}

type SkillRouteParams = { name: string; slug: string }

export const GET = withAuth<SkillDetailResponse | { error: string }, SkillRouteParams>(
  { csrf: false },
  async (_request, { params: { name } }) => {
    const result = await readSkill(name)
    if (!result.ok) {
      const status = result.error === 'not_found'
        ? 404
        : result.error === 'kb_unavailable'
          ? 503
          : 500
      return NextResponse.json({ error: result.error }, { status })
    }

    return NextResponse.json({ skill: result.data, hash: result.hash })
  }
)

export const PATCH = withAuth<SkillDetailResponse | { error: string }, SkillRouteParams>(
  { csrf: true },
  async (request, { user, slug, params: { name } }) => {
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let body: UpdateSkillRequest
    try {
      body = await request.json()
    } catch (error) {
      if (error instanceof SyntaxError) {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
      }

      throw error
    }

    const existing = await readSkill(name)
    if (!existing.ok) {
      const status = existing.error === 'not_found'
        ? 404
        : existing.error === 'kb_unavailable'
          ? 503
          : 500
      return NextResponse.json({ error: existing.error }, { status })
    }

    const description = 'description' in body
      ? typeof body.description === 'string'
        ? body.description.trim()
        : ''
      : existing.data.description
    if (!description || description.length > 1024) {
      return NextResponse.json({ error: 'invalid_description' }, { status: 400 })
    }

    const skillBody = 'body' in body
      ? typeof body.body === 'string'
        ? body.body
        : null
      : existing.data.body
    if (skillBody == null) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const assignedAgentIds = 'assignedAgentIds' in body
      ? parseAssignedAgentIds(body.assignedAgentIds)
      : existing.data.assignedAgentIds
    if (!assignedAgentIds) {
      return NextResponse.json({ error: 'invalid_assigned_agents' }, { status: 400 })
    }

    const result = await saveSkillDocument({
      mode: 'update',
      name,
      description,
      body: skillBody,
      assignedAgentIds,
      expectedHash: typeof body.expectedHash === 'string' ? body.expectedHash : undefined,
    })
    if (!result.ok) {
      const status =
        result.error === 'not_found' ? 404
        : result.error === 'conflict' ? 409
        : result.error === 'unknown_agent' ? 400
        : result.error === 'kb_unavailable' ? 503
        : 500
      return NextResponse.json({ error: result.error }, { status })
    }

    const updated = await readSkill(name)
    if (!updated.ok) {
      return NextResponse.json({ error: 'read_failed' }, { status: 500 })
    }

    await auditEvent({
      actorUserId: user.id,
      action: 'skill.updated',
      metadata: { slug, skillName: name },
    })

    return NextResponse.json({ skill: updated.data, hash: result.hash })
  }
)

export const DELETE = withAuth<{ hash?: string } | { error: string }, SkillRouteParams>(
  { csrf: true },
  async (request, { user, slug, params: { name } }) => {
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let body: { expectedHash?: unknown } | null = null
    try {
      body = await request.json()
    } catch {
      body = null
    }

    const result = await deleteSkill(
      name,
      body && typeof body.expectedHash === 'string' ? body.expectedHash : undefined,
    )
    if (!result.ok) {
      const status =
        result.error === 'not_found' ? 404
        : result.error === 'conflict' ? 409
        : result.error === 'kb_unavailable' ? 503
        : 500
      return NextResponse.json({ error: result.error }, { status })
    }

    await auditEvent({
      actorUserId: user.id,
      action: 'skill.deleted',
      metadata: { slug, skillName: name },
    })

    return NextResponse.json({ hash: result.hash })
  }
)
