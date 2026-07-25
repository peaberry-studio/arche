import { getUrlScheme, isAbsoluteUri, isInlineImageUri } from '@/lib/vega-data-path'
import { isRecord } from '@/lib/records'

// Vega-Lite version shipped by the app. Every spec's `$schema` is rewritten to this
// value: combined with `mode: 'vega-lite'` at embed time it makes it impossible to
// smuggle a raw Vega spec, whose grammar is broader than anything Vega-Lite compiles to.
export const VEGA_LITE_SCHEMA = 'https://vega.github.io/schema/vega-lite/v6.json'

// The full Vega-Lite grammar is supported. These budgets are not a feature allowlist —
// they bound the work a single spec can demand. The security boundary is elsewhere:
// expressions run under vega-interpreter (no codegen, and prod CSP has no 'unsafe-eval'),
// remote data/images are blocked by CSP, `data.url` goes through a workspace-confined
// loader, and unsafe link schemes are stopped at click time by VegaFigure.
const MAX_SPEC_CHARS = 8 * 1024 * 1024
const MAX_SPEC_DEPTH = 64
const MAX_TOTAL_ROWS = 200_000
const MAX_REPEAT_VIEWS = 400
const MAX_COMPOSITION_BRANCHES = 1_000
const MAX_DIMENSION = 10_000
const MAX_GRATICULE_LINES = 10_000

const HREF_SCHEMES = new Set(['http', 'https', 'mailto'])

const WARN_LOADER = 'Removed a `loader` override; data loading is controlled by Arche.'
const WARN_EMBED_OPTIONS =
  'Removed `usermeta.embedOptions`; a chart cannot change how Arche embeds it.'
const WARN_HREF = 'Removed a link with an unsupported URL scheme.'
const WARN_URL =
  'Removed a remote `url`. Reference a workspace file by relative path or inline the data in `data.values`.'

export type ChartSpec = Record<string, unknown>

/** The single model every chart surface consumes: what to render, at what cost, minus what. */
export type SanitizedChart = {
  spec: ChartSpec
  warnings: string[]
  /** Total inline rows across every inline data source, used to pick a renderer. */
  inlineRows: number
  /**
   * Workspace-relative `data.url` values this spec will actually fetch. Collected during
   * the same walk that applies the URL policy, so callers never have to re-derive them by
   * guessing at key names — which would also sweep up `url` columns inside opaque rows.
   */
  dataUrls: string[]
}

type UrlPolicy = 'href' | 'resource'

type WalkContext = {
  warnings: Set<string>
  rows: number
  depthExceeded: boolean
  dataUrls: Set<string>
}

type ComplexityContext = {
  compositionBranches: number
  exceeded: boolean
}

function repeatViewCount(value: unknown): number {
  if (Array.isArray(value)) return Math.max(value.length, 1)
  if (!isRecord(value)) return 1

  let count = 1
  for (const key of ['row', 'column', 'layer']) {
    const entries = value[key]
    if (Array.isArray(entries)) count *= Math.max(entries.length, 1)
  }
  return count
}

function exceedsGraticuleBudget(value: unknown): boolean {
  if (!isRecord(value)) return false

  for (const key of ['step', 'stepMajor', 'stepMinor']) {
    const step = value[key]
    if (!Array.isArray(step) || step.length < 2) continue

    const [longitude, latitude] = step
    if (typeof longitude !== 'number' || typeof latitude !== 'number') continue
    if (longitude <= 0 || latitude <= 0) continue

    const lines = Math.ceil(360 / longitude) + Math.ceil(180 / latitude)
    if (lines > MAX_GRATICULE_LINES) return true
  }

  return false
}

/**
 * Vega-Lite composition can multiply a tiny input into thousands of views before row
 * budgets become relevant. This preflight bounds that syntactic expansion, dimensions,
 * and generated graticules without restricting which grammar features may be used.
 */
function inspectComplexity(
  value: unknown,
  repeatProduct: number,
  context: ComplexityContext,
): void {
  if (context.exceeded || !value || typeof value !== 'object') return

  if (Array.isArray(value)) {
    for (const entry of value) inspectComplexity(entry, repeatProduct, context)
    return
  }

  if (!isRecord(value)) return

  const localRepeatProduct = repeatProduct * repeatViewCount(value.repeat)
  if (localRepeatProduct > MAX_REPEAT_VIEWS) {
    context.exceeded = true
    return
  }

  for (const [key, entry] of Object.entries(value)) {
    // Inline rows and named datasets are opaque user data, not specification structure.
    if (key === 'values' || key === 'datasets') continue

    if (
      (key === 'width' || key === 'height') &&
      typeof entry === 'number' &&
      (!Number.isFinite(entry) || entry <= 0 || entry > MAX_DIMENSION)
    ) {
      context.exceeded = true
      return
    }

    if (key === 'graticule' && exceedsGraticuleBudget(entry)) {
      context.exceeded = true
      return
    }

    if (
      (key === 'layer' || key === 'concat' || key === 'hconcat' || key === 'vconcat') &&
      Array.isArray(entry)
    ) {
      context.compositionBranches += entry.length
      if (context.compositionBranches > MAX_COMPOSITION_BRANCHES) {
        context.exceeded = true
        return
      }
    }

    inspectComplexity(entry, localRepeatProduct, context)
  }
}

