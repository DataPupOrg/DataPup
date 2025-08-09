import { vi, beforeAll, afterEach, afterAll } from 'vitest'
import '@testing-library/jest-dom/vitest'

// Setup for renderer process tests
beforeAll(() => {
  process.env.NODE_ENV = 'test'
  
  // Mock window.electron API
  Object.defineProperty(window, 'electron', {
    value: {
      database: {
        testConnection: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        query: vi.fn(),
        getDatabases: vi.fn(),
        getTables: vi.fn(),
        getTableSchema: vi.fn(),
        insertRow: vi.fn(),
        updateRow: vi.fn(),
        deleteRow: vi.fn(),
        executeBulkOperations: vi.fn()
      },
      llm: {
        generateSQL: vi.fn(),
        explainQuery: vi.fn()
      },
      storage: {
        saveConnection: vi.fn(),
        getConnections: vi.fn(),
        deleteConnection: vi.fn()
      }
    },
    writable: true,
    configurable: true
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

afterAll(() => {
  vi.restoreAllMocks()
})