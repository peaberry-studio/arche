'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { MagnifyingGlass } from '@phosphor-icons/react'

import { ConnectorTypeIcon } from '@/components/connectors/connector-type-icon'
import type { ConnectorType } from '@/lib/connectors/types'

type TypeOption = {
  type: ConnectorType
  label: string
  description: string
}

type TypeSelectorStepProps = {
  availableTypeOptions: TypeOption[]
  isActive: boolean
  onSelectType: (type: ConnectorType) => void
}

export function TypeSelectorStep({
  availableTypeOptions,
  isActive,
  onSelectType,
}: TypeSelectorStepProps) {
  const [searchQuery, setSearchQuery] = useState('')

  if (!isActive) return null

  const query = searchQuery.trim().toLowerCase()
  const filtered = query
    ? availableTypeOptions.filter(
        (option) =>
          option.label.toLowerCase().includes(query) ||
          option.description.toLowerCase().includes(query) ||
          option.type.toLowerCase().includes(query)
      )
    : availableTypeOptions

  return (
    <div className="space-y-4">
      {/* Search */}
      <label className="flex items-center gap-2 rounded-xl bg-foreground/[0.03] px-3 py-2 transition-colors hover:bg-foreground/5 focus-within:bg-foreground/5">
        <MagnifyingGlass
          size={14}
          className="shrink-0 text-muted-foreground/50"
        />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search connectors..."
          aria-label="Search connectors"
          className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/40"
        />
      </label>

      {/* Grid */}
      <div className="grid gap-3 sm:grid-cols-2">
        {filtered.map((option) => (
          <button
            key={option.type}
            type="button"
            onClick={() => onSelectType(option.type)}
            className="relative rounded-xl border border-border/50 px-4 py-3 text-left transition-all hover:border-border hover:bg-accent/50"
          >
            <span className="absolute right-3 top-3 text-muted-foreground/60">
              <Plus className="h-4 w-4" />
            </span>
            <div className="flex items-center gap-2">
              <ConnectorTypeIcon
                type={option.type}
                className="h-4 w-4 text-muted-foreground"
              />
              <span className="text-sm font-medium text-foreground">
                {option.label}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {option.description}
            </p>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          No connectors match your search.
        </p>
      ) : null}

      {availableTypeOptions.length === 1 &&
      availableTypeOptions[0]?.type === 'custom' ? (
        <p className="text-xs text-muted-foreground">
          The single-instance connectors are already configured.
        </p>
      ) : null}
    </div>
  )
}
