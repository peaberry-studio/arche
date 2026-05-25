import { userService } from '@/lib/services'

export type FlowRouteUser = {
  id: string
  role: string
  slug: string
}

export type FlowRouteContext = {
  actorUserId: string
  actorSlug: string
  workspaceSlug: string
  workspaceUserId: string
}

export async function resolveFlowRouteContext(slug: string, actor: FlowRouteUser): Promise<FlowRouteContext | null> {
  if (actor.slug === slug) {
    return {
      actorSlug: actor.slug,
      actorUserId: actor.id,
      workspaceSlug: slug,
      workspaceUserId: actor.id,
    }
  }

  if (actor.role !== 'ADMIN') return null

  const workspaceUser = await userService.findIdBySlug(slug)
  if (!workspaceUser) return null

  return {
    actorSlug: actor.slug,
    actorUserId: actor.id,
    workspaceSlug: slug,
    workspaceUserId: workspaceUser.id,
  }
}

export function flowRunActionStatus(error: string): number {
  if (error === 'not_found') return 404
  if (error === 'flow_busy') return 409
  return 400
}
