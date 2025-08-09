import { vi, beforeAll, afterEach, afterAll } from 'vitest'

// Setup for integration tests
beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.INTEGRATION_TEST = 'true'
  
  // Set reasonable timeouts for integration tests
  vi.setConfig({ testTimeout: 30000 })
})

// Helper to skip tests if database is not available
export const skipIfNoDatabase = (databaseType: string) => {
  const envVar = `TEST_${databaseType.toUpperCase()}_URL`
  const skip = !process.env[envVar]
  
  if (skip) {
    console.warn(`Skipping ${databaseType} integration tests. Set ${envVar} to run these tests.`)
  }
  
  return skip
}

afterEach(() => {
  vi.clearAllMocks()
})

afterAll(() => {
  vi.restoreAllMocks()
})