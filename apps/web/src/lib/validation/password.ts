export const MIN_PASSWORD_LENGTH = 8

export function validatePassword(password: string): { valid: true } | { valid: false; message: string } {
  if (!password) {
    return { valid: false, message: 'Password is required.' }
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }
  }

  return { valid: true }
}
