import { describe, it, expect } from 'vitest'
import { validateSlug, assertValidSlug } from '../slug'

describe('validateSlug', () => {
  describe('valid slugs', () => {
    it.each([
      'john',
      'john-doe',
      'user123',
      'a',
      'ab',
      'a1',
      '123',
      'test-user-name',
    ])('accepts valid slug: %s', (slug) => {
      expect(validateSlug(slug)).toEqual({ valid: true })
    })
  })

  describe('path traversal rejection', () => {
    it.each([
      ['../etc', 'path traversal with ..'],
      ['..', 'double dot only'],
      ['foo/bar', 'forward slash'],
      ['foo\\bar', 'backslash'],
      ['foo/../bar', 'embedded path traversal'],
    ])('rejects %s (%s)', (slug) => {
      const result = validateSlug(slug)
      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('invalid slugs', () => {
    it.each([
      ['UPPERCASE', 'uppercase letters'],
      ['under_score', 'underscore'],
      ['-start', 'starts with hyphen'],
      ['end-', 'ends with hyphen'],
      ['has space', 'contains space'],
      ['has.dot', 'contains dot'],
      ['', 'empty string'],
    ])('rejects %s (%s)', (slug) => {
      const result = validateSlug(slug)
      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('rejects slug longer than 32 characters', () => {
      const longSlug = 'a'.repeat(33)
      const result = validateSlug(longSlug)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Slug must be 1-32 characters')
    })

    it('accepts slug of exactly 32 characters', () => {
      const maxSlug = 'a'.repeat(32)
      expect(validateSlug(maxSlug)).toEqual({ valid: true })
    })
  })
})

describe('assertValidSlug', () => {
  it('does not throw for valid slugs', () => {
    expect(() => assertValidSlug('valid-slug')).not.toThrow()
  })

  it('throws for invalid slugs', () => {
    expect(() => assertValidSlug('../etc')).toThrow('Invalid characters in slug')
    expect(() => assertValidSlug('UPPERCASE')).toThrow('Slug must be lowercase alphanumeric with hyphens')
    expect(() => assertValidSlug('')).toThrow('Slug must be 1-32 characters')
  })
})
