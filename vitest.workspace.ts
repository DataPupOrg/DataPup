import { defineWorkspace } from 'vitest/config'
import { resolve } from 'path'

export default defineWorkspace([
  {
    test: {
      name: 'main',
      environment: 'node',
      include: ['src/main/**/*.{test,spec}.{js,ts}'],
      setupFiles: ['./tests/helpers/setup-main.ts']
    },
    resolve: {
      alias: {
        '@tests': resolve(__dirname, './tests')
      }
    }
  },
  {
    test: {
      name: 'renderer',
      environment: 'happy-dom',
      include: ['src/renderer/**/*.{test,spec}.{js,ts,jsx,tsx}'],
      setupFiles: ['./tests/helpers/setup-renderer.ts']
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, './src/renderer'),
        '@tests': resolve(__dirname, './tests')
      }
    }
  },
  {
    test: {
      name: 'integration',
      environment: 'node',
      include: ['tests/integration/**/*.{test,spec}.{js,ts}'],
      setupFiles: ['./tests/helpers/setup-integration.ts']
    },
    resolve: {
      alias: {
        '@tests': resolve(__dirname, './tests')
      }
    }
  }
])