import { getRuntimeMode, type RuntimeMode } from '@/lib/runtime/mode'

export type RuntimeCapabilities = {
  multiUser: boolean
  auth: boolean
  containers: boolean
  csrf: boolean
  twoFactor: boolean
  teamManagement: boolean
  connectors: boolean
  kickstart: boolean
}

const WEB_CAPABILITIES: RuntimeCapabilities = {
  multiUser: true,
  auth: true,
  containers: true,
  csrf: true,
  twoFactor: true,
  teamManagement: true,
  connectors: true,
  kickstart: true,
}

const DESKTOP_CAPABILITIES: RuntimeCapabilities = {
  multiUser: false,
  auth: false,
  containers: false,
  csrf: false,
  twoFactor: false,
  teamManagement: false,
  connectors: false,
  kickstart: false,
}

const CAPABILITIES_BY_MODE: Record<RuntimeMode, RuntimeCapabilities> = {
  web: WEB_CAPABILITIES,
  desktop: DESKTOP_CAPABILITIES,
}

export function getRuntimeCapabilities(): RuntimeCapabilities {
  return CAPABILITIES_BY_MODE[getRuntimeMode()]
}
