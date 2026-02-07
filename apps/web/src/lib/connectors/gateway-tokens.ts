import crypto from 'node:crypto'

import { getConnectorGatewayTokenSecret, getConnectorGatewayTokenTtlSeconds } from '@/lib/connectors/gateway-config'

export type ConnectorGatewayTokenPayload = {
  userId: string
  workspaceSlug: string
  connectorId: string
  exp: number
}

type ConnectorGatewayTokenInput = Omit<ConnectorGatewayTokenPayload, 'exp'>

function encodePayload(payload: ConnectorGatewayTokenPayload): string {
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

function isValidPayload(payload: ConnectorGatewayTokenPayload): boolean {
  return (
    typeof payload.userId === 'string' &&
    payload.userId.length > 0 &&
    typeof payload.workspaceSlug === 'string' &&
    payload.workspaceSlug.length > 0 &&
    typeof payload.connectorId === 'string' &&
    payload.connectorId.length > 0 &&
    typeof payload.exp === 'number' &&
    Number.isFinite(payload.exp)
  )
}

export function issueConnectorGatewayToken(input: ConnectorGatewayTokenInput): string {
  const ttlSeconds = getConnectorGatewayTokenTtlSeconds()
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const payload: ConnectorGatewayTokenPayload = { ...input, exp }
  const encoded = encodePayload(payload)
  const signature = signPayload(encoded, getConnectorGatewayTokenSecret())
  return `${encoded}.${signature}`
}

export function verifyConnectorGatewayToken(token: string): ConnectorGatewayTokenPayload {
  const parts = token.split('.')
  if (parts.length !== 2) {
    throw new Error('invalid_token')
  }

  const [encoded, signature] = parts
  if (!encoded || !signature) {
    throw new Error('invalid_token')
  }

  const expected = signPayload(encoded, getConnectorGatewayTokenSecret())
  if (!timingSafeMatch(expected, signature)) {
    throw new Error('invalid_token')
  }

  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ConnectorGatewayTokenPayload
  if (!isValidPayload(payload)) {
    throw new Error('invalid_token')
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('token_expired')
  }

  return payload
}
