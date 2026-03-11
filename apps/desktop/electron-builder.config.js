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
  extraResources: [
    {
      from: '../web/.next/standalone',
      to: 'web',
      filter: ['**/*'],
    },
    {
      from: '../web/.next/static',
      to: 'web/.next/static',
      filter: ['**/*'],
    },
    {
      from: '../web/public',
      to: 'web/public',
      filter: ['**/*'],
    },
    {
      from: 'bin/opencode',
      to: 'bin/opencode',
    },
  ],
  mac: {
    category: 'public.app-category.developer-tools',
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
    hardenedRuntime: true,
    gatekeeperAssess: false,
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