/**
 * Vega renders the `href` channel into an SVG anchor. This catches literal values; hrefs
 * produced by an expression only exist after render, so VegaFigure re-checks at click
 * time and that guard is the authoritative one.
 */
export function isSafeHref(value: string): boolean {
  const scheme = getUrlScheme(value)
  if (scheme === null) return true
  return HREF_SCHEMES.has(scheme)
}

/** `data.url`, the `image` mark and the `url` channel: workspace-relative or inline only. */
function isSafeResourceUrl(value: string): boolean {
  return !isAbsoluteUri(value) || isInlineImageUri(value)
}

/**
 * The guard every recursive step shares: the depth budget, array mapping and leaf
 * passthrough. Handing back the narrowed record means each walker below states only what
 * its own keys mean, with no re-narrowing at the call site.
 */
type WalkStep =
  | { kind: 'done'; value: unknown }
  | { kind: 'record'; entries: [string, unknown][] }

function walkNode(
  value: unknown,
  depth: number,
  context: WalkContext,
  recurse: (entry: unknown, depth: number) => unknown,
): WalkStep {
  if (depth > MAX_SPEC_DEPTH) {
    context.depthExceeded = true
    return { kind: 'done', value: undefined }
  }
  if (Array.isArray(value)) {
    return { kind: 'done', value: value.map((entry) => recurse(entry, depth + 1)) }
  }
  if (!isRecord(value)) return { kind: 'done', value }

  return { kind: 'record', entries: Object.entries(value) }
}

function applyUrlPolicy(value: string, policy: UrlPolicy, context: WalkContext): string | undefined {
  if (policy === 'href') {
    if (isSafeHref(value)) return value
    context.warnings.add(WARN_HREF)
    return undefined
  }

  if (isSafeResourceUrl(value)) return value
  context.warnings.add(WARN_URL)
  return undefined
}

/**
 * Inline data is opaque: rows are user data, not spec, so no key in them carries meaning
 * to us. We measure the cost and hand the array back untouched — rewriting a column that
 * happens to be named `url` or `href` would corrupt the data instead of protecting it.
 */
function takeInlineData(value: unknown, context: WalkContext): unknown {
  if (Array.isArray(value)) {
    context.rows += value.length
    return value
  }

  // GeoJSON feature collections are inline data too.
  if (isRecord(value) && Array.isArray(value.features)) {
    context.rows += value.features.length
  }

  return value
}

/** `data.sequence` generates rows without listing them; charge the generated count. */
function countSequence(value: unknown, context: WalkContext): void {
  if (!isRecord(value)) return

  const { start, step, stop } = value
  if (typeof start !== 'number' || typeof stop !== 'number') return

  const stride = typeof step === 'number' && step !== 0 ? Math.abs(step) : 1
  context.rows += Math.max(0, Math.ceil(Math.abs(stop - start) / stride))
}

/**
 * vega-embed merges `usermeta.embedOptions` *over* the options its caller passes, and can
 * even take its loader from there. Left intact, a spec could set `actions.editor: true`
 * with a hostile `editorUrl`, turn off `ast`, or switch `mode` to raw Vega. None of the
 * rest of `usermeta` reaches vega-embed, so only this key is removed.
 */
function stripEmbedOptions(value: unknown, context: WalkContext): unknown {
  if (!isRecord(value) || !('embedOptions' in value)) return value

  context.warnings.add(WARN_EMBED_OPTIONS)
  const { embedOptions: _removed, ...rest } = value
  return rest
}

function sanitizeDataDefinition(value: unknown, depth: number, context: WalkContext): unknown {
  const step = walkNode(value, depth, context, (entry, d) =>
    sanitizeDataDefinition(entry, d, context))
  if (step.kind === 'done') return step.value

  const result: Record<string, unknown> = {}

  for (const [key, entry] of step.entries) {
    if (key === 'loader') {
      context.warnings.add(WARN_LOADER)
      continue
    }

    // The one place Vega fetches data from, so also the one place URLs are collected.
    if (key === 'url' && typeof entry === 'string') {
      const safe = applyUrlPolicy(entry, 'resource', context)
      if (safe !== undefined) {
        result.url = safe
        if (!isAbsoluteUri(safe)) context.dataUrls.add(safe)
      }
      continue
    }

    if (key === 'values') {
      result.values = takeInlineData(entry, context)
      continue
    }

    if (key === 'sequence') {
      countSequence(entry, context)
      result.sequence = entry
      continue
    }

    // `format`, `name`, `graticule` carry no resources.
    result[key] = entry
  }

  return result
}

