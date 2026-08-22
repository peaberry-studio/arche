import { describe, expect, it } from 'vitest'

import { BITMAP_GRID_COLS, BITMAP_GRID_ROWS } from '@/components/workspace/bitmap-glyph'
import { getEmptyComposerGlyph } from '@/components/workspace/empty-composer-glyphs'
import {
  EMPTY_COMPOSER_INTENTS,
  pickEmptyComposerIntent,
} from '@/components/workspace/empty-composer-intents'

describe('empty composer intents', () => {
  it('keeps a unique pool of fifty short intents', () => {
    expect(EMPTY_COMPOSER_INTENTS).toHaveLength(50)
    expect(new Set(EMPTY_COMPOSER_INTENTS).size).toBe(50)
    expect(EMPTY_COMPOSER_INTENTS.every((intent) => intent.length > 0 && intent.length <= 22)).toBe(
      true,
    )
  })

  it('picks from the pool and skips an immediate repeat', () => {
    const first = pickEmptyComposerIntent(() => 0)
    const second = pickEmptyComposerIntent(() => 0)

    expect(EMPTY_COMPOSER_INTENTS).toContain(first)
    expect(EMPTY_COMPOSER_INTENTS).toContain(second)
    expect(second).not.toBe(first)
  })

  it('gives every intent a related 6x6 glyph', () => {
    const cellCount = BITMAP_GRID_COLS * BITMAP_GRID_ROWS

    for (const intent of EMPTY_COMPOSER_INTENTS) {
      const glyph = getEmptyComposerGlyph(intent)
      expect(glyph.frames.length).toBeGreaterThan(1)
      expect(glyph.frames.every((frame) => frame.length === cellCount)).toBe(true)
      expect(glyph.frames.every((frame) => frame.some(Boolean))).toBe(true)
    }
  })
})
