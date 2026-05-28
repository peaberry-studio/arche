'use client'

import { useRef, type ChangeEvent } from 'react'
import { SpinnerGap, UploadSimple } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import type { FlowTemplateImportWarning } from '@/lib/flows/import-export'

type FlowImportTemplatePanelProps = {
  importWarnings: FlowTemplateImportWarning[]
  isImporting: boolean
  onImportError: (error: string) => void
  onImportTemplate: (template: unknown) => Promise<void> | void
}

export function FlowImportTemplatePanel({
  importWarnings,
  isImporting,
  onImportError,
  onImportTemplate,
}: FlowImportTemplatePanelProps) {
  const importInputRef = useRef<HTMLInputElement | null>(null)

  async function importTemplateFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      onImportError('invalid_json')
      return
    }

    await onImportTemplate(parsed)
  }

  return (
    <>
      <section className="rounded-xl border border-border/60 bg-card/40 p-5">
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => void importTemplateFile(event)}
        />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Import template</h2>
            <p className="text-xs text-muted-foreground">Load a flow JSON template as an unsaved draft, then review it before creating.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => importInputRef.current?.click()}
            disabled={isImporting}
          >
            {isImporting ? <SpinnerGap size={14} className="mr-1.5 animate-spin" /> : <UploadSimple size={14} className="mr-1.5" />}
            {isImporting ? 'Importing...' : 'Import template'}
          </Button>
        </div>
      </section>

      {importWarnings.length > 0 ? (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-800 dark:text-amber-200">
          <h2 className="text-sm font-semibold">Review imported template</h2>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {importWarnings.map((warning, index) => (
              <li key={`${warning.code}-${warning.nodeId ?? warning.value ?? index}`}>{warning.message}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}
