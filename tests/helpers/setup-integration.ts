import { vi, beforeAll, afterEach, afterAll } from 'vitest'

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.INTEGRATION_TEST = 'true'
  vi.setConfig({ testTimeout: 30000 })
})

afterEach(() => {
  vi.clearAllMocks()
})

afterAll(() => {
  vi.restoreAllMocks()
})