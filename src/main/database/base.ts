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
  BulkOperationResult
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
    affectedRows?: number
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
      isDML
    }
  }

  abstract query(connectionId: string, sql: string, sessionId?: string): Promise<QueryResult>

  abstract cancelQuery(
    connectionId: string,
    queryId: string
  ): Promise<{ success: boolean; message: string }>

  abstract insertRow(
    connectionId: string,
    table: string,
    data: Record<string, any>,
    database?: string
  ): Promise<InsertResult>

  abstract updateRow(
    connectionId: string,
    table: string,
    primaryKey: Record<string, any>,
    updates: Record<string, any>,
    database?: string
  ): Promise<UpdateResult>

  abstract deleteRow(
    connectionId: string,
    table: string,
    primaryKey: Record<string, any>,
    database?: string
  ): Promise<DeleteResult>

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

  // Transaction support - abstract implementation
  abstract supportsTransactions(connectionId: string): Promise<boolean>

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
