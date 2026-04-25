export type E2EProfile = 'smoke-fake' | 'real-runtime'

export function getE2eProfile(): E2EProfile {
  const profile = process.env.ARCHE_E2E_PROFILE?.trim()
  if (profile === 'real-runtime') return 'real-runtime'
  return 'smoke-fake'
}

export function isSmokeFakeProfile(): boolean {
  return getE2eProfile() === 'smoke-fake'
}

export function isRealRuntimeProfile(): boolean {
  return getE2eProfile() === 'real-runtime'
}
