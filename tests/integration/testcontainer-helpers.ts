import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers'
import { DatabaseConfig } from '../../src/main/database/interface'
import { DatabaseManager } from '../../src/main/database/manager'

export class PostgreSQLTestContainer {
  private container?: StartedPostgreSqlContainer
  private dbManager?: DatabaseManager
  private connectionId?: string

  async start(): Promise<{
    config: DatabaseConfig
    dbManager: DatabaseManager
    connectionId: string
    container: StartedPostgreSqlContainer
  }> {
    this.container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('datapup_test')
      .withUsername('test_user')
      .withPassword('test_password')
      .withExposedPorts(5432)
      .start()

    const config: DatabaseConfig = {
      type: 'postgresql',
      host: this.container.getHost(),
      port: this.container.getPort(),
      database: this.container.getDatabase(),
      username: this.container.getUsername(),
      password: this.container.getPassword(),
      ssl: false,
      timeout: 30000
    }

    this.dbManager = new DatabaseManager()
    this.connectionId = `test-pg-${Date.now()}`
    
    const connectResult = await this.dbManager.connect(config, this.connectionId)
    if (!connectResult.success) {
      throw new Error(`Failed to connect to PostgreSQL: ${connectResult.message}`)
    }

    return {
      config,
      dbManager: this.dbManager,
      connectionId: this.connectionId,
      container: this.container
    }
  }

  async stop(): Promise<void> {
    if (this.dbManager && this.connectionId) {
      await this.dbManager.disconnect(this.connectionId)
      await this.dbManager.cleanup()
    }
    
    if (this.container) {
      await this.container.stop()
    }
  }

  async executeInTransaction<T>(
    fn: (dbManager: DatabaseManager, connectionId: string) => Promise<T>
  ): Promise<T> {
    if (!this.dbManager || !this.connectionId) {
      throw new Error('Container not started')
    }

    try {
      await this.dbManager.query(this.connectionId, 'BEGIN')
      const result = await fn(this.dbManager, this.connectionId)
      await this.dbManager.query(this.connectionId, 'ROLLBACK')
      return result
    } catch (error) {
      await this.dbManager.query(this.connectionId, 'ROLLBACK')
      throw error
    }
  }
}

export class ClickHouseTestContainer {
  private container?: StartedTestContainer
  private dbManager?: DatabaseManager
  private connectionId?: string

  async start(): Promise<{
    config: DatabaseConfig
    dbManager: DatabaseManager
    connectionId: string
    container: StartedTestContainer
  }> {
    this.container = await new GenericContainer('clickhouse/clickhouse-server:24.3-alpine')
      .withExposedPorts(8123, 9000)
      .withEnvironment({
        CLICKHOUSE_USER: 'test_user',
        CLICKHOUSE_PASSWORD: 'test_password',
        CLICKHOUSE_DB: 'datapup_test',
        CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: '1'
      })
      .withWaitStrategy(Wait.forLogMessage(/Ready for connections/))
      .start()

    const config: DatabaseConfig = {
      type: 'clickhouse',
      host: this.container.getHost(),
      port: this.container.getMappedPort(8123),
      database: 'datapup_test',
      username: 'test_user',
      password: 'test_password',
      secure: false,
      timeout: 30000
    }

    await new Promise(resolve => setTimeout(resolve, 2000))

    this.dbManager = new DatabaseManager()
    this.connectionId = `test-ch-${Date.now()}`
    
    const connectResult = await this.dbManager.connect(config, this.connectionId)
    if (!connectResult.success) {
      throw new Error(`Failed to connect to ClickHouse: ${connectResult.message}`)
    }

    return {
      config,
      dbManager: this.dbManager,
      connectionId: this.connectionId,
      container: this.container
    }
  }

  async stop(): Promise<void> {
    if (this.dbManager && this.connectionId) {
      await this.dbManager.disconnect(this.connectionId)
      await this.dbManager.cleanup()
    }
    
    if (this.container) {
      await this.container.stop()
    }
  }
}

export class TestTableHelper {
  constructor(
    private dbManager: DatabaseManager,
    private connectionId: string,
    private dbType: 'postgresql' | 'clickhouse'
  ) {}

  async createTestTable(prefix = 'test_table'): Promise<string> {
    const tableName = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}`
    
    if (this.dbType === 'postgresql') {
      const createSQL = `
        CREATE TABLE ${tableName} (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255),
          value INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `
      await this.dbManager.query(this.connectionId, createSQL)
    } else {
      const createSQL = `
        CREATE TABLE ${tableName} (
          id UInt32,
          name String,
          value UInt32,
          created_at DateTime DEFAULT now()
        ) ENGINE = MergeTree()
        ORDER BY id
      `
      await this.dbManager.query(this.connectionId, createSQL)
    }
    
    return tableName
  }

  async dropTable(tableName: string): Promise<void> {
    await this.dbManager.query(this.connectionId, `DROP TABLE IF EXISTS ${tableName}`)
  }

  async insertTestData(tableName: string, count = 5): Promise<void> {
    for (let i = 1; i <= count; i++) {
      const data = this.dbType === 'postgresql' 
        ? { name: `Test Item ${i}`, value: i * 100 }
        : { id: i, name: `Test Item ${i}`, value: i * 100 }
        
      await this.dbManager.insertRow(this.connectionId, tableName, data)
    }
    
    if (this.dbType === 'clickhouse') {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
}

export async function isDockerAvailable(): Promise<boolean> {
  try {
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)
    
    await execAsync('docker version')
    return true
  } catch {
    return false
  }
}

export async function shouldSkipContainerTests(): Promise<boolean> {
  if (process.env.SKIP_CONTAINER_TESTS === 'true') {
    return true
  }
  
  const dockerAvailable = await isDockerAvailable()
  if (!dockerAvailable) {
    console.warn('Docker is not available. Skipping container tests.')
    return true
  }
  
  return false
}