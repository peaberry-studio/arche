'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { OllamaPublicDetails } from '@/lib/providers/ollama'

export type OllamaCredentialFormState = {
  baseUrl: string
  mode: 'local' | 'remote'
  token: string
}

export const DEFAULT_OLLAMA_CREDENTIAL_FORM: OllamaCredentialFormState = {
  baseUrl: '',
  mode: 'local',
  token: '',
}

export function getOllamaCredentialForm(
  forms: Record<string, OllamaCredentialFormState>,
  providerId: string,
): OllamaCredentialFormState {
  return forms[providerId] ?? DEFAULT_OLLAMA_CREDENTIAL_FORM
}

export function updateOllamaCredentialForms(
  forms: Record<string, OllamaCredentialFormState>,
  providerId: string,
  patch: Partial<OllamaCredentialFormState>,
): Record<string, OllamaCredentialFormState> {
  return {
    ...forms,
    [providerId]: { ...DEFAULT_OLLAMA_CREDENTIAL_FORM, ...forms[providerId], ...patch },
  }
}

export function resetOllamaCredentialForm(
  forms: Record<string, OllamaCredentialFormState>,
  providerId: string,
): Record<string, OllamaCredentialFormState> {
  return { ...forms, [providerId]: DEFAULT_OLLAMA_CREDENTIAL_FORM }
}

export function canSaveOllamaCredential(form: OllamaCredentialFormState): boolean {
  return form.mode === 'local' || (Boolean(form.baseUrl.trim()) && Boolean(form.token.trim()))
}

export function buildOllamaCredentialSaveBody(form: OllamaCredentialFormState): Record<string, string> {
  if (form.mode === 'local') {
    const baseUrl = form.baseUrl.trim()
    return baseUrl ? { baseUrl, mode: 'local' } : { mode: 'local' }
  }

  return {
    baseUrl: form.baseUrl.trim(),
    mode: 'remote',
    token: form.token.trim(),
  }
}

type OllamaCredentialDetailsProps = {
  details?: OllamaPublicDetails
}

export function OllamaCredentialDetails({ details }: OllamaCredentialDetailsProps) {
  if (!details) return null

  const modeLabel = details.mode === 'local' ? 'Local' : 'Remote'
  const modelLabels = details.models.map((model) => model.name || model.id)

  return (
    <div className="mt-1 space-y-1 text-xs text-muted-foreground">
      <p>{details.baseUrl ? `${modeLabel}: ${details.baseUrl}` : modeLabel}</p>
      <p>
        {modelLabels.length} model{modelLabels.length === 1 ? '' : 's'} discovered
        {modelLabels.length > 0 ? `: ${modelLabels.slice(0, 4).join(', ')}` : ''}
      </p>
    </div>
  )
}

type OllamaCredentialFormProps = {
  actionLabel: string
  form: OllamaCredentialFormState
  isBusy: boolean
  onChange: (patch: Partial<OllamaCredentialFormState>) => void
  onSave: () => void
}

export function OllamaCredentialForm({
  actionLabel,
  form,
  isBusy,
  onChange,
  onSave,
}: OllamaCredentialFormProps) {
  const canSave = canSaveOllamaCredential(form)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={form.mode === 'local' ? 'default' : 'outline'}
          disabled={isBusy}
          onClick={() => onChange({ mode: 'local' })}
        >
          Local
        </Button>
        <Button
          type="button"
          size="sm"
          variant={form.mode === 'remote' ? 'default' : 'outline'}
          disabled={isBusy}
          onClick={() => onChange({ mode: 'remote' })}
        >
          Remote
        </Button>
      </div>

      {form.mode === 'local' ? (
        <div className="space-y-2">
          <Input
            value={form.baseUrl}
            onChange={(event) => onChange({ baseUrl: event.target.value })}
            placeholder="Optional local URL, auto-detect if blank"
          />
          <p className="text-xs text-muted-foreground">Detects Ollama from the Arche server and saves only when models can be listed.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={form.baseUrl}
            onChange={(event) => onChange({ baseUrl: event.target.value })}
            placeholder="https://ollama.example.com/v1"
          />
          <Input
            type="password"
            value={form.token}
            onChange={(event) => onChange({ token: event.target.value })}
            placeholder="Bearer token"
          />
        </div>
      )}

      <Button
        type="button"
        size="sm"
        disabled={isBusy || !canSave}
        onClick={onSave}
      >
        {isBusy ? 'Saving...' : form.mode === 'local' ? 'Detect Ollama' : actionLabel}
      </Button>
    </div>
  )
}
