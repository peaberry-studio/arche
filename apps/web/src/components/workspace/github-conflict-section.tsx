'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Warning } from '@phosphor-icons/react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ConflictData = {
  path: string
  ours: string
  theirs: string
  working: string
}

type GitHubConflictSectionProps = {
  slug: string
  mergePending?: boolean
  conflictFiles: string[]
  onFileResolved: (path: string) => void
  onMergeFinalized: () => void
  onMergeAborted: () => void
}

export function GitHubConflictSection({
  slug,
  mergePending = false,
  conflictFiles,
  onFileResolved,
  onMergeFinalized,
  onMergeAborted,
}: GitHubConflictSectionProps) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null)
  const [resolvedFiles, setResolvedFiles] = useState<Set<string>>(new Set())
  const [conflictData, setConflictData] = useState<Record<string, ConflictData>>({})
  const [editedContent, setEditedContent] = useState<Record<string, string>>({})
  const [loadingFile, setLoadingFile] = useState<string | null>(null)
  const [savingFile, setSavingFile] = useState<string | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [aborting, setAborting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autoOpenedConflictRef = useRef<string | null>(null)

  const allResolved = mergePending && (
    conflictFiles.length === 0 || conflictFiles.every((file) => resolvedFiles.has(file))
  )

  const firstUnresolvedFile = useMemo(
    () => conflictFiles.find((file) => !resolvedFiles.has(file)) ?? null,
    [conflictFiles, resolvedFiles],
  )

  const loadConflictDetail = useCallback(async (path: string) => {
    setLoadingFile(path)
    setError(null)

    try {
      const res = await fetch(
        `/api/u/${slug}/kb-github-remote/conflicts/resolve?path=${encodeURIComponent(path)}`,
        { cache: 'no-store' },
      )
      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.path) {
        setError(data?.error ?? 'Failed to load conflict details')
        setLoadingFile(null)
        return
      }

      const detail: ConflictData = {
        path: data.path,
        ours: data.ours ?? '',
        theirs: data.theirs ?? '',
        working: data.working ?? '',
      }
      setConflictData((prev) => ({ ...prev, [path]: detail }))
      setEditedContent((prev) => ({ ...prev, [path]: detail.working }))
    } catch {
      setError('Could not reach the server.')
    } finally {
      setLoadingFile(null)
    }
  }, [slug])

  const handleExpand = useCallback((path: string) => {
    if (expandedFile === path) {
      setExpandedFile(null)
      return
    }
    setExpandedFile(path)
    if (!conflictData[path]) {
      void loadConflictDetail(path)
    }
  }, [expandedFile, conflictData, loadConflictDetail])

  useEffect(() => {
    if (!firstUnresolvedFile || expandedFile || autoOpenedConflictRef.current === firstUnresolvedFile) {
      return
    }

    autoOpenedConflictRef.current = firstUnresolvedFile
    setExpandedFile(firstUnresolvedFile)
    if (!conflictData[firstUnresolvedFile]) {
      void loadConflictDetail(firstUnresolvedFile)
    }
  }, [conflictData, expandedFile, firstUnresolvedFile, loadConflictDetail])

  const handleKeepLocal = useCallback((path: string) => {
    const data = conflictData[path]
    if (data) setEditedContent((prev) => ({ ...prev, [path]: data.ours }))
  }, [conflictData])

  const handleKeepRemote = useCallback((path: string) => {
    const data = conflictData[path]
    if (data) setEditedContent((prev) => ({ ...prev, [path]: data.theirs }))
  }, [conflictData])

  const handleMarkResolved = useCallback(async (path: string) => {
    setSavingFile(path)
    setError(null)

    try {
      const res = await fetch(`/api/u/${slug}/kb-github-remote/conflicts/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path,
          strategy: 'ours',
          content: editedContent[path],
        }),
      })
      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Failed to resolve conflict')
        return
      }

      setResolvedFiles((prev) => new Set(prev).add(path))
      setExpandedFile(null)
      onFileResolved(path)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setSavingFile(null)
    }
  }, [slug, editedContent, onFileResolved])

  const handleFinalize = useCallback(async () => {
    setFinalizing(true)
    setError(null)

    try {
      const res = await fetch(`/api/u/${slug}/kb-github-remote/conflicts/finalize`, {
        method: 'POST',
      })
      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Failed to finalize merge')
        return
      }

      onMergeFinalized()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setFinalizing(false)
    }
  }, [slug, onMergeFinalized])

  const handleAbort = useCallback(async () => {
    setAborting(true)
    setError(null)

    try {
      const res = await fetch(`/api/u/${slug}/kb-github-remote/conflicts`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Failed to abort merge')
        return
      }

      onMergeAborted()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setAborting(false)
    }
  }, [slug, onMergeAborted])

  const isBusy = loadingFile !== null || savingFile !== null || finalizing || aborting

  return (
    <div className="space-y-2">
      <div className="rounded-md border-[0.5px] border-amber-500/25 bg-amber-500/5 p-2.5">
        <div className="flex items-center gap-2 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          <Warning size={14} weight="bold" className="shrink-0" />
          <span>
            {conflictFiles.length > 0
              ? `GitHub sync conflicts in ${conflictFiles.length} file${conflictFiles.length !== 1 ? 's' : ''}`
              : 'GitHub sync merge ready to finalize'}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {conflictFiles.length > 0
            ? 'Resolve each file, then finalize the merge.'
            : 'All conflicted files are resolved. Finalize the merge to update the knowledge base.'}
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-500">
          {error}
        </div>
      ) : null}

      {conflictFiles.length > 0 ? (
        <div className="space-y-1.5">
          {conflictFiles.map((file) => {
            const isResolved = resolvedFiles.has(file)
            const isExpanded = expandedFile === file
            const data = conflictData[file]
            const isLoading = loadingFile === file
            const isSaving = savingFile === file

            return (
              <div
                key={file}
                className={cn(
                  'overflow-hidden rounded-md border-[0.5px] border-border/20 bg-foreground/[0.015]',
                  isExpanded && 'border-amber-500/30',
                )}
              >
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <span
                    className="flex-1 truncate text-xs font-medium text-foreground font-mono"
                    title={file}
                  >
                    {file}
                  </span>
                  {isResolved ? (
                    <Badge variant="success" className="px-2 py-0 text-[10px]">
                      Resolved
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2 text-[11px]"
                      onClick={() => handleExpand(file)}
                      disabled={isBusy}
                    >
                      {isExpanded ? 'Collapse' : 'Resolve'}
                    </Button>
                  )}
                </div>

                {isExpanded && !isResolved ? (
                  <div className="border-t border-border/20 px-2 pb-2 pt-1.5 space-y-2">
                    {isLoading ? (
                      <div className="py-4 text-center text-[11px] text-muted-foreground">
                        Loading conflict data…
                      </div>
                    ) : data ? (
                      <>
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => handleKeepLocal(file)}
                            disabled={isBusy}
                          >
                            Keep Local
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => handleKeepRemote(file)}
                            disabled={isBusy}
                          >
                            Keep Remote
                          </Button>
                        </div>
                        <textarea
                          value={editedContent[file] ?? ''}
                          onChange={(e) =>
                            setEditedContent((prev) => ({
                              ...prev,
                              [file]: e.target.value,
                            }))
                          }
                          className={cn(
                            'min-h-[200px] w-full resize-y rounded-md border border-border/40 bg-background px-2.5 py-2',
                            'text-[11px] font-mono leading-relaxed text-foreground',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
                          )}
                          disabled={isBusy}
                        />
                        <Button
                          size="sm"
                          className="h-7 px-3 text-[11px]"
                          onClick={() => void handleMarkResolved(file)}
                          disabled={isBusy}
                        >
                          {isSaving ? 'Resolving…' : 'Mark Resolved'}
                        </Button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          className="h-7 px-3 text-[11px]"
          disabled={!allResolved || isBusy}
          onClick={() => void handleFinalize()}
        >
          {finalizing ? 'Finalizing…' : 'Finalize Merge'}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="h-7 px-3 text-[11px]"
          disabled={isBusy}
          onClick={() => void handleAbort()}
        >
          {aborting ? 'Aborting…' : 'Abort Merge'}
        </Button>
      </div>
    </div>
  )
}
