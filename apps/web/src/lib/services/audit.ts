import { prisma } from '@/lib/prisma'

export async function createEvent(args: {
  actorUserId?: string | null
  action: string
  metadata?: unknown
}): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        actorUserId: args.actorUserId ?? null,
        action: args.action,
        metadata: args.metadata ?? undefined,
      },
    })
  } catch (e) {
    console.warn('audit event failed:', args.action, e)
  }
}
