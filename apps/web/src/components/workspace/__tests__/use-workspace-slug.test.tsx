/**
 * @vitest-environment jsdom
 */
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useWorkspaceSlug } from '@/components/workspace/vega-workspace-loader'

const route = vi.hoisted(() => ({ params: {} as Record<string, string>, pathname: '/' }))

vi.mock('next/navigation', () => ({
  useParams: () => route.params,
  usePathname: () => route.pathname,
}))

describe('useWorkspaceSlug', () => {
  afterEach(() => {
    route.params = {}
    route.pathname = '/'
  })

  it('returns the slug inside a workspace route', () => {
    route.params = { slug: 'my-space' }
    route.pathname = '/w/my-space'

    expect(renderHook(() => useWorkspaceSlug()).result.current).toBe('my-space')
  })

  it('ignores the identically-named org param on /u/[slug]', () => {
    // Trusting the param alone would point chart data at a workspace that does not exist.
    route.params = { slug: 'acme-org' }
    route.pathname = '/u/acme-org/settings'

    expect(renderHook(() => useWorkspaceSlug()).result.current).toBeUndefined()
  })

  it('returns undefined when the route has no slug', () => {
    route.pathname = '/w/'
    expect(renderHook(() => useWorkspaceSlug()).result.current).toBeUndefined()
  })
})
