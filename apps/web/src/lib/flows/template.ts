import type { FlowRunStepRecord } from '@/lib/services/flow'

type FlowTemplateContext = {
  flow: {
    name: string
  }
  humanResponses: Map<string, string>
  previousOutput: string | null
  run: {
    id: string
  }
  stepOutputs: Map<string, string>
}

export type FlowTemplateResult =
  | { ok: true; value: string }
  | { ok: false; error: string }

const VARIABLE_PATTERN = /{{\s*([a-zA-Z0-9_.-]+)\s*}}/g

function getVariableValue(variable: string, context: FlowTemplateContext): string | null {
  if (variable === 'previous.output') {
    return context.previousOutput
  }

  if (variable === 'flow.name') {
    return context.flow.name
  }

  if (variable === 'run.id') {
    return context.run.id
  }

  const stepMatch = /^steps\.([a-zA-Z0-9_-]+)\.output$/.exec(variable)
  if (stepMatch) {
    return context.stepOutputs.get(stepMatch[1]) ?? null
  }

  const humanMatch = /^human\.([a-zA-Z0-9_-]+)\.response$/.exec(variable)
  if (humanMatch) {
    return context.humanResponses.get(humanMatch[1]) ?? null
  }

  return null
}

export function renderFlowTemplate(template: string, context: FlowTemplateContext): FlowTemplateResult {
  let error: string | null = null
  const value = template.replace(VARIABLE_PATTERN, (_match, variable: string) => {
    const replacement = getVariableValue(variable, context)
    if (replacement === null) {
      error = `unknown_template_variable:${variable}`
      return ''
    }

    return replacement
  })

  if (error) {
    return { ok: false, error }
  }

  return { ok: true, value }
}

export function buildFlowTemplateContext(params: {
  flowName: string
  previousOutput: string | null
  runId: string
  steps: FlowRunStepRecord[]
}): FlowTemplateContext {
  const stepOutputs = new Map<string, string>()
  const humanResponses = new Map<string, string>()

  for (const step of params.steps) {
    const output = step.compactedOutput ?? step.rawOutput
    if (output) {
      stepOutputs.set(step.nodeId, output)
    }
    if (step.humanResponse) {
      humanResponses.set(step.nodeId, step.humanResponse)
    }
  }

  return {
    flow: { name: params.flowName },
    humanResponses,
    previousOutput: params.previousOutput,
    run: { id: params.runId },
    stepOutputs,
  }
}

export function validateFlowTemplateVariables(template: string, nodeIds: ReadonlySet<string>): FlowTemplateResult {
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const variable = match[1]
    if (variable === 'previous.output' || variable === 'flow.name' || variable === 'run.id') {
      continue
    }

    const stepMatch = /^steps\.([a-zA-Z0-9_-]+)\.output$/.exec(variable)
    if (stepMatch && nodeIds.has(stepMatch[1])) {
      continue
    }

    const humanMatch = /^human\.([a-zA-Z0-9_-]+)\.response$/.exec(variable)
    if (humanMatch && nodeIds.has(humanMatch[1])) {
      continue
    }

    return { ok: false, error: `unknown_template_variable:${variable}` }
  }

  return { ok: true, value: template }
}
