import test from 'node:test'
import assert from 'node:assert/strict'

import { propose } from '../tools/learning.js'

test('learning_propose description is the quality gate for KB proposals', () => {
  const description = propose.description

  assert.match(description, /inspect the existing KB files/i)
  assert.match(description, /update an existing file|new one/i)
  assert.match(description, /duplicates/i)
  assert.match(description, /skip transient/i)
  assert.match(description, /nothing durable/i)
  assert.match(description, /never writes/i)
})