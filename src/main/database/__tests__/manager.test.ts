import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseManager } from '../manager'
import { DatabaseManagerFactory } from '../factory'
import { mockDatabaseConfig, mockQueryResults } from '@tests/fixtures/test-data'

// Mock the factory
vi.mock('../factory')

describe('DatabaseManager', () => {
  let dbManager: DatabaseManager
  let mockFactory: any
  let mockDbImplementation: any

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()
    
    // Create mock database implementation
    mockDbImplementation = {
      connect: vi.fn().mockResolvedValue({ success: true, message: 'Connected' }),
      disconnect: vi.fn().mockResolvedValue({ success: true, message: 'Disconnected' }),
      query: vi.fn().mockResolvedValue(mockQueryResults.success),
      getDatabases: vi.fn().mockResolvedValue({ 
        success: true, 
        databases: ['db1', 'db2'],
        message: 'Found 2 databases'
      }),
      getTables: vi.fn().mockResolvedValue({
        success: true,
        tables: ['table1', 'table2'],
        message: 'Found 2 tables'
      }),
      getTableSchema: vi.fn().mockResolvedValue({
        success: true,
        schema: [],
        message: 'Schema retrieved'
      }),
      isConnected: vi.fn().mockReturnValue(true),
      isReadOnly: vi.fn().mockReturnValue(false),
      getCapabilities: vi.fn().mockReturnValue({
        supportsTransactions: true,
        supportsBatchOperations: true,
        supportsReturning: true,
        supportsUpsert: true,
        supportsSchemas: true,
        requiresPrimaryKey: false
      }),
      insertRow: vi.fn().mockResolvedValue({ success: true }),
      updateRow: vi.fn().mockResolvedValue({ success: true }),
      deleteRow: vi.fn().mockResolvedValue({ success: true }),
      executeBulkOperations: vi.fn().mockResolvedValue({ 
        success: true, 
        results: [] 
      }),
      getConnectionInfo: vi.fn().mockReturnValue({
        host: 'localhost',
        port: 5432,
        database: 'test_db',
        type: 'postgresql'
      }),
      getAllConnections: vi.fn().mockReturnValue(['connection1']),
      getPrimaryKeys: vi.fn().mockResolvedValue(['id']),
      getTableFullSchema: vi.fn().mockResolvedValue({
        success: true,
        schema: { columns: [], primaryKeys: ['id'], uniqueKeys: [] }
      }),
      supportsTransactions: vi.fn().mockReturnValue(true)
    }

    // Mock factory methods
    mockFactory = {
      isSupported: vi.fn().mockReturnValue(true),
      getManager: vi.fn().mockReturnValue(mockDbImplementation),
      getSupportedTypes: vi.fn().mockReturnValue(['postgresql', 'clickhouse'])
    }

    // Apply mock
    DatabaseManagerFactory.prototype.isSupported = mockFactory.isSupported
    DatabaseManagerFactory.prototype.getManager = mockFactory.getManager
    DatabaseManagerFactory.prototype.getSupportedTypes = mockFactory.getSupportedTypes

    dbManager = new DatabaseManager()
  })

  describe('testConnection', () => {
    it('should successfully test a connection', async () => {
      const result = await dbManager.testConnection(mockDatabaseConfig.postgresql)
      
      expect(result.success).toBe(true)
      expect(result.message).toBe('Connection test successful')
      expect(mockDbImplementation.connect).toHaveBeenCalled()
      expect(mockDbImplementation.disconnect).toHaveBeenCalled()
    })

    it('should handle unsupported database types', async () => {
      mockFactory.isSupported.mockReturnValue(false)
      
      const result = await dbManager.testConnection({
        ...mockDatabaseConfig.postgresql,
        type: 'unsupported'
      })
      
      expect(result.success).toBe(false)
      expect(result.message).toContain('Unsupported database type')
    })

    it('should handle connection failures', async () => {
      mockDbImplementation.connect.mockResolvedValue({
        success: false,
        message: 'Connection failed'
      })
      
      const result = await dbManager.testConnection(mockDatabaseConfig.postgresql)
      
      expect(result.success).toBe(false)
      expect(mockDbImplementation.disconnect).not.toHaveBeenCalled()
    })
  })

  describe('connect', () => {
    it('should establish a connection', async () => {
      const connectionId = 'test-connection'
      const result = await dbManager.connect(mockDatabaseConfig.postgresql, connectionId)
      
      expect(result.success).toBe(true)
      expect(mockDbImplementation.connect).toHaveBeenCalledWith(
        mockDatabaseConfig.postgresql,
        connectionId
      )
    })

    it('should disconnect existing connection before connecting new one', async () => {
      const connectionId1 = 'connection1'
      const connectionId2 = 'connection2'
      
      await dbManager.connect(mockDatabaseConfig.postgresql, connectionId1)
      await dbManager.connect(mockDatabaseConfig.clickhouse, connectionId2)
      
      expect(mockDbImplementation.disconnect).toHaveBeenCalledWith(connectionId1)
    })
  })

  describe('query', () => {
    it('should execute a query on active connection', async () => {
      const connectionId = 'test-connection'
      const sql = 'SELECT * FROM users'
      
      await dbManager.connect(mockDatabaseConfig.postgresql, connectionId)
      const result = await dbManager.query(connectionId, sql)
      
      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(2)
      expect(mockDbImplementation.query).toHaveBeenCalledWith(connectionId, sql, undefined)
    })

    it('should return error when no active connection', async () => {
      const result = await dbManager.query('non-existent', 'SELECT 1')
      
      expect(result.success).toBe(false)
      expect(result.error).toBe('No active connection')
    })
  })

  describe('executeBulkOperations', () => {
    it('should execute bulk operations', async () => {
      const connectionId = 'test-connection'
      const operations = [
        { type: 'insert' as const, table: 'users', data: { name: 'Test' } }
      ]
      
      await dbManager.connect(mockDatabaseConfig.postgresql, connectionId)
      const result = await dbManager.executeBulkOperations(connectionId, operations)
      
      expect(result.success).toBe(true)
      expect(mockDbImplementation.executeBulkOperations).toHaveBeenCalledWith(
        connectionId,
        operations
      )
    })
  })

  describe('getSupportedDatabaseTypes', () => {
    it('should return list of supported database types', () => {
      const types = dbManager.getSupportedDatabaseTypes()
      
      expect(types).toEqual(['postgresql', 'clickhouse'])
      expect(mockFactory.getSupportedTypes).toHaveBeenCalled()
    })
  })

  describe('disconnect', () => {
    it('should disconnect active connection', async () => {
      const connectionId = 'test-connection'
      
      await dbManager.connect(mockDatabaseConfig.postgresql, connectionId)
      const result = await dbManager.disconnect(connectionId)
      
      expect(result.success).toBe(true)
      expect(mockDbImplementation.disconnect).toHaveBeenCalledWith(connectionId)
    })

    it('should return error when disconnecting non-existent connection', async () => {
      const result = await dbManager.disconnect('non-existent')
      
      expect(result.success).toBe(false)
      expect(result.message).toBe('Connection not found')
    })
  })
})