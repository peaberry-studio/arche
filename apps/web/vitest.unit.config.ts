import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig, { sharedCoverageConfig, sharedTestExclude } from './vitest.config'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.spec.ts', 'src/**/*.spec.tsx'],
      exclude: [...sharedTestExclude, 'src/**/*.e2e.test.ts', 'src/app/api/**/*.test.ts'],
      coverage: {
        ...sharedCoverageConfig,
        reportsDirectory: './coverage/unit',
      },
    },
  }),
)
