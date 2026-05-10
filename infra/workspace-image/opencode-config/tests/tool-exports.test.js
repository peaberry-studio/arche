import test from 'node:test'
import assert from 'node:assert/strict'

import * as chartTools from '../tools/chart.js'
import * as diagramTools from '../tools/diagram.js'
import * as documentTools from '../tools/document.js'
import * as emailTools from '../tools/email.js'
import * as presentationTools from '../tools/presentation.js'
import * as spreadsheetTools from '../tools/spreadsheet.js'

test('tool modules only export executable tool definitions', () => {
  assert.deepEqual(Object.keys(chartTools).sort(), ['create'])
  assert.deepEqual(Object.keys(diagramTools).sort(), ['create'])
  assert.deepEqual(Object.keys(documentTools).sort(), ['inspect'])
  assert.deepEqual(Object.keys(emailTools).sort(), ['draft'])
  assert.deepEqual(Object.keys(presentationTools).sort(), ['inspect'])
  assert.deepEqual(Object.keys(spreadsheetTools).sort(), ['inspect', 'query', 'sample', 'stats'])
})
