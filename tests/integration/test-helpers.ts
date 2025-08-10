import { DatabaseManager } from '../../src/main/database/manager'
import { DatabaseConfig } from '../../src/main/database/interface'

/**
 * Test database configurations
 */
export const TEST_CONFIGS = {
  postgresql: {
    type: 'postgresql' as const,
    host: process.env.TEST_POSTGRESQL_HOST || 'localhost',
    port: parseInt(process.env.TEST_POSTGRESQL_PORT || '5433'), // Docker port
    database: process.env.TEST_POSTGRESQL_DB || 'datapup_test',
    username: process.env.TEST_POSTGRESQL_USER || 'test_user',
    password: process.env.TEST_POSTGRESQL_PASSWORD || 'test_password',
    ssl: false,
    timeout: 30000
  },
  clickhouse: {
    type: 'clickhouse' as const,
    host: process.env.TEST_CLICKHOUSE_HOST || 'localhost',
    port: parseInt(process.env.TEST_CLICKHOUSE_PORT || '8124'), // Docker port
    database: process.env.TEST_CLICKHOUSE_DB || 'datapup_test',
    username: process.env.TEST_CLICKHOUSE_USER || 'test_user',
    password: process.env.TEST_CLICKHOUSE_PASSWORD || 'test_password',
    secure: false,
    timeout: 30000
  }
}

/**
 * Test table utilities
 */
export class TestTableManager {
  private dbManager: DatabaseManager
  private connectionId: string
  private createdTables: string[] = []

  constructor(dbManager: DatabaseManager, connectionId: string) {
    this.dbManager = dbManager
    this.connectionId = connectionId
  }

  /**
   * Create a test table with a unique name
   */
  async createTestTable(prefix = 'test_table'): Promise<string> {
    const tableName = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}`
    
    const createSQL = `
      CREATE TABLE ${tableName} (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        value INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `
    
    await this.dbManager.query(this.connectionId, createSQL)
    this.createdTables.push(tableName)
    
    return tableName
  }

  /**
   * Insert test data
   */
  async insertTestData(tableName: string, count = 5): Promise<void> {
    for (let i = 1; i <= count; i++) {
      await this.dbManager.insertRow(
        this.connectionId,
        tableName,
        {
          name: `Test Item ${i}`,
          value: i * 100
        }
      )
    }
  }

  /**
   * Clean up all created test tables
   */
  async cleanup(): Promise<void> {
    for (const table of this.createdTables) {
      try {
        await this.dbManager.query(
          this.connectionId,
          `DROP TABLE IF EXISTS ${table}`
        )
      } catch (error) {
        console.warn(`Failed to drop test table ${table}:`, error)
      }
    }
    this.createdTables = []
  }
}

/**
 * Test transaction manager for PostgreSQL
 */
export class TestTransactionManager {
  private dbManager: DatabaseManager
  private connectionId: string
  private inTransaction = false

  constructor(dbManager: DatabaseManager, connectionId: string) {
    this.dbManager = dbManager
    this.connectionId = connectionId
  }

  async begin(): Promise<void> {
    if (!this.inTransaction) {
      await this.dbManager.query(this.connectionId, 'BEGIN')
      this.inTransaction = true
    }
  }

  async rollback(): Promise<void> {
    if (this.inTransaction) {
      await this.dbManager.query(this.connectionId, 'ROLLBACK')
      this.inTransaction = false
    }
  }

  async commit(): Promise<void> {
    if (this.inTransaction) {
      await this.dbManager.query(this.connectionId, 'COMMIT')
      this.inTransaction = false
    }
  }
}

/**
 * Wait for database to be ready
 */
export async function waitForDatabase(
  config: DatabaseConfig,
  maxRetries = 30,
  retryDelay = 1000
): Promise<boolean> {
  const dbManager = new DatabaseManager()
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await dbManager.testConnection(config)
      if (result.success) {
        await dbManager.cleanup()
        return true
      }
    } catch (error) {
      // Ignore connection errors during startup
    }
    
    await new Promise(resolve => setTimeout(resolve, retryDelay))
  }
  
  await dbManager.cleanup()
  return false
}

/**
 * Create a test database connection
 */
export async function createTestConnection(
  dbType: 'postgresql' | 'clickhouse'
): Promise<{ dbManager: DatabaseManager; connectionId: string; config: DatabaseConfig }> {
  const dbManager = new DatabaseManager()
  const config = TEST_CONFIGS[dbType]
  const connectionId = `test-${dbType}-${Date.now()}`
  
  const connectResult = await dbManager.connect(config, connectionId)
  
  if (!connectResult.success) {
    throw new Error(`Failed to connect to ${dbType}: ${connectResult.message}`)
  }
  
  return { dbManager, connectionId, config }
}

/**
 * Assert query result
 */
export function assertQuerySuccess(result: any, expectedRows?: number): void {
  expect(result.success).toBe(true)
  expect(result.error).toBeUndefined()
  
  if (expectedRows !== undefined) {
    expect(result.data).toHaveLength(expectedRows)
  }
}

/**
 * Assert bulk operation result
 */
export function assertBulkOperationSuccess(result: any, expectedOperations?: number): void {
  expect(result.success).toBe(true)
  expect(result.error).toBeUndefined()
  
  if (expectedOperations !== undefined) {
    expect(result.results).toHaveLength(expectedOperations)
    result.results.forEach((opResult: any) => {
      expect(opResult.success).toBe(true)
    })
  }
}