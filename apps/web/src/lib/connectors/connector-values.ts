export { isRecord } from '@/lib/records'

export function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function getPositiveInteger(value: unknown): number | undefined {
  const number = getFiniteNumber(value)
  if (number === undefined || !Number.isInteger(number) || number <= 0) {
    return undefined
  }
  return number
}

export function getNonNegativeInteger(value: unknown): number | undefined {
  const number = getFiniteNumber(value)
  if (number === undefined || !Number.isInteger(number) || number < 0) {
    return undefined
  }
  return number
}

export function getBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

export function getStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const strings = value
    .map((entry) => getString(entry))
    .filter((entry): entry is string => Boolean(entry))

  return strings.length > 0 ? strings : undefined
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

export function hasOwnProperty(args: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(args, key)
}
