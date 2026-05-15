'use client'

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'

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

type ConnectorSectionEntry = {
  node: ReactNode
  type: ConnectorType
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
  const [isActiveComplete, setIsActiveComplete] = useState(false)

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
  const activeType = availableTypeOptions.some((option) => option.type === selectedType)
    ? selectedType
    : availableTypeOptions[0]?.type ?? 'custom'
  const activeRef = sectionRefs[activeType]

  const handleStateChange = useCallback(() => {
    setIsActiveComplete(Boolean(activeRef.current?.isComplete()))
  }, [activeRef])

  function resetModalState() {
    setModalStep('select')
    setSelectedType(DEFAULT_TYPE)
    setIsSaving(false)
    setError(null)
    setIsActiveComplete(false)
    setSessionKey((key) => key + 1)
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetModalState()
    }
    onOpenChange(nextOpen)
  }

  function handleSelectType(type: ConnectorType) {
    setSelectedType(type)
    setIsActiveComplete(false)
    setError(null)
    setModalStep('configure')
  }

  function handleBack() {
    setModalStep('select')
    setError(null)
  }

  const connectorSections = [
    {
      type: 'linear',
      node: (
        <LinearSection
          key={`linear-${sessionKey}`}
          ref={linearRef}
          onStateChange={handleStateChange}
          isActive={activeType === 'linear'}
        />
      ),
    },
    {
      type: 'notion',
      node: (
        <NotionSection
          key={`notion-${sessionKey}`}
          ref={notionRef}
          onStateChange={handleStateChange}
          isActive={activeType === 'notion'}
        />
      ),
    },
    {
      type: 'zendesk',
      node: (
        <ZendeskSection
          key={`zendesk-${sessionKey}`}
          ref={zendeskRef}
          onStateChange={handleStateChange}
          isActive={activeType === 'zendesk'}
        />
      ),
    },
    {
      type: 'ahrefs',
      node: (
        <AhrefsSection
          key={`ahrefs-${sessionKey}`}
          ref={ahrefsRef}
          onStateChange={handleStateChange}
          isActive={activeType === 'ahrefs'}
        />
      ),
    },
    {
      type: 'umami',
      node: (
        <UmamiSection
          key={`umami-${sessionKey}`}
          ref={umamiRef}
          onStateChange={handleStateChange}
          isActive={activeType === 'umami'}
        />
      ),
    },
    {
      type: 'meta-ads',
      node: (
        <MetaAdsSection
          key={`meta-ads-${sessionKey}`}
          ref={metaAdsRef}
          onStateChange={handleStateChange}
          isActive={activeType === 'meta-ads'}
        />
      ),
    },
    {
      type: 'google_gmail',
      node: (
        <GoogleWorkspaceSection
          key={`google_gmail-${sessionKey}`}
          ref={googleGmailRef}
          onStateChange={handleStateChange}
          isActive={activeType === 'google_gmail'}
          connectorType="google_gmail"
        />
      ),
    },
    {
      type: 'google_drive',
      node: (
        <GoogleWorkspaceSection
          key={`google_drive-${sessionKey}`}
          ref={googleDriveRef}
          onStateChange={handleStateChange}
          isActive={activeType === 'google_drive'}
          connectorType="google_drive"
        />
      ),
    },
    {
      type: 'google_calendar',
      node: (
        <GoogleWorkspaceSection
          key={`google_calendar-${sessionKey}`}
          ref={googleCalendarRef}
          onStateChange={handleStateChange}
          isActive={activeType === 'google_calendar'}
          connectorType="google_calendar"
        />
      ),
    },
    {
      type: 'google_chat',
      node: (
        <GoogleWorkspaceSection
          key={`google_chat-${sessionKey}`}
          ref={googleChatRef}
          onStateChange={handleStateChange}
          isActive={activeType === 'google_chat'}
          connectorType="google_chat"
        />
      ),
    },
    {
      type: 'google_people',
      node: (
        <GoogleWorkspaceSection
          key={`google_people-${sessionKey}`}
          ref={googlePeopleRef}
          onStateChange={handleStateChange}
          isActive={activeType === 'google_people'}
          connectorType="google_people"
        />
      ),
    },
    {
      type: 'custom',
      node: (
        <CustomSection
          key={`custom-${sessionKey}`}
          ref={customRef}
          onStateChange={handleStateChange}
          isActive={activeType === 'custom'}
        />
      ),
    },
  ] satisfies ConnectorSectionEntry[]

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
          type: activeType,
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
      handleDialogOpenChange(false)
    } catch {
      setError(getConnectorErrorMessage(null, 'network_error'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
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
          {connectorSections.map((section) => section.node)}
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
                disabled={isSaving || !isActiveComplete}
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
