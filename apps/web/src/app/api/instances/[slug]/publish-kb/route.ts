import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthenticatedUser } from '@/lib/auth'
import { validateSameOrigin } from '@/lib/csrf'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'

export interface PublishKbResult {
  ok: boolean
  status: 'published' | 'nothing_to_publish' | 'push_rejected' | 'conflicts' | 'no_remote' | 'error'
  commitHash?: string
  files?: string[]
  message?: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse<PublishKbResult | { error: string }>> {
  const session = await getAuthenticatedUser()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const originValidation = validateSameOrigin(request)
  if (!originValidation.ok) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { slug } = await params

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const instance = await prisma.instance.findUnique({
    where: { slug },
    select: { containerId: true, status: true },
  })

  if (!instance) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  if (instance.status !== 'running' || !instance.containerId) {
    return NextResponse.json({ error: 'instance_not_running' }, { status: 409 })
  }

  try {
    const agent = await createWorkspaceAgentClient(slug)
    if (!agent) {
      return NextResponse.json({ error: 'instance_unavailable' }, { status: 409 })
    }

    const response = await fetch(`${agent.baseUrl}/kb/publish`, {
      method: 'POST',
      headers: {
        Authorization: agent.authHeader,
        Accept: 'application/json'
      },
      cache: 'no-store'
    })

    const data = await response.json().catch(() => null) as PublishKbResult | null
    if (!response.ok || !data) {
      const errorText = data?.message ?? `workspace_agent_http_${response.status}`
      return NextResponse.json({
        ok: false,
        status: 'error',
        message: errorText,
      })
    }

    return NextResponse.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({
      ok: false,
      status: 'error',
      message,
    })
  }
}
