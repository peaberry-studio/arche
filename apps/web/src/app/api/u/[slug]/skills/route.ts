import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import {
  listSkills,
  saveSkillDocument,
} from '@/lib/skills/skill-store'
import { SKILL_NAME_PATTERN } from '@/lib/skills/types'
import { withAuth } from '@/lib/runtime/with-auth'

type SkillListItem = {
  assignedAgentIds: string[]
  description: string
  hasResources: boolean
  name: string
  resourcePaths: string[]
}

type SkillsListResponse = {
  hash?: string | null
  skills: SkillListItem[]
}

type CreateSkillRequest = {
  assignedAgentIds?: unknown
  body?: unknown
  description?: unknown
  expectedHash?: unknown
  name?: unknown
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

export const GET = withAuth<SkillsListResponse | { error: string }>(
  { csrf: false },
  async () => {
    const result = await listSkills()
    if (!result.ok) {
      const status = result.error === 'kb_unavailable' ? 503 : 500
      return NextResponse.json({ error: result.error }, { status })
    }

    return NextResponse.json({ skills: result.data, hash: result.hash })
  }
)

export const POST = withAuth<{ hash?: string; skill: SkillListItem } | { error: string }>(
  { csrf: true },
  async (request, { user, slug }) => {
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    let body: CreateSkillRequest
    try {
      body = await request.json()
    } catch (error) {
      if (error instanceof SyntaxError) {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
      }

      throw error
    }

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 64 || !SKILL_NAME_PATTERN.test(name)) {
      return NextResponse.json({ error: 'invalid_name' }, { status: 400 })
    }

    const description = typeof body.description === 'string' ? body.description.trim() : ''
    if (!description || description.length > 1024) {
      return NextResponse.json({ error: 'invalid_description' }, { status: 400 })
    }

    if (typeof body.body !== 'string') {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const assignedAgentIds = parseAssignedAgentIds(body.assignedAgentIds)
    if (!assignedAgentIds) {
      return NextResponse.json({ error: 'invalid_assigned_agents' }, { status: 400 })
    }

    const result = await saveSkillDocument({
      mode: 'create',
      name,
      description,
      body: body.body,
      assignedAgentIds,
      expectedHash: typeof body.expectedHash === 'string' ? body.expectedHash : undefined,
    })
    if (!result.ok) {
      const status =
        result.error === 'skill_exists' ? 409
        : result.error === 'conflict' ? 409
        : result.error === 'unknown_agent' ? 400
        : result.error === 'kb_unavailable' ? 503
        : 500
      return NextResponse.json({ error: result.error }, { status })
    }

    const skills = await listSkills()
    if (!skills.ok) {
      return NextResponse.json({ error: 'read_failed' }, { status: 500 })
    }

    const createdSkill = skills.data.find((entry) => entry.name === name)
    if (!createdSkill) {
      return NextResponse.json({ error: 'read_failed' }, { status: 500 })
    }

    await auditEvent({
      actorUserId: user.id,
      action: 'skill.created',
      metadata: { slug, skillName: name },
    })

    return NextResponse.json({ skill: createdSkill, hash: result.hash }, { status: 201 })
  }
)
