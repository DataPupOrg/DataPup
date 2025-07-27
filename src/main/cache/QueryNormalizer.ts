import * as crypto from 'crypto'

export interface NormalizedQuery {
  normalized: string
  tables: string[]
  queryType: 'SELECT' | 'DDL' | 'DML' | 'OTHER'
  hash: string
}

export class QueryNormalizer {
  /**
   * Normalize a SQL query for consistent caching
   */
  static normalize(query: string): NormalizedQuery {
    // Remove comments and extra whitespace
    let normalized = this.removeComments(query)
    normalized = this.normalizeWhitespace(normalized)

    // Convert to uppercase for case-insensitive comparison
    normalized = normalized.toUpperCase()

    // Extract tables and determine query type
    const tables = this.extractTables(normalized)
    const queryType = this.determineQueryType(normalized)

    // Generate hash
    const hash = this.generateHash(normalized)

    return {
      normalized,
      tables,
      queryType,
      hash
    }
  }

  /**
   * Generate a cache key from query and connection parameters
   */
  static generateCacheKey(query: string, connectionId: string, database?: string): string {
    const normalized = this.normalize(query)
    const contextData = `${connectionId}:${database || 'default'}`

    return crypto
      .createHash('sha256')
      .update(`${normalized.normalized}:${contextData}`)
      .digest('hex')
  }

  /**
   * Check if a query should be cached
   */
  static shouldCache(query: string): boolean {
    const normalized = this.normalize(query)

    // Only cache SELECT queries
    if (normalized.queryType !== 'SELECT') {
      return false
    }

    // Don't cache queries with time-sensitive functions
    const timeSensitiveFunctions = [
      'NOW()',
      'CURRENT_TIMESTAMP',
      'CURRENT_DATE',
      'CURRENT_TIME',
      'RAND()',
      'RANDOM()',
      'UUID()',
      'NEWID()'
    ]

    const upperQuery = normalized.normalized
    return !timeSensitiveFunctions.some((func) => upperQuery.includes(func))
  }

  private static removeComments(query: string): string {
    // Remove single line comments (-- comment)
    query = query.replace(/--.*$/gm, '')

    // Remove multi-line comments (/* comment */)
    query = query.replace(/\/\*[\s\S]*?\*\//g, '')

    return query
  }

  private static normalizeWhitespace(query: string): string {
    // Replace multiple whitespace characters with single space
    return query.replace(/\s+/g, ' ').trim()
  }

  private static extractTables(normalizedQuery: string): string[] {
    const tables: Set<string> = new Set()

    // Simple regex patterns to extract table names
    // This is a basic implementation - a full SQL parser would be more accurate

    // FROM clause
    const fromMatches = normalizedQuery.match(/\bFROM\s+([^\s,;()]+)/gi)
    if (fromMatches) {
      fromMatches.forEach((match) => {
        const tableName = match.replace(/^FROM\s+/i, '').trim()
        tables.add(this.cleanTableName(tableName))
      })
    }

    // JOIN clauses
    const joinMatches = normalizedQuery.match(/\bJOIN\s+([^\s,;()]+)/gi)
    if (joinMatches) {
      joinMatches.forEach((match) => {
        const tableName = match.replace(/^JOIN\s+/i, '').trim()
        tables.add(this.cleanTableName(tableName))
      })
    }

    // UPDATE clauses
    const updateMatches = normalizedQuery.match(/\bUPDATE\s+([^\s,;()]+)/gi)
    if (updateMatches) {
      updateMatches.forEach((match) => {
        const tableName = match.replace(/^UPDATE\s+/i, '').trim()
        tables.add(this.cleanTableName(tableName))
      })
    }

    // INSERT INTO clauses
    const insertMatches = normalizedQuery.match(/\bINSERT\s+INTO\s+([^\s,;()]+)/gi)
    if (insertMatches) {
      insertMatches.forEach((match) => {
        const tableName = match.replace(/^INSERT\s+INTO\s+/i, '').trim()
        tables.add(this.cleanTableName(tableName))
      })
    }

    // DELETE FROM clauses
    const deleteMatches = normalizedQuery.match(/\bDELETE\s+FROM\s+([^\s,;()]+)/gi)
    if (deleteMatches) {
      deleteMatches.forEach((match) => {
        const tableName = match.replace(/^DELETE\s+FROM\s+/i, '').trim()
        tables.add(this.cleanTableName(tableName))
      })
    }

    return Array.from(tables).filter(Boolean)
  }

  private static cleanTableName(tableName: string): string {
    // Remove quotes and backticks
    tableName = tableName.replace(/[`"'[\]]/g, '')

    // Remove database prefix if present (keep only table name for cache invalidation)
    const parts = tableName.split('.')
    return parts.length > 1 ? parts[parts.length - 1] : tableName
  }

  private static determineQueryType(normalizedQuery: string): 'SELECT' | 'DDL' | 'DML' | 'OTHER' {
    const trimmed = normalizedQuery.trim()

    if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH')) {
      return 'SELECT'
    }

    if (
      trimmed.startsWith('INSERT') ||
      trimmed.startsWith('UPDATE') ||
      trimmed.startsWith('DELETE')
    ) {
      return 'DML'
    }

    if (
      trimmed.startsWith('CREATE') ||
      trimmed.startsWith('DROP') ||
      trimmed.startsWith('ALTER') ||
      trimmed.startsWith('TRUNCATE')
    ) {
      return 'DDL'
    }

    return 'OTHER'
  }

  private static generateHash(normalizedQuery: string): string {
    return crypto.createHash('md5').update(normalizedQuery).digest('hex')
  }
}
