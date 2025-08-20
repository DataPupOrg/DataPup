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

interface MySQLConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  ssl?: boolean
  timeout?: number
  readonly?: boolean
}

interface MySQLConnection {
  id: string
  config: MySQLConfig
  client: any // mysql2.Connection instance
  isConnected: boolean
  lastUsed: Date
}

class MySQLManager extends BaseDatabaseManager {
  protected connections: Map<string, MySQLConnection> = new Map()

  async connect(config: DatabaseConfig, connectionId: string): Promise<ConnectionResult> {
    try {
      // Check if connection already exists
      if (this.connections.has(connectionId)) {
        const existing = this.connections.get(connectionId)!
        if (existing.isConnected) {
          return { success: true, message: 'Already connected to MySQL' }
        }
      }

      // Import mysql2 dynamically
      const mysql = await import('mysql2/promise')

      // Create MySQL connection configuration
      const connectionConfig: any = {
        host: config.host,
        port: config.port || 3306,
        database: config.database,
        user: config.username,
        password: config.password,
        connectTimeout: config.timeout || 30000,
        charset: 'utf8mb4'
      }

      // Handle SSL configuration
      if (config.ssl || config.secure) {
        // For MySQL2, SSL can be configured as an object
        // Using a minimal SSL configuration that works for most cases
        // This allows SSL connections without strict certificate validation
        connectionConfig.ssl = {
          rejectUnauthorized: false
        }
      }

      // Create connection
      const client = await mysql.createConnection(connectionConfig)

      // Test connection with a simple query
      await client.execute('SELECT 1')

      // Store connection
      const connection: MySQLConnection = {
        id: connectionId,
        config: connectionConfig,
        client,
        isConnected: true,
        lastUsed: new Date()
      }

      this.connections.set(connectionId, connection)

      return {
        success: true,
        message: `Connected to MySQL database: ${config.database}`
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to connect to MySQL: ${error.message}`
      }
    }
  }

  async disconnect(connectionId: string): Promise<{ success: boolean; message: string }> {
    const connection = this.connections.get(connectionId)
    if (connection && connection.client) {
      try {
        await connection.client.end()
        connection.isConnected = false
        this.connections.delete(connectionId)
        return { success: true, message: 'Disconnected from MySQL' }
      } catch (error: any) {
        console.error('Error disconnecting from MySQL:', error)
        return { success: false, message: `Failed to disconnect: ${error.message}` }
      }
    }
    return { success: true, message: 'No active connection to disconnect' }
  }

  isConnected(connectionId: string): boolean {
    const connection = this.connections.get(connectionId)
    return connection?.isConnected || false
  }

  isReadOnly(connectionId: string): boolean {
    return this.readonlyConnections.has(connectionId)
  }

  getCapabilities(): DatabaseCapabilities {
    return {
      supportsTransactions: true,
      supportsBatchOperations: true,
      supportsReturning: false, // MySQL doesn't support RETURNING clause
      supportsUpsert: true,
      supportsSchemas: false, // MySQL uses databases instead of schemas
      requiresPrimaryKey: false,
      defaultSchema: undefined
    }
  }

  protected escapeIdentifier(identifier: string): string {
    return `\`${identifier.replace(/`/g, '``')}\``
  }

