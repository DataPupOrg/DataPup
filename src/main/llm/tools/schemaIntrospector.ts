import { DatabaseManager } from '../../database/manager'
import { DatabaseSchema, TableSchema, ColumnSchema } from '../interface'

class SchemaIntrospector {
  private databaseManager: DatabaseManager

  constructor(databaseManager: DatabaseManager) {
    this.databaseManager = databaseManager
  }

  async getDatabaseSchema(connectionId: string, database?: string): Promise<DatabaseSchema | null> {
    try {
      // Get the current database if not specified
      if (!database) {
        const connectionInfo = this.databaseManager.getConnectionInfo(connectionId)
        if (!connectionInfo) {
          throw new Error('Connection not found')
        }
        database = connectionInfo.database
      }

      // Get all tables in the database
      const tablesResult = await this.databaseManager.getTables(connectionId, database)
      if (!tablesResult.success || !tablesResult.tables) {
        throw new Error('Failed to get tables')
      }

      const tables: TableSchema[] = []

      // Get schema for each table
      for (const tableName of tablesResult.tables) {
        const schemaResult = await this.databaseManager.getTableSchema(
          connectionId,
          tableName,
          database
        )
        if (schemaResult.success && schemaResult.schema) {
          const columns: ColumnSchema[] = schemaResult.schema.map((col: any) => ({
            name: col.name || col.field || col[0],
            type: col.type || col[1],
            nullable: this.parseNullable(col.null || col[2]),
            default: col.default || col[3] || undefined
          }))

          tables.push({
            name: tableName,
            columns
          })
        }
      }

      return {
        database,
        tables
      }
    } catch (error) {
      console.error('Error getting database schema:', error)
      return null
    }
  }

  async getSampleData(
    connectionId: string,
    database: string,
    tableNames: string[],
    limit: number = 3
  ): Promise<Record<string, any[]>> {
    const sampleData: Record<string, any[]> = {}

    try {
      for (const tableName of tableNames) {
        const query = `SELECT * FROM ${database}.${tableName} LIMIT ${limit}`
        const result = await this.databaseManager.query(connectionId, query)

        if (result.success && result.data) {
          sampleData[tableName] = result.data
        }
      }
    } catch (error) {
      console.error('Error getting sample data:', error)
    }

    return sampleData
  }

  async getRelevantTables(
    connectionId: string,
    database: string,
    naturalLanguageQuery: string
  ): Promise<string[]> {
    try {
      // Get all tables
      const tablesResult = await this.databaseManager.getTables(connectionId, database)
      if (!tablesResult.success || !tablesResult.tables) {
        return []
      }

      // For now, return all tables. In the future, we could use the LLM to determine relevance
      // based on table names and the natural language query
      return tablesResult.tables
    } catch (error) {
      console.error('Error getting relevant tables:', error)
      return []
    }
  }

  private parseNullable(nullableStr: string | boolean): boolean | undefined {
    if (typeof nullableStr === 'boolean') {
      return nullableStr
    }

    if (typeof nullableStr === 'string') {
      const lower = nullableStr.toLowerCase()
      if (lower === 'yes' || lower === 'true' || lower === '1') {
        return true
      }
      if (lower === 'no' || lower === 'false' || lower === '0') {
        return false
      }
    }

    return undefined
  }

  formatSchemaForDisplay(schema: DatabaseSchema): string {
    let formatted = `Database: ${schema.database}\n\n`

    for (const table of schema.tables) {
      formatted += `📋 Table: ${table.name}\n`
      for (const column of table.columns) {
        const nullable =
          column.nullable !== undefined ? (column.nullable ? 'NULL' : 'NOT NULL') : ''
        const defaultValue = column.default ? ` DEFAULT ${column.default}` : ''
        formatted += `  ├─ ${column.name}: ${column.type}${nullable}${defaultValue}\n`
      }
      formatted += '\n'
    }

    return formatted
  }
}

export { SchemaIntrospector }
