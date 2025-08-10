import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { skipIfNoDatabase } from '../helpers/setup-integration'
import {
  createTestConnection,
  TestTableManager,
  TestTransactionManager,
  assertQuerySuccess,
  assertBulkOperationSuccess,
  waitForDatabase,
  TEST_CONFIGS
} from './test-helpers'

describe('Bulk Operations Integration Tests', () => {
  describe('PostgreSQL Bulk Operations', () => {
    const skip = skipIfNoDatabase('postgresql')
    let dbManager: any
    let connectionId: string
    let tableManager: TestTableManager
    let transactionManager: TestTransactionManager
    
    beforeAll(async () => {
      if (skip) return
      
      // Wait for database to be ready (useful for Docker startup)
      const isReady = await waitForDatabase(TEST_CONFIGS.postgresql)
      if (!isReady) {
        throw new Error('PostgreSQL test database is not available')
      }
      
      // Create connection
      const connection = await createTestConnection('postgresql')
      dbManager = connection.dbManager
      connectionId = connection.connectionId
      
      // Initialize helpers
      tableManager = new TestTableManager(dbManager, connectionId)
      transactionManager = new TestTransactionManager(dbManager, connectionId)
    })
    
    afterAll(async () => {
      if (skip) return
      
      // Clean up
      await tableManager.cleanup()
      await dbManager.disconnect(connectionId)
      await dbManager.cleanup()
    })
    
    beforeEach(async () => {
      if (skip) return
      await transactionManager.begin()
    })
    
    afterEach(async () => {
      if (skip) return
      await transactionManager.rollback()
    })
    
    it.skipIf(skip)('should execute bulk insert operations', async () => {
      // Create test table
      const tableName = await tableManager.createTestTable('bulk_insert')
      
      // Prepare bulk operations
      const operations = [
        {
          type: 'insert' as const,
          table: tableName,
          data: { name: 'Item 1', value: 100 }
        },
        {
          type: 'insert' as const,
          table: tableName,
          data: { name: 'Item 2', value: 200 }
        },
        {
          type: 'insert' as const,
          table: tableName,
          data: { name: 'Item 3', value: 300 }
        }
      ]
      
      // Execute bulk operations
      const result = await dbManager.executeBulkOperations(connectionId, operations)
      assertBulkOperationSuccess(result, 3)
      
      // Verify data was inserted
      const queryResult = await dbManager.query(
        connectionId,
        `SELECT * FROM ${tableName} ORDER BY value`
      )
      assertQuerySuccess(queryResult, 3)
      expect(queryResult.data[0].name).toBe('Item 1')
      expect(queryResult.data[1].name).toBe('Item 2')
      expect(queryResult.data[2].name).toBe('Item 3')
    })
    
    it.skipIf(skip)('should execute mixed bulk operations', async () => {
      // Create and populate test table
      const tableName = await tableManager.createTestTable('bulk_mixed')
      await tableManager.insertTestData(tableName, 3)
      
      // Get initial data
      const initialQuery = await dbManager.query(
        connectionId,
        `SELECT * FROM ${tableName} ORDER BY id`
      )
      const firstRowId = initialQuery.data[0].id
      const secondRowId = initialQuery.data[1].id
      
      // Prepare mixed operations
      const operations = [
        {
          type: 'update' as const,
          table: tableName,
          primaryKey: { id: firstRowId },
          data: { name: 'Updated Item', value: 999 }
        },
        {
          type: 'delete' as const,
          table: tableName,
          primaryKey: { id: secondRowId }
        },
        {
          type: 'insert' as const,
          table: tableName,
          data: { name: 'New Item', value: 400 }
        }
      ]
      
      // Execute bulk operations
      const result = await dbManager.executeBulkOperations(connectionId, operations)
      assertBulkOperationSuccess(result, 3)
      
      // Verify changes
      const finalQuery = await dbManager.query(
        connectionId,
        `SELECT * FROM ${tableName} ORDER BY id`
      )
      
      // Should have 3 rows (original 3 - 1 deleted + 1 inserted)
      expect(finalQuery.data).toHaveLength(3)
      
      // Check updated row
      const updatedRow = finalQuery.data.find((r: any) => r.id === firstRowId)
      expect(updatedRow.name).toBe('Updated Item')
      expect(updatedRow.value).toBe(999)
      
      // Check deleted row doesn't exist
      const deletedRow = finalQuery.data.find((r: any) => r.id === secondRowId)
      expect(deletedRow).toBeUndefined()
      
      // Check new row exists
      const newRow = finalQuery.data.find((r: any) => r.name === 'New Item')
      expect(newRow).toBeDefined()
      expect(newRow.value).toBe(400)
    })
    
    it.skipIf(skip)('should handle bulk operation failures with rollback', async () => {
      // Create test table
      const tableName = await tableManager.createTestTable('bulk_failure')
      await tableManager.insertTestData(tableName, 2)
      
      // Prepare operations with one that will fail
      const operations = [
        {
          type: 'insert' as const,
          table: tableName,
          data: { name: 'Valid Item', value: 100 }
        },
        {
          type: 'update' as const,
          table: tableName,
          primaryKey: { id: 999999 }, // Non-existent ID
          data: { name: 'This will fail' }
        }
      ]
      
      // Execute bulk operations (should fail and rollback)
      const result = await dbManager.executeBulkOperations(connectionId, operations)
      
      // Transaction should be rolled back
      expect(result.success).toBe(false)
      expect(result.error).toContain('rolled back')
      
      // Verify no changes were made (transaction rolled back)
      const queryResult = await dbManager.query(
        connectionId,
        `SELECT COUNT(*) as count FROM ${tableName}`
      )
      expect(queryResult.data[0].count).toBe('2') // Original 2 rows, no new inserts
    })
    
    it.skipIf(skip)('should handle PostgreSQL-specific schema in bulk operations', async () => {
      // This tests that our PostgreSQL implementation correctly uses schema.table format
      const tableName = await tableManager.createTestTable('schema_test')
      
      // Use bulk operations with explicit database parameter (should be ignored)
      const operations = [
        {
          type: 'insert' as const,
          table: tableName,
          data: { name: 'Schema Test', value: 100 },
          database: 'ignored_database' // This should be ignored in PostgreSQL
        }
      ]
      
      const result = await dbManager.executeBulkOperations(connectionId, operations)
      assertBulkOperationSuccess(result, 1)
      
      // Verify the insert worked (proves schema handling is correct)
      const queryResult = await dbManager.query(
        connectionId,
        `SELECT * FROM ${tableName} WHERE name = 'Schema Test'`
      )
      assertQuerySuccess(queryResult, 1)
      expect(queryResult.data[0].value).toBe(100)
    })
  })
  
  describe('ClickHouse Bulk Operations', () => {
    const skip = skipIfNoDatabase('clickhouse')
    let dbManager: any
    let connectionId: string
    let tableManager: TestTableManager
    
    beforeAll(async () => {
      if (skip) return
      
      // Wait for database to be ready
      const isReady = await waitForDatabase(TEST_CONFIGS.clickhouse)
      if (!isReady) {
        throw new Error('ClickHouse test database is not available')
      }
      
      // Create connection
      const connection = await createTestConnection('clickhouse')
      dbManager = connection.dbManager
      connectionId = connection.connectionId
      
      // Initialize helpers
      tableManager = new TestTableManager(dbManager, connectionId)
    })
    
    afterAll(async () => {
      if (skip) return
      
      // Clean up
      await tableManager.cleanup()
      await dbManager.disconnect(connectionId)
      await dbManager.cleanup()
    })
    
    it.skipIf(skip)('should execute bulk insert operations in ClickHouse', async () => {
      // Create ClickHouse-specific test table
      const tableName = `test_bulk_${Date.now()}`
      const createSQL = `
        CREATE TABLE ${tableName} (
          id UInt32,
          name String,
          value UInt32,
          created_at DateTime DEFAULT now()
        ) ENGINE = MergeTree()
        ORDER BY id
      `
      
      await dbManager.query(connectionId, createSQL)
      
      // Prepare bulk operations
      const operations = [
        {
          type: 'insert' as const,
          table: tableName,
          data: { id: 1, name: 'Item 1', value: 100 }
        },
        {
          type: 'insert' as const,
          table: tableName,
          data: { id: 2, name: 'Item 2', value: 200 }
        }
      ]
      
      // Execute bulk operations
      const result = await dbManager.executeBulkOperations(connectionId, operations)
      assertBulkOperationSuccess(result, 2)
      
      // Wait a bit for ClickHouse to process (eventual consistency)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Verify data
      const queryResult = await dbManager.query(
        connectionId,
        `SELECT * FROM ${tableName} ORDER BY id`
      )
      assertQuerySuccess(queryResult, 2)
      
      // Clean up
      await dbManager.query(connectionId, `DROP TABLE ${tableName}`)
    })
  })
})