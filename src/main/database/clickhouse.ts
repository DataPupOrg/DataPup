import { BaseDatabaseManager } from './base'
import {
  DatabaseConfig,
  ConnectionResult,
  QueryResult,
  QueryType,
  DatabaseCapabilities,
  TableSchema,
  ColumnSchema
} from './interface'

interface ClickHouseConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  secure?: boolean
  timeout?: number
  readonly?: boolean
}

interface ClickHouseConnection {
  id: string
  config: ClickHouseConfig
  client: any // @clickhouse/client instance
  isConnected: boolean
  lastUsed: Date
}

class ClickHouseManager extends BaseDatabaseManager {
  protected connections: Map<string, ClickHouseConnection> = new Map()

  async connect(config: DatabaseConfig, connectionId: string): Promise<ConnectionResult> {
    try {
      // Check if connection already exists
      if (this.connections.has(connectionId)) {
        const existing = this.connections.get(connectionId)!
        if (existing.isConnected) {
          return { success: true, message: 'Already connected to ClickHouse' }
        }
      }

      // Import createClient from @clickhouse/client dynamically
      const { createClient } = await import('@clickhouse/client')

      // Create ClickHouse client configuration
      console.log('ClickHouse manager config:', config)
      console.log('ClickHouse secure flag:', config.secure)
      const protocol = config.secure ? 'https' : 'http'
      const url = `${protocol}://${config.username}:${config.password}@${config.host}:${config.port}/${config.database}`
      console.log('ClickHouse connection URL protocol:', protocol)

      const clientConfig = {
        url: url,
        request_timeout: config.timeout || 30000,
        // Additional ClickHouse-specific options can be added here
        session_id: connectionId,
        // Connection pooling settings
        keep_alive: {
          enabled: true,
          interval: 30000
        }
      }

      // Create and test the connection
      const client = createClient(clientConfig)

      // Test the connection by executing a simple query
      await client.query({ query: 'SELECT 1 as test' })

      // Store the connection
      const connection: ClickHouseConnection = {
        id: connectionId,
        config: {
          host: config.host,
          port: config.port,
          database: config.database,
          username: config.username,
          password: config.password,
          secure: config.secure,
          timeout: config.timeout,
          readonly: config.readonly
        },
        client,
        isConnected: true,
        lastUsed: new Date()
      }

      this.connections.set(connectionId, connection)

      // Track read-only connections
      if (config.readonly) {
        this.readonlyConnections.add(connectionId)
      }

      return {
        success: true,
        message: `Connected to ClickHouse at ${config.host}:${config.port}`
      }
    } catch (error) {
      console.error('ClickHouse connection error:', error)
      return {
        success: false,
        message: 'Failed to connect to ClickHouse',
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  async disconnect(connectionId: string): Promise<{ success: boolean; message: string }> {
    try {
      const connection = this.connections.get(connectionId)
      if (!connection) {
        return { success: false, message: 'Connection not found' }
      }

      if (connection.isConnected && connection.client) {
        // Close the ClickHouse connection
        await connection.client.close()
      }

      // Remove from connections map
      this.connections.delete(connectionId)
      this.readonlyConnections.delete(connectionId)

      return { success: true, message: 'Disconnected from ClickHouse' }
    } catch (error) {
      console.error('ClickHouse disconnection error:', error)
      return {
        success: false,
        message: 'Failed to disconnect from ClickHouse'
      }
    }
  }

  async query(connectionId: string, sql: string, sessionId?: string): Promise<QueryResult> {
    try {
      const connection = this.connections.get(connectionId)
      if (!connection || !connection.isConnected) {
        return this.createQueryResult(false, 'Not connected to ClickHouse. Please connect first.')
      }

      // Validate read-only queries
      const validation = this.validateReadOnlyQuery(connectionId, sql)
      if (!validation.valid) {
        return this.createQueryResult(false, validation.error || 'Query not allowed')
      }

      // Update last used timestamp
      connection.lastUsed = new Date()

      // Detect query type
      const queryType = this.detectQueryType(sql)
      const isDDL = queryType === QueryType.DDL
      const isDML = [QueryType.INSERT, QueryType.UPDATE, QueryType.DELETE].includes(queryType)

      console.log('Executing ClickHouse query:', sql)
      console.log('Query type:', queryType)

      if (isDDL || isDML) {
        // Use command() for DDL/DML queries that don't return data
        await connection.client.command({
          query: sql,
          session_id: sessionId || connectionId
        })

        return this.createQueryResult(
          true,
          'Command executed successfully',
          [],
          undefined,
          queryType,
          isDML ? 1 : 0 // For DML, we don't get affected rows from ClickHouse easily
        )
      } else {
        // Use query() for SELECT and data-returning queries
        const result = await connection.client.query({
          query: sql,
          session_id: sessionId || connectionId
        })

        // Convert result to plain JavaScript object for IPC serialization
        const rawData = await result.json()
        console.log('ClickHouse raw result:', rawData)
        console.log('ClickHouse result type:', typeof rawData)

        // Extract the actual data rows from the ClickHouse response
        let data = []
        if (rawData && typeof rawData === 'object') {
          if (rawData.data && Array.isArray(rawData.data)) {
            data = rawData.data
          } else if (Array.isArray(rawData)) {
            data = rawData
          }
        }

        console.log('Extracted data:', data)
        console.log('Data length:', data.length)

        return this.createQueryResult(
          true,
          `Query executed successfully. Returned ${data.length} rows.`,
          data,
          undefined,
          queryType
        )
      }
    } catch (error) {
      console.error('ClickHouse query error:', error)
      return this.createQueryResult(
        false,
        'Query execution failed',
        undefined,
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }

  async getDatabases(
    connectionId: string
  ): Promise<{ success: boolean; databases?: string[]; message: string }> {
    try {
      const result = await this.query(connectionId, 'SHOW DATABASES')
      if (result.success && result.data) {
        const databases = result.data.map((row: any) => row.name || row.database || row[0])
        return {
          success: true,
          databases,
          message: `Found ${databases.length} databases`
        }
      }
      return result
    } catch (error) {
      console.error('Error getting databases:', error)
      return {
        success: false,
        message: 'Failed to get databases'
      }
    }
  }

  async getTables(
    connectionId: string,
    database?: string
  ): Promise<{ success: boolean; tables?: string[]; message: string }> {
    try {
      const dbClause = database ? `FROM ${database}` : ''
      const result = await this.query(connectionId, `SHOW TABLES ${dbClause}`)
      if (result.success && result.data) {
        const tables = result.data.map((row: any) => row.name || row.table || row[0])
        return {
          success: true,
          tables,
          message: `Found ${tables.length} tables`
        }
      }
      return result
    } catch (error) {
      console.error('Error getting tables:', error)
      return {
        success: false,
        message: 'Failed to get tables'
      }
    }
  }

  async getTableSchema(
    connectionId: string,
    tableName: string,
    database?: string
  ): Promise<{ success: boolean; schema?: any[]; message: string }> {
    try {
      const fullTableName = database ? `${database}.${tableName}` : tableName
      const result = await this.query(connectionId, `DESCRIBE ${fullTableName}`)
      if (result.success && result.data) {
        return {
          success: true,
          schema: result.data,
          message: `Retrieved schema for ${fullTableName}`
        }
      }
      return result
    } catch (error) {
      console.error('Error getting table schema:', error)
      return {
        success: false,
        message: 'Failed to get table schema'
      }
    }
  }

  isConnected(connectionId: string): boolean {
    const connection = this.connections.get(connectionId)
    return connection?.isConnected || false
  }

  getConnectionInfo(connectionId: string): { host: string; port: number; database: string } | null {
    const connection = this.connections.get(connectionId)
    if (connection) {
      return {
        host: connection.config.host,
        port: connection.config.port,
        database: connection.config.database
      }
    }
    return null
  }

  getAllConnections(): string[] {
    return Array.from(this.connections.keys())
  }

  getCapabilities(): DatabaseCapabilities {
    return {
      supportsTransactions: false, // ClickHouse doesn't support traditional transactions
      supportsBatchOperations: true,
      supportsReturning: false,
      supportsUpsert: true, // Via INSERT ... ON DUPLICATE KEY UPDATE
      supportsSchemas: true, // Databases in ClickHouse
      requiresPrimaryKey: false, // ClickHouse doesn't require primary keys
      defaultSchema: 'default'
    }
  }

  async getTableFullSchema(
    connectionId: string,
    tableName: string,
    database?: string
  ): Promise<{ success: boolean; schema?: TableSchema; message: string }> {
    try {
      // Get basic schema
      const schemaResult = await this.getTableSchema(connectionId, tableName, database)
      if (!schemaResult.success || !schemaResult.schema) {
        return {
          success: false,
          message: schemaResult.message || 'Failed to get table schema'
        }
      }

      // Get the current database if not specified
      const connectionInfo = this.getConnectionInfo(connectionId)
      const targetDatabase = database || connectionInfo?.database || 'default'

      // Query system tables for primary key information
      const pkQuery = `
        SELECT name
        FROM system.columns
        WHERE database = '${targetDatabase}'
          AND table = '${tableName}'
          AND is_in_primary_key = 1
        ORDER BY position
      `

      const pkResult = await this.query(connectionId, pkQuery)
      const primaryKeys =
        pkResult.success && pkResult.data ? pkResult.data.map((row) => row.name) : []

      // Convert schema to ColumnSchema format
      const columns: ColumnSchema[] = schemaResult.schema.map((col: any) => ({
        name: col.name || col.field || col[0],
        type: col.type || col[1],
        nullable: col.nullable !== false, // ClickHouse columns are nullable by default unless specified
        default: col.default_expression || col.default || col[3] || undefined,
        isPrimaryKey: primaryKeys.includes(col.name || col.field || col[0]),
        isUnique: false // ClickHouse doesn't have unique constraints
      }))

      const tableSchema: TableSchema = {
        columns,
        primaryKeys,
        uniqueKeys: [] // ClickHouse doesn't support unique constraints
      }

      return {
        success: true,
        schema: tableSchema,
        message: 'Table schema retrieved successfully'
      }
    } catch (error) {
      console.error('Error getting full table schema:', error)
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get table schema'
      }
    }
  }

  // Clean up all connections
  async cleanup(): Promise<void> {
    const disconnectPromises = Array.from(this.connections.keys()).map((id) => this.disconnect(id))
    await Promise.allSettled(disconnectPromises)
  }
}

export { ClickHouseManager }
export type { ClickHouseConfig, ClickHouseConnection }
