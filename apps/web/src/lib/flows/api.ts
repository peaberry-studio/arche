import { userService } from '@/lib/services'

export type FlowRouteUser = {
  id: string
  slug: string
}

export async function resolveFlowOwnerUserId(slug: string, contextUser: FlowRouteUser): Promise<string | null> {
  if (contextUser.slug === slug) return contextUser.id

  const owner = await userService.findIdBySlug(slug)
  return owner?.id ?? null
}

export function flowRunActionStatus(error: string): number {
  if (error === 'not_found') return 404
  if (error === 'flow_busy') return 409
  return 400
}
