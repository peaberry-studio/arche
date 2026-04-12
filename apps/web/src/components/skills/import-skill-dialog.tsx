'use client'

import { useMemo, useRef, useState } from 'react'
import { SpinnerGap, UploadSimple } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { notifyWorkspaceConfigChanged } from '@/lib/runtime/config-status-events'
import { cn } from '@/lib/utils'

type AgentOption = {
  displayName: string
  id: string
  isPrimary: boolean
}

type ImportSkillDialogProps = {
  agents: AgentOption[]
  expectedHash?: string | null
  onImported: () => void | Promise<void>
  open: boolean
  onOpenChange: (open: boolean) => void
  slug: string
}

export function ImportSkillDialog({
  slug,
  open,
  onOpenChange,
  agents,
  expectedHash,
  onImported,
}: ImportSkillDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [assignedAgentIds, setAssignedAgentIds] = useState<string[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const sortedAgents = useMemo(
    () => [...agents].sort((left, right) => {
      if (left.isPrimary && !right.isPrimary) return -1
      if (!left.isPrimary && right.isPrimary) return 1
      return left.displayName.localeCompare(right.displayName)
    }),
    [agents]
  )

  function resetDialog() {
    setSelectedFile(null)
    setAssignedAgentIds([])
    setImportError(null)
    setIsImporting(false)
  }

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
    if (!nextOpen) {
      resetDialog()
    }
  }

  function toggleAssignedAgent(agentId: string) {
    setAssignedAgentIds((current) =>
      current.includes(agentId)
        ? current.filter((entry) => entry !== agentId)
        : [...current, agentId]
    )
  }

  async function handleImport() {
    if (!selectedFile || isImporting) {
      return
    }

    setIsImporting(true)
    setImportError(null)

    try {
      const formData = new FormData()
      formData.set('file', selectedFile)
      formData.set('assignedAgentIds', JSON.stringify(assignedAgentIds))
      if (typeof expectedHash === 'string' && expectedHash) {
        formData.set('expectedHash', expectedHash)
      }

      const response = await fetch(`/api/u/${slug}/skills/import`, {
        method: 'POST',
        body: formData,
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        setImportError(data?.error ?? 'import_failed')
        return
      }

      notifyWorkspaceConfigChanged()
      await onImported()
      handleOpenChange(false)
    } catch {
      setImportError('network_error')
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import skill</DialogTitle>
          <DialogDescription>
            Upload a `.zip` bundle with a `SKILL.md` file. If the skill already exists, the import replaces it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-2">
            <Label>Archive</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'flex w-full items-center justify-between rounded-xl border border-dashed px-4 py-4 text-left transition-colors',
                selectedFile
                  ? 'border-primary/40 bg-primary/5 text-foreground'
                  : 'border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70'
              )}
            >
              <div>
                <p className="text-sm font-medium">{selectedFile?.name ?? 'Choose a skill archive'}</p>
                <p className="text-xs text-muted-foreground">
                  {selectedFile ? `${Math.ceil(selectedFile.size / 1024)} KB` : 'ZIP bundles only'}
                </p>
              </div>
              <UploadSimple size={18} weight="bold" />
            </button>
          </div>

          <div className="space-y-3">
            <Label>Assigned agents</Label>
            <div className="grid gap-2 md:grid-cols-2">
              {sortedAgents.map((agent) => {
                const checked = assignedAgentIds.includes(agent.id)
                return (
                  <label
                    key={agent.id}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                      checked
                        ? 'border-primary/40 bg-primary/5 text-foreground'
                        : 'border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAssignedAgent(agent.id)}
                      className="h-4 w-4 rounded border border-border/70 bg-card/70 accent-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    />
                    <span className="font-medium">{agent.displayName}</span>
                    {agent.isPrimary ? <span className="text-xs">(Primary)</span> : null}
                  </label>
                )
              })}
            </div>
          </div>

          {importError ? (
            <div className="rounded-lg border border-border/60 bg-card/50 p-4 text-sm text-destructive">
              Error: {importError}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleImport()} disabled={!selectedFile || isImporting}>
            {isImporting ? <SpinnerGap size={16} className="animate-spin" /> : null}
            {isImporting ? 'Importing...' : 'Import skill'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
