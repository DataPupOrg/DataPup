import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DatabaseManager } from '../../src/main/database/manager'
import { skipIfNoDatabase } from '../helpers/setup-integration'

describe('Database Connection Integration Tests', () => {
  let dbManager: DatabaseManager
  
  beforeAll(() => {
    dbManager = new DatabaseManager()
  })
  
  afterAll(async () => {
    await dbManager.cleanup()
  })

  describe('PostgreSQL Connection', () => {
    const skip = skipIfNoDatabase('postgresql')
    
    it.skipIf(skip)('should connect to PostgreSQL database', async () => {
      const config = {
        type: 'postgresql',
        host: process.env.TEST_POSTGRESQL_HOST || 'localhost',
        port: parseInt(process.env.TEST_POSTGRESQL_PORT || '5432'),
        database: process.env.TEST_POSTGRESQL_DB || 'test_db',
        username: process.env.TEST_POSTGRESQL_USER || 'test_user',
        password: process.env.TEST_POSTGRESQL_PASSWORD || 'test_password',
        ssl: false,
        timeout: 30000
      }
      
      const result = await dbManager.testConnection(config)
      
      // This test will only run if TEST_POSTGRESQL_URL is set
      expect(result.success).toBe(true)
      expect(result.message).toContain('successful')
    })

    it.skipIf(skip)('should execute queries on PostgreSQL', async () => {
      const config = {
        type: 'postgresql',
        host: process.env.TEST_POSTGRESQL_HOST || 'localhost',
        port: parseInt(process.env.TEST_POSTGRESQL_PORT || '5432'),
        database: process.env.TEST_POSTGRESQL_DB || 'test_db',
        username: process.env.TEST_POSTGRESQL_USER || 'test_user',
        password: process.env.TEST_POSTGRESQL_PASSWORD || 'test_password',
        ssl: false,
        timeout: 30000
      }
      
      const connectionId = 'test-pg-connection'
      const connectResult = await dbManager.connect(config, connectionId)
      expect(connectResult.success).toBe(true)
      
      // Test a simple query
      const queryResult = await dbManager.query(connectionId, 'SELECT 1 as test_value')
      expect(queryResult.success).toBe(true)
      expect(queryResult.data).toHaveLength(1)
      expect(queryResult.data[0].test_value).toBe(1)
      
      // Clean up
      await dbManager.disconnect(connectionId)
    })
  })

  describe('ClickHouse Connection', () => {
    const skip = skipIfNoDatabase('clickhouse')
    
    it.skipIf(skip)('should connect to ClickHouse database', async () => {
      const config = {
        type: 'clickhouse',
        host: process.env.TEST_CLICKHOUSE_HOST || 'localhost',
        port: parseInt(process.env.TEST_CLICKHOUSE_PORT || '8123'),
        database: process.env.TEST_CLICKHOUSE_DB || 'default',
        username: process.env.TEST_CLICKHOUSE_USER || 'default',
        password: process.env.TEST_CLICKHOUSE_PASSWORD || '',
        secure: false,
        timeout: 30000
      }
      
      const result = await dbManager.testConnection(config)
      
      // This test will only run if TEST_CLICKHOUSE_URL is set
      expect(result.success).toBe(true)
      expect(result.message).toContain('successful')
    })
  })
})