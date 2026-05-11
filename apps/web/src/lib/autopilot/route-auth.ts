import { userService } from '@/lib/services'

export async function resolveAutopilotWorkspaceUserId(
  slug: string,
  contextUser: { id: string; slug: string },
): Promise<string | null> {
  if (contextUser.slug === slug) {
    return contextUser.id
  }

  const owner = await userService.findIdBySlug(slug)
  return owner?.id ?? null
}
