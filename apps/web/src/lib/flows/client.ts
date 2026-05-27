import type { FlowTemplate, FlowTemplateImportWarning } from '@/lib/flows/import-export'
import type { FlowDetail, FlowListItem, FlowPayload, FlowRunListItem } from '@/lib/flows/types'

export type FlowClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

async function readFlowJson<T>(response: Response): Promise<FlowClientResult<T>> {
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok) {
    return { ok: false, error: data?.error ?? 'request_failed' }
  }

  if (!data) {
    return { ok: false, error: 'invalid_response' }
  }

  return { ok: true, data }
}

function ensureFlowList(data: { flows?: FlowListItem[] }): FlowClientResult<{ flows: FlowListItem[] }> {
  return Array.isArray(data.flows)
    ? { ok: true, data: { flows: data.flows } }
    : { ok: false, error: 'invalid_response' }
}

function ensureFlowDetail(data: { flow?: FlowDetail }): FlowClientResult<{ flow: FlowDetail }> {
  return data.flow
    ? { ok: true, data: { flow: data.flow } }
    : { ok: false, error: 'invalid_response' }
}

function ensureFlowImportValidation(data: {
  draftPayload?: FlowPayload
  template?: FlowTemplate
  warnings?: FlowTemplateImportWarning[]
}): FlowClientResult<{ draftPayload: FlowPayload; template: FlowTemplate; warnings: FlowTemplateImportWarning[] }> {
  return data.draftPayload && data.template && Array.isArray(data.warnings)
    ? { ok: true, data: { draftPayload: data.draftPayload, template: data.template, warnings: data.warnings } }
    : { ok: false, error: 'invalid_response' }
}

function ensureFlowRunDetail(data: { run?: FlowRunListItem }): FlowClientResult<{ run: FlowRunListItem }> {
  return data.run
    ? { ok: true, data: { run: data.run } }
    : { ok: false, error: 'invalid_response' }
}

function ensureOk(data: { ok?: boolean }): FlowClientResult<{ ok: true }> {
  return data.ok === true
    ? { ok: true, data: { ok: true } }
    : { ok: false, error: 'invalid_response' }
}

export async function fetchFlowList(slug: string): Promise<FlowClientResult<{ flows: FlowListItem[] }>> {
  const result = await readFlowJson<{ flows?: FlowListItem[] }>(await fetch(`/api/u/${slug}/flows`, { cache: 'no-store' }))
  return result.ok ? ensureFlowList(result.data) : result
}

export async function fetchFlowDetail(slug: string, flowId: string): Promise<FlowClientResult<{ flow: FlowDetail }>> {
  const result = await readFlowJson<{ flow?: FlowDetail }>(await fetch(`/api/u/${slug}/flows/${flowId}`, { cache: 'no-store' }))
  return result.ok ? ensureFlowDetail(result.data) : result
}

export async function fetchFlowRunRequest(slug: string, runId: string): Promise<FlowClientResult<{ run: FlowRunListItem }>> {
  const result = await readFlowJson<{ run?: FlowRunListItem }>(await fetch(`/api/u/${slug}/flows/runs/${runId}`, { cache: 'no-store' }))
  return result.ok ? ensureFlowRunDetail(result.data) : result
}

export async function createFlowRequest(slug: string, payload: FlowPayload): Promise<FlowClientResult<{ flow: FlowDetail }>> {
  const result = await readFlowJson<{ flow?: FlowDetail }>(await fetch(`/api/u/${slug}/flows`, {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }))
  return result.ok ? ensureFlowDetail(result.data) : result
}

export async function validateFlowImportRequest(
  slug: string,
  template: unknown,
): Promise<FlowClientResult<{ draftPayload: FlowPayload; template: FlowTemplate; warnings: FlowTemplateImportWarning[] }>> {
  const result = await readFlowJson<{
    draftPayload?: FlowPayload
    template?: FlowTemplate
    warnings?: FlowTemplateImportWarning[]
  }>(await fetch(`/api/u/${slug}/flows/import/validate`, {
    body: JSON.stringify(template),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }))
  return result.ok ? ensureFlowImportValidation(result.data) : result
}

export async function updateFlowRequest(
  slug: string,
  flowId: string,
  payload: Partial<FlowPayload>,
): Promise<FlowClientResult<{ flow: FlowDetail }>> {
  const result = await readFlowJson<{ flow?: FlowDetail }>(await fetch(`/api/u/${slug}/flows/${flowId}`, {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
  }))
  return result.ok ? ensureFlowDetail(result.data) : result
}

export async function deleteFlowRequest(slug: string, flowId: string): Promise<FlowClientResult<{ ok: true }>> {
  const result = await readFlowJson<{ ok?: boolean }>(await fetch(`/api/u/${slug}/flows/${flowId}`, { method: 'DELETE' }))
  return result.ok ? ensureOk(result.data) : result
}

export async function runFlowRequest(slug: string, flowId: string): Promise<FlowClientResult<{ ok: true }>> {
  const result = await readFlowJson<{ ok?: boolean }>(await fetch(`/api/u/${slug}/flows/${flowId}/run`, { method: 'POST' }))
  return result.ok ? ensureOk(result.data) : result
}

export async function copyFlowRequest(slug: string, flowId: string): Promise<FlowClientResult<{ flow: FlowDetail }>> {
  const result = await readFlowJson<{ flow?: FlowDetail }>(await fetch(`/api/u/${slug}/flows/${flowId}/copy`, { method: 'POST' }))
  return result.ok ? ensureFlowDetail(result.data) : result
}

export async function cancelFlowRunRequest(slug: string, runId: string): Promise<FlowClientResult<{ ok: true }>> {
  const result = await readFlowJson<{ ok?: boolean }>(await fetch(`/api/u/${slug}/flows/runs/${runId}/cancel`, { method: 'POST' }))
  return result.ok ? ensureOk(result.data) : result
}

export async function submitHumanResponseRequest(
  slug: string,
  runId: string,
  response: string,
): Promise<FlowClientResult<{ ok: true }>> {
  const result = await readFlowJson<{ ok?: boolean }>(await fetch(`/api/u/${slug}/flows/runs/${runId}/human-response`, {
    body: JSON.stringify({ response }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }))
  return result.ok ? ensureOk(result.data) : result
}
