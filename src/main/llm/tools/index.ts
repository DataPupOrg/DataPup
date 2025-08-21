import { DatabaseManager } from '../../database/manager'
import { logger } from '../../utils/logger'
import { QueryPerformanceAnalyzer } from './queryPerformanceAnalyzer'
import { QueryPerformanceResult } from '../../database/interface'

export class AITools {
  private databaseManager: DatabaseManager
  private lastErrors: Record<string, any> = {}
  private conversationContexts: Record<string, any> = {}
  private queryPerformanceAnalyzer: QueryPerformanceAnalyzer

  constructor(databaseManager: DatabaseManager) {
    this.databaseManager = databaseManager
    this.queryPerformanceAnalyzer = new QueryPerformanceAnalyzer(databaseManager)
  }

  async listDatabases(connectionId: string) {
    return await this.databaseManager.getDatabases(connectionId)
  }

  async listTables(connectionId: string, database?: string) {
    return await this.databaseManager.getTables(connectionId, database)
  }

  async getTableSchema(connectionId: string, tableName: string, database?: string) {
    return await this.databaseManager.getTableSchema(connectionId, tableName, database)
  }

  async getSampleRows(
    connectionId: string,
    database: string,
    tableName: string,
    limit: number = 5
  ) {
    try {
      const query = `SELECT * FROM ${database}.${tableName} LIMIT ${limit}`
      return await this.databaseManager.query(connectionId, query)
    } catch (error) {
      logger.error('Error getting sample rows:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  async executeQuery(connectionId: string, sql: string) {
    try {
      const result = await this.databaseManager.query(connectionId, sql)
      if (!result.success) {
        this.lastErrors[connectionId] = result.error
      }
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      this.lastErrors[connectionId] = errorMessage
      return {
        success: false,
        error: errorMessage
      }
    }
  }

  async getLastError(connectionId: string) {
    return {
      success: true,
      error: this.lastErrors[connectionId] || null
    }
  }

  async searchTables(connectionId: string, pattern: string, database?: string) {
    try {
      const tablesResult = await this.databaseManager.getTables(connectionId, database)
      if (!tablesResult.success || !tablesResult.tables) {
        return { success: false, tables: [], error: tablesResult.error }
      }
      const filtered = tablesResult.tables.filter((table) =>
        table.toLowerCase().includes(pattern.toLowerCase())
      )
      return { success: true, tables: filtered }
    } catch (error) {
      logger.error('Error searching tables:', error)
      return {
        success: false,
        tables: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  async searchColumns(connectionId: string, pattern: string, database?: string) {
    try {
      const tablesResult = await this.databaseManager.getTables(connectionId, database)
      if (!tablesResult.success || !tablesResult.tables) {
        return { success: false, columns: [], error: tablesResult.error }
      }

      const matchingColumns: Array<{ table: string; column: string; type: string }> = []

      for (const table of tablesResult.tables) {
        const schemaResult = await this.databaseManager.getTableSchema(
          connectionId,
          table,
          database
        )
        if (schemaResult.success && schemaResult.schema) {
          for (const col of schemaResult.schema) {
            const columnName = col.name || col.field || col[0]
            if (columnName && columnName.toLowerCase().includes(pattern.toLowerCase())) {
              matchingColumns.push({
                table,
                column: columnName,
                type: col.type || col[1] || 'unknown'
              })
            }
          }
        }
      }

      return { success: true, columns: matchingColumns }
    } catch (error) {
      logger.error('Error searching columns:', error)
      return {
        success: false,
        columns: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  async summarizeSchema(connectionId: string, database?: string) {
    try {
      const tablesResult = await this.databaseManager.getTables(connectionId, database)
      if (!tablesResult.success || !tablesResult.tables) {
        return { success: false, summary: '', error: tablesResult.error }
      }

      const tableCount = tablesResult.tables.length
      const tableSummaries: string[] = []

      for (const table of tablesResult.tables.slice(0, 10)) {
        // Limit to first 10 tables
        const schemaResult = await this.databaseManager.getTableSchema(
          connectionId,
          table,
          database
        )
        if (schemaResult.success && schemaResult.schema) {
          tableSummaries.push(`- ${table} (${schemaResult.schema.length} columns)`)
        }
      }

      const summary = `Database "${database || 'default'}" contains ${tableCount} tables:\n${tableSummaries.join('\n')}${
        tableCount > 10 ? `\n... and ${tableCount - 10} more tables` : ''
      }`

      return { success: true, summary }
    } catch (error) {
      logger.error('Error summarizing schema:', error)
      return {
        success: false,
        summary: '',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  async summarizeTable(connectionId: string, tableName: string, database?: string) {
    try {
      const schemaResult = await this.databaseManager.getTableSchema(
        connectionId,
        tableName,
        database
      )
      if (!schemaResult.success || !schemaResult.schema) {
        return { success: false, summary: '', error: schemaResult.error }
      }

      const columns = schemaResult.schema
        .map((col) => {
          const name = col.name || col.field || col[0]
          const type = col.type || col[1]
          return `  - ${name}: ${type}`
        })
        .join('\n')

      const summary = `Table "${tableName}" has ${schemaResult.schema.length} columns:\n${columns}`
      return { success: true, summary }
    } catch (error) {
      logger.error('Error summarizing table:', error)
      return {
        success: false,
        summary: '',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  async profileTable(connectionId: string, tableName: string, database?: string) {
    try {
      const countQuery = `SELECT COUNT(*) as count FROM ${database ? `${database}.` : ''}${tableName}`
      const countResult = await this.databaseManager.query(connectionId, countQuery)

      if (!countResult.success || !countResult.data || countResult.data.length === 0) {
        return { success: false, profile: {}, error: 'Failed to get row count' }
      }

      const rowCount = countResult.data[0].count || countResult.data[0].COUNT || 0

      const schemaResult = await this.databaseManager.getTableSchema(
        connectionId,
        tableName,
        database
      )
      const columnCount =
        schemaResult.success && schemaResult.schema ? schemaResult.schema.length : 0

      return {
        success: true,
        profile: {
          tableName,
          database: database || 'default',
          rowCount,
          columnCount,
          approximateSize: `~${Math.round((rowCount * columnCount * 50) / 1024 / 1024)} MB (estimate)`
        }
      }
    } catch (error) {
      logger.error('Error profiling table:', error)
      return {
        success: false,
        profile: {},
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  async getConversationContext(sessionId: string) {
    return {
      success: true,
      context: this.conversationContexts[sessionId] || null
    }
  }

  async setConversationContext(sessionId: string, context: any) {
    this.conversationContexts[sessionId] = context
    return { success: true }
  }

  async getDocumentation(topic: string) {
    const docs: Record<string, string> = {
      'table-operations': `
Table Operations:
- INSERT: Add new rows to a table
- UPDATE: Modify existing rows
- DELETE: Remove rows from a table
- SELECT: Query data from tables

Example:
SELECT * FROM users WHERE age > 18;
UPDATE users SET status = 'active' WHERE id = 1;
`,
      'join-types': `
SQL Join Types:
- INNER JOIN: Returns records with matching values in both tables
- LEFT JOIN: Returns all records from left table and matched from right
- RIGHT JOIN: Returns all records from right table and matched from left
- FULL OUTER JOIN: Returns all records when there's a match in either table

Example:
SELECT u.name, o.order_date
FROM users u
INNER JOIN orders o ON u.id = o.user_id;
`,
      aggregations: `
Aggregation Functions:
- COUNT(): Count number of rows
- SUM(): Sum of values
- AVG(): Average value
- MIN(): Minimum value
- MAX(): Maximum value
- GROUP BY: Group rows by column values

Example:
SELECT department, COUNT(*) as employee_count
FROM employees
GROUP BY department;
`
    }

    const content = docs[topic] || `No documentation available for topic: ${topic}`
    return { success: true, content }
  }

  async analyzeQueryPerformance(
    connectionId: string, 
    sql: string, 
    database?: string
  ): Promise<QueryPerformanceResult> {
    return await this.queryPerformanceAnalyzer.analyzeQueryPerformance(connectionId, sql, database)
  }
}
