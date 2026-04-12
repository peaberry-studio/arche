import crypto from 'node:crypto'

import { getConnectorGatewayTokenSecret } from '@/lib/connectors/gateway-config'

export type ConnectorGatewayTokenPayload = {
  userId: string
  workspaceSlug: string
  connectorId: string
}

type ConnectorGatewayTokenInput = ConnectorGatewayTokenPayload

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
    payload.connectorId.length > 0
  )
}

export function issueConnectorGatewayToken(input: ConnectorGatewayTokenInput): string {
  const encoded = encodePayload(input)
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

  const raw: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('invalid_token')
  }
  const payload = raw as ConnectorGatewayTokenPayload
  if (!isValidPayload(payload)) {
    throw new Error('invalid_token')
  }

  return payload
}
