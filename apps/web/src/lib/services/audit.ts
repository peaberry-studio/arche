import { prisma } from '@/lib/prisma'

export type AuditEventArgs = {
  actorUserId?: string | null
  action: string
  metadata?: unknown
}

type AuditEventClient = Pick<typeof prisma, 'auditEvent'>

export async function createEventStrict(args: AuditEventArgs, client: AuditEventClient = prisma): Promise<void> {
  await client.auditEvent.create({
    data: {
      actorUserId: args.actorUserId ?? null,
      action: args.action,
      metadata: args.metadata ?? undefined,
    },
  })
}

export async function createEvent(args: AuditEventArgs): Promise<void> {
  try {
    await createEventStrict(args)
  } catch (e) {
    console.warn('audit event failed:', args.action, e)
  }
}
