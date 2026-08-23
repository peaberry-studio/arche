type TwoFactorStatus =
  | { ok: true; enabled: boolean; verifiedAt: Date | null; recoveryCodesRemaining: number }
  | { ok: false; error: string }
  | null

type TwoFactorStatusView = {
  enabled: boolean
  verifiedAt: Date | null
  recoveryCodesRemaining: number
}

const DEFAULT_TWO_FACTOR_STATUS: TwoFactorStatusView = {
  enabled: false,
  verifiedAt: null,
  recoveryCodesRemaining: 0,
}

export function normalizeTwoFactorStatus(status: TwoFactorStatus): TwoFactorStatusView {
  if (!status || !status.ok) {
    return DEFAULT_TWO_FACTOR_STATUS
  }

  return {
    enabled: status.enabled,
    verifiedAt: status.verifiedAt,
    recoveryCodesRemaining: status.recoveryCodesRemaining,
  }
}
