import crypto from 'node:crypto'
import type { ProviderId } from './types'
import { getGatewayTokenSecret, getGatewayTokenTtlSeconds } from './config'

export type GatewayTokenPayload = {
  userId: string
  workspaceSlug: string
  providerId: ProviderId
  version: number
  exp: number
}

export type GatewayTokenInput = Omit<GatewayTokenPayload, 'exp'>

function encodePayload(payload: GatewayTokenPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function signPayload(encoded: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(encoded).digest('base64url')
}

function timingSafeMatch(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)
  if (expectedBuffer.length !== actualBuffer.length) return false
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer)
}

function isValidPayload(payload: GatewayTokenPayload): boolean {
  return (
    typeof payload.userId === 'string' &&
    payload.userId.length > 0 &&
    typeof payload.workspaceSlug === 'string' &&
    payload.workspaceSlug.length > 0 &&
    typeof payload.providerId === 'string' &&
    payload.providerId.length > 0 &&
    typeof payload.version === 'number' &&
    Number.isFinite(payload.version) &&
    typeof payload.exp === 'number' &&
    Number.isFinite(payload.exp)
  )
}

function createGatewayToken(payload: GatewayTokenPayload): string {
  const encoded = encodePayload(payload)
  const secret = getGatewayTokenSecret()
  const signature = signPayload(encoded, secret)
  return `${encoded}.${signature}`
}

export function issueGatewayToken(payload: GatewayTokenInput): string {
  const ttlSeconds = getGatewayTokenTtlSeconds()
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  return createGatewayToken({ ...payload, exp })
}

export function verifyGatewayToken(token: string): GatewayTokenPayload {
  try {
    const parts = token.split('.')
    if (parts.length !== 2) {
      throw new Error('invalid_token')
    }

    const [encoded, signature] = parts
    if (!encoded || !signature) {
      throw new Error('invalid_token')
    }

    const secret = getGatewayTokenSecret()
    const expectedSignature = signPayload(encoded, secret)
    if (!timingSafeMatch(expectedSignature, signature)) {
      throw new Error('invalid_token')
    }

    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as GatewayTokenPayload
    if (!isValidPayload(payload)) {
      throw new Error('invalid_token')
    }

    const now = Math.floor(Date.now() / 1000)
    if (payload.exp <= now) {
      throw new Error('token_expired')
    }

    return payload
  } catch (error) {
    if (error instanceof Error && (error.message === 'invalid_token' || error.message === 'token_expired')) {
      throw error
    }
    throw new Error('invalid_token')
  }
}
