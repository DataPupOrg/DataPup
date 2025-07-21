import {
  DatabaseManagerInterface,
  DatabaseConfig,
  ConnectionResult,
  QueryResult,
  QueryType,
  InsertResult,
  UpdateResult,
  DeleteResult,
  TableSchema,
  DatabaseCapabilities,
  TransactionHandle,
  BulkOperation,
  BulkOperationResult,
  PaginationOptions,
  PaginationInfo
} from './interface'

export abstract class BaseDatabaseManager implements DatabaseManagerInterface {
  protected connections: Map<string, any> = new Map()
  protected readonlyConnections: Set<string> = new Set()

  abstract connect(config: DatabaseConfig, connectionId: string): Promise<ConnectionResult>
  abstract disconnect(connectionId: string): Promise<{ success: boolean; message: string }>
  abstract getCapabilities(): DatabaseCapabilities

  isConnected(connectionId: string): boolean {
    return this.connections.has(connectionId)
  }

  isReadOnly(connectionId: string): boolean {
    return this.readonlyConnections.has(connectionId)
  }

  protected detectQueryType(sql: string): QueryType {
    const trimmedSql = sql.trim().toUpperCase()

    if (trimmedSql.startsWith('SELECT') || trimmedSql.startsWith('WITH')) {
      return QueryType.SELECT
    } else if (trimmedSql.startsWith('INSERT')) {
      return QueryType.INSERT
    } else if (trimmedSql.startsWith('UPDATE')) {
      return QueryType.UPDATE
    } else if (trimmedSql.startsWith('DELETE')) {
      return QueryType.DELETE
    } else if (trimmedSql.match(/^(CREATE|DROP|ALTER|TRUNCATE|RENAME|COMMENT)\s/)) {
      return QueryType.DDL
    } else if (trimmedSql.match(/^(SHOW|DESCRIBE|DESC|EXPLAIN)\s/)) {
      return QueryType.SYSTEM
    }

    return QueryType.OTHER
  }

  protected validateReadOnlyQuery(
    connectionId: string,
    sql: string
  ): { valid: boolean; error?: string } {
    if (!this.isReadOnly(connectionId)) {
      return { valid: true }
    }

    const queryType = this.detectQueryType(sql)
    const allowedTypes = [QueryType.SELECT, QueryType.SYSTEM]

    if (!allowedTypes.includes(queryType)) {
      return {
        valid: false,
        error: `Read-only connection: ${queryType} queries are not allowed`
      }
    }

    return { valid: true }
  }

  protected createQueryResult(
    success: boolean,
    message: string,
    data?: any[],
    error?: string,
    queryType?: QueryType,
    affectedRows?: number,
    pagination?: PaginationInfo
  ): QueryResult {
    const isDDL = queryType === QueryType.DDL
    const isDML = [QueryType.INSERT, QueryType.UPDATE, QueryType.DELETE].includes(
      queryType || QueryType.OTHER
    )

    return {
      success,
      message,
      data,
      error,
      queryType,
      affectedRows,
      isDDL,
      isDML,
      pagination
    }
  }

  protected parseSQLForPagination(sql: string): {
    hasLimit: boolean
    hasOffset: boolean
    originalLimit?: number
    originalOffset?: number
  } {
    const upperSql = sql.toUpperCase()

    // Check for LIMIT clause
    const limitMatch = upperSql.match(/\bLIMIT\s+(\d+)/i)
    const offsetMatch = upperSql.match(/\bOFFSET\s+(\d+)/i)

    return {
      hasLimit: !!limitMatch,
      hasOffset: !!offsetMatch,
      originalLimit: limitMatch ? parseInt(limitMatch[1]) : undefined,
      originalOffset: offsetMatch ? parseInt(offsetMatch[1]) : undefined
    }
  }

