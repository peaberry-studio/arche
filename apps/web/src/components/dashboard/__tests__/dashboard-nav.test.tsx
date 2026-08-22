/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DashboardNav } from '@/components/dashboard/dashboard-nav'

vi.mock('next/navigation', () => ({
  usePathname: () => '/u/admin',
  useSearchParams: () => new URLSearchParams(),
}))

describe('DashboardNav', () => {
  afterEach(() => {
    cleanup()
    document.documentElement.style.removeProperty('--dashboard-nav-offset')
    window.localStorage.clear()
  })

  it('keeps logout out of the dashboard nav', () => {
    render(<DashboardNav slug="admin" />)

    expect(screen.getByRole('link', { name: 'Knowledge Base' }).getAttribute('href')).toBe('/w/admin/explore')
    expect(screen.getByRole('link', { name: 'Knowledge' }).getAttribute('href')).toBe('/w/admin?mode=knowledge')
    expect(screen.getByRole('link', { name: /open workspace/i }).getAttribute('href')).toBe('/w/admin')
    expect(screen.queryByRole('link', { name: 'Team' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull()
  })

  it('keeps logout out of the mobile menu', () => {
    render(<DashboardNav slug="admin" />)

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))

    expect(screen.getAllByRole('link', { name: 'Settings' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull()
  })

  it('updates and cleans the dashboard nav offset', () => {
    const { unmount } = render(<DashboardNav slug="admin" />)

    expect(document.documentElement.style.getPropertyValue('--dashboard-nav-offset')).toBe('12.5rem')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }))

    expect(document.documentElement.style.getPropertyValue('--dashboard-nav-offset')).toBe('3rem')
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeTruthy()

    unmount()

    expect(document.documentElement.style.getPropertyValue('--dashboard-nav-offset')).toBe('')
  })

  it('restores the collapsed state from initialExpanded', () => {
    render(<DashboardNav slug="admin" initialExpanded={false} />)

    expect(document.documentElement.style.getPropertyValue('--dashboard-nav-offset')).toBe('3rem')
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeTruthy()
  })

  it('persists the expanded state', () => {
    render(<DashboardNav slug="admin" />)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }))

    expect(window.localStorage.getItem('dashboard-nav-expanded:admin')).toBe('false')
  })
})
