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
      this.validateReadOnly(sql)
    }

    connection.lastUsed = new Date()

    try {
      const result = await connection.client.query(sql)
      
      return {
        success: true,
        data: result.rows || [],
        rowCount: result.rowCount || 0,
        fields: result.fields?.map((field: any) => ({
          name: field.name,
          type: this.mapPostgreSQLType(field.dataTypeID)
        })) || [],
        executionTime: 0 // PostgreSQL pg library doesn't provide execution time
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        data: [],
        rowCount: 0,
        fields: []
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

  async getDatabases(connectionId: string): Promise<string[]> {
    console.log('PostgreSQL getDatabases called for connectionId:', connectionId)
    
    const result = await this.query(
      connectionId,
      'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname'
    )
    
    console.log('PostgreSQL getDatabases query result:', result)
    
    if (result.success) {
      const databases = result.data.map((row: any) => row.datname)
      console.log('PostgreSQL databases found:', databases)
      return databases
    }
    console.log('PostgreSQL getDatabases failed:', result.error)
    return []
  }

  async getTables(connectionId: string, database?: string): Promise<string[]> {
    console.log('PostgreSQL getTables called for connectionId:', connectionId, 'database:', database)
    
    const result = await this.query(
      connectionId,
      `SELECT tablename FROM pg_tables 
       WHERE schemaname = 'public' 
       ORDER BY tablename`
    )
    
    console.log('PostgreSQL getTables query result:', result)
    
    if (result.success) {
      const tables = result.data.map((row: any) => row.tablename)
      console.log('PostgreSQL tables found:', tables)
      return tables
    }
    console.log('PostgreSQL getTables failed:', result.error)
    return []
  }

  async getTableSchema(connectionId: string, tableName: string): Promise<TableSchema> {
    const result = await this.query(
      connectionId,
      `SELECT 
         column_name,
         data_type,
         is_nullable,
         column_default
       FROM information_schema.columns 
       WHERE table_name = '${tableName}' 
       AND table_schema = 'public'
       ORDER BY ordinal_position`
    )

    if (result.success) {
      const columns: ColumnSchema[] = result.data.map((row: any) => ({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
        defaultValue: row.column_default
      }))

      return {
        name: tableName,
        columns,
        primaryKeys: [], // Would need additional query to get primary keys
        foreignKeys: []
      }
    }

    throw new Error(`Failed to get schema for table ${tableName}`)
  }

  async queryTable(
    connectionId: string,
    options: TableQueryOptions,
    sessionId?: string
  ): Promise<QueryResult> {
    console.log('PostgreSQL queryTable called with options:', options)
    const { database, table, filters, orderBy, limit, offset } = options

    // In PostgreSQL, ignore the 'database' parameter and always use 'public' schema
    // The database is already selected in the connection, tables are in schemas
    const schema = 'public'
    console.log('PostgreSQL queryTable - database param:', database, 'using schema:', schema, 'table:', table)
    const qualifiedTable = `${this.escapeIdentifier(schema)}.${this.escapeIdentifier(table)}`

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
    return this.query(connectionId, sql, sessionId)
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
}

export { PostgreSQLManager }