  protected addPaginationToSQL(sql: string, pagination: PaginationOptions): string {
    const { page = 1, limit = 100 } = pagination
    const offset = (page - 1) * limit

    // For databases that support LIMIT/OFFSET syntax (most SQL databases)
    // Remove existing LIMIT/OFFSET clauses first
    let cleanSql = sql.replace(/\s+LIMIT\s+\d+(\s+OFFSET\s+\d+)?/gi, '')

    // Add new LIMIT and OFFSET
    return `${cleanSql} LIMIT ${limit} OFFSET ${offset}`
  }

  protected createPaginationInfo(page: number, limit: number, totalCount?: number): PaginationInfo {
    const totalPages = totalCount ? Math.ceil(totalCount / limit) : undefined

    return {
      currentPage: page,
      pageSize: limit,
      totalCount,
      totalPages,
      hasMore: totalPages ? page < totalPages : false,
      hasPrevious: page > 1
    }
  }

  protected shouldApplyPagination(sql: string, pagination?: PaginationOptions): boolean {
    if (!pagination) return false

    const queryType = this.detectQueryType(sql)
    // Only apply pagination to SELECT queries
    if (queryType !== QueryType.SELECT) return false

    // Check if query already has a user-specified LIMIT that's smaller than our pagination
    const sqlInfo = this.parseSQLForPagination(sql)
    if (
      sqlInfo.hasLimit &&
      sqlInfo.originalLimit &&
      sqlInfo.originalLimit <= (pagination.limit || 100)
    ) {
      return false // User has already specified a smaller limit
    }

    return true
  }

  abstract query(
    connectionId: string,
    sql: string,
    sessionId?: string,
    pagination?: PaginationOptions
  ): Promise<QueryResult>

  async cancelQuery(
    connectionId: string,
    queryId: string
  ): Promise<{ success: boolean; message: string }> {
    return {
      success: false,
      message: 'Query cancellation not supported by this database'
    }
  }

  async insertRow(
    connectionId: string,
    table: string,
    data: Record<string, any>,
    database?: string
  ): Promise<InsertResult> {
    // Default implementation - can be overridden by specific database managers
    const columns = Object.keys(data)
    const values = Object.values(data)

    const qualifiedTable = database ? `${database}.${table}` : table

    // Note: This is a basic implementation. Real implementations should use parameterized queries
    const escapedValues = values
      .map((v) => {
        if (v === null || v === undefined || v === '') return 'NULL'
        if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`
        if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`
        if (typeof v === 'boolean') return v ? '1' : '0'
        return v
      })
      .join(', ')
    const finalSql = `INSERT INTO ${qualifiedTable} (${columns.join(', ')}) VALUES (${escapedValues})`

    const result = await this.query(connectionId, finalSql)
    return result as InsertResult
  }

  async updateRow(
    connectionId: string,
    table: string,
    primaryKey: Record<string, any>,
    updates: Record<string, any>,
    database?: string
  ): Promise<UpdateResult> {
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
    const escapeValue = (val: any) => {
      if (val === null || val === undefined || val === '') return 'NULL'
      if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`
      if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`
      if (typeof val === 'boolean') return val ? '1' : '0'
      return val
    }

    const whereClauses = Object.entries(primaryKey).map(([col, val]) => {
      return `${col} = ${escapeValue(val)}`
    })

    const qualifiedTable = database ? `${database}.${table}` : table
    const sql = `DELETE FROM ${qualifiedTable} WHERE ${whereClauses.join(' AND ')}`

    const result = await this.query(connectionId, sql)
    return result as DeleteResult
  }

  abstract getDatabases(
    connectionId: string
  ): Promise<{ success: boolean; databases?: string[]; message: string }>

  abstract getTables(
    connectionId: string,
    database?: string
  ): Promise<{ success: boolean; tables?: string[]; message: string }>

  abstract getTableSchema(
    connectionId: string,
    tableName: string,
    database?: string
  ): Promise<{ success: boolean; schema?: any[]; message: string }>

  abstract getTableFullSchema(
    connectionId: string,
    tableName: string,
    database?: string
  ): Promise<{ success: boolean; schema?: TableSchema; message: string }>

