import { TableQueryOptions, TableFilter, QueryResult } from '../database/interface'

export interface DatabaseAdapter {
  escapeIdentifier(identifier: string): string
  escapeValue(value: any): string
  buildWhereClause(filter: TableFilter): string
  query(connectionId: string, sql: string, sessionId?: string): Promise<QueryResult>
  getCountExpression?(): string // Optional method for database-specific count syntax
}

export class PaginationQueryBuilder {
  constructor(private adapter: DatabaseAdapter) {}

  async buildPaginatedQuery(
    connectionId: string,
    options: TableQueryOptions,
    qualifiedTable: string,
    sessionId?: string
  ): Promise<QueryResult> {
    const { filters, orderBy, limit, offset } = options

    let baseQuery = `FROM ${qualifiedTable}`

    // Add WHERE clause if filters exist
    if (filters && filters.length > 0) {
      const whereClauses = filters
        .map((filter: TableFilter) => this.adapter.buildWhereClause(filter))
        .filter(Boolean)
      if (whereClauses.length > 0) {
        baseQuery += ` WHERE ${whereClauses.join(' AND ')}`
      }
    }

    // Build the main SELECT query
    let sql = `SELECT * ${baseQuery}`

    // Add ORDER BY clause
    if (orderBy && orderBy.length > 0) {
      const orderClauses = orderBy.map((o: { column: string; direction: 'asc' | 'desc' }) => 
        `${this.adapter.escapeIdentifier(o.column)} ${o.direction.toUpperCase()}`
      )
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
    const result = await this.adapter.query(connectionId, sql, sessionId)

    // If successful and we have pagination, get the total count
    if (result.success && (limit || offset)) {
      try {
        const countExpression = this.adapter.getCountExpression?.() || 'COUNT(*)'
        const countSql = `SELECT ${countExpression} as total ${baseQuery}`
        const countResult = await this.adapter.query(connectionId, countSql)

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
}