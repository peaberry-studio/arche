import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

import * as XLSX from 'xlsx'

import { inspect, query, resolveSpreadsheetPath, sample, stats } from './spreadsheet.js'

const FIXTURE_DIR = '/workspace/.arche/attachments'
const FIXTURE_PATH = `${FIXTURE_DIR}/spreadsheet-test.xlsx`

async function ensureFixture() {
  await fs.mkdir(FIXTURE_DIR, { recursive: true })

  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.json_to_sheet([
    { region: 'north', revenue: 120, active: true },
    { region: 'south', revenue: 90, active: false },
    { region: 'north', revenue: 30, active: true },
  ])
  XLSX.utils.book_append_sheet(workbook, worksheet, 'sales')
  XLSX.writeFile(workbook, FIXTURE_PATH)
}

function parseOutput(output) {
  return JSON.parse(output)
}

test('resolveSpreadsheetPath enforces .arche/attachments boundary', () => {
  assert.deepEqual(resolveSpreadsheetPath('.arche/attachments/sales.xlsx'), {
    ok: true,
    path: '/workspace/.arche/attachments/sales.xlsx',
  })

  assert.deepEqual(resolveSpreadsheetPath('..\\..\\etc\\passwd'), {
    ok: false,
    error: 'path_outside_attachments',
  })

  assert.deepEqual(resolveSpreadsheetPath('/workspace/.arche/../README.md'), {
    ok: false,
    error: 'path_outside_attachments',
  })

  assert.deepEqual(resolveSpreadsheetPath('.arche//attachments//sales.xlsx'), {
    ok: true,
    path: '/workspace/.arche/attachments/sales.xlsx',
  })
})

test('spreadsheet tools smoke test', async (t) => {
  try {
    await ensureFixture()
  } catch {
    t.skip('workspace mount is unavailable in this environment')
    return
  }

  const inspectResult = parseOutput(await inspect.execute({ path: '.arche/attachments/spreadsheet-test.xlsx' }))
  assert.equal(inspectResult.ok, true)
  assert.deepEqual(inspectResult.sheets.map((sheet) => sheet.name), ['sales'])

  const sampleResult = parseOutput(
    await sample.execute({ path: '.arche/attachments/spreadsheet-test.xlsx', sheet: 'sales', limit: 2 }),
  )
  assert.equal(sampleResult.ok, true)
  assert.equal(sampleResult.returnedRows, 2)

  const queryResult = parseOutput(
    await query.execute({
      path: '.arche/attachments/spreadsheet-test.xlsx',
      sheet: 'sales',
      filters: [{ column: 'region', op: 'eq', value: 'north' }],
    }),
  )
  assert.equal(queryResult.ok, true)
  assert.equal(queryResult.totalRows, 2)

  const statsResult = parseOutput(
    await stats.execute({
      path: '.arche/attachments/spreadsheet-test.xlsx',
      sheet: 'sales',
      columns: ['revenue'],
    }),
  )
  assert.equal(statsResult.ok, true)
  assert.equal(statsResult.columns[0].numeric.max, 120)
})
