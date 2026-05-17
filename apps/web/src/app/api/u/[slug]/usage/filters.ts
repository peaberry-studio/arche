import type { NextRequest } from 'next/server'

import type { ProviderUsageFilters } from '@/lib/services/provider-usage'

function parseDateParam(value: string | null): Date | undefined {
  if (!value) return undefined

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date
}

function parseStringParam(value: string | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function parseUsageFilters(request: NextRequest): ProviderUsageFilters {
  const search = request.nextUrl.searchParams

  return {
    from: parseDateParam(search.get('from')),
    to: parseDateParam(search.get('to')),
    userId: parseStringParam(search.get('userId')),
    providerId: parseStringParam(search.get('providerId')),
    modelId: parseStringParam(search.get('modelId')),
  }
}
