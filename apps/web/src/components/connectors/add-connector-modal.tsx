'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AhrefsSection } from '@/components/connectors/add-connector/ahrefs/section'
import { CustomSection } from '@/components/connectors/add-connector/custom/section'
import { GoogleWorkspaceSection } from '@/components/connectors/add-connector/google-workspace/section'
import { LinearSection } from '@/components/connectors/add-connector/linear/section'
import { MetaAdsSection } from '@/components/connectors/add-connector/meta-ads/section'
import { NotionSection } from '@/components/connectors/add-connector/notion/section'
import {
  CONNECTOR_TYPE_OPTIONS,
  DEFAULT_TYPE,
} from '@/components/connectors/add-connector/shared'
import type { AddConnectorSectionHandle } from '@/components/connectors/add-connector/section-types'
import { TypeSelectorStep } from '@/components/connectors/add-connector/type-selector-step'
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

  const [modalStep, setModalStep] = useState<'select' | 'configure'>('select')
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
  const metaAdsRef = useRef<AddConnectorSectionHandle>(null)
  const googleGmailRef = useRef<AddConnectorSectionHandle>(null)
  const googleDriveRef = useRef<AddConnectorSectionHandle>(null)
  const googleCalendarRef = useRef<AddConnectorSectionHandle>(null)
  const googleChatRef = useRef<AddConnectorSectionHandle>(null)
  const googlePeopleRef = useRef<AddConnectorSectionHandle>(null)
  const customRef = useRef<AddConnectorSectionHandle>(null)

  const handleStateChange = useCallback(() => {
    setTick((t) => t + 1)
  }, [])

  const sectionRefs = {
    linear: linearRef,
    notion: notionRef,
    zendesk: zendeskRef,
    ahrefs: ahrefsRef,
    umami: umamiRef,
    'meta-ads': metaAdsRef,
    google_gmail: googleGmailRef,
    google_drive: googleDriveRef,
    google_calendar: googleCalendarRef,
    google_chat: googleChatRef,
    google_people: googlePeopleRef,
    custom: customRef,
  } satisfies Record<ConnectorType, typeof linearRef>

  const activeRef = sectionRefs[selectedType]

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
      setModalStep('select')
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
      setModalStep('select')
    }
  }, [availableTypeOptions, open, selectedType])

  function handleSelectType(type: ConnectorType) {
    setSelectedType(type)
    setError(null)
    setModalStep('configure')
  }

  function handleBack() {
    setModalStep('select')
    setError(null)
  }

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
          'scrollbar-custom max-h-[90vh] overflow-y-auto sm:max-w-xl',
          darkModeClasses,
          themeClassName
        )}
      >
        <DialogHeader>
          <DialogTitle>Add connector</DialogTitle>
          <DialogDescription>
            {modalStep === 'select'
              ? 'Choose a connector to add.'
              : 'Configure the connection details.'}
          </DialogDescription>
        </DialogHeader>

        {/* --- Selection step --- */}
        <TypeSelectorStep
          availableTypeOptions={availableTypeOptions}
          isActive={modalStep === 'select'}
          onSelectType={handleSelectType}
        />

        {/* --- Configuration fields --- */}
        <div className={cn(modalStep !== 'configure' && 'hidden')}>
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
          <MetaAdsSection
            key={`meta-ads-${sessionKey}`}
            ref={metaAdsRef}
            onStateChange={handleStateChange}
            isActive={selectedType === 'meta-ads'}
          />
          <GoogleWorkspaceSection
            key={`google_gmail-${sessionKey}`}
            ref={googleGmailRef}
            onStateChange={handleStateChange}
            isActive={selectedType === 'google_gmail'}
            connectorType="google_gmail"
          />
          <GoogleWorkspaceSection
            key={`google_drive-${sessionKey}`}
            ref={googleDriveRef}
            onStateChange={handleStateChange}
            isActive={selectedType === 'google_drive'}
            connectorType="google_drive"
          />
          <GoogleWorkspaceSection
            key={`google_calendar-${sessionKey}`}
            ref={googleCalendarRef}
            onStateChange={handleStateChange}
            isActive={selectedType === 'google_calendar'}
            connectorType="google_calendar"
          />
          <GoogleWorkspaceSection
            key={`google_chat-${sessionKey}`}
            ref={googleChatRef}
            onStateChange={handleStateChange}
            isActive={selectedType === 'google_chat'}
            connectorType="google_chat"
          />
          <GoogleWorkspaceSection
            key={`google_people-${sessionKey}`}
            ref={googlePeopleRef}
            onStateChange={handleStateChange}
            isActive={selectedType === 'google_people'}
            connectorType="google_people"
          />
          <CustomSection
            key={`custom-${sessionKey}`}
            ref={customRef}
            onStateChange={handleStateChange}
            isActive={selectedType === 'custom'}
          />
        </div>

        {/* --- Error --- */}
        {error ? (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {/* --- Footer --- */}
        <div className="flex justify-end gap-2 pt-2">
          {modalStep === 'configure' ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={handleBack}
                disabled={isSaving}
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={isSaving || !activeRef.current?.isComplete()}
              >
                {isSaving ? 'Saving...' : 'Save connector'}
              </Button>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
