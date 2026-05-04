/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import SignupPage from '@/app/signup/page'

describe('SignupPage', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the access request form and success state', () => {
    render(<SignupPage />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alice' } })
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'alice@example.com' } })
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Acme' } })
    fireEvent.change(screen.getByLabelText('Team size'), { target: { value: '11-50' } })
    fireEvent.change(screen.getByLabelText('Workspace slug'), { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText(/Processes to internalize/), {
      target: { value: 'Automate weekly summaries' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }))

    expect(screen.getByText('Request received')).toBeTruthy()
    expect(screen.getByText('We will contact you within 24 hours to set up your workspace.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/')
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
  })
})
