import { sanitizeVegaLiteSpec } from '@/lib/vega/sanitize-spec'

export type VegaLiteValidationResult =
  | { ok: true; warnings: string[]; inlineRows: number }
  | { ok: false; error: 'invalid_json' | 'rejected' | 'compile_error'; message: string; hint?: string }

const MAX_MESSAGE_CHARS = 600

function truncate(message: string): string {
  const trimmed = message.trim()
  return trimmed.length > MAX_MESSAGE_CHARS ? `${trimmed.slice(0, MAX_MESSAGE_CHARS)}…` : trimmed
}

/**
 * Compiles a spec the same way the viewer does, so an agent can check its work before
 * writing a chart into an article. The whole Vega-Lite grammar is accepted; this reports
 * genuine compile errors, not an Arche-specific subset.
 */
export async function validateVegaLiteSpec(rawSpec: string): Promise<VegaLiteValidationResult> {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawSpec)
  } catch (error) {
    return {
      ok: false,
      error: 'invalid_json',
      message: truncate(error instanceof Error ? error.message : String(error)),
      hint: 'The fenced block must contain a single raw JSON object.',
    }
  }

  const sanitized = sanitizeVegaLiteSpec(parsed)
  if (!sanitized) {
    return {
      ok: false,
      error: 'rejected',
      message: 'The spec is not a JSON object, or exceeds the 8 MB / 200k inline row / 64 nesting-level budget.',
      hint: 'Split large data across several figures or articles rather than downsampling.',
    }
  }

  const [vega, vegaLite] = await Promise.all([import('vega'), import('vega-lite')])

  const compileWarnings: string[] = []
  const logger = vega.logger(vega.Warn)
  logger.warn = (...args: unknown[]) => {
    compileWarnings.push(args.map((arg) => String(arg)).join(' '))
    return logger
  }

  try {
    vegaLite.compile(sanitized.spec as unknown as Parameters<typeof vegaLite.compile>[0], { logger })
  } catch (error) {
    return {
      ok: false,
      error: 'compile_error',
      message: truncate(error instanceof Error ? error.message : String(error)),
      hint: 'See https://vega.github.io/vega-lite/docs/ — the full grammar is supported, so this is a spec error rather than an unsupported feature.',
    }
  }

  return {
    ok: true,
    warnings: [...sanitized.warnings, ...compileWarnings.map(truncate)],
    inlineRows: sanitized.inlineRows,
  }
}
