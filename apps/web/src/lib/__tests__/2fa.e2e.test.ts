import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const DATABASE_URL = process.env.DATABASE_URL
const ENCRYPTION_KEY = process.env.ARCHE_ENCRYPTION_KEY
const SKIP = !DATABASE_URL || !ENCRYPTION_KEY

type PrismaModule = typeof import('../prisma')
type TotpModule = typeof import('../totp')

let prismaModule: PrismaModule
let totpModule: TotpModule
let testUserId: string

const TEST_EMAIL = `2fa-e2e-${Date.now()}@test.local`
const TEST_PASSWORD = 'test-password-e2e-123'
const TEST_SLUG = `e2e-2fa-${Date.now()}`

describe.runIf(!SKIP)('2FA e2e', () => {
  beforeAll(async () => {
    const [pm, tm, argon2] = await Promise.all([
      import('../prisma'),
      import('../totp'),
      import('argon2'),
    ])
    prismaModule = pm
    totpModule = tm

    const user = await prismaModule.prisma.user.create({
      data: {
        email: TEST_EMAIL,
        slug: TEST_SLUG,
        passwordHash: await argon2.hash(TEST_PASSWORD),
      },
    })
    testUserId = user.id
  })

  afterAll(async () => {
    if (testUserId) {
      await prismaModule.prisma.twoFactorRecovery.deleteMany({ where: { userId: testUserId } })
      await prismaModule.prisma.session.deleteMany({ where: { userId: testUserId } })
      await prismaModule.prisma.user.delete({ where: { id: testUserId } }).catch(() => {})
    }
  })

  it('encrypts and decrypts TOTP secret correctly', () => {
    const secret = totpModule.generateSecret()
    const encrypted = totpModule.encryptSecret(secret)
    expect(totpModule.decryptSecret(encrypted)).toBe(secret)
  })

  it('generates and verifies TOTP code', () => {
    const secret = totpModule.generateSecret()
    const code = totpModule.generateCurrentCode(secret)
    expect(totpModule.verifyTotp(secret, code).valid).toBe(true)
    expect(totpModule.verifyTotp(secret, '000000').valid).toBe(false)
  })

  it('rejects replayed TOTP code', () => {
    const secret = totpModule.generateSecret()
    const code = totpModule.generateCurrentCode(secret)

    // First use should succeed
    const result1 = totpModule.verifyTotp(secret, code)
    expect(result1.valid).toBe(true)
    expect(result1.windowStart).toBeInstanceOf(Date)

    // Replay with same windowStart should fail
    const result2 = totpModule.verifyTotp(secret, code, result1.windowStart)
    expect(result2.valid).toBe(false)
  })

  it('full 2FA lifecycle: setup → verify → use recovery → disable', async () => {
    const argon2 = await import('argon2')

    // 1. Generate and store encrypted secret
    const secret = totpModule.generateSecret()
    const encrypted = totpModule.encryptSecret(secret)

    await prismaModule.prisma.user.update({
      where: { id: testUserId },
      data: { totpSecret: encrypted },
    })

    // 2. Verify TOTP code works
    const code = totpModule.generateCurrentCode(secret)
    expect(totpModule.verifyTotp(secret, code).valid).toBe(true)

    // 3. Enable 2FA and store recovery codes
    const recoveryCodes = totpModule.generateRecoveryCodes(3)
    const hashedCodes = await Promise.all(
      recoveryCodes.map(async (c) => ({
        userId: testUserId,
        codeHash: await argon2.hash(c),
      }))
    )

    await prismaModule.prisma.$transaction([
      prismaModule.prisma.twoFactorRecovery.deleteMany({ where: { userId: testUserId } }),
      prismaModule.prisma.twoFactorRecovery.createMany({ data: hashedCodes }),
      prismaModule.prisma.user.update({
        where: { id: testUserId },
        data: { totpEnabled: true, totpVerifiedAt: new Date() },
      }),
    ])

    // 4. Verify user is now 2FA enabled
    const enabledUser = await prismaModule.prisma.user.findUnique({
      where: { id: testUserId },
      select: { totpEnabled: true, totpVerifiedAt: true },
    })
    expect(enabledUser?.totpEnabled).toBe(true)
    expect(enabledUser?.totpVerifiedAt).toBeInstanceOf(Date)

    // 5. Verify recovery code works
    const testRecoveryCode = recoveryCodes[0]
    const storedCodes = await prismaModule.prisma.twoFactorRecovery.findMany({
      where: { userId: testUserId, usedAt: null },
    })
    expect(storedCodes).toHaveLength(3)

    let recoveryMatched = false
    for (const stored of storedCodes) {
      if (await argon2.verify(stored.codeHash, testRecoveryCode)) {
        await prismaModule.prisma.twoFactorRecovery.update({
          where: { id: stored.id },
          data: { usedAt: new Date() },
        })
        recoveryMatched = true
        break
      }
    }
    expect(recoveryMatched).toBe(true)

    // 6. Verify one less recovery code remains
    const remaining = await prismaModule.prisma.twoFactorRecovery.count({
      where: { userId: testUserId, usedAt: null },
    })
    expect(remaining).toBe(2)

    // 7. Disable 2FA
    await prismaModule.prisma.$transaction([
      prismaModule.prisma.twoFactorRecovery.deleteMany({ where: { userId: testUserId } }),
      prismaModule.prisma.user.update({
        where: { id: testUserId },
        data: { totpEnabled: false, totpSecret: null, totpVerifiedAt: null },
      }),
    ])

    const disabledUser = await prismaModule.prisma.user.findUnique({
      where: { id: testUserId },
      select: { totpEnabled: true, totpSecret: true },
    })
    expect(disabledUser?.totpEnabled).toBe(false)
    expect(disabledUser?.totpSecret).toBeNull()
  })
})
