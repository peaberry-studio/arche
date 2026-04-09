'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'

import {
  KickstartWizard,
  type KickstartWizardLoadCatalogResult,
  type KickstartWizardSubmitResult,
} from '@/components/kickstart/kickstart-wizard'
import type {
  KickstartApplyRequestPayload,
  KickstartStatus,
  KickstartTemplatesResponse,
} from '@/kickstart/types'

type ModelOption = {
  id: string
  label: string
}

type WebKickstartWizardProps = {
  initialCompanyDescription?: string
  initialCompanyName?: string
  initialTemplateId?: string | null
  initialStatus?: KickstartStatus
  slug: string
}

export function WebKickstartWizard({
  slug,
  initialStatus,
  initialCompanyDescription,
  initialCompanyName,
  initialTemplateId,
}: WebKickstartWizardProps) {
  const router = useRouter()

  const loadCatalog = useCallback(async (): Promise<KickstartWizardLoadCatalogResult> => {
    const [templatesResponse, modelsResponse] = await Promise.all([
      fetch(`/api/u/${slug}/kickstart/templates`, {
        cache: 'no-store',
      }).catch(() => null),
      fetch(`/api/u/${slug}/agents/models`, {
        cache: 'no-store',
      }).catch(() => null),
    ])

    const response = templatesResponse
    if (!response) {
      return { ok: false, error: 'Failed to load kickstart templates' }
    }

    const data = (await response.json().catch(() => null)) as KickstartTemplatesResponse | { error?: string } | null
    if (!response.ok || !data || !('templates' in data)) {
      return {
        ok: false,
        error: (data && 'error' in data && data.error) || 'Failed to load kickstart templates',
      }
    }

    let models: ModelOption[] = []
    if (modelsResponse?.ok) {
      const modelData = (await modelsResponse.json().catch(() => null)) as { models?: ModelOption[] } | null
      models = modelData?.models ?? []
    }

    return {
      ok: true,
      catalog: data,
      models,
    }
  }, [slug])

  const handleSubmit = useCallback(async (
    payload: KickstartApplyRequestPayload,
  ): Promise<KickstartWizardSubmitResult> => {
    try {
      const response = await fetch(`/api/u/${slug}/kickstart/apply`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const data = (await response.json().catch(() => null)) as {
        error?: string
        message?: string
      } | null

      if (!response.ok) {
        return {
          ok: false,
          error: data?.message ?? data?.error ?? 'Kickstart apply failed',
        }
      }

      router.push(`/u/${slug}?setup=completed`)
      return { ok: true }
    } catch {
      return { ok: false, error: 'Kickstart apply failed' }
    }
  }, [router, slug])

  return (
    <KickstartWizard
      initialStatus={initialStatus}
      initialCompanyDescription={initialCompanyDescription}
      initialCompanyName={initialCompanyName}
      initialTemplateId={initialTemplateId}
      loadCatalog={loadCatalog}
      onSubmit={handleSubmit}
    />
  )
}
