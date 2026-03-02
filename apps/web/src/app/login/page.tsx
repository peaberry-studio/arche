import { redirect } from 'next/navigation'

import { isDesktopNoAuthEnabled, getAuthenticatedUser } from '@/lib/auth'

import { LoginClient } from './login-client'

export default async function LoginPage() {
  if (isDesktopNoAuthEnabled()) {
    const session = await getAuthenticatedUser()
    if (session) {
      redirect(`/u/${session.user.slug}`)
    }
  }

  return <LoginClient />
}
