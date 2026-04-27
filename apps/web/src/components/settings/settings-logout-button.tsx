'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'

export function SettingsLogoutButton() {
  const router = useRouter()
  const isLoggingOutRef = useRef(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  async function handleLogout() {
    if (isLoggingOut || isLoggingOutRef.current) return

    isLoggingOutRef.current = true
    setIsLoggingOut(true)
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
    } finally {
      router.push('/login')
      router.refresh()
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="w-full justify-start px-3 text-muted-foreground hover:text-foreground"
      onClick={handleLogout}
      disabled={isLoggingOut}
    >
      {isLoggingOut ? 'Logging out...' : 'Log out'}
    </Button>
  )
}
