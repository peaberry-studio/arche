const hasKeychainNotarization = Boolean(process.env.APPLE_KEYCHAIN_PROFILE)
const hasAppleIdNotarization = Boolean(
  process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID,
)
const hasApiKeyNotarization = Boolean(
  process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER,
)

const macNotarize = hasKeychainNotarization
  ? { keychainProfile: process.env.APPLE_KEYCHAIN_PROFILE }
  : hasAppleIdNotarization
    ? { teamId: process.env.APPLE_TEAM_ID }
    : hasApiKeyNotarization
      ? true
      : false

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.arche.desktop',
  productName: 'Arche',
  directories: {
    buildResources: 'build',
    output: 'release',
  },
  files: [
    'dist/**/*',
    'node_modules/**/*',
    'package.json',
  ],
  asarUnpack: [
    'node_modules/dugite/git/**',
  ],
  extraResources: [
    {
      from: '../web/.next/standalone',
      to: 'web',
      filter: ['**/*'],
    },
    {
      // Next.js standalone in a monorepo nests the app under apps/web/.
      // Static assets are excluded from standalone and must be placed where
      // server.js expects them: alongside its own .next directory.
      from: '../web/.next/static',
      to: 'web/apps/web/.next/static',
      filter: ['**/*'],
    },
    {
      from: '../../infra/workspace-image/opencode-config',
      to: 'opencode-config',
      filter: ['**/*'],
    },
    {
      from: 'bin/opencode',
      to: 'bin/opencode',
    },
    {
      from: 'bin/workspace-agent',
      to: 'bin/workspace-agent',
    },
    {
      from: 'bin/node',
      to: 'bin/node',
    },
    {
      from: 'bin/opencode-config',
      to: 'bin/opencode-config',
      filter: ['**/*'],
    },
  ],
  mac: {
    category: 'public.app-category.developer-tools',
    target: ['dmg', 'zip'],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    notarize: macNotarize,
  },
  linux: {
    category: 'Development',
    target: [
      { target: 'AppImage' },
      { target: 'deb' },
    ],
  },
  win: {
    target: [
      { target: 'nsis' },
      { target: 'zip' },
    ],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
}
