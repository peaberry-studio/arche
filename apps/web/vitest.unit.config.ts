import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig, { sharedCoverageConfig, sharedCoverageExclude, sharedTestExclude } from './vitest.config'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.spec.ts', 'src/**/*.spec.tsx'],
      exclude: [...sharedTestExclude, 'src/**/*.e2e.test.ts', 'src/app/api/**/*.test.ts'],
      coverage: {
        ...sharedCoverageConfig,
        exclude: [
          ...sharedCoverageExclude,
          'src/app/**/layout.tsx',
          'src/app/**/page.tsx',
          'src/app/**/route.ts',
          'src/app/api/**',
          'src/instrumentation*.ts',
          'src/proxy.ts',
          'src/reaper-daemon.ts',
        ],
        reportsDirectory: './coverage/unit',
      },
    },
  }),
)
