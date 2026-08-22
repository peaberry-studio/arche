'use client'

import { useEffect, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { notifyWorkspaceConfigChanged } from '@/lib/runtime/config-status-events'

type ModelOption = {
  id: string
  label: string
}

type WorkspaceDefaultModelControlProps = {
  defaultModel?: string | null
  hash?: string
  inputId: string
  isAdmin?: boolean
  onSaved: () => Promise<void>
  slug: string
}

export function WorkspaceDefaultModelControl({
  defaultModel,
  hash,
  inputId,
  isAdmin = true,
  onSaved,
  slug,
}: WorkspaceDefaultModelControlProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const inputValue = draft ?? defaultModel ?? ''

  useEffect(() => {
    let cancelled = false

    fetch(`/api/u/${slug}/agents/models`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return
        const data = (await response.json().catch(() => null)) as { models?: ModelOption[] } | null
        if (!cancelled) setModelOptions(data?.models ?? [])
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [slug])

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) {
      setDraft(null)
      setMessage(null)
      setError(null)
    }
  }

  async function handleSave() {
    if (isSaving) return

    setIsSaving(true)
    setMessage(null)
    setError(null)

    try {
      const response = await fetch(`/api/u/${slug}/agents/default-model`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          defaultModel: inputValue.trim() || null,
          expectedHash: hash,
        }),
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        setError(data?.error ?? 'save_failed')
        return
      }

      setMessage('Default model saved.')
      setDraft(null)
      notifyWorkspaceConfigChanged()
      await onSaved()
    } catch {
      setError('network_error')
    } finally {
      setIsSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <p className="text-sm text-muted-foreground">{defaultModel ?? 'No default model configured.'}</p>
    )
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => handleOpenChange(true)}
        aria-label="Edit default model"
        className="h-10 max-w-[18rem] gap-2 px-3 font-normal"
      >
        <span className="text-muted-foreground">Default</span>
        <span className="truncate">{defaultModel || 'None'}</span>
        <CaretDown size={12} className="shrink-0 text-muted-foreground" />
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md gap-4 p-6" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Default model</DialogTitle>
            <DialogDescription>
              Agents without an override inherit this workspace model.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor={inputId} className="sr-only">
              Default model
            </Label>
            <Input
              id={inputId}
              list={`${inputId}-options`}
              value={inputValue}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleSave()
                }
              }}
              placeholder="Select or type a model"
            />
            <datalist id={`${inputId}-options`}>
              {modelOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </datalist>
            {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
            {error ? <p className="text-xs text-destructive">Error: {error}</p> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving}
              aria-label="Save default model"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
