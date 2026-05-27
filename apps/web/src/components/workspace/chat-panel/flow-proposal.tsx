'use client'

import { GitBranch, SpinnerGap, WarningCircle } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import type { FlowTemplate } from '@/lib/flows/import-export'
import { storeFlowTemplateDraft } from '@/lib/flows/template-session'
import { isRecord } from '@/lib/records'

export type FlowProposalOutput = {
  template: FlowTemplate
  warnings: string[]
}

type FlowProposalCardProps = {
  isRunning: boolean
  proposal: FlowProposalOutput
  slug?: string
}

const FLOW_TEMPLATE_FORMAT = 'arche-flow-template/v1'

function isFlowTemplate(value: unknown): value is FlowTemplate {
  return (
    isRecord(value) &&
    value.format === FLOW_TEMPLATE_FORMAT &&
    typeof value.name === 'string' &&
    isRecord(value.definition) &&
    Array.isArray(value.definition.nodes) &&
    Array.isArray(value.definition.edges)
  )
}

function getWarningText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (isRecord(value) && typeof value.message === 'string' && value.message.trim()) return value.message.trim()
  return null
}

function readWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const warnings: string[] = []
  for (const warning of value) {
    const text = getWarningText(warning)
    if (text) warnings.push(text)
  }
  return warnings
}

function hasFailedValidation(value: Record<string, unknown>): boolean {
  if (value.ok === false) return true
  return isRecord(value.validation) && value.validation.ok === false
}

export function parseFlowProposalOutput(rawOutput?: string): FlowProposalOutput | null {
  const source = rawOutput?.trim()
  if (!source) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return null
  }

  if (!isRecord(parsed) || hasFailedValidation(parsed)) return null

  const template = isFlowTemplate(parsed.template) ? parsed.template : isFlowTemplate(parsed) ? parsed : null
  if (!template) return null

  return {
    template,
    warnings: readWarnings(parsed.warnings),
  }
}

export function FlowProposalCard({ isRunning, proposal, slug }: FlowProposalCardProps) {
  const { template, warnings } = proposal
  const scheduleLabel = template.enabled
    ? template.cronExpression
      ? `Scheduled in ${template.timezone}`
      : 'Enabled, schedule missing'
    : 'Manual only'

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-primary/20 bg-primary/5 text-sm shadow-sm">
      <div className="flex items-center gap-2 border-b border-primary/10 px-4 py-2.5">
        <GitBranch size={16} weight="fill" className="shrink-0 text-primary" />
        <span className="text-xs font-semibold tracking-wide text-primary uppercase">Flow proposal</span>
        {isRunning ? (
          <span className="chat-text-micro inline-flex items-center gap-1 text-muted-foreground">
            <SpinnerGap size={12} className="animate-spin" />
            Updating
          </span>
        ) : null}
      </div>

      <div className="space-y-3 px-4 py-3">
        <div>
          <p className="font-medium text-foreground">{template.name}</p>
          {template.description ? <p className="mt-1 text-xs text-muted-foreground">{template.description}</p> : null}
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-md bg-background/70 px-2 py-1">{template.definition.nodes.length} nodes</span>
          <span className="rounded-md bg-background/70 px-2 py-1">{template.definition.edges.length} edges</span>
          <span className="rounded-md bg-background/70 px-2 py-1">{scheduleLabel}</span>
        </div>

        {warnings.length > 0 ? (
          <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            {warnings.map((warning) => (
              <div key={warning} className="flex items-start gap-1.5">
                <WarningCircle size={12} weight="fill" className="mt-0.5 shrink-0" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        ) : null}

        {slug ? (
          <Button size="sm" asChild>
            <a
              href={`/u/${slug}/flows/new`}
              onClick={() => storeFlowTemplateDraft(template)}
            >
              Review &amp; create
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  )
}
