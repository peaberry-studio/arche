'use client'

import { useParams, usePathname } from 'next/navigation'
import type { EmbedOptions } from 'vega-embed'

import { isAbsoluteUri, resolveWorkspaceDataPath, workspaceDataUrl } from '@/lib/vega/data-path'
import { MAX_WORKSPACE_CHART_DATA_BYTES } from '@/lib/vega/sanitize-spec'

type VegaNamespace = (typeof import('vega-embed'))['vega']

/**
 * The workspace slug for the current route, or undefined when there is none (relative
 * `data.url` values simply do not resolve outside a workspace).
 *
 * The pathname check is load-bearing, not defensive: `/u/[slug]` binds the same param name
 * to an organization, so trusting the param alone would resolve chart data against a
 * workspace that does not exist.
 */
export function useWorkspaceSlug(): string | undefined {
  const params = useParams<{ slug?: string }>()
  const pathname = usePathname()

  if (!pathname?.startsWith('/w/')) return undefined

  const slug = params?.slug
  return typeof slug === 'string' && slug ? slug : undefined
}

/**
 * Confines `data.url` to the given workspace. Relative paths are rewritten to the
 * same-origin file route; absolute URIs keep Vega's default handling, which under the
 * app's CSP means anything off-origin simply fails to load.
 */
export function buildWorkspaceLoader(
  vega: VegaNamespace,
  slug: string,
): EmbedOptions['loader'] {
  const loader = vega.loader()
  const defaultSanitize = loader.sanitize.bind(loader)

  loader.sanitize = async (uri, options) => {
    const rawUri = String(uri)
    if (isAbsoluteUri(rawUri)) return defaultSanitize(rawUri, options)

    const path = resolveWorkspaceDataPath(rawUri)
    if (!path) throw new Error(`Blocked a data URL that escapes the workspace: ${rawUri}`)

    return { href: workspaceDataUrl(slug, path, { maxBytes: MAX_WORKSPACE_CHART_DATA_BYTES }) }
  }

  return loader
}
