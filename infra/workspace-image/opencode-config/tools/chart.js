import { z } from 'zod'

import { toToolOutput } from '../shared/attachment-tools.js'

// chart_create is the convenience path for simple single-series charts; full grammar and
// large data belong in chart_render. These bounds are deliberately tighter than the
// renderer's (which counts rows, not cells): the point is to stop this tool normalizing
// and transporting a payload that only exists because the wrong tool was reached for.
const MAX_ROWS = 200000
const MAX_TOTAL_CELLS = 1000000
const MAX_SERIALIZED_CHARS = 8 * 1024 * 1024
const MAX_TITLE_CHARS = 160
const MAX_FIELD_CHARS = 80
const MAX_CELL_STRING_CHARS = 500
const MAX_SOURCE_NOTE_CHARS = 300
const VEGA_LITE_SCHEMA = 'https://vega.github.io/schema/vega-lite/v6.json'

const CHART_TYPES = ['bar', 'line', 'area', 'scatter', 'pie']
const CHART_INPUT_EXAMPLE = {
  type: 'bar',
  title: 'Variation by segment',
  xField: 'segment',
  yField: 'change_percent',
  data: [
    { segment: 'Mexico', change_percent: 60 },
    { segment: 'Rest of countries', change_percent: -9.1 },
  ],
  sourceNote: 'Mixpanel, last 7 full days vs previous 7 days',
}
const CHART_INPUT_CONTRACT_HINT = [
  'chart_create requires inline data in the data field as an array of row objects.',
  'Do not put CSV, JSON, or numeric values only in sourceNote; sourceNote is metadata only.',
  'Every row must include the xField and yField keys, and every yField value must be a finite number.',
  `Example input: ${JSON.stringify(CHART_INPUT_EXAMPLE)}`,
].join(' ')
const INVALID_CHART_INPUT_REASON_HINTS = {
  invalid_chart_type: `The type field must be one of: ${CHART_TYPES.join(', ')}.`,
  missing_field: 'Every data row must include both the xField and yField keys.',
  non_finite_numeric: 'Numeric chart values must be finite; do not pass Infinity or NaN.',
  pie_negative_value: 'Pie charts require every yField value to be zero or greater.',
  row_limit_exceeded: `The data field can include at most ${MAX_ROWS} rows.`,
  cell_limit_exceeded: `The data field can include at most ${MAX_TOTAL_CELLS} cells (rows x columns); use chart_render with a fenced spec for larger datasets.`,
  payload_too_large: `The serialized chart must stay under ${MAX_SERIALIZED_CHARS} characters; use chart_render with a fenced spec for larger datasets.`,
  scatter_x_not_numeric: 'Scatter charts require every xField value to be a finite number.',
  schema_validation_failed: 'The input did not match the chart_create argument schema.',
  text_limit_exceeded: `Titles are limited to ${MAX_TITLE_CHARS} characters, field names to ${MAX_FIELD_CHARS}, cell strings to ${MAX_CELL_STRING_CHARS}, and row keys must be unique.`,
  y_not_numeric: 'Every yField value must be a finite number.',
}

const chartTypeSchema = z.enum(CHART_TYPES)
const cellValueSchema = z.union([
  z.string().max(MAX_CELL_STRING_CHARS),
  z.number().finite(),
  z.boolean(),
  z.null(),
])
const chartRowSchema = z.record(z.string(), cellValueSchema)

const createArgsSchema = z.object({
  type: chartTypeSchema,
  title: z.string().min(1).max(MAX_TITLE_CHARS),
  xField: z.string().min(1).max(MAX_FIELD_CHARS),
  yField: z.string().min(1).max(MAX_FIELD_CHARS),
  data: z.array(chartRowSchema).min(1).max(MAX_ROWS),
  sourceNote: z.string().max(MAX_SOURCE_NOTE_CHARS).optional(),
}).strict()

