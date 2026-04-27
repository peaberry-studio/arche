export function getTeamErrorMessage(error: string): string {
  switch (error) {
    case 'email_in_use':
      return 'That email is already in use.'
    case 'slug_in_use':
      return 'That slug is already in use.'
    case 'invalid_email':
      return 'Enter a valid email address.'
    case 'invalid_slug':
      return 'Enter a valid slug.'
    case 'invalid_password':
      return 'Password is required.'
    case 'password_reset_failed':
      return 'Password reset failed. Please try again.'
    case 'invalid_role':
      return 'Select a valid role.'
    case 'last_admin':
      return 'You cannot leave the system without at least one admin.'
    case 'forbidden':
      return 'You do not have permission for this action.'
    case 'user_not_found':
      return 'The selected user was not found.'
    case 'invalid_provider':
      return 'The selected provider is invalid.'
    case 'missing_fields':
      return 'Required fields are missing.'
    case 'invalid_json':
    case 'invalid_body':
      return 'The submitted data is invalid.'
    case 'network_error':
      return 'Network error. Please try again.'
    default:
      return error
  }
}
