import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig, { sharedCoverageConfig, sharedCoverageExclude, sharedTestExclude } from './vitest.config'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['tests/**/*.test.ts', 'src/app/api/**/*.test.ts'],
      exclude: [...sharedTestExclude, 'src/**/*.e2e.test.ts'],
      coverage: {
        ...sharedCoverageConfig,
        exclude: [
          ...sharedCoverageExclude,
          'src/actions/**',
          'src/autopilot-daemon.ts',
          'src/app/auth/**',
          'src/app/layout.tsx',
          'src/app/login/**',
          'src/app/page.tsx',
          'src/app/signup/**',
          'src/app/u/**',
          'src/app/w/**',
          'src/components/**',
          'src/contexts/**',
          'src/hooks/**',
          'src/instrumentation*.ts',
          'src/lib/**',
          'src/proxy.ts',
          'src/reaper-daemon.ts',
          'src/types/**',
        ],
        include: ['src/app/api/**/*.{ts,tsx}'],
        reportsDirectory: './coverage/integration',
      },
    },
  }),
)
