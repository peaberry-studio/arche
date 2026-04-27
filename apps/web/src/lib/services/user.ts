import type { UserKind, UserRole } from '@prisma/client'

import { prisma } from '@/lib/prisma'

// ---------------------------------------------------------------------------
// Query return shapes
// ---------------------------------------------------------------------------

export type UserIdentity = {
  id: string
  email: string
  slug: string
}

export type UserIdOnly = {
  id: string
}

export type UserLoginRecord = {
  id: string
  email: string
  slug: string
  role: UserRole
  passwordHash: string
  totpEnabled: boolean
}

export type User2faRecord = {
  id: string
  email: string
  slug: string
  role: UserRole
  totpSecret: string | null
  totpLastUsedAt: Date | null
  twoFactorRecovery: Array<{ id: string; codeHash: string }>
}

export type UserTeamRecord = {
  id: string
  email: string
  slug: string
  role: UserRole
  createdAt: Date
}

export type UserLookupRecord = {
  id: string
  email: string
  slug: string
  role: UserRole
  kind: UserKind
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function findIdBySlug(slug: string): Promise<UserIdOnly | null> {
  return prisma.user.findUnique({
    where: { slug },
    select: { id: true },
  })
}

export function findIdentityBySlug(slug: string): Promise<UserIdentity | null> {
  return prisma.user.findUnique({
    where: { slug },
    select: { id: true, email: true, slug: true },
  })
}

export function findById(id: string) {
  return prisma.user.findUnique({ where: { id } })
}

export function findByIdSelect<T extends Parameters<typeof prisma.user.findUnique>[0]['select']>(
  id: string,
  select: T,
) {
  return prisma.user.findUnique({ where: { id }, select })
}

export function findLoginByEmail(email: string): Promise<UserLoginRecord | null> {
  return prisma.user.findFirst({
    where: { email, kind: 'HUMAN' },
    select: {
      id: true,
      email: true,
      slug: true,
      role: true,
      passwordHash: true,
      totpEnabled: true,
    },
  })
}

export function find2faById(id: string): Promise<User2faRecord | null> {
  return prisma.user.findFirst({
    where: { id, kind: 'HUMAN' },
    select: {
      id: true,
      email: true,
      slug: true,
      role: true,
      totpSecret: true,
      totpLastUsedAt: true,
      twoFactorRecovery: {
        where: { usedAt: null },
        select: { id: true, codeHash: true },
      },
    },
  })
}

export function findTeamMembers(): Promise<UserTeamRecord[]> {
  return prisma.user.findMany({
    where: { kind: 'HUMAN' },
    select: { id: true, email: true, slug: true, role: true, createdAt: true },
    orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
  })
}

export function findTeamMemberById(id: string): Promise<UserTeamRecord | null> {
  return prisma.user.findFirst({
    where: { id, kind: 'HUMAN' },
    select: { id: true, email: true, slug: true, role: true, createdAt: true },
  })
}

export function findExistingByEmailOrSlug(email: string, slug: string) {
  return prisma.user.findFirst({
    where: { OR: [{ email }, { slug }] },
    select: { id: true, email: true, slug: true, role: true, kind: true },
  })
}

export function countAdmins(): Promise<number> {
  return prisma.user.count({ where: { role: 'ADMIN', kind: 'HUMAN' } })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function create(data: {
  email: string
  slug: string
  role: UserRole
  passwordHash: string
  kind?: UserKind
}): Promise<UserTeamRecord> {
  return prisma.user.create({
    data: {
      ...data,
      kind: data.kind ?? 'HUMAN',
    },
    select: { id: true, email: true, slug: true, role: true, createdAt: true },
  })
}

export function updateRole(id: string, role: UserRole): Promise<UserTeamRecord> {
  return prisma.user.update({
    where: { id },
    data: { role },
    select: { id: true, email: true, slug: true, role: true, createdAt: true },
  })
}

export function updatePasswordHash(id: string, passwordHash: string) {
  return prisma.user.update({
    where: { id },
    data: { passwordHash },
  })
}

export function updatePasswordHashAndRevokeSessions(id: string, passwordHash: string, keepSessionId?: string) {
  const revokedAt = new Date()

  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { passwordHash },
    })

    await tx.session.updateMany({
      where: {
        userId: id,
        revokedAt: null,
        ...(keepSessionId ? { id: { not: keepSessionId } } : {}),
      },
      data: { revokedAt },
    })
  })
}

export function updateTotpLastUsedAt(id: string, totpLastUsedAt: Date) {
  return prisma.user.update({
    where: { id },
    data: { totpLastUsedAt },
  })
}

export function updateTotpSecret(id: string, totpSecret: string) {
  return prisma.user.update({
    where: { id },
    data: { totpSecret, totpVerifiedAt: null },
  })
}

export function deleteById(id: string) {
  return prisma.user.deleteMany({ where: { id } })
}

// ---------------------------------------------------------------------------
// Transactions (2FA)
// ---------------------------------------------------------------------------

export function enableTwoFactor(userId: string, hashedCodes: Array<{ userId: string; codeHash: string }>) {
  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { totpEnabled: true, totpVerifiedAt: new Date() },
    })
    await tx.twoFactorRecovery.deleteMany({ where: { userId } })
    await tx.twoFactorRecovery.createMany({ data: hashedCodes })
  })
}

export function disableTwoFactor(userId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        totpEnabled: false,
        totpSecret: null,
        totpVerifiedAt: null,
        totpLastUsedAt: null,
      },
    })
    await tx.twoFactorRecovery.deleteMany({ where: { userId } })
  })
}

export function regenerateRecoveryCodes(userId: string, hashedCodes: Array<{ userId: string; codeHash: string }>) {
  return prisma.$transaction(async (tx) => {
    await tx.twoFactorRecovery.deleteMany({ where: { userId } })
    await tx.twoFactorRecovery.createMany({ data: hashedCodes })
  })
}

export function countUnusedRecoveryCodes(userId: string): Promise<number> {
  return prisma.twoFactorRecovery.count({ where: { userId, usedAt: null } })
}

export function markRecoveryCodeUsed(id: string) {
  return prisma.twoFactorRecovery.update({
    where: { id },
    data: { usedAt: new Date() },
  })
}
