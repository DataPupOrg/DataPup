import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PostgreSQLManager } from '../postgresql'
import { mockDatabaseConfig, mockBulkOperations } from '@tests/fixtures/test-data'

// Mock the pg module
vi.mock('pg', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined)
  }))
}))

describe('PostgreSQLManager', () => {
  let pgManager: PostgreSQLManager
  let mockClient: any

  beforeEach(() => {
    vi.clearAllMocks()
    pgManager = new PostgreSQLManager()
    
    // Get the mocked client
    const { Client } = require('pg')
    mockClient = new Client()
  })

  describe('connect', () => {
    it('should establish a PostgreSQL connection', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ '?column?': 1 }] })
      
      const result = await pgManager.connect(
        mockDatabaseConfig.postgresql,
        'test-connection'
      )
      
      expect(result.success).toBe(true)
      expect(result.message).toContain('Connected to PostgreSQL')
      expect(mockClient.connect).toHaveBeenCalled()
    })

    it('should handle connection errors', async () => {
      mockClient.connect.mockRejectedValue(new Error('Connection refused'))
      
      const result = await pgManager.connect(
        mockDatabaseConfig.postgresql,
        'test-connection'
      )
      
      expect(result.success).toBe(false)
      expect(result.message).toContain('Failed to connect')
    })
  })

  describe('escapeIdentifier', () => {
    it('should properly escape PostgreSQL identifiers', () => {
      // Access the protected method through a subclass or type assertion
      const manager = pgManager as any
      
      expect(manager.escapeIdentifier('table')).toBe('"table"')
      expect(manager.escapeIdentifier('table"name')).toBe('"table""name"')
      expect(manager.escapeIdentifier('my-table')).toBe('"my-table"')
    })
  })

  describe('escapeValue', () => {
    it('should properly escape values', () => {
      const manager = pgManager as any
      
      expect(manager.escapeValue(null)).toBe('NULL')
      expect(manager.escapeValue('string')).toBe("'string'")
      expect(manager.escapeValue("it's")).toBe("'it''s'")
      expect(manager.escapeValue(123)).toBe('123')
      expect(manager.escapeValue(true)).toBe('true')
      expect(manager.escapeValue(false)).toBe('false')
      expect(manager.escapeValue(new Date('2024-01-01'))).toContain('2024-01-01')
    })
  })

  describe('CRUD operations with schema support', () => {
    beforeEach(async () => {
      // Setup connection
      mockClient.query.mockResolvedValue({ rows: [{ '?column?': 1 }] })
      await pgManager.connect(mockDatabaseConfig.postgresql, 'test-connection')
      mockClient.query.mockClear()
    })

    describe('insertRow', () => {
      it('should use public schema for table qualification', async () => {
        mockClient.query.mockResolvedValue({ 
          rows: [], 
          rowCount: 1 
        })
        
        await pgManager.insertRow(
          'test-connection',
          'users',
          { name: 'John', age: 30 },
          'ignored_database' // This should be ignored
        )
        
        const executedSql = mockClient.query.mock.calls[0][0]
        expect(executedSql).toContain('"public"."users"')
        expect(executedSql).not.toContain('ignored_database')
        expect(executedSql).toContain('INSERT INTO')
      })
    })

    describe('updateRow', () => {
      it('should use public schema for table qualification', async () => {
        mockClient.query.mockResolvedValue({ 
          rows: [], 
          rowCount: 1 
        })
        
        await pgManager.updateRow(
          'test-connection',
          'users',
          { id: 1 },
          { name: 'Jane' },
          'ignored_database'
        )
        
        const executedSql = mockClient.query.mock.calls[0][0]
        expect(executedSql).toContain('"public"."users"')
        expect(executedSql).not.toContain('ignored_database')
        expect(executedSql).toContain('UPDATE')
        expect(executedSql).toContain('SET')
        expect(executedSql).toContain('WHERE')
      })
    })

    describe('deleteRow', () => {
      it('should use public schema for table qualification', async () => {
        mockClient.query.mockResolvedValue({ 
          rows: [], 
          rowCount: 1 
        })
        
        await pgManager.deleteRow(
          'test-connection',
          'users',
          { id: 1 },
          'ignored_database'
        )
        
        const executedSql = mockClient.query.mock.calls[0][0]
        expect(executedSql).toContain('"public"."users"')
        expect(executedSql).not.toContain('ignored_database')
        expect(executedSql).toContain('DELETE FROM')
        expect(executedSql).toContain('WHERE')
      })
    })
  })

  describe('queryTable', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [{ '?column?': 1 }] })
      await pgManager.connect(mockDatabaseConfig.postgresql, 'test-connection')
      mockClient.query.mockClear()
    })

    it('should build correct query with schema', async () => {
      mockClient.query.mockResolvedValue({ 
        rows: [{ id: 1, name: 'Test' }],
        rowCount: 1
      })
      
      await pgManager.queryTable('test-connection', {
        database: 'ignored',
        table: 'users',
        filters: [
          { column: 'active', operator: '=', value: true }
        ],
        orderBy: [{ column: 'name', direction: 'asc' }],
        limit: 10,
        offset: 0
      })
      
      const executedSql = mockClient.query.mock.calls[0][0]
      expect(executedSql).toContain('"public"."users"')
      expect(executedSql).toContain('WHERE')
      expect(executedSql).toContain('ORDER BY')
      expect(executedSql).toContain('LIMIT 10')
    })
  })

  describe('getDatabases', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [{ '?column?': 1 }] })
      await pgManager.connect(mockDatabaseConfig.postgresql, 'test-connection')
      mockClient.query.mockClear()
    })

    it('should retrieve list of databases', async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          { datname: 'postgres' },
          { datname: 'test_db' },
          { datname: 'production' }
        ]
      })
      
      const result = await pgManager.getDatabases('test-connection')
      
      expect(result.success).toBe(true)
      expect(result.databases).toEqual(['postgres', 'test_db', 'production'])
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_database')
      )
    })
  })

  describe('getTables', () => {
    beforeEach(async () => {
      mockClient.query.mockResolvedValue({ rows: [{ '?column?': 1 }] })
      await pgManager.connect(mockDatabaseConfig.postgresql, 'test-connection')
      mockClient.query.mockClear()
    })

    it('should retrieve list of tables from public schema', async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          { tablename: 'users' },
          { tablename: 'products' },
          { tablename: 'orders' }
        ]
      })
      
      const result = await pgManager.getTables('test-connection')
      
      expect(result.success).toBe(true)
      expect(result.tables).toEqual(['users', 'products', 'orders'])
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_tables')
      )
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("schemaname = 'public'")
      )
    })
  })

  describe('getCapabilities', () => {
    it('should return PostgreSQL capabilities', () => {
      const capabilities = pgManager.getCapabilities()
      
      expect(capabilities.supportsTransactions).toBe(true)
      expect(capabilities.supportsBatchOperations).toBe(true)
      expect(capabilities.supportsReturning).toBe(true)
      expect(capabilities.supportsUpsert).toBe(true)
      expect(capabilities.supportsSchemas).toBe(true)
      expect(capabilities.requiresPrimaryKey).toBe(false)
      expect(capabilities.defaultSchema).toBe('public')
    })
  })

  describe('disconnect', () => {
    it('should properly disconnect from PostgreSQL', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ '?column?': 1 }] })
      await pgManager.connect(mockDatabaseConfig.postgresql, 'test-connection')
      
      await pgManager.disconnect('test-connection')
      
      expect(mockClient.end).toHaveBeenCalled()
    })
  })
})