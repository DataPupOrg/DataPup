import { vi } from 'vitest'

// Global test setup
beforeAll(() => {
  // Set test environment variables if needed
  process.env.NODE_ENV = 'test'
})

// Mock console methods to reduce test output noise
global.console = {
  ...console,
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  // Keep warn and error for debugging
  warn: console.warn,
  error: console.error
}

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks()
})

// Clean up after all tests
afterAll(() => {
  vi.restoreAllMocks()
})