  protected escapeValue(value: any): string {
    if (value === null || value === undefined) {
      return 'NULL'
    }
    if (typeof value === 'string') {
      return `'${value.replace(/'/g, "''")}'`
    }
    if (typeof value === 'number') {
      return value.toString()
    }
    if (typeof value === 'boolean') {
      return value ? '1' : '0'
    }
    if (value instanceof Date) {
      return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`
    }
    if (Array.isArray(value)) {
      return `(${value.map((v) => this.escapeValue(v)).join(', ')})`
    }
    return `'${String(value).replace(/'/g, "''")}'`
  }

  async query(connectionId: string, sql: string, queryId?: string): Promise<QueryResult> {
    const connection = this.connections.get(connectionId)
    if (!connection || !connection.isConnected) {
      return {
        success: false,
        message: 'Not connected to MySQL database'
      }
    }

    try {
      // Check if this is a read-only connection and query type
      if (this.isReadOnly(connectionId)) {
        const queryType = this.detectQueryType(sql)
        if (queryType !== QueryType.SELECT && queryType !== QueryType.SYSTEM) {
          return {
            success: false,
            message: 'Read-only connection: only SELECT queries are allowed'
          }
        }
      }

      connection.lastUsed = new Date()

      // Execute query
      const [rows, fields] = await connection.client.execute(sql)

      // Determine query type
      const queryType = this.detectQueryType(sql)

      return {
        success: true,
        data: Array.isArray(rows) ? rows : [rows],
        message: `Query executed successfully`,
        queryType,
        affectedRows: (rows as any).affectedRows || 0,
        totalRows: Array.isArray(rows) ? rows.length : 1
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Query failed: ${error.message}`,
        error: error.message
      }
    }
  }

  async cancelQuery(
    connectionId: string,
    queryId: string
  ): Promise<{ success: boolean; message: string }> {
    // MySQL doesn't support query cancellation in the same way as other databases
    // This is a placeholder implementation
    return {
      success: false,
      message: 'Query cancellation is not supported in MySQL'
    }
  }

  async getDatabases(
    connectionId: string
  ): Promise<{ success: boolean; databases?: string[]; message: string }> {
    try {
      const result = await this.query(connectionId, 'SHOW DATABASES')
      if (result.success && result.data) {
        const databases = result.data
          .map((row: any) => row.Database || row.database)
          .filter(
            (db: string) =>
              !['information_schema', 'performance_schema', 'mysql', 'sys'].includes(db)
          )
        return { success: true, databases, message: `Found ${databases.length} databases` }
      }
      return { success: false, message: 'Failed to get databases' }
    } catch (error: any) {
      return { success: false, message: `Error getting databases: ${error.message}` }
    }
  }

  async getTables(
    connectionId: string,
    database?: string
  ): Promise<{ success: boolean; tables?: string[]; message: string }> {
    try {
      const dbName = database || 'information_schema'
      const result = await this.query(
        connectionId,
        `SHOW TABLES FROM ${this.escapeIdentifier(dbName)}`
      )
      if (result.success && result.data) {
        const tables = result.data.map((row: any) => {
          const key = Object.keys(row)[0]
          return row[key]
        })
        return { success: true, tables, message: `Found ${tables.length} tables` }
      }
      return { success: false, message: 'Failed to get tables' }
    } catch (error: any) {
      return { success: false, message: `Error getting tables: ${error.message}` }
    }
  }

  async getTableSchema(
    connectionId: string,
    tableName: string,
    database?: string
  ): Promise<{ success: boolean; schema?: any[]; message: string }> {
    try {
      const dbName = database || 'information_schema'
      const result = await this.query(
        connectionId,
        `DESCRIBE ${this.escapeIdentifier(dbName)}.${this.escapeIdentifier(tableName)}`
      )
      if (result.success && result.data) {
        const schema = result.data.map((row: any) => ({
          name: row.Field,
          type: row.Type,
          nullable: row.Null === 'YES',
          default: row.Default,
          isPrimaryKey: row.Key === 'PRI',
          isUnique: row.Key === 'UNI'
        }))
        return { success: true, schema, message: `Found ${schema.length} columns` }
      }
      return { success: false, message: 'Failed to get table schema' }
    } catch (error: any) {
      return { success: false, message: `Error getting table schema: ${error.message}` }
    }
  }

  async getTableFullSchema(
    connectionId: string,
    tableName: string,
    database?: string
  ): Promise<{ success: boolean; schema?: TableSchema; message: string }> {
    try {
      const schemaResult = await this.getTableSchema(connectionId, tableName, database)
      if (!schemaResult.success || !schemaResult.schema) {
        return { success: false, message: schemaResult.message }
      }

      const columns: ColumnSchema[] = schemaResult.schema.map((col: any) => ({
        name: col.name,
        type: col.type,
        nullable: col.nullable,
        default: col.default,
        isPrimaryKey: col.isPrimaryKey,
        isUnique: col.isUnique
      }))

      const primaryKeys = columns.filter((col) => col.isPrimaryKey).map((col) => col.name)
      const uniqueKeys = columns.filter((col) => col.isUnique).map((col) => [col.name])

      const tableSchema: TableSchema = {
        columns,
        primaryKeys,
        uniqueKeys
      }

      return { success: true, schema: tableSchema, message: `Found ${columns.length} columns` }
    } catch (error: any) {
      return { success: false, message: `Error getting full table schema: ${error.message}` }
    }
  }

  async queryTable(
    connectionId: string,
    options: TableQueryOptions,
    sessionId?: string
  ): Promise<QueryResult> {
    try {
      const { database, table, filters = [], orderBy = [], limit, offset } = options

      let sql = `SELECT * FROM ${this.escapeIdentifier(database)}.${this.escapeIdentifier(table)}`

      // Add WHERE clause if filters are provided
      if (filters.length > 0) {
        const whereConditions = filters.map((filter) => this.buildWhereClause(filter))
        sql += ` WHERE ${whereConditions.join(' AND ')}`
      }

      // Add ORDER BY clause if specified
      if (orderBy.length > 0) {
        const orderClauses = orderBy.map(
          (order) => `${this.escapeIdentifier(order.column)} ${order.direction.toUpperCase()}`
        )
        sql += ` ORDER BY ${orderClauses.join(', ')}`
      }

      // Add LIMIT and OFFSET
      if (limit) {
        sql += ` LIMIT ${limit}`
        if (offset) {
          sql += ` OFFSET ${offset}`
        }
      }

      return await this.query(connectionId, sql, sessionId)
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to query table: ${error.message}`,
        error: error.message
      }
    }
  }

  protected buildWhereClause(filter: TableFilter): string {
    const column = this.escapeIdentifier(filter.column)
    const operator = filter.operator
    const value = filter.value

    switch (operator) {
      case '=':
      case '!=':
      case '>':
      case '<':
      case '>=':
      case '<=':
        return `${column} ${operator} ${this.escapeValue(value)}`
      case 'LIKE':
      case 'NOT LIKE':
        return `${column} ${operator} ${this.escapeValue(value)}`
      case 'IN':
      case 'NOT IN':
        if (Array.isArray(value)) {
          return `${column} ${operator} ${this.escapeValue(value)}`
        }
        return `${column} ${operator} (${this.escapeValue(value)})`
      case 'IS NULL':
        return `${column} IS NULL`
      case 'IS NOT NULL':
        return `${column} IS NOT NULL`
      default:
        return `${column} = ${this.escapeValue(value)}`
    }
  }

  async cleanup(): Promise<void> {
    const disconnectPromises = Array.from(this.connections.keys()).map((id) => this.disconnect(id))
    await Promise.all(disconnectPromises)
    this.connections.clear()
    this.readonlyConnections.clear()
  }

  getConnectionInfo(
    connectionId: string
  ): { host: string; port: number; database: string; type: string } | null {
    const connection = this.connections.get(connectionId)
    if (!connection) return null

    return {
      host: connection.config.host,
      port: connection.config.port,
      database: connection.config.database,
      type: 'mysql'
    }
  }

  getAllConnections(): string[] {
    return Array.from(this.connections.keys())
  }

  async supportsTransactions(connectionId: string): Promise<boolean> {
    return true // MySQL supports transactions
  }

  async beginTransaction(connectionId: string): Promise<any> {
    const connection = this.connections.get(connectionId)
    if (!connection || !connection.isConnected) {
      throw new Error('Not connected to MySQL database')
    }

    await connection.client.beginTransaction()
    return {
      id: connectionId,
      commit: async () => {
        await connection.client.commit()
      },
      rollback: async () => {
        await connection.client.rollback()
      }
    }
  }

  async executeBulkOperations(connectionId: string, operations: any[]): Promise<any> {
    const connection = this.connections.get(connectionId)
    if (!connection || !connection.isConnected) {
      return { success: false, error: 'Not connected to MySQL database' }
    }

    const results = []
    let hasError = false

    try {
      await connection.client.beginTransaction()

      for (const operation of operations) {
        try {
          let sql = ''
          let params: any[] = []

          switch (operation.type) {
            case 'insert':
              const columns = Object.keys(operation.data || {})
              const values = Object.values(operation.data || {})
              sql = `INSERT INTO ${this.escapeIdentifier(operation.table)} (${columns.map((c) => this.escapeIdentifier(c)).join(', ')}) VALUES (${values.map(() => '?').join(', ')})`
              params = values
              break
            case 'update':
              const setClause = Object.keys(operation.updates || {})
                .map((key) => `${this.escapeIdentifier(key)} = ?`)
                .join(', ')
              const whereClause = Object.keys(operation.where || {})
                .map((key) => `${this.escapeIdentifier(key)} = ?`)
                .join(' AND ')
              sql = `UPDATE ${this.escapeIdentifier(operation.table)} SET ${setClause} WHERE ${whereClause}`
              params = [
                ...Object.values(operation.updates || {}),
                ...Object.values(operation.where || {})
              ]
              break
            case 'delete':
              const deleteWhereClause = Object.keys(operation.where || {})
                .map((key) => `${this.escapeIdentifier(key)} = ?`)
                .join(' AND ')
              sql = `DELETE FROM ${this.escapeIdentifier(operation.table)} WHERE ${deleteWhereClause}`
              params = Object.values(operation.where || {})
              break
          }

          const [result] = await connection.client.execute(sql, params)
          results.push({ success: true, result })
        } catch (error: any) {
          hasError = true
          results.push({ success: false, error: error.message })
        }
      }

      if (hasError) {
        await connection.client.rollback()
        return { success: false, results, error: 'Some operations failed' }
      } else {
        await connection.client.commit()
        return { success: true, results }
      }
    } catch (error: any) {
      await connection.client.rollback()
      return { success: false, error: error.message }
    }
  }

  async getPrimaryKeys(connectionId: string, table: string, database?: string): Promise<string[]> {
    try {
      const schemaResult = await this.getTableSchema(connectionId, table, database)
      if (schemaResult.success && schemaResult.schema) {
        return schemaResult.schema
          .filter((col: any) => col.isPrimaryKey)
          .map((col: any) => col.name)
      }
      return []
    } catch (error) {
      console.error('Error getting primary keys:', error)
      return []
    }
  }
}

export { MySQLManager }
