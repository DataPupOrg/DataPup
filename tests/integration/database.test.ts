import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { 
  PostgreSQLTestContainer, 
  ClickHouseTestContainer,
  TestTableHelper,
  shouldSkipContainerTests
} from './testcontainer-helpers'

describe('Database Integration Tests', () => {
  describe('PostgreSQL', () => {
    let pgContainer: PostgreSQLTestContainer
    let dbManager: any
    let connectionId: string
    let tableHelper: TestTableHelper
    let skip: boolean

    beforeAll(async () => {
      skip = await shouldSkipContainerTests()
      if (skip) return

      pgContainer = new PostgreSQLTestContainer()
      const setup = await pgContainer.start()
      dbManager = setup.dbManager
      connectionId = setup.connectionId
      tableHelper = new TestTableHelper(dbManager, connectionId, 'postgresql')
    }, 60000)

    afterAll(async () => {
      if (!skip && pgContainer) {
        await pgContainer.stop()
      }
    })

    it.skipIf(skip)('should connect to PostgreSQL', async () => {
      const result = await dbManager.query(connectionId, 'SELECT version()')
      expect(result.success).toBe(true)
      expect(result.data[0].version).toContain('PostgreSQL')
    })

    it.skipIf(skip)('should perform CRUD operations', async () => {
      const tableName = await tableHelper.createTestTable()
      
      await tableHelper.insertTestData(tableName, 3)
      
      const result = await dbManager.query(
        connectionId,
        `SELECT * FROM ${tableName} ORDER BY value`
      )
      
      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(3)
      expect(result.data[0].name).toBe('Test Item 1')
      expect(result.data[2].value).toBe(300)
      
      await tableHelper.dropTable(tableName)
    })

    it.skipIf(skip)('should handle transactions', async () => {
      const tableName = await tableHelper.createTestTable('transaction_test')
      
      await pgContainer.executeInTransaction(async (db, connId) => {
        await db.insertRow(connId, tableName, { name: 'Transaction Test', value: 999 })
        
        const result = await db.query(connId, `SELECT * FROM ${tableName}`)
        expect(result.data).toHaveLength(1)
      })
      
      const finalResult = await dbManager.query(
        connectionId,
        `SELECT * FROM ${tableName}`
      )
      expect(finalResult.data).toHaveLength(0)
      
      await tableHelper.dropTable(tableName)
    })

    it.skipIf(skip)('should handle bulk operations', async () => {
      const tableName = await tableHelper.createTestTable('bulk_test')
      
      const operations = [
        {
          type: 'insert' as const,
          table: tableName,
          data: { name: 'Bulk Item 1', value: 100 }
        },
        {
          type: 'insert' as const,
          table: tableName,
          data: { name: 'Bulk Item 2', value: 200 }
        },
        {
          type: 'insert' as const,
          table: tableName,
          data: { name: 'Bulk Item 3', value: 300 }
        }
      ]
      
      const result = await dbManager.executeBulkOperations(connectionId, operations)
      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(3)
      
      const queryResult = await dbManager.query(
        connectionId,
        `SELECT * FROM ${tableName} ORDER BY value`
      )
      expect(queryResult.data).toHaveLength(3)
      expect(queryResult.data[0].value).toBe(100)
      expect(queryResult.data[2].value).toBe(300)
      
      await tableHelper.dropTable(tableName)
    })

    it.skipIf(skip)('should use public schema correctly', async () => {
      const tableName = await tableHelper.createTestTable('schema_test')
      
      await dbManager.insertRow(
        connectionId,
        tableName,
        { name: 'Schema Test', value: 123 },
        'ignored_database'
      )
      
      const result = await dbManager.query(
        connectionId,
        `SELECT * FROM public.${tableName}`
      )
      
      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(1)
      expect(result.data[0].name).toBe('Schema Test')
      
      await tableHelper.dropTable(tableName)
    })
  })

  describe('ClickHouse', () => {
    let chContainer: ClickHouseTestContainer
    let dbManager: any
    let connectionId: string
    let tableHelper: TestTableHelper
    let skip: boolean

    beforeAll(async () => {
      skip = await shouldSkipContainerTests()
      if (skip) return

      chContainer = new ClickHouseTestContainer()
      const setup = await chContainer.start()
      dbManager = setup.dbManager
      connectionId = setup.connectionId
      tableHelper = new TestTableHelper(dbManager, connectionId, 'clickhouse')
    }, 60000)

    afterAll(async () => {
      if (!skip && chContainer) {
        await chContainer.stop()
      }
    })

    it.skipIf(skip)('should connect to ClickHouse', async () => {
      const result = await dbManager.query(connectionId, 'SELECT version()')
      expect(result.success).toBe(true)
      expect(result.data[0]['version()']).toContain('24.3')
    })

    it.skipIf(skip)('should perform CRUD operations', async () => {
      const tableName = await tableHelper.createTestTable('clickhouse_test')
      
      await tableHelper.insertTestData(tableName, 3)
      
      const result = await dbManager.query(
        connectionId,
        `SELECT * FROM ${tableName} ORDER BY id`
      )
      
      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(3)
      expect(result.data[0].name).toBe('Test Item 1')
      expect(result.data[2].value).toBe(300)
      
      await tableHelper.dropTable(tableName)
    })

    it.skipIf(skip)('should handle aggregations', async () => {
      const tableName = await tableHelper.createTestTable('ch_agg')
      
      await dbManager.insertRow(connectionId, tableName, {
        id: 1,
        name: 'ClickHouse Test',
        value: 500
      })
      
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const result = await dbManager.query(
        connectionId,
        `SELECT name, sum(value) as total FROM ${tableName} GROUP BY name`
      )
      
      expect(result.success).toBe(true)
      expect(result.data[0].total).toBe(500)
      
      await tableHelper.dropTable(tableName)
    })
  })

  describe('Container Isolation', () => {
    let skip: boolean

    beforeAll(async () => {
      skip = await shouldSkipContainerTests()
    })

    it.skipIf(skip)('should provide isolated containers', async () => {
      const container1 = new PostgreSQLTestContainer()
      const container2 = new PostgreSQLTestContainer()
      
      const setup1 = await container1.start()
      const setup2 = await container2.start()
      
      const tableName = 'isolation_test'
      
      await setup1.dbManager.query(
        setup1.connectionId,
        `CREATE TABLE ${tableName} (id SERIAL PRIMARY KEY, data TEXT)`
      )
      
      await setup2.dbManager.query(
        setup2.connectionId,
        `CREATE TABLE ${tableName} (id SERIAL PRIMARY KEY, data TEXT)`
      )
      
      await setup1.dbManager.insertRow(
        setup1.connectionId,
        tableName,
        { data: 'Container 1 Data' }
      )
      
      await setup2.dbManager.insertRow(
        setup2.connectionId,
        tableName,
        { data: 'Container 2 Data' }
      )
      
      const result1 = await setup1.dbManager.query(
        setup1.connectionId,
        `SELECT * FROM ${tableName}`
      )
      const result2 = await setup2.dbManager.query(
        setup2.connectionId,
        `SELECT * FROM ${tableName}`
      )
      
      expect(result1.data[0].data).toBe('Container 1 Data')
      expect(result2.data[0].data).toBe('Container 2 Data')
      
      await container1.stop()
      await container2.stop()
    }, 120000)
  })
})