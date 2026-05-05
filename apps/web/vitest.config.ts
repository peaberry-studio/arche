import { configDefaults, defineConfig } from 'vitest/config'
import path from 'path'

export const sharedTestExclude = [...configDefaults.exclude, '.next/**', 'e2e/**']

export const sharedCoverageExclude = [
  '**/*.d.ts',
  '**/*.test.*',
  '**/*.spec.*',
  '**/__tests__/**',
  'coverage/**',
  'e2e/**',
  'src/generated/**',
]

export const sharedCoverageConfig = {
  all: true,
  exclude: sharedCoverageExclude,
  include: ['src/**/*.{ts,tsx}'],
  provider: 'v8' as const,
  reporter: ['text', 'json-summary', 'html', 'lcov'],
}

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    exclude: sharedTestExclude,
    coverage: {
      ...sharedCoverageConfig,
      reportsDirectory: './coverage/all',
    },
  },
  resolve: {
    alias: [
      {
        find: /^@desktop\/(.*)$/,
        replacement: `${path.resolve(__dirname, '../desktop/src')}/$1`,
      },
      {
        find: /^@\/kickstart\/(.*)$/,
        replacement: `${path.resolve(__dirname, './kickstart')}/$1`,
      },
      {
        find: /^@\//,
        replacement: `${path.resolve(__dirname, './src')}/`,
      },
    ],
  },
})
