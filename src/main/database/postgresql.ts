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
  TableFilter,
  InsertResult,
  UpdateResult,
  DeleteResult
} from './interface'

interface PostgreSQLConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  ssl?: boolean
  timeout?: number
  readonly?: boolean
}

interface PostgreSQLConnection {
  id: string
  config: PostgreSQLConfig
  client: any // pg.Client instance
  isConnected: boolean
  lastUsed: Date
}

class PostgreSQLManager extends BaseDatabaseManager {
  protected connections: Map<string, PostgreSQLConnection> = new Map()

  async connect(config: DatabaseConfig, connectionId: string): Promise<ConnectionResult> {
    try {
      // Check if connection already exists
      if (this.connections.has(connectionId)) {
        const existing = this.connections.get(connectionId)!
        if (existing.isConnected) {
          return { success: true, message: 'Already connected to PostgreSQL' }
        }
      }

      // Import Client from pg dynamically
      const { Client } = await import('pg')

      // Create PostgreSQL client configuration
      const clientConfig = {
        host: config.host,
        port: config.port || 5432,
        database: config.database,
        user: config.username,
        password: config.password,
        ssl: config.ssl || config.secure || false,
        connectionTimeoutMillis: config.timeout || 30000,
        query_timeout: 300000 // 5 minutes query timeout
      }

      const client = new Client(clientConfig)

      // Connect to PostgreSQL
      await client.connect()

      // Test connection with a simple query
      await client.query('SELECT 1')

      // Store connection
      const connection: PostgreSQLConnection = {
        id: connectionId,
        config: clientConfig,
        client,
        isConnected: true,
        lastUsed: new Date()
      }

      this.connections.set(connectionId, connection)

      return {
        success: true,
        message: `Connected to PostgreSQL database: ${config.database}`
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to connect to PostgreSQL: ${error.message}`
      }
    }
  }

  async disconnect(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId)
    if (connection && connection.client) {
      try {
        await connection.client.end()
        connection.isConnected = false
      } catch (error) {
        console.error('Error disconnecting from PostgreSQL:', error)
      } finally {
        this.connections.delete(connectionId)
      }
    }
  }

  getCapabilities(): DatabaseCapabilities {
    return {
      supportsTransactions: true,
      supportsBatchOperations: true,
      supportsReturning: true,
      supportsUpsert: true,
      supportsSchemas: true,
      requiresPrimaryKey: false,
      defaultSchema: 'public'
    }
  }

  private parseTableName(tableName: string): { schema: string; table: string } {
    if (tableName.includes('.')) {
      const parts = tableName.split('.')
      return { schema: parts[0], table: parts[1] }
    }
    return { schema: 'public', table: tableName }
  }

  protected escapeIdentifier(identifier: string): string {
    // PostgreSQL uses double quotes for identifiers
    return `"${identifier.replace(/"/g, '""')}"`
  }

  protected escapeValue(value: any): string {
    if (value === null || value === undefined) {
      return 'NULL'
    }
    if (typeof value === 'string') {
      return `'${value.replace(/'/g, "''")}'`
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false'
    }
    if (value instanceof Date) {
      return `'${value.toISOString()}'`
    }
    return String(value)
  }

