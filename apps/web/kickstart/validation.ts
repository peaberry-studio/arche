import {
  KICKSTART_AGENT_BY_ID,
  getKickstartAgentById,
} from '@/kickstart/agents/catalog'
import { hasOnlyAllowedKeys, isRecord } from '@/kickstart/parse-utils'
import { getRequiredAgentIdsForTemplate } from '@/kickstart/required-agent-ids'
import { getKickstartTemplateById } from '@/kickstart/templates'
import type {
  KickstartNormalizedAgentSelection,
  KickstartNormalizedApplyInput,
} from '@/kickstart/types'

const TOP_LEVEL_KEYS = new Set([
  'companyName',
  'companyDescription',
  'templateId',
  'agents',
])

const AGENT_KEYS = new Set(['id', 'model', 'prompt', 'temperature'])

const MAX_COMPANY_NAME_LENGTH = 120
const MAX_COMPANY_DESCRIPTION_LENGTH = 400
const MAX_MODEL_LENGTH = 120
const MAX_PROMPT_LENGTH = 20000

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string }

export type KickstartPayloadValidationResult =
  | { ok: true; input: KickstartNormalizedApplyInput }
  | { ok: false; error: 'invalid_payload'; message: string }

function parseRequiredString(
  value: unknown,
  fieldName: string,
  maxLength: number
): ValidationResult<string> {
  if (typeof value !== 'string') {
    return { ok: false, message: `${fieldName} must be a string` }
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return { ok: false, message: `${fieldName} is required` }
  }

  if (trimmed.length > maxLength) {
    return {
      ok: false,
      message: `${fieldName} exceeds ${maxLength} characters`,
    }
  }

  return { ok: true, value: trimmed }
}

function parseOptionalModel(value: unknown): ValidationResult<string | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined }
  }

  if (typeof value !== 'string') {
    return { ok: false, message: 'agent model must be a string' }
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return { ok: false, message: 'agent model must not be empty' }
  }

  if (trimmed.length > MAX_MODEL_LENGTH) {
    return {
      ok: false,
      message: `agent model exceeds ${MAX_MODEL_LENGTH} characters`,
    }
  }

  return { ok: true, value: trimmed }
}

function parseOptionalPrompt(value: unknown): ValidationResult<string | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined }
  }

  if (typeof value !== 'string') {
    return { ok: false, message: 'agent prompt must be a string' }
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return { ok: false, message: 'agent prompt must not be empty' }
  }

  if (trimmed.length > MAX_PROMPT_LENGTH) {
    return {
      ok: false,
      message: `agent prompt exceeds ${MAX_PROMPT_LENGTH} characters`,
    }
  }

  return { ok: true, value: trimmed }
}

function parseOptionalTemperature(value: unknown): ValidationResult<number | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined }
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, message: 'agent temperature must be a number' }
  }

  if (value < 0 || value > 2) {
    return { ok: false, message: 'agent temperature must be between 0 and 2' }
  }

  return { ok: true, value }
}

function parseAgents(
  value: unknown,
  templateId: string
): ValidationResult<KickstartNormalizedAgentSelection[]> {
  if (!Array.isArray(value)) {
    return { ok: false, message: 'agents must be an array' }
  }

  if (value.length === 0) {
    return { ok: false, message: 'at least one agent must be selected' }
  }

  if (value.length > KICKSTART_AGENT_BY_ID.size) {
    return { ok: false, message: 'too many selected agents' }
  }

  const seen = new Set<string>()
  const selections: KickstartNormalizedAgentSelection[] = []

  for (const item of value) {
    if (!isRecord(item)) {
      return { ok: false, message: 'agent entry must be an object' }
    }

    if (!hasOnlyAllowedKeys(item, AGENT_KEYS)) {
      return { ok: false, message: 'agent entry has unsupported fields' }
    }

    const parsedId = parseRequiredString(item.id, 'agent id', 80)
    if (!parsedId.ok) {
      return parsedId
    }

    if (!getKickstartAgentById(parsedId.value)) {
      return { ok: false, message: `unknown agent id: ${parsedId.value}` }
    }

    if (seen.has(parsedId.value)) {
      return { ok: false, message: `duplicate agent id: ${parsedId.value}` }
    }
    seen.add(parsedId.value)

    const parsedModel = parseOptionalModel(item.model)
    if (!parsedModel.ok) return parsedModel

    const parsedPrompt = parseOptionalPrompt(item.prompt)
    if (!parsedPrompt.ok) return parsedPrompt

    const parsedTemperature = parseOptionalTemperature(item.temperature)
    if (!parsedTemperature.ok) return parsedTemperature

    selections.push({
      id: parsedId.value,
      modelOverride: parsedModel.value,
      promptOverride: parsedPrompt.value,
      temperatureOverride: parsedTemperature.value,
    })
  }

  for (const requiredId of getRequiredAgentIdsForTemplate(templateId)) {
    if (!seen.has(requiredId)) {
      return {
        ok: false,
        message: `required agent missing: ${requiredId}`,
      }
    }
  }

  return { ok: true, value: selections }
}

export function parseKickstartApplyPayload(
  payload: unknown
): KickstartPayloadValidationResult {
  if (!isRecord(payload)) {
    return { ok: false, error: 'invalid_payload', message: 'payload must be an object' }
  }

  if (!hasOnlyAllowedKeys(payload, TOP_LEVEL_KEYS)) {
    return {
      ok: false,
      error: 'invalid_payload',
      message: 'payload has unsupported fields',
    }
  }

  const parsedCompanyName = parseRequiredString(
    payload.companyName,
    'companyName',
    MAX_COMPANY_NAME_LENGTH
  )
  if (!parsedCompanyName.ok) {
    return { ok: false, error: 'invalid_payload', message: parsedCompanyName.message }
  }

  const parsedCompanyDescription = parseRequiredString(
    payload.companyDescription,
    'companyDescription',
    MAX_COMPANY_DESCRIPTION_LENGTH
  )
  if (!parsedCompanyDescription.ok) {
    return {
      ok: false,
      error: 'invalid_payload',
      message: parsedCompanyDescription.message,
    }
  }

  const parsedTemplateId = parseRequiredString(payload.templateId, 'templateId', 80)
  if (!parsedTemplateId.ok) {
    return { ok: false, error: 'invalid_payload', message: parsedTemplateId.message }
  }

  const template = getKickstartTemplateById(parsedTemplateId.value)
  if (!template) {
    return {
      ok: false,
      error: 'invalid_payload',
      message: `unknown template id: ${parsedTemplateId.value}`,
    }
  }

  const parsedAgents = parseAgents(payload.agents, template.id)
  if (!parsedAgents.ok) {
    return { ok: false, error: 'invalid_payload', message: parsedAgents.message }
  }

  return {
    ok: true,
    input: {
      context: {
        companyName: parsedCompanyName.value,
        companyDescription: parsedCompanyDescription.value,
      },
      template,
      agents: parsedAgents.value,
    },
  }
}