  getConnectionInfo(connectionId: string): { host: string; port: number; database: string } | null {
    const connection = this.connections.get(connectionId)
    if (!connection) return null

    return {
      host: connection.config.host,
      port: connection.config.port,
      database: connection.config.database
    }
  }

  getAllConnections(): string[] {
    return Array.from(this.connections.keys())
  }

  // Transaction support - default implementations
  async supportsTransactions(connectionId: string): Promise<boolean> {
    return this.getCapabilities().supportsTransactions
  }

  async beginTransaction(connectionId: string): Promise<TransactionHandle> {
    throw new Error('Transactions not supported by this database')
  }

  async executeBulkOperations(
    connectionId: string,
    operations: BulkOperation[]
  ): Promise<BulkOperationResult> {
    // Check if database supports transactions
    const hasTransactionSupport = await this.supportsTransactions(connectionId)

    if (hasTransactionSupport) {
      // Try to use transactions
      try {
        await this.query(connectionId, 'BEGIN TRANSACTION')

        const results: QueryResult[] = []
        let allSuccess = true

        for (const op of operations) {
          try {
            let result: QueryResult
            switch (op.type) {
              case 'insert':
                result = await this.insertRow(connectionId, op.table, op.data!, op.database)
                break
              case 'update':
                result = await this.updateRow(
                  connectionId,
                  op.table,
                  op.primaryKey || op.where!,
                  op.data!,
                  op.database
                )
                break
              case 'delete':
                result = await this.deleteRow(
                  connectionId,
                  op.table,
                  op.primaryKey || op.where!,
                  op.database
                )
                break
            }
            results.push(result)
            if (!result.success) {
              allSuccess = false
              break
            }
          } catch (error) {
            allSuccess = false
            results.push({
              success: false,
              message: `${op.type} operation failed`,
              error: error instanceof Error ? error.message : 'Unknown error'
            })
            break
          }
        }

        if (allSuccess) {
          await this.query(connectionId, 'COMMIT')

          // Don't try to fetch updated data - let the client handle refreshing
          let updatedData: any[] | undefined = undefined

          return {
            success: true,
            results,
            data: updatedData
          }
        } else {
          await this.query(connectionId, 'ROLLBACK')
          return {
            success: false,
            results,
            error: 'Transaction rolled back due to errors'
          }
        }
      } catch (error) {
        // Try to rollback if possible
        try {
          await this.query(connectionId, 'ROLLBACK')
        } catch (rollbackError) {
          // Ignore rollback errors
        }

        // Fall back to non-transactional execution
        return this.executeBulkOperationsWithoutTransaction(connectionId, operations)
      }
    } else {
      // Execute without transactions
      return this.executeBulkOperationsWithoutTransaction(connectionId, operations)
    }
  }

  private async executeBulkOperationsWithoutTransaction(
    connectionId: string,
    operations: BulkOperation[]
  ): Promise<BulkOperationResult> {
    const results: QueryResult[] = []

    for (const op of operations) {
      try {
        let result: QueryResult
        switch (op.type) {
          case 'insert':
            result = await this.insertRow(connectionId, op.table, op.data!, op.database)
            break
          case 'update':
            result = await this.updateRow(
              connectionId,
              op.table,
              op.primaryKey || op.where!,
              op.data!,
              op.database
            )
            break
          case 'delete':
            result = await this.deleteRow(
              connectionId,
              op.table,
              op.primaryKey || op.where!,
              op.database
            )
            break
        }
        results.push(result)
      } catch (error) {
        results.push({
          success: false,
          message: `${op.type} operation failed`,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    // Don't try to fetch updated data - let the client handle refreshing
    let updatedData: any[] | undefined = undefined

    return {
      success: results.every((r) => r.success),
      results,
      warning: 'Operations executed without transaction support',
      data: updatedData
    }
  }

  async getPrimaryKeys(connectionId: string, table: string, database?: string): Promise<string[]> {
    const tableSchema = await this.getTableFullSchema(connectionId, table, database)
    if (tableSchema.success && tableSchema.schema) {
      return tableSchema.schema.primaryKeys
    }
    return []
  }

  abstract cleanup(): Promise<void>
}
