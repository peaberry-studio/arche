import crypto from 'node:crypto'

import { getConnectorGatewayTokenSecret } from '@/lib/connectors/gateway-config'

export type ConnectorGatewayTokenPayload = {
  userId: string
  workspaceSlug: string
  connectorId: string
  credentialEpoch: string
  iat: number
  exp: number
  aud: 'connector-gateway'
}

type ConnectorGatewayTokenInput = Pick<ConnectorGatewayTokenPayload, 'userId' | 'workspaceSlug' | 'connectorId' | 'credentialEpoch'>

export const CONNECTOR_GATEWAY_TTL_SECONDS = 300

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
    typeof payload.credentialEpoch === 'string' && payload.credentialEpoch.length > 0 &&
    payload.aud === 'connector-gateway' &&
    Number.isSafeInteger(payload.iat) && Number.isSafeInteger(payload.exp) &&
    payload.iat <= Math.floor(Date.now() / 1000) &&
    payload.exp > Math.floor(Date.now() / 1000) &&
    payload.exp > payload.iat && payload.exp - payload.iat <= CONNECTOR_GATEWAY_TTL_SECONDS
  )
}

export function issueConnectorGatewayToken(input: ConnectorGatewayTokenInput): string {
  const iat = Math.floor(Date.now() / 1000)
  const encoded = encodePayload({ ...input, iat, exp: iat + CONNECTOR_GATEWAY_TTL_SECONDS, aud: 'connector-gateway' })
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
