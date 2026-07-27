import { normalizeWorkspacePath } from '@/lib/workspace-paths'

const URL_SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/

/**
 * Browsers strip control characters before parsing a URL scheme, so `java\nscript:` has
 * to be read as `javascript:` here too. Every scheme decision in the app goes through
 * this one normalization — a second, laxer copy would let an obfuscated URI be classified
 * one way for policy and another way for data loading.
 */
function normalizeUrlForScheme(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().toLowerCase()
}

/** The scheme of a URI, or null when it is relative. */
export function getUrlScheme(value: string): string | null {
  const match = URL_SCHEME_PATTERN.exec(normalizeUrlForScheme(value))
  return match ? match[1] : null
}

/** True for an inline image payload — the one absolute form charts may reference. */
export function isInlineImageUri(value: string): boolean {
  return normalizeUrlForScheme(value).startsWith('data:image/')
}

/**
 * Same-origin route that streams a workspace file. Vega's browser loader fetches this
 * instead of the raw `data.url`, so a spec can reference files committed alongside an
 * article without the app ever making an outbound request on the spec's behalf.
 */
export function workspaceDataUrl(
  slug: string,
  path: string,
  options?: { maxBytes?: number },
): string {
  const base = `/api/w/${encodeURIComponent(slug)}/files/download?path=${encodeURIComponent(path)}`
  // maxBytes asks the route to 413 rather than stream a larger body. It is a client-side
  // budget, not a security boundary: the caller can only restrict what it receives.
  return options?.maxBytes ? `${base}&maxBytes=${options.maxBytes}` : base
}

/**
 * Resolves a spec-supplied `data.url` against the workspace root. Returns null when the
 * value escapes the workspace or is empty; the caller turns that into a load failure.
 */
export function resolveWorkspaceDataPath(rawUri: string): string | null {
  const normalized = normalizeWorkspacePath(rawUri)
  if (!normalized) return null
  if (normalized.split('/').includes('..')) return null
  return normalized
}

export function isAbsoluteUri(rawUri: string): boolean {
  return getUrlScheme(rawUri) !== null
}
