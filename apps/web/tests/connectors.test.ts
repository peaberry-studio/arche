import { describe, it, expect } from 'vitest'
import { encryptConfig, decryptConfig } from '@/lib/connectors/crypto'
import { CONNECTOR_TYPES } from '@/lib/connectors/types'

describe('connectors/crypto', () => {
  const sample = { apiKey: 'sk-123', workspace: 'my-team' }

  it('encryptConfig produces iv:tag:data format', () => {
    const encrypted = encryptConfig(sample)
    const parts = encrypted.split(':')
    expect(parts).toHaveLength(3)
    parts.forEach((p) => expect(p.length).toBeGreaterThan(0))
  })

  it('decryptConfig round-trips correctly', () => {
    const encrypted = encryptConfig(sample)
    const decrypted = decryptConfig(encrypted)
    expect(decrypted).toEqual(sample)
  })

  it('decryptConfig throws on corrupted input', () => {
    expect(() => decryptConfig('bad:data:here')).toThrow('Failed to decrypt connector configuration')
  })

  it('round-trips empty config', () => {
    const encrypted = encryptConfig({})
    expect(decryptConfig(encrypted)).toEqual({})
  })

  it('round-trips unicode values', () => {
    const config = { name: '日本語テスト', emoji: '🚀', accent: 'café' }
    const encrypted = encryptConfig(config)
    expect(decryptConfig(encrypted)).toEqual(config)
  })

  it('rejects config exceeding max size', () => {
    const big = { data: 'x'.repeat(11 * 1024) }
    expect(() => encryptConfig(big)).toThrow('exceeds maximum size')
  })
})

describe('connectors/types', () => {
  it('CONNECTOR_TYPES contains expected values', () => {
    expect(CONNECTOR_TYPES).toEqual(['linear', 'notion', 'slack', 'github', 'custom'])
  })
})
