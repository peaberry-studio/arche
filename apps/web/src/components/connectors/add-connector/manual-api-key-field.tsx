'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type ManualApiKeyFieldProps = {
  id: string
  label?: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  helperText?: string
}

export function ManualApiKeyField({
  id,
  label = 'API Key',
  placeholder = 'Paste your API key',
  value,
  onChange,
  helperText,
}: ManualApiKeyFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      {helperText ? (
        <p className="text-xs text-muted-foreground">{helperText}</p>
      ) : null}
    </div>
  )
}
