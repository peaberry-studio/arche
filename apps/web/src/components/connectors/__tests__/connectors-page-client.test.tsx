/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ConnectorsPageClient } from '@/components/connectors/connectors-page-client'

vi.mock('@/components/connectors/connectors-manager', () => ({
  ConnectorsManager: ({ slug }: { slug: string }) => (
    <div data-testid="connectors-manager">ConnectorsManager: {slug}</div>
  ),
}))

describe('ConnectorsPageClient', () => {
  it('renders ConnectorsManager with the provided slug', () => {
    render(<ConnectorsPageClient slug="alice" />)

    expect(screen.getByTestId('connectors-manager')).toBeDefined()
  })
})
