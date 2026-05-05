import { describe, expect, it } from 'vitest'

import { getTeamErrorMessage } from '@/components/team/error-messages'

describe('getTeamErrorMessage', () => {
  it.each([
    ['email_in_use', 'That email is already in use.'],
    ['slug_in_use', 'That slug is already in use.'],
    ['invalid_email', 'Enter a valid email address.'],
    ['invalid_slug', 'Enter a valid slug.'],
    ['invalid_password', 'Password is required.'],
    ['password_reset_failed', 'Password reset failed. Please try again.'],
    ['invalid_role', 'Select a valid role.'],
    ['last_admin', 'You cannot leave the system without at least one admin.'],
    ['forbidden', 'You do not have permission for this action.'],
    ['user_not_found', 'The selected user was not found.'],
    ['invalid_provider', 'The selected provider is invalid.'],
    ['missing_fields', 'Required fields are missing.'],
    ['invalid_json', 'The submitted data is invalid.'],
    ['invalid_body', 'The submitted data is invalid.'],
    ['network_error', 'Network error. Please try again.'],
    ['custom_error', 'custom_error'],
  ])('maps %s', (code, message) => {
    expect(getTeamErrorMessage(code)).toBe(message)
  })
})
