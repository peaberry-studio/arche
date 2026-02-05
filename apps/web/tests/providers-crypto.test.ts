import { describe, it, expect } from 'vitest'
import { encryptProviderSecret, decryptProviderSecret } from '@/lib/providers/crypto'

describe('providers/crypto', () => {
  it('round-trips secrets', () => {
    const encrypted = encryptProviderSecret({ apiKey: 'sk-123' })
    expect(decryptProviderSecret(encrypted)).toEqual({ apiKey: 'sk-123' })
  })

  it('rejects corrupted secrets', () => {
    expect(() => decryptProviderSecret('bad:data:here')).toThrow('Failed to decrypt provider secret')
  })

  it('rejects secrets exceeding max size', () => {
    const encrypted = { apiKey: 'x'.repeat(16 * 1024) }
    expect(() => encryptProviderSecret(encrypted)).toThrow('Provider secret exceeds maximum size')
  })
})