function sanitizeDatasets(value: unknown, context: WalkContext): unknown {
  if (!isRecord(value)) return value

  const result: Record<string, unknown> = {}
  for (const [name, rows] of Object.entries(value)) {
    result[name] = takeInlineData(rows, context)
  }

  return result
}

/** Applies a channel's URL policy to the literals it can carry, and nothing else. */
function sanitizeChannel(
  value: unknown,
  policy: UrlPolicy,
  depth: number,
  context: WalkContext,
): unknown {
  const step = walkNode(value, depth, context, (entry, d) =>
    sanitizeChannel(entry, policy, d, context))
  if (step.kind === 'done') return step.value

  const result: Record<string, unknown> = {}

  for (const [key, entry] of step.entries) {
    if ((key === 'value' || key === 'datum') && typeof entry === 'string') {
      const safe = applyUrlPolicy(entry, policy, context)
      if (safe !== undefined) result[key] = safe
      continue
    }

    if (key === 'condition') {
      result.condition = sanitizeChannel(entry, policy, depth + 1, context)
      continue
    }

    // `field`, `title`, `type`, `scale`, … are not URLs even inside an href channel.
    result[key] = sanitizeSpecValue(entry, depth + 1, context)
  }

  return result
}

function sanitizeEncoding(value: unknown, depth: number, context: WalkContext): unknown {
  const step = walkNode(value, depth, context, (entry, d) => sanitizeEncoding(entry, d, context))
  if (step.kind === 'done') return step.value

  const result: Record<string, unknown> = {}

  for (const [channel, definition] of step.entries) {
    const policy: UrlPolicy | null =
      channel === 'href' ? 'href' : channel === 'url' ? 'resource' : null

    result[channel] = policy
      ? sanitizeChannel(definition, policy, depth + 1, context)
      : sanitizeSpecValue(definition, depth + 1, context)
  }

  return result
}

/** An `image` mark carries a literal `url`, which Vega loads as an image, never as data. */
function sanitizeMark(value: unknown, depth: number, context: WalkContext): unknown {
  if (!isRecord(value)) return value

  const result: Record<string, unknown> = {}

  for (const [key, entry] of Object.entries(value)) {
    if (key === 'url' && typeof entry === 'string') {
      const safe = applyUrlPolicy(entry, 'resource', context)
      if (safe !== undefined) result.url = safe
      continue
    }

    result[key] = sanitizeSpecValue(entry, depth + 1, context)
  }

  return result
}

function sanitizeSpecValue(value: unknown, depth: number, context: WalkContext): unknown {
  const step = walkNode(value, depth, context, (entry, d) => sanitizeSpecValue(entry, d, context))
  if (step.kind === 'done') return step.value

  const result: Record<string, unknown> = {}

  for (const [key, entry] of step.entries) {
    switch (key) {
      case 'loader':
        context.warnings.add(WARN_LOADER)
        break
      case 'usermeta':
        result.usermeta = stripEmbedOptions(entry, context)
        break
      case 'data':
        result.data = sanitizeDataDefinition(entry, depth + 1, context)
        break
      case 'datasets':
        result.datasets = sanitizeDatasets(entry, context)
        break
      case 'encoding':
        result.encoding = sanitizeEncoding(entry, depth + 1, context)
        break
      case 'mark':
        result.mark = sanitizeMark(entry, depth + 1, context)
        break
      default:
        result[key] = sanitizeSpecValue(entry, depth + 1, context)
    }
  }

  return result
}

/**
 * Accepts any Vega-Lite spec and returns it intact apart from a small set of security
 * transforms, alongside its inline row cost and warnings describing anything removed.
 * Returns null only when the input is not an object or blows a resource budget.
 */
export function sanitizeVegaLiteSpec(input: unknown): SanitizedChart | null {
  if (!isRecord(input)) return null

  let serializedLength: number
  try {
    serializedLength = JSON.stringify(input)?.length ?? 0
  } catch {
    return null
  }
  if (serializedLength > MAX_SPEC_CHARS) return null

  const complexity: ComplexityContext = { compositionBranches: 0, exceeded: false }
  inspectComplexity(input, 1, complexity)
  if (complexity.exceeded) return null

  const context: WalkContext = {
    warnings: new Set(),
    rows: 0,
    depthExceeded: false,
    dataUrls: new Set(),
  }
  const sanitized = sanitizeSpecValue(input, 0, context)

  if (context.depthExceeded || !isRecord(sanitized)) return null
  if (context.rows > MAX_TOTAL_ROWS) return null

  return {
    spec: { ...sanitized, $schema: VEGA_LITE_SCHEMA },
    warnings: [...context.warnings],
    inlineRows: context.rows,
    dataUrls: [...context.dataUrls],
  }
}
