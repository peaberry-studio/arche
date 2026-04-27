/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DashboardNav } from '@/components/dashboard/dashboard-nav'

vi.mock('next/navigation', () => ({
  usePathname: () => '/u/admin',
}))

describe('DashboardNav', () => {
  afterEach(() => {
    cleanup()
  })

  it('keeps logout out of the dashboard nav', () => {
    render(<DashboardNav slug="admin" />)

    expect(screen.getByRole('link', { name: /open workspace/i }).getAttribute('href')).toBe('/w/admin')
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull()
  })

  it('keeps logout out of the mobile menu', () => {
    render(<DashboardNav slug="admin" />)

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))

    expect(screen.getAllByRole('link', { name: 'Settings' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull()
  })
})
