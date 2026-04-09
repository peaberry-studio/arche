export type DesktopVaultSummary = {
  id: string
  name: string
  path: string
  lastOpenedAt?: string
}

export type DesktopApiResult =
  | { ok: true }
  | { ok: false; error: string }

export type CreateVaultArgs = {
  kickstartPayload: unknown
  parentPath: string
  name: string
}
