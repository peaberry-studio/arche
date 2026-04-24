'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AhrefsSection } from '@/components/connectors/add-connector/ahrefs/section'
import { CustomSection } from '@/components/connectors/add-connector/custom/section'
import { LinearSection } from '@/components/connectors/add-connector/linear/section'
import { NotionSection } from '@/components/connectors/add-connector/notion/section'
import {
  CONNECTOR_TYPE_OPTIONS,
  DEFAULT_TYPE,
} from '@/components/connectors/add-connector/shared'
import type { AddConnectorSectionHandle } from '@/components/connectors/add-connector/section-types'
import { UmamiSection } from '@/components/connectors/add-connector/umami/section'
import { ZendeskSection } from '@/components/connectors/add-connector/zendesk/section'
import { getConnectorErrorMessage } from '@/components/connectors/error-messages'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useWorkspaceTheme } from '@/contexts/workspace-theme-context'
import {
  isSingleInstanceConnectorType,
  type ConnectorType,
} from '@/lib/connectors/types'
import { cn } from '@/lib/utils'

type AddConnectorModalProps = {
  slug: string
  existingConnectors: Array<{ id: string; type: ConnectorType }>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export function AddConnectorModal({
  slug,
  existingConnectors,
  open,
  onOpenChange,
  onSaved,
}: AddConnectorModalProps) {
  const { themeId, isDark } = useWorkspaceTheme()
  const themeClassName = `theme-${themeId}`
  const darkModeClasses = isDark ? 'dark' : ''

  const [selectedType, setSelectedType] = useState<ConnectorType>(DEFAULT_TYPE)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionKey, setSessionKey] = useState(0)
  const [, setTick] = useState(0)

  const linearRef = useRef<AddConnectorSectionHandle>(null)
  const notionRef = useRef<AddConnectorSectionHandle>(null)
  const zendeskRef = useRef<AddConnectorSectionHandle>(null)
  const ahrefsRef = useRef<AddConnectorSectionHandle>(null)
  const umamiRef = useRef<AddConnectorSectionHandle>(null)
  const customRef = useRef<AddConnectorSectionHandle>(null)

  const handleStateChange = useCallback(() => {
    setTick((t) => t + 1)
  }, [])

  const activeRef =
    selectedType === 'linear'
      ? linearRef
      : selectedType === 'notion'
        ? notionRef
        : selectedType === 'zendesk'
          ? zendeskRef
          : selectedType === 'ahrefs'
            ? ahrefsRef
            : selectedType === 'umami'
              ? umamiRef
              : customRef

  const availableTypeOptions = useMemo(
    () =>
      CONNECTOR_TYPE_OPTIONS.filter((option) => {
        if (!isSingleInstanceConnectorType(option.type)) return true
        return !existingConnectors.some(
          (connector) => connector.type === option.type
        )
      }),
    [existingConnectors]
  )

  const initializedForOpen = useRef(false)

  useEffect(() => {
    if (!open) {
      setSelectedType(DEFAULT_TYPE)
      setIsSaving(false)
      setError(null)
      initializedForOpen.current = false
      return
    }
    if (initializedForOpen.current) return
    initializedForOpen.current = true
    const defaultType = availableTypeOptions[0]?.type ?? 'custom'
    setSelectedType(defaultType)
    setSessionKey((k) => k + 1)
  }, [open, availableTypeOptions])

  useEffect(() => {
    if (!open) return
    const selectedStillAvailable = availableTypeOptions.some(
      (option) => option.type === selectedType
    )
    if (!selectedStillAvailable) {
      const fallbackType = availableTypeOptions[0]?.type ?? 'custom'
      setSelectedType(fallbackType)
    }
  }, [availableTypeOptions, open, selectedType])

  async function handleSave() {
    const submission = activeRef.current?.getSubmission()
    if (!submission || !submission.ok) {
      setError(submission?.message ?? 'Configuration is incomplete.')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/u/${slug}/connectors`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: selectedType,
          name: submission.name,
          config: submission.config,
        }),
      })

      const data = (await response.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null

      if (!response.ok) {
        setError(getConnectorErrorMessage(data, 'save_failed'))
        return
      }

      onSaved()
      onOpenChange(false)
    } catch {
      setError(getConnectorErrorMessage(null, 'network_error'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'max-h-[90vh] overflow-y-auto sm:max-w-xl',
          darkModeClasses,
          themeClassName
        )}
      >
        <DialogHeader>
          <DialogTitle>Add connector</DialogTitle>
          <DialogDescription>
            Choose a type and configure the connection details.
          </DialogDescription>
        </DialogHeader>

        {/* --- Type selector --- */}
        <fieldset className="space-y-3">
          <legend className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Type
          </legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {availableTypeOptions.map((option) => {
              const isSelected = option.type === selectedType
              return (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => {
                    setSelectedType(option.type)
                    setError(null)
                  }}
                  className={cn(
                    'rounded-xl border px-4 py-3 text-left transition-all',
                    isSelected
                      ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/20'
                      : 'border-border/50 hover:border-border'
                  )}
                >
                  <p className="text-sm font-medium text-foreground">
                    {option.label}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {option.description}
                  </p>
                </button>
              )
            })}
          </div>
          {availableTypeOptions.length === 1 &&
          availableTypeOptions[0]?.type === 'custom' ? (
            <p className="text-xs text-muted-foreground">
              The single-instance connectors are already configured.
            </p>
          ) : null}
        </fieldset>

        {/* --- Divider --- */}
        <hr className="border-border/40" />

        {/* --- Configuration fields --- */}
        <LinearSection
          key={`linear-${sessionKey}`}
          ref={linearRef}
          onStateChange={handleStateChange}
          isActive={selectedType === 'linear'}
        />
        <NotionSection
          key={`notion-${sessionKey}`}
          ref={notionRef}
          onStateChange={handleStateChange}
          isActive={selectedType === 'notion'}
        />
        <ZendeskSection
          key={`zendesk-${sessionKey}`}
          ref={zendeskRef}
          onStateChange={handleStateChange}
          isActive={selectedType === 'zendesk'}
        />
        <AhrefsSection
          key={`ahrefs-${sessionKey}`}
          ref={ahrefsRef}
          onStateChange={handleStateChange}
          isActive={selectedType === 'ahrefs'}
        />
        <UmamiSection
          key={`umami-${sessionKey}`}
          ref={umamiRef}
          onStateChange={handleStateChange}
          isActive={selectedType === 'umami'}
        />
        <CustomSection
          key={`custom-${sessionKey}`}
          ref={customRef}
          onStateChange={handleStateChange}
          isActive={selectedType === 'custom'}
        />

        {/* --- Error --- */}
        {error ? (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {/* --- Footer --- */}
        <div className="flex justify-end pt-2">
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !activeRef.current?.isComplete()}
          >
            {isSaving ? 'Saving...' : 'Save connector'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
