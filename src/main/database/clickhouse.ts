import { BaseDatabaseManager } from './base'
import {
  DatabaseConfig,
  ConnectionResult,
  QueryResult,
  QueryType,
  DatabaseCapabilities,
  TableSchema,
  ColumnSchema,
  TableQueryOptions,
  TableFilter
} from './interface'
import { logger } from '../utils/logger'

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
  private activeQueries: Map<string, AbortController> = new Map() // Track active queries by queryId

  constructor() {
    super()
    // Configure ClickHouse-specific cache settings
    this.cacheManager.updateConfig({
      defaultTTL: 10 * 60 * 1000, // 10 minutes for ClickHouse (longer than default)
      compressionThreshold: 512 * 1024, // 512KB - ClickHouse can return large results
      enableCompression: true
    })
  }

  // Override query method to add ClickHouse-specific cache logic
  async query(connectionId: string, sql: string, sessionId?: string): Promise<QueryResult> {
    // For ClickHouse SYSTEM queries, don't cache results as they change frequently
    const upperSql = sql.trim().toUpperCase()
    if (
      upperSql.startsWith('SHOW') ||
      upperSql.startsWith('DESCRIBE') ||
      upperSql.startsWith('SYSTEM')
    ) {
      return this.executeQuery(connectionId, sql, sessionId)
    }

    // Use base class caching for other queries
    return super.query(connectionId, sql, sessionId)
  }

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
      const protocol = config.secure ? 'https' : 'http'
      const url = `${protocol}://${config.username}:${config.password}@${config.host}:${config.port}/${config.database}`

      const clientConfig = {
        url: url,
        request_timeout: config.timeout || 30000,
        // Additional ClickHouse-specific options can be added here
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

      // Cancel any active queries for this connection
      for (const [queryId, controller] of this.activeQueries.entries()) {
        controller.abort()
        this.activeQueries.delete(queryId)
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

  async executeQuery(connectionId: string, sql: string, sessionId?: string): Promise<QueryResult> {
    const startTime = Date.now()
    const timestamp = new Date().toISOString()

    try {
      const connection = this.connections.get(connectionId)
      if (!connection || !connection.isConnected) {
        return this.createQueryResult(false, 'Not connected to ClickHouse. Please connect first.')
      }

      // Validate read-only queries
      const validation = this.validateReadOnlyQuery(connectionId, sql)
      if (!validation.valid) {
        logger.warn(`[${timestamp}] ClickHouse read-only query validation failed`, {
          connectionId,
          sql: sql.slice(0, 100) + (sql.length > 100 ? '...' : ''),
          error: validation.error,
          timestamp
        })
        return this.createQueryResult(false, validation.error || 'Query not allowed')
      }

      // Update last used timestamp
      connection.lastUsed = new Date()

      // Detect query type
      const queryType = this.detectQueryType(sql)
      const isDDL = queryType === QueryType.DDL
      const isDML = [QueryType.INSERT, QueryType.UPDATE, QueryType.DELETE].includes(queryType)

      logger.debug(`[${timestamp}] ClickHouse query details`, {
        connectionId,
        queryType,
        isDDL,
        isDML,
        sessionId,
        host: connection.config.host,
        database: connection.config.database,
        timestamp
      })

      if (isDDL || isDML) {
        logger.info(`[${timestamp}] Executing ClickHouse command`, {
          connectionId,
          queryType,
          sessionId,
          sql: sql.slice(0, 200) + (sql.length > 200 ? '...' : ''),
          timestamp
        })

        // Use command() for DDL/DML queries that don't return data
        await connection.client.command({
          query: sql,
          query_id: sessionId || undefined
        })

        const duration = Date.now() - startTime
        const completionTimestamp = new Date().toISOString()
        logger.info(`[${completionTimestamp}] ClickHouse command completed in ${duration}ms`, {
          queryType,
          sessionId,
          duration,
          timestamp: completionTimestamp
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
        logger.info(`[${timestamp}] Executing ClickHouse query`, {
          connectionId,
          queryType,
          sessionId,
          sql: sql.slice(0, 200) + (sql.length > 200 ? '...' : ''),
          timestamp
        })

        // Use query() for SELECT and data-returning queries
        const abortController = new AbortController()

        // Store the abort controller if we have a sessionId
        if (sessionId) {
          this.activeQueries.set(sessionId, abortController)
        }

        const result = await connection.client.query({
          query: sql,
          query_id: sessionId || undefined,
          abort_signal: abortController.signal
        })

        // Convert result to plain JavaScript object for IPC serialization
        const rawData = await result.json()

        // Extract the actual data rows from the ClickHouse response
        let data = []
        if (rawData && typeof rawData === 'object') {
          if (rawData.data && Array.isArray(rawData.data)) {
            data = rawData.data
          } else if (Array.isArray(rawData)) {
            data = rawData
          }
        }

        // Clean up the abort controller
        if (sessionId) {
          this.activeQueries.delete(sessionId)
        }

        const duration = Date.now() - startTime
        const completionTimestamp = new Date().toISOString()
        logger.info(`[${completionTimestamp}] ClickHouse query completed in ${duration}ms`, {
          queryType,
          rowCount: data.length,
          sessionId,
          duration,
          timestamp: completionTimestamp
        })

        return this.createQueryResult(
          true,
          `Query executed successfully. Returned ${data.length} rows.`,
          data,
          undefined,
          queryType
        )
      }
    } catch (error) {
      // Clean up the abort controller on error
      if (sessionId) {
        this.activeQueries.delete(sessionId)
      }

      const duration = Date.now() - startTime
      const errorTimestamp = new Date().toISOString()

      logger.error(`[${errorTimestamp}] ClickHouse query error after ${duration}ms`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        connectionId,
        sessionId,
        duration,
        sql: sql.slice(0, 200) + (sql.length > 200 ? '...' : ''),
        timestamp: errorTimestamp
      })

      // Check if it was cancelled
      if (error instanceof Error && error.name === 'AbortError') {
        logger.info(`[${errorTimestamp}] ClickHouse query was cancelled`, {
          connectionId,
          sessionId,
          duration,
          timestamp: errorTimestamp
        })

        return this.createQueryResult(
          false,
          'Query was cancelled',
          undefined,
          'Query execution was cancelled by user'
        )
      }

      return this.createQueryResult(
        false,
        'Query execution failed',
        undefined,
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }

  async cancelQuery(
    connectionId: string,
    queryId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      // First try to abort using the abort controller
      const abortController = this.activeQueries.get(queryId)
      if (abortController) {
        abortController.abort()
        this.activeQueries.delete(queryId)
      }

      // Also try to kill the query on the server side
      const connection = this.connections.get(connectionId)
      if (connection && connection.isConnected) {
        try {
          await connection.client.command({
            query: `KILL QUERY WHERE query_id = '${queryId}'`
          })
        } catch (killError) {
          // Ignore errors from KILL QUERY as the query might have already finished
          console.log('KILL QUERY error (expected if query already finished):', killError)
        }
      }

      return {
        success: true,
        message: 'Query cancellation requested'
      }
    } catch (error) {
      console.error('Error cancelling query:', error)
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to cancel query'
      }
    }
  }

  async queryTable(
    connectionId: string,
    options: TableQueryOptions,
    sessionId?: string
  ): Promise<QueryResult> {
    // ClickHouse-specific implementation
    const { database, table, filters, orderBy, limit, offset } = options

    // ClickHouse uses backticks for identifiers
    const qualifiedTable = database ? `\`${database}\`.\`${table}\`` : `\`${table}\``

    let baseQuery = `FROM ${qualifiedTable}`

    // Add WHERE clause if filters exist
    if (filters && filters.length > 0) {
      const whereClauses = filters
        .map((filter) => this.buildClickHouseWhereClause(filter))
        .filter(Boolean)
      if (whereClauses.length > 0) {
        baseQuery += ` WHERE ${whereClauses.join(' AND ')}`
      }
    }

    // Build the main SELECT query
    let sql = `SELECT * ${baseQuery}`

    // Add ORDER BY clause
    if (orderBy && orderBy.length > 0) {
      const orderClauses = orderBy.map((o) => `\`${o.column}\` ${o.direction.toUpperCase()}`)
      sql += ` ORDER BY ${orderClauses.join(', ')}`
    }

    // Add LIMIT and OFFSET
    if (limit) {
      sql += ` LIMIT ${limit}`
    }
    if (offset) {
      sql += ` OFFSET ${offset}`
    }

    // Execute the main query
    const result = await this.executeQuery(connectionId, sql, sessionId)

    // If successful and we have pagination, get the total count
    if (result.success && (limit || offset)) {
      try {
        const countSql = `SELECT count() as total ${baseQuery}`
        const countResult = await this.executeQuery(connectionId, countSql)

        if (countResult.success && countResult.data && countResult.data[0]) {
          result.totalRows = Number(countResult.data[0].total)
          result.hasMore = offset + (result.data?.length || 0) < result.totalRows
        }
      } catch (error) {
        // If count fails, continue without it
        console.warn('Failed to get total count:', error)
      }
    }

    return result
  }

  private buildClickHouseWhereClause(filter: TableFilter): string {
    const { column, operator, value } = filter

    // Handle NULL operators
    if (operator === 'IS NULL' || operator === 'IS NOT NULL') {
      return `\`${column}\` ${operator}`
    }

    // Handle IN and NOT IN operators
    if ((operator === 'IN' || operator === 'NOT IN') && Array.isArray(value)) {
      const values = value.map((v) => this.escapeClickHouseValue(v)).join(', ')
      return `\`${column}\` ${operator} (${values})`
    }

    // Handle LIKE operators - ClickHouse is case-sensitive by default
    if (operator === 'LIKE' || operator === 'NOT LIKE') {
      return `\`${column}\` ${operator} ${this.escapeClickHouseValue(`%${value}%`)}`
    }

    // Handle other operators
    if (value !== undefined && value !== null) {
      return `\`${column}\` ${operator} ${this.escapeClickHouseValue(value)}`
    }

    return ''
  }

  private escapeClickHouseValue(value: any): string {
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`
    if (typeof value === 'number') return value.toString()
    if (typeof value === 'boolean') return value ? '1' : '0'
    if (value instanceof Date) return `'${value.toISOString()}'`
    return `'${String(value).replace(/'/g, "\\'")}'`
  }

  async getDatabases(
    connectionId: string
  ): Promise<{ success: boolean; databases?: string[]; message: string }> {
    try {
      const result = await this.executeQuery(connectionId, 'SHOW DATABASES')
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
      console.log('DEBUG: Getting tables for database:', database)

      // For ClickHouse, we need to use the correct syntax
      let query: string
      if (database) {
        query = `SHOW TABLES FROM ${database}`
      } else {
        query = 'SHOW TABLES'
      }

      console.log('DEBUG: Executing query:', query)
      const result = await this.executeQuery(connectionId, query)

      console.log('DEBUG: Query result:', result)

      if (result.success && result.data) {
        const tables = result.data.map((row: any) => {
          // ClickHouse returns different column names depending on the version
          const tableName = row.name || row.table || row[0] || Object.values(row)[0]
          console.log('DEBUG: Processing table row:', row, '-> tableName:', tableName)
          return tableName
        })

        console.log('DEBUG: Found tables:', tables)

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
      const result = await this.executeQuery(connectionId, `DESCRIBE ${fullTableName}`)
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

  getConnectionInfo(
    connectionId: string
  ): { host: string; port: number; database: string; type: string } | null {
    const connection = this.connections.get(connectionId)
    if (connection) {
      return {
        host: connection.config.host,
        port: connection.config.port,
        database: connection.config.database,
        type: connection.config.type
      }
    }
    return null
  }

  getAllConnections(): string[] {
    return Array.from(this.connections.keys())
  }

  async updateRow(
    connectionId: string,
    table: string,
    primaryKey: Record<string, any>,
    updates: Record<string, any>,
    database?: string
  ): Promise<QueryResult> {
    try {
      const connection = this.connections.get(connectionId)
      if (!connection || !connection.isConnected) {
        return this.createQueryResult(false, 'Not connected to ClickHouse')
      }

      // ClickHouse requires ALTER TABLE ... UPDATE syntax
      const escapeValue = (val: any) => {
        if (val === null || val === undefined || val === '') return 'NULL'
        if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`
        if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`
        if (typeof val === 'boolean') return val ? '1' : '0'
        return val
      }

      const setClauses = Object.entries(updates).map(([col, val]) => {
        return `${col} = ${escapeValue(val)}`
      })

      const whereClauses = Object.entries(primaryKey).map(([col, val]) => {
        return `${col} = ${escapeValue(val)}`
      })

      const qualifiedTable = database ? `${database}.${table}` : table
      const sql = `ALTER TABLE ${qualifiedTable} UPDATE ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`

      // Execute the ALTER TABLE UPDATE command
      await connection.client.command({
        query: sql
      })

      return this.createQueryResult(
        true,
        'Row updated successfully',
        [],
        undefined,
        QueryType.UPDATE,
        1
      )
    } catch (error) {
      console.error('ClickHouse update error:', error)
      return this.createQueryResult(
        false,
        'Update failed',
        undefined,
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }

  getCapabilities(): DatabaseCapabilities {
    return {
      supportsTransactions: false, // ClickHouse has experimental support but requires ZooKeeper
      supportsBatchOperations: true,
      supportsReturning: false,
      supportsUpsert: true, // Via INSERT ... ON DUPLICATE KEY UPDATE
      supportsSchemas: true, // Databases in ClickHouse
      requiresPrimaryKey: false, // ClickHouse doesn't require primary keys
      defaultSchema: 'default'
    }
  }

  async supportsTransactions(connectionId: string): Promise<boolean> {
    try {
      // Check if experimental transactions are enabled
      const result = await this.executeQuery(
        connectionId,
        "SELECT value FROM system.settings WHERE name = 'allow_experimental_transactions'"
      )

      if (result.success && result.data && result.data.length > 0) {
        return result.data[0].value === '1' || result.data[0].value === 1
      }

      return false
    } catch (error) {
      // If the query fails, transactions are not supported
      return false
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

      const pkResult = await this.executeQuery(connectionId, pkQuery)
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
