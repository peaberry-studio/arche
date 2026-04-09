import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
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
