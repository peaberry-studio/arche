import { getRuntimeMode, type RuntimeMode } from '@/lib/runtime/mode'

export type RuntimeCapabilities = {
  multiUser: boolean
  auth: boolean
  containers: boolean
  workspaceAgent: boolean
  reaper: boolean
  csrf: boolean
  twoFactor: boolean
  teamManagement: boolean
  connectors: boolean
  kickstart: boolean
  autopilot: boolean
  slackIntegration: boolean
}

const WEB_CAPABILITIES: RuntimeCapabilities = {
  multiUser: true,
  auth: true,
  containers: true,
  workspaceAgent: true,
  reaper: true,
  csrf: true,
  twoFactor: true,
  teamManagement: true,
  connectors: true,
  kickstart: true,
  autopilot: true,
  slackIntegration: true,
}

const DESKTOP_CAPABILITIES: RuntimeCapabilities = {
  multiUser: false,
  auth: false,
  containers: false,
  workspaceAgent: true,
  reaper: false,
  csrf: false,
  twoFactor: false,
  teamManagement: false,
  connectors: true,
  kickstart: true,
  autopilot: false,
  slackIntegration: false,
}

const CAPABILITIES_BY_MODE: Record<RuntimeMode, RuntimeCapabilities> = {
  web: WEB_CAPABILITIES,
  desktop: DESKTOP_CAPABILITIES,
}

export function getRuntimeCapabilities(): RuntimeCapabilities {
  return CAPABILITIES_BY_MODE[getRuntimeMode()]
}
