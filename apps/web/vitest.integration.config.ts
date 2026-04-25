import { defineConfig, mergeConfig } from 'vitest/config'

import baseConfig, { sharedCoverageConfig, sharedTestExclude } from './vitest.config'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['tests/**/*.test.ts', 'src/app/api/**/*.test.ts'],
      exclude: [...sharedTestExclude, 'src/**/*.e2e.test.ts'],
      coverage: {
        ...sharedCoverageConfig,
        reportsDirectory: './coverage/integration',
      },
    },
  }),
)
