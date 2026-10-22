import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

type LookupAddress = {
  address: string
  family: number
}

export type LookupHost = (hostname: string) => Promise<LookupAddress[]>

type EndpointValidationError = 'invalid_endpoint' | 'blocked_endpoint'

type EndpointValidationResult =
  | { ok: true; url: URL }
  | { ok: false; error: EndpointValidationError }

const BLOCKED_SUBNETS = new BlockList()

BLOCKED_SUBNETS.addSubnet('127.0.0.0', 8, 'ipv4')
BLOCKED_SUBNETS.addSubnet('10.0.0.0', 8, 'ipv4')
BLOCKED_SUBNETS.addSubnet('172.16.0.0', 12, 'ipv4')
BLOCKED_SUBNETS.addSubnet('192.168.0.0', 16, 'ipv4')
BLOCKED_SUBNETS.addSubnet('169.254.0.0', 16, 'ipv4')
BLOCKED_SUBNETS.addSubnet('0.0.0.0', 8, 'ipv4')
BLOCKED_SUBNETS.addSubnet('100.64.0.0', 10, 'ipv4')
BLOCKED_SUBNETS.addSubnet('192.0.0.0', 24, 'ipv4')
BLOCKED_SUBNETS.addSubnet('192.0.2.0', 24, 'ipv4')
BLOCKED_SUBNETS.addSubnet('198.18.0.0', 15, 'ipv4')
BLOCKED_SUBNETS.addSubnet('198.51.100.0', 24, 'ipv4')
BLOCKED_SUBNETS.addSubnet('203.0.113.0', 24, 'ipv4')
BLOCKED_SUBNETS.addSubnet('224.0.0.0', 4, 'ipv4')
BLOCKED_SUBNETS.addSubnet('240.0.0.0', 4, 'ipv4')
BLOCKED_SUBNETS.addSubnet('ff00::', 8, 'ipv6')
BLOCKED_SUBNETS.addSubnet('64:ff9b::', 96, 'ipv6')
BLOCKED_SUBNETS.addSubnet('64:ff9b:1::', 48, 'ipv6')
BLOCKED_SUBNETS.addSubnet('2002::', 16, 'ipv6')
BLOCKED_SUBNETS.addSubnet('2001::', 32, 'ipv6')

BLOCKED_SUBNETS.addSubnet('::', 128, 'ipv6')
BLOCKED_SUBNETS.addSubnet('::1', 128, 'ipv6')
BLOCKED_SUBNETS.addSubnet('fc00::', 7, 'ipv6')
BLOCKED_SUBNETS.addSubnet('fe80::', 10, 'ipv6')

async function defaultLookupHost(hostname: string): Promise<LookupAddress[]> {
  return lookup(hostname, { all: true, verbatim: true })
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost')
}

function normalizeHostname(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1)
  }
  return hostname
}

function extractMappedIpv4Address(address: string): string | null {
  const lowered = address.toLowerCase()

  const dotted = lowered.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted?.[1]) {
    return isIP(dotted[1]) === 4 ? dotted[1] : null
  }

  const hex = lowered.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (!hex?.[1] || !hex[2]) return null

  const high = Number.parseInt(hex[1], 16)
  const low = Number.parseInt(hex[2], 16)
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null

  const octets = [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ]

  return octets.join('.')
}

export function isBlockedIpAddress(address: string): boolean {
  const family = isIP(address)

  if (family === 4) {
    return BLOCKED_SUBNETS.check(address, 'ipv4')
  }

  if (family === 6) {
    if (BLOCKED_SUBNETS.check(address, 'ipv6')) {
      return true
    }

    const mappedIpv4 = extractMappedIpv4Address(address)
    return mappedIpv4 ? BLOCKED_SUBNETS.check(mappedIpv4, 'ipv4') : false
  }

  return false
}

export async function validateConnectorTestEndpoint(
  rawEndpoint: string,
  options: { lookupHost?: LookupHost } = {}
): Promise<EndpointValidationResult> {
  const endpoint = rawEndpoint.trim()
  if (!endpoint) {
    return { ok: false, error: 'invalid_endpoint' }
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(endpoint)
  } catch {
    return { ok: false, error: 'invalid_endpoint' }
  }

  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
    return { ok: false, error: 'invalid_endpoint' }
  }

  const hostname = normalizeHostname(parsedUrl.hostname.toLowerCase())
  if (!hostname) {
    return { ok: false, error: 'invalid_endpoint' }
  }

  if (isLocalHostname(hostname)) {
    return { ok: false, error: 'blocked_endpoint' }
  }

  if (isBlockedIpAddress(hostname)) {
    return { ok: false, error: 'blocked_endpoint' }
  }

  if (isIP(hostname) === 0) {
    const lookupHost = options.lookupHost ?? defaultLookupHost

    let addresses: LookupAddress[]
    try {
      addresses = await lookupHost(hostname)
    } catch {
      return { ok: false, error: 'invalid_endpoint' }
    }

    if (!Array.isArray(addresses) || addresses.length === 0) {
      return { ok: false, error: 'invalid_endpoint' }
    }

    if (addresses.some((entry) => isBlockedIpAddress(entry.address))) {
      return { ok: false, error: 'blocked_endpoint' }
    }
  }

  return { ok: true, url: parsedUrl }
}