  async query(
    connectionId: string,
    sql: string,
    queryId?: string
  ): Promise<QueryResult> {
    console.log('PostgreSQL query called with connectionId:', connectionId)
    console.log('Available connections:', Array.from(this.connections.keys()))

    const connection = this.connections.get(connectionId)
    if (!connection || !connection.isConnected) {
      console.log('Connection not found or not connected:', connection)
      throw new Error('No active PostgreSQL connection')
    }

    // Validate read-only connections
    if (connection.config.readonly) {
      const validation = this.validateReadOnlyQuery(connectionId, sql)
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error || 'Read-only validation failed',
          message: validation.error || 'Read-only validation failed',
          data: []
        }
      }
    }

    connection.lastUsed = new Date()

    try {
      const result = await connection.client.query(sql)

      return {
        success: true,
        data: result.rows || [],
        message: 'Query executed successfully',
        affectedRows: result.rowCount || 0
      }
    } catch (error: any) {
      console.error('PostgreSQL query error:', error)
      return {
        success: false,
        error: error.message,
        message: error.message,
        data: []
      }
    }
  }

  private mapPostgreSQLType(typeId: number): string {
    // Map PostgreSQL OID types to readable names
    const typeMap: { [key: number]: string } = {
      16: 'boolean',
      17: 'bytea',
      20: 'bigint',
      21: 'smallint',
      23: 'integer',
      25: 'text',
      700: 'real',
      701: 'double precision',
      1082: 'date',
      1114: 'timestamp',
      1184: 'timestamptz',
      1700: 'numeric'
    }
    return typeMap[typeId] || 'unknown'
  }

  async getDatabases(connectionId: string): Promise<{ success: boolean; databases?: string[]; message: string }> {
    console.log('PostgreSQL getDatabases called for connectionId:', connectionId)

    const result = await this.query(
      connectionId,
      'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname'
    )

    console.log('PostgreSQL getDatabases query result:', result)

    if (result.success && result.data) {
      const databases = result.data.map((row: any) => row.datname)
      console.log('PostgreSQL databases found:', databases)
      return {
        success: true,
        databases,
        message: `Found ${databases.length} databases`
      }
    }
    console.log('PostgreSQL getDatabases failed:', result.error)
    return {
      success: false,
      message: result.error || 'Failed to get databases'
    }
  }

  async getTables(connectionId: string, database?: string): Promise<{ success: boolean; tables?: string[]; message: string }> {
    console.log('PostgreSQL getTables called for connectionId:', connectionId, 'database:', database)

    const result = await this.query(
      connectionId,
      `SELECT schemaname, tablename FROM pg_tables
       WHERE schemaname NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
       AND schemaname NOT LIKE 'pg_temp_%'
       AND schemaname NOT LIKE 'pg_toast_temp_%'
       ORDER BY schemaname, tablename`
    )

    console.log('PostgreSQL getTables query result:', result)

    if (result.success && result.data) {
      const tables = result.data.map((row: any) => `${row.schemaname}.${row.tablename}`)
      console.log('PostgreSQL tables found:', tables)
      return {
        success: true,
        tables,
        message: `Found ${tables.length} tables`
      }
    }
    console.log('PostgreSQL getTables failed:', result.error)
    return {
      success: false,
      message: result.error || 'Failed to get tables'
    }
  }

  async getTableSchema(connectionId: string, tableName: string, database?: string): Promise<{ success: boolean; schema?: any[]; message: string }> {
    const { schema: schemaName, table: actualTableName } = this.parseTableName(tableName)

    const result = await this.query(
      connectionId,
      `SELECT
         column_name,
         data_type,
         is_nullable,
         column_default
       FROM information_schema.columns
       WHERE table_name = '${actualTableName}'
       AND table_schema = '${schemaName}'
       ORDER BY ordinal_position`
    )

    if (result.success && result.data) {
      const schema = result.data.map((row: any) => ({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
        default: row.column_default
      }))

      return {
        success: true,
        schema,
        message: `Retrieved schema for table ${tableName}`
      }
    }

    return {
      success: false,
      message: result.error || `Failed to get schema for table ${tableName}`
    }
  }

  async getTableFullSchema(connectionId: string, tableName: string, database?: string): Promise<{ success: boolean; schema?: TableSchema; message: string }> {
    try {
      const { schema: schemaName, table: actualTableName } = this.parseTableName(tableName)

      // Get column information
      const columnResult = await this.query(
        connectionId,
        `SELECT
           column_name,
           data_type,
           is_nullable,
           column_default
         FROM information_schema.columns
         WHERE table_name = '${actualTableName}'
         AND table_schema = '${schemaName}'
         ORDER BY ordinal_position`
      )

      if (!columnResult.success || !columnResult.data) {
        return {
          success: false,
          message: columnResult.error || `Failed to get schema for table ${tableName}`
        }
      }

      const columns: ColumnSchema[] = columnResult.data.map((row: any) => ({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
        defaultValue: row.column_default
      }))

      // Get primary key information
      const qualifiedTableName = `${schemaName}.${actualTableName}`
      const pkResult = await this.query(
        connectionId,
        `SELECT a.attname
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
         WHERE i.indrelid = '${qualifiedTableName}'::regclass AND i.indisprimary`
      )

      const primaryKeys: string[] =
        pkResult.success && pkResult.data ? pkResult.data.map((row: any) => row.attname) : []

      const schema: TableSchema = {
        columns,
        primaryKeys,
        uniqueKeys: [] // Would need additional query for unique keys
      }

      return {
        success: true,
        schema,
        message: `Retrieved full schema for table ${tableName}`
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Error getting table schema: ${error.message}`
      }
    }
  }

  async queryTable(
    connectionId: string,
    options: TableQueryOptions,
    sessionId?: string
  ): Promise<QueryResult> {
    console.log('PostgreSQL queryTable called with options:', options)
    const { database, table, filters, orderBy, limit, offset } = options

    const { schema: schemaName, table: actualTableName } = this.parseTableName(table)
    
    console.log('PostgreSQL queryTable - database param:', database, 'using schema:', schemaName, 'table:', actualTableName)
    const qualifiedTable = `${this.escapeIdentifier(schemaName)}.${this.escapeIdentifier(actualTableName)}`

    let sql = `SELECT * FROM ${qualifiedTable}`

    // Add WHERE clause if filters exist
    if (filters && filters.length > 0) {
      const whereClauses = filters.map((filter) => this.buildWhereClause(filter)).filter(Boolean)
      if (whereClauses.length > 0) {
        sql += ` WHERE ${whereClauses.join(' AND ')}`
      }
    }

    // Add ORDER BY clause
    if (orderBy && orderBy.length > 0) {
      const orderClauses = orderBy.map((o) => `${this.escapeIdentifier(o.column)} ${o.direction.toUpperCase()}`)
      sql += ` ORDER BY ${orderClauses.join(', ')}`
    }

    // Add LIMIT and OFFSET
    if (limit) {
      sql += ` LIMIT ${limit}`
    }
    if (offset) {
      sql += ` OFFSET ${offset}`
    }

    console.log('PostgreSQL queryTable SQL:', sql)
    
    // Execute the main query
    const result = await this.query(connectionId, sql, sessionId)

    // If successful and we have pagination, get the total count
    if (result.success && (limit || offset)) {
      try {
        // Build count query without LIMIT/OFFSET
        let countSql = `SELECT COUNT(*) as total FROM ${qualifiedTable}`
        
        // Add WHERE clause if filters exist (same as main query)
        if (filters && filters.length > 0) {
          const whereClauses = filters.map((filter) => this.buildWhereClause(filter)).filter(Boolean)
          if (whereClauses.length > 0) {
            countSql += ` WHERE ${whereClauses.join(' AND ')}`
          }
        }
        
        const countResult = await this.query(connectionId, countSql)

        if (countResult.success && countResult.data && countResult.data[0]) {
          result.totalRows = Number(countResult.data[0].total)
          result.hasMore = (offset || 0) + (result.data?.length || 0) < result.totalRows
        }
      } catch (error) {
        // If count fails, continue without it
        console.warn('Failed to get total count:', error)
      }
    }

    return result
  }

  protected buildWhereClause(filter: TableFilter): string {
    const { column, operator, value } = filter
    const escapedColumn = this.escapeIdentifier(column)

    switch (operator) {
      case '=':
      case '!=':
      case '>':
      case '<':
      case '>=':
      case '<=':
        return `${escapedColumn} ${operator} ${this.escapeValue(value)}`
      case 'LIKE':
      case 'NOT LIKE':
        return `${escapedColumn} ${operator} ${this.escapeValue(value)}`
      case 'IN':
      case 'NOT IN':
        if (Array.isArray(value)) {
          const values = value.map(v => this.escapeValue(v)).join(', ')
          return `${escapedColumn} ${operator} (${values})`
        }
        return `${escapedColumn} ${operator} (${this.escapeValue(value)})`
      case 'IS NULL':
      case 'IS NOT NULL':
        return `${escapedColumn} ${operator}`
      default:
        return ''
    }
  }

  async insertRow(
    connectionId: string,
    table: string,
    data: Record<string, any>,
    database?: string
  ): Promise<InsertResult> {
    const connection = this.connections.get(connectionId)
    if (!connection || !connection.isConnected) {
      return {
        success: false,
        message: 'Not connected to PostgreSQL',
        error: 'No active connection'
      }
    }

    const { schema: schemaName, table: actualTableName } = this.parseTableName(table)
    
    const qualifiedTable = `${this.escapeIdentifier(schemaName)}.${this.escapeIdentifier(actualTableName)}`
    
    const columns = Object.keys(data)
    const values = Object.values(data)
    
    const escapedColumns = columns.map(col => this.escapeIdentifier(col)).join(', ')
    const escapedValues = values.map(val => this.escapeValue(val)).join(', ')
    
    const sql = `INSERT INTO ${qualifiedTable} (${escapedColumns}) VALUES (${escapedValues})`
    
    const result = await this.query(connectionId, sql)
    return result as InsertResult
  }

  async updateRow(
    connectionId: string,
    table: string,
    primaryKey: Record<string, any>,
    updates: Record<string, any>,
    database?: string
  ): Promise<UpdateResult> {
    const connection = this.connections.get(connectionId)
    if (!connection || !connection.isConnected) {
      return {
        success: false,
        message: 'Not connected to PostgreSQL',
        error: 'No active connection',
        affectedRows: 0
      }
    }

    const { schema: schemaName, table: actualTableName } = this.parseTableName(table)
    
    const qualifiedTable = `${this.escapeIdentifier(schemaName)}.${this.escapeIdentifier(actualTableName)}`
    
    const setClauses = Object.entries(updates).map(([col, val]) => {
      return `${this.escapeIdentifier(col)} = ${this.escapeValue(val)}`
    })
    
    const whereClauses = Object.entries(primaryKey).map(([col, val]) => {
      return `${this.escapeIdentifier(col)} = ${this.escapeValue(val)}`
    })
    
    const sql = `UPDATE ${qualifiedTable} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`
    
    const result = await this.query(connectionId, sql)
    return result as UpdateResult
  }

  async deleteRow(
    connectionId: string,
    table: string,
    primaryKey: Record<string, any>,
    database?: string
  ): Promise<DeleteResult> {
    const connection = this.connections.get(connectionId)
    if (!connection || !connection.isConnected) {
      return {
        success: false,
        message: 'Not connected to PostgreSQL',
        error: 'No active connection',
        affectedRows: 0
      }
    }

    const { schema: schemaName, table: actualTableName } = this.parseTableName(table)
    
    const qualifiedTable = `${this.escapeIdentifier(schemaName)}.${this.escapeIdentifier(actualTableName)}`
    
    const whereClauses = Object.entries(primaryKey).map(([col, val]) => {
      return `${this.escapeIdentifier(col)} = ${this.escapeValue(val)}`
    })
    
    const sql = `DELETE FROM ${qualifiedTable} WHERE ${whereClauses.join(' AND ')}`
    
    const result = await this.query(connectionId, sql)
    return result as DeleteResult
  }

  getConnectionInfo(
    connectionId: string
  ): { host: string; port: number; database: string; type: string } | null {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      return null
    }

    return {
      host: connection.config.host,
      port: connection.config.port,
      database: connection.config.database,
      type: 'postgresql'
    }
  }

  async cleanup(): Promise<void> {
    // Disconnect all connections
    const connectionIds = Array.from(this.connections.keys())
    for (const connectionId of connectionIds) {
      await this.disconnect(connectionId)
    }
  }
}

export { PostgreSQLManager }
