import { createHmac, timingSafeEqual } from 'node:crypto'

import { getGatewayTokenSecret } from '@/lib/providers/config'

export function getModelsCatalogToken(): string {
  return createHmac('sha256', getGatewayTokenSecret()).update('arche:models-catalog:v1').digest('base64url')
}

export function isModelsCatalogToken(token: string): boolean {
  const actual = Buffer.from(token)
  const expected = Buffer.from(getModelsCatalogToken())
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
