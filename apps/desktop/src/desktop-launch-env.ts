const CHILD_ENV_VARS_TO_CLEAR = [
  'ARCHE_DATA_DIR',
  'ARCHE_DESKTOP_API_TOKEN',
  'ARCHE_DESKTOP_VAULT_ID',
  'ARCHE_DESKTOP_VAULT_NAME',
  'ARCHE_DESKTOP_VAULT_PATH',
  'ARCHE_DESKTOP_WEB_PORT',
  'ARCHE_GATEWAY_TOKEN_SECRET',
  'ARCHE_OPENCODE_DATA_DIR',
] as const

const MANAGED_SECRET_ENV_PAIRS = [
  {
    managedEnvName: 'ARCHE_DESKTOP_MANAGED_CONNECTOR_OAUTH_STATE_SECRET',
    valueEnvName: 'ARCHE_CONNECTOR_OAUTH_STATE_SECRET',
  },
  {
    managedEnvName: 'ARCHE_DESKTOP_MANAGED_ENCRYPTION_KEY',
    valueEnvName: 'ARCHE_ENCRYPTION_KEY',
  },
] as const

export function buildDesktopLaunchEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const launchEnv = { ...env }

  for (const { managedEnvName, valueEnvName } of MANAGED_SECRET_ENV_PAIRS) {
    if (launchEnv[managedEnvName]) {
      delete launchEnv[valueEnvName]
    }

    delete launchEnv[managedEnvName]
  }

  for (const envName of CHILD_ENV_VARS_TO_CLEAR) {
    delete launchEnv[envName]
  }

  return launchEnv
}
