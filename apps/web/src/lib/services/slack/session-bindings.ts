import { prisma } from '@/lib/prisma'

export async function deleteSessionBindingsByOpenCodeSessionId(
  openCodeSessionId: string,
): Promise<{ dm: number; thread: number }> {
  const [dmResult, threadResult] = await prisma.$transaction([
    prisma.slackDmSessionBinding.deleteMany({
      where: { openCodeSessionId },
    }),
    prisma.slackThreadBinding.deleteMany({
      where: { openCodeSessionId },
    }),
  ])

  return {
    dm: dmResult.count,
    thread: threadResult.count,
  }
}
