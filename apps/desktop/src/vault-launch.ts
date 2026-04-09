const VAULT_PATH_ARG_PREFIX = '--vault-path='
const LAUNCHER_ARG = '--launcher'

export type DesktopLaunchContext =
  | { mode: 'launcher'; vaultPath: null }
  | { mode: 'vault'; vaultPath: string }

function readVaultPathArg(argv: string[]): string | null {
  for (const arg of argv) {
    if (!arg.startsWith(VAULT_PATH_ARG_PREFIX)) {
      continue
    }

    const value = arg.slice(VAULT_PATH_ARG_PREFIX.length).trim()
    if (value) {
      return value
    }
  }

  return null
}

export function resolveLaunchContext(argv: string[], lastOpenedVaultPath: string | null): DesktopLaunchContext {
  if (argv.includes(LAUNCHER_ARG)) {
    return { mode: 'launcher', vaultPath: null }
  }

  const explicitVaultPath = readVaultPathArg(argv)
  if (explicitVaultPath) {
    return { mode: 'vault', vaultPath: explicitVaultPath }
  }

  if (lastOpenedVaultPath) {
    return { mode: 'vault', vaultPath: lastOpenedVaultPath }
  }

  return { mode: 'launcher', vaultPath: null }
}

export function buildLaunchArgs(argv: string[], nextContext: DesktopLaunchContext): string[] {
  const baseArgs = argv.filter(
    (arg) => arg !== LAUNCHER_ARG && !arg.startsWith(VAULT_PATH_ARG_PREFIX),
  )

  if (nextContext.mode === 'launcher') {
    return [...baseArgs, LAUNCHER_ARG]
  }

  return [...baseArgs, `${VAULT_PATH_ARG_PREFIX}${nextContext.vaultPath}`]
}