function normalizeLineEndings(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

function normalizeSafeText(value, maxChars, allowEmpty = false) {
  const text = normalizeLineEndings(value)
  if (!allowEmpty && !text) return null
  if (text.length > maxChars) return null
  return text
}

function isValidCellValue(value) {
  if (value === null) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return true
  if (typeof value !== 'string') return false
  return value.length <= MAX_CELL_STRING_CHARS
}

function normalizeRows(rows) {
  const columns = new Set()
  const normalizedRows = []

  for (const row of rows) {
    const nextRow = {}
    const rowKeys = new Set()

    for (const [rawKey, value] of Object.entries(row)) {
      const key = normalizeSafeText(rawKey, MAX_FIELD_CHARS)
      if (!key || rowKeys.has(key)) return { ok: false, reason: 'text_limit_exceeded' }
      if (!isValidCellValue(value)) return { ok: false, reason: 'text_limit_exceeded' }

      rowKeys.add(key)
      columns.add(key)

      nextRow[key] = typeof value === 'string' ? normalizeLineEndings(value) : value
    }

    normalizedRows.push(nextRow)
  }

  if (normalizedRows.length * Math.max(columns.size, 1) > MAX_TOTAL_CELLS) {
    return { ok: false, reason: 'cell_limit_exceeded' }
  }

  return { ok: true, columns, rows: normalizedRows }
}

function hasPresentValue(row, field) {
  const value = row[field]
  return value !== null && value !== undefined && value !== ''
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function inferFieldType(rows, field) {
  return rows.every((row) => isFiniteNumber(row[field])) ? 'quantitative' : 'nominal'
}

function validateChartData(type, rows, xField, yField) {
  for (const row of rows) {
    if (!hasPresentValue(row, xField)) return 'missing_field'
    if (!isFiniteNumber(row[yField])) return 'y_not_numeric'
    if (type === 'scatter' && !isFiniteNumber(row[xField])) return 'scatter_x_not_numeric'
    if (type === 'pie' && row[yField] < 0) return 'pie_negative_value'
  }

  return null
}

function buildSpec({ type, title, xField, yField, data }) {
  const baseSpec = {
    $schema: VEGA_LITE_SCHEMA,
    title,
    data: { values: data },
    width: 'container',
    height: type === 'pie' ? 300 : 320,
    autosize: { type: 'fit', contains: 'padding' },
  }

  if (type === 'pie') {
    return {
      ...baseSpec,
      mark: 'arc',
      encoding: {
        theta: { field: yField, type: 'quantitative' },
        color: { field: xField, type: 'nominal' },
      },
    }
  }

  const xType = type === 'scatter' ? 'quantitative' : inferFieldType(data, xField)
  const mark = type === 'scatter' ? 'point' : type
  return {
    ...baseSpec,
    mark,
    encoding: {
      x: { field: xField, type: xType },
      y: { field: yField, type: 'quantitative' },
    },
  }
}

function normalizeChartInput(input) {
  const title = normalizeSafeText(input.title, MAX_TITLE_CHARS)
  const xField = normalizeSafeText(input.xField, MAX_FIELD_CHARS)
  const yField = normalizeSafeText(input.yField, MAX_FIELD_CHARS)
  const sourceNote = input.sourceNote === undefined
    ? undefined
    : normalizeSafeText(input.sourceNote, MAX_SOURCE_NOTE_CHARS, true)
  const normalizedData = normalizeRows(input.data)

  if (!title || !xField || !yField || sourceNote === null) {
    return { ok: false, reason: 'text_limit_exceeded' }
  }

  if (!normalizedData.ok) {
    return normalizedData
  }

  if (!normalizedData.columns.has(xField) || !normalizedData.columns.has(yField)) {
    return { ok: false, reason: 'missing_field' }
  }

  const dataValidationReason = validateChartData(input.type, normalizedData.rows, xField, yField)
  if (dataValidationReason) {
    return { ok: false, reason: dataValidationReason }
  }

  return {
    ok: true,
    value: {
      type: input.type,
      title,
      xField,
      yField,
      data: normalizedData.rows,
      sourceNote: sourceNote || undefined,
    },
  }
}

function hasNonFiniteNumber(value) {
  if (typeof value === 'number') return !Number.isFinite(value)
  if (Array.isArray(value)) return value.some((item) => hasNonFiniteNumber(item))
  if (!value || typeof value !== 'object') return false
  return Object.values(value).some((item) => hasNonFiniteNumber(item))
}

function schemaFailureReason(input) {
  if (input && typeof input === 'object') {
    if ('type' in input && !CHART_TYPES.includes(input.type)) return 'invalid_chart_type'
    if (Array.isArray(input.data) && input.data.length > MAX_ROWS) return 'row_limit_exceeded'
    if (hasNonFiniteNumber(input.data)) return 'non_finite_numeric'
  }

  return 'schema_validation_failed'
}

function invalidChartInputOutput(reason) {
  return toToolOutput({
    ok: false,
    error: 'invalid_chart_input',
    reason,
    hint: `${INVALID_CHART_INPUT_REASON_HINTS[reason]} ${CHART_INPUT_CONTRACT_HINT}`,
    example: CHART_INPUT_EXAMPLE,
  })
}

export const create = {
  description: [
    'Create a safe Vega-Lite chart from inline row data.',
    'Always pass the numeric rows in the required data field; sourceNote is only a short metadata note, ' +
      'not a place for CSV/JSON/data values.',
    `Example input: ${JSON.stringify(CHART_INPUT_EXAMPLE)}`,
    'For charts that should persist in a document (KB articles, reports), prefer vega-lite fenced code blocks in markdown instead of this tool; see AGENTS.md Markdown Capabilities.',
  ].join(' '),
  args: {
    type: chartTypeSchema.describe('Chart type: bar, line, area, scatter, or pie.'),
    title: z.string().min(1).max(MAX_TITLE_CHARS).describe('Short chart title. Plain text only.'),
    xField: z.string().min(1).max(MAX_FIELD_CHARS).describe('Field name for the x-axis or category labels.'),
    yField: z.string().min(1).max(MAX_FIELD_CHARS).describe('Numeric field name for the y-axis or values.'),
    data: z.array(chartRowSchema).min(1).max(MAX_ROWS).describe(
      `Required inline chart data as row objects. Maximum ${MAX_ROWS} rows.`,
    ),
    sourceNote: z.string().max(MAX_SOURCE_NOTE_CHARS).optional().describe(
      'Optional plain-text note explaining the data source. Do not put the chart data here.',
    ),
  },
  async execute(args) {
    const parsed = createArgsSchema.safeParse(args)
    if (!parsed.success) {
      return invalidChartInputOutput(schemaFailureReason(args))
    }

    const normalized = normalizeChartInput(parsed.data)
    if (!normalized.ok) {
      return invalidChartInputOutput(normalized.reason)
    }

    const chartInput = normalized.value
    const payload = {
      ok: true,
      format: 'arche-chart/v1',
      chart: {
        title: chartInput.title,
        sourceNote: chartInput.sourceNote,
        spec: buildSpec(chartInput),
      },
    }

    if (JSON.stringify(payload).length > MAX_SERIALIZED_CHARS) {
      return invalidChartInputOutput('payload_too_large')
    }

    return toToolOutput(payload)
  },
}

function invalidSpecOutput(reason, hint) {
  return toToolOutput({
    ok: false,
    error: 'invalid_chart_spec',
    reason,
    hint,
  })
}

export const render = {
  description: [
    'Render a raw Vega-Lite specification in chat.',
    'The complete Vega-Lite grammar is supported (https://vega.github.io/vega-lite/docs/):',
    'every mark including geoshape, image and boxplot; multi-view composition via layer, facet, repeat,',
    'hconcat, vconcat and concat; every transform; interactive params and selections; projections; and expressions.',
    'Use this instead of chart_create whenever the chart is anything beyond a single-series bar/line/area/scatter/pie.',
    'For charts that should persist in a document (KB articles, reports), prefer vega-lite fenced code blocks in markdown; see AGENTS.md Markdown Capabilities.',
  ].join(' '),
  args: {
    title: z.string().min(1).max(MAX_TITLE_CHARS).describe('Short chart title shown above the chart.'),
    spec: z.string().min(1).describe(
      'The Vega-Lite specification as a raw JSON object string. Prefer inline data.values.',
    ),
    sourceNote: z.string().max(MAX_SOURCE_NOTE_CHARS).optional().describe(
      'Optional short note explaining the data source.',
    ),
  },
  async execute(args) {
    const title = normalizeSafeText(args?.title, MAX_TITLE_CHARS)
    if (!title) {
      return invalidSpecOutput('invalid_title', `Provide a plain-text title of at most ${MAX_TITLE_CHARS} characters.`)
    }

    const sourceNote = args?.sourceNote === undefined
      ? undefined
      : normalizeSafeText(args.sourceNote, MAX_SOURCE_NOTE_CHARS, true)
    if (sourceNote === null) {
      return invalidSpecOutput('invalid_source_note', `sourceNote is limited to ${MAX_SOURCE_NOTE_CHARS} characters.`)
    }

    const rawSpec = typeof args?.spec === 'string' ? args.spec.trim() : ''
    if (!rawSpec || rawSpec.length > MAX_SERIALIZED_CHARS) {
      return invalidSpecOutput('invalid_spec_size', `The spec must be non-empty and under ${MAX_SERIALIZED_CHARS} characters.`)
    }

    let spec
    try {
      spec = JSON.parse(rawSpec)
    } catch (error) {
      return invalidSpecOutput('invalid_json', `The spec must be a single raw JSON object. ${error.message}`)
    }

    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      return invalidSpecOutput('invalid_json', 'The spec must be a JSON object, not an array or primitive.')
    }

    // Arche's renderer applies the authoritative security pass (URL scheme filtering,
    // loader stripping, resource budgets) before embedding, so this tool only has to
    // guarantee it is emitting a well-formed envelope.
    return toToolOutput({
      ok: true,
      format: 'arche-chart/v1',
      chart: { title, sourceNote: sourceNote || undefined, spec },
    })
  },
}
