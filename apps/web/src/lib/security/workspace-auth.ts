import { createHash, timingSafeEqual } from 'node:crypto'

import { instanceService } from '@/lib/services'
import { decryptPassword } from '@/lib/spawner/crypto'
import { validateSlug } from '@/lib/validation/slug'

export function getWorkspaceCredentialEpoch(encryptedPassword: string): string {
  return createHash('sha256').update(encryptedPassword).digest('hex')
}

export async function authenticateWorkspace(request: Request, slug: string): Promise<{ credentialEpoch: string } | null> {
  if (!validateSlug(slug).valid) return null
  const instance = await instanceService.findCredentialsBySlug(slug)
  if (!instance || !['starting', 'running'].includes(instance.status)) return null
  const expected = Buffer.from(`Basic ${Buffer.from(`opencode:${decryptPassword(instance.serverPassword)}`).toString('base64')}`)
  const actual = Buffer.from(request.headers.get('authorization') ?? '')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  return { credentialEpoch: getWorkspaceCredentialEpoch(instance.serverPassword) }
}

export async function isWorkspaceCredentialCurrent(slug: string, credentialEpoch: string): Promise<boolean> {
  if (!validateSlug(slug).valid) return false
  const instance = await instanceService.findCredentialsBySlug(slug)
  return !!instance && ['starting', 'running'].includes(instance.status) &&
    getWorkspaceCredentialEpoch(instance.serverPassword) === credentialEpoch
}
