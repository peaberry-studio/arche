const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

export function validateSlug(slug: string): { valid: boolean; error?: string } {
  if (!slug || slug.length > 32) {
    return { valid: false, error: 'Slug must be 1-32 characters' }
  }
  if (slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
    return { valid: false, error: 'Invalid characters in slug' }
  }
  if (!SLUG_PATTERN.test(slug)) {
    return { valid: false, error: 'Slug must be lowercase alphanumeric with hyphens' }
  }
  return { valid: true }
}

export function assertValidSlug(slug: string): void {
  const result = validateSlug(slug)
  if (!result.valid) throw new Error(result.error)
}
