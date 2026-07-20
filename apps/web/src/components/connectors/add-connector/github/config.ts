import { parseGithubConnectorConfig } from '@/lib/connectors/github'

import type { ConnectorConfigResult } from '@/components/connectors/add-connector/types'

export type GithubConnectorFormState = {
  selectedType: 'github'
  pat: string
  host: string
  pinnedRepos: string[]
}

export function buildGithubConnectorConfig(
  state: GithubConnectorFormState
): ConnectorConfigResult {
  if (!state.pat.trim()) {
    return { ok: false, message: 'GitHub personal access token is required.' }
  }

  if (state.pinnedRepos.length === 0) {
    return { ok: false, message: 'Add at least one pinned repository.' }
  }

  const parsed = parseGithubConnectorConfig({
    pat: state.pat,
    ...(state.host.trim() ? { host: state.host } : {}),
    pinnedRepos: state.pinnedRepos,
  })
  if (!parsed.ok) {
    return {
      ok: false,
      message: 'Enter a valid GitHub personal access token, host, and pinned repositories.',
    }
  }

  return { ok: true, value: parsed.config }
}

export function isGithubConnectorConfigurationComplete(
  state: GithubConnectorFormState
): boolean {
  return buildGithubConnectorConfig(state).ok
}
