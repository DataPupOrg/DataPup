import { IntellisenseProvider } from '../IntellisenseProvider'
import type { SQLContext, DatabaseSchema, Position } from '../types'
import { Monaco } from '@monaco-editor/react'

export class PostgreSQLIntellisenseProvider extends IntellisenseProvider {
  getDatabaseSpecificKeywords(): string[] {
    return [
      'RETURNING',
      'ILIKE',
      'SIMILAR TO',
      'JSONB',
      'JSON',
      'ARRAY',
      'HSTORE',
      'SERIAL',
      'BIGSERIAL',
      'SMALLSERIAL',
      'UUID',
      'INET',
      'CIDR',
      'MACADDR',
      'INTERVAL',
      'TIMESTAMPTZ',
      'TIMETZ',
      'POINT',
      'LINE',
      'LSEG',
      'BOX',
      'PATH',
      'POLYGON',
      'CIRCLE',
      'TABLESPACE',
      'SCHEMA',
      'DOMAIN',
      'EXTENSION',
      'SEQUENCE',
      'FUNCTION',
      'PROCEDURE',
      'TRIGGER',
      'RULE',
      'POLICY',
      'ROLE',
      'INHERIT',
      'NOINHERIT',
      'LOGIN',
      'NOLOGIN',
      'SUPERUSER',
      'NOSUPERUSER',
      'CREATEDB',
      'NOCREATEDB',
      'CREATEROLE',
      'NOCREATEROLE',
      'REPLICATION',
      'NOREPLICATION',
      'BYPASSRLS',
      'NOBYPASSRLS',
      'CONNECTION LIMIT',
      'ENCRYPTED',
      'UNENCRYPTED',
      'VALID UNTIL',
      'IN ROLE',
      'ADMIN',
      'CONCURRENTLY',
      'ONLY',
      'EXCLUDE',
      'DEFERRABLE',
      'INITIALLY DEFERRED',
      'INITIALLY IMMEDIATE',
      'MATCH FULL',
      'MATCH PARTIAL',
      'MATCH SIMPLE',
      'ON DELETE',
      'ON UPDATE',
      'CASCADE',
      'RESTRICT',
      'SET NULL',
      'SET DEFAULT',
      'NO ACTION'
    ]
  }

  getDatabaseSpecificFunctions(): string[] {
    return [
      'AGE',
      'EXTRACT',
      'DATE_PART',
      'DATE_TRUNC',
      'GENERATE_SERIES',
      'ARRAY_AGG',
      'ARRAY_APPEND',
      'ARRAY_PREPEND',
      'ARRAY_CAT',
      'ARRAY_DIMS',
      'ARRAY_FILL',
      'ARRAY_LENGTH',
      'ARRAY_LOWER',
      'ARRAY_NDIMS',
      'ARRAY_POSITION',
      'ARRAY_POSITIONS',
      'ARRAY_REMOVE',
      'ARRAY_REPLACE',
      'ARRAY_TO_STRING',
      'ARRAY_UPPER',
      'CARDINALITY',
      'UNNEST',
      'JSON_AGG',
      'JSON_OBJECT_AGG',
      'JSONB_AGG',
      'JSONB_OBJECT_AGG',
      'JSON_ARRAY_ELEMENTS',
      'JSON_ARRAY_ELEMENTS_TEXT',
      'JSON_EACH',
      'JSON_EACH_TEXT',
      'JSON_EXTRACT_PATH',
      'JSON_EXTRACT_PATH_TEXT',
      'JSON_OBJECT_KEYS',
      'JSON_POPULATE_RECORD',
      'JSON_POPULATE_RECORDSET',
      'JSON_TO_RECORD',
      'JSON_TO_RECORDSET',
      'JSONB_ARRAY_ELEMENTS',
      'JSONB_ARRAY_ELEMENTS_TEXT',
      'JSONB_EACH',
      'JSONB_EACH_TEXT',
      'JSONB_EXTRACT_PATH',
      'JSONB_EXTRACT_PATH_TEXT',
      'JSONB_OBJECT_KEYS',
      'JSONB_POPULATE_RECORD',
      'JSONB_POPULATE_RECORDSET',
      'JSONB_TO_RECORD',
      'JSONB_TO_RECORDSET',
      'ROW_TO_JSON',
      'TO_JSON',
      'TO_JSONB',
      'STRING_AGG',
      'STRING_TO_ARRAY',
      'REGEXP_REPLACE',
      'REGEXP_SPLIT_TO_ARRAY',
      'REGEXP_SPLIT_TO_TABLE',
      'SPLIT_PART',
      'STRPOS',
      'INITCAP',
      'LPAD',
      'RPAD',
      'LTRIM',
      'RTRIM',
      'BTRIM',
      'TRANSLATE',
      'ENCODE',
      'DECODE',
      'MD5',
      'SHA224',
      'SHA256',
      'SHA384',
      'SHA512',
      'CRYPT',
      'GEN_SALT',
      'GEN_RANDOM_UUID',
      'RANDOM',
      'SETSEED',
      'WIDTH_BUCKET',
      'RANGE_MERGE',
      'RANGE_INTERSECT',
      'LOWER_INC',
      'UPPER_INC',
      'LOWER_INF',
      'UPPER_INF',
      'ISEMPTY',
      'RANGE_UNION',
      'RANGE_MINUS',
      'MULTIRANGE',
      'OVERLAPS',
      'ISFINITE',
      'JUSTIFY_DAYS',
      'JUSTIFY_HOURS',
      'JUSTIFY_INTERVAL',
      'CLOCK_TIMESTAMP',
      'STATEMENT_TIMESTAMP',
      'TRANSACTION_TIMESTAMP',
      'TIMEOFDAY',
      'LOCALTIMESTAMP',
      'LOCALTIME',
      'NOW',
      'CURRENT_DATE',
      'CURRENT_TIME',
      'CURRENT_TIMESTAMP',
      'MAKE_DATE',
      'MAKE_TIME',
      'MAKE_TIMESTAMP',
      'MAKE_TIMESTAMPTZ',
      'MAKE_INTERVAL',
      'TO_TIMESTAMP',
      'TO_DATE',
      'TO_CHAR',
      'TO_NUMBER',
      'INET_CLIENT_ADDR',
      'INET_CLIENT_PORT',
      'INET_SERVER_ADDR',
      'INET_SERVER_PORT',
      'ABBREV',
      'BROADCAST',
      'FAMILY',
      'HOST',
      'HOSTMASK',
      'MASKLEN',
      'NETMASK',
      'NETWORK',
      'SET_MASKLEN',
      'TEXT',
      'INET_SAME_FAMILY',
      'INET_MERGE',
      'TRUNC',
      'MACADDR8_SET7BIT'
    ]
  }

  getDatabaseSpecificOperators(): string[] {
    return [
      '?',      // JSON key exists
      '?&',     // JSON all keys exist
      '?|',     // JSON any key exists
      '@>',     // JSON/JSONB contains
      '<@',     // JSON/JSONB contained by
      '#>',     // JSON extract path
      '#>>',    // JSON extract path as text
      '||',     // String/Array concatenation
      '@@',     // Full text search match
      '@@@',    // Deprecated full text search
      '!!',     // Factorial
      '|/',     // Square root
      '||/',    // Cube root
      '@',      // Absolute value
      '&',      // Bitwise AND
      '|',      // Bitwise OR
      '#',      // Bitwise XOR
      '~',      // Bitwise NOT
      '<<',     // Bitwise shift left
      '>>',     // Bitwise shift right
      '&&',     // Overlaps (for geometric types)
      '&<',     // Does not extend to the right of
      '&>',     // Does not extend to the left of
      '<<|',    // Is below
      '|>>',    // Is above
      '&<|',    // Does not extend above
      '|&>',    // Does not extend below
      '<->',    // Distance between
      '##',     // Closest point
      '<#>',    // Distance between (for text search)
      '~~',     // LIKE
      '~~*',    // ILIKE
      '!~~',    // NOT LIKE
      '!~~*',   // NOT ILIKE
      '~',      // Regular expression match
      '~*',     // Regular expression match (case insensitive)
      '!~',     // Regular expression not match
      '!~*',    // Regular expression not match (case insensitive)
      '->',     // JSON get value
      '->>',    // JSON get value as text
      '#-'      // JSON delete path
    ]
  }

  formatIdentifier(identifier: string): string {
    // PostgreSQL identifiers typically don't need quoting
    return identifier
  }

  protected quoteIdentifier(identifier: string): string {
    // PostgreSQL uses double quotes for identifiers when quoting is needed
    return `"${identifier.replace(/"/g, '""')}"`
  }

  getCompletionItems(
    monaco: Monaco,
    model: any,
    position: Position,
    context: SQLContext,
    schema?: DatabaseSchema
  ): any[] {
    const items = super.getCompletionItems(monaco, model, position, context, schema)
    
    // Add PostgreSQL-specific operators
    const operators = this.getDatabaseSpecificOperators().map(op => ({
      label: op,
      kind: monaco.languages.CompletionItemKind.Operator,
      insertText: op,
      detail: 'PostgreSQL operator',
      documentation: `PostgreSQL-specific operator: ${op}`
    }))

    return [...items, ...operators]
  }

  protected getTableSuggestions(
    _context: SQLContext,
    schema: DatabaseSchema,
    position: Position,
    range: any
  ): Monaco.languages.CompletionItem[] {
    const suggestions: Monaco.languages.CompletionItem[] = []

    schema.tables.forEach((table, fullName) => {
      // Handle 3-level hierarchy: database.schema.table
      const parts = fullName.split('.')
      let schemaName: string, tableName: string, displayName: string, insertText: string

      if (parts.length === 3) {
        // 3-level: database.schema.table
        const [database, schema, table] = parts
        schemaName = schema
        tableName = table
        displayName = `${schema}.${table}`
        insertText = `${this.formatIdentifier(schema)}.${this.formatIdentifier(table)}`
      } else if (parts.length === 2) {
        // 2-level fallback: schema.table
        const [schema, table] = parts
        schemaName = schema
        tableName = table
        displayName = fullName
        insertText = `${this.formatIdentifier(schema)}.${this.formatIdentifier(table)}`
      } else {
        // 1-level fallback: just table name
        schemaName = 'public'
        tableName = fullName
        displayName = `public.${fullName}`
        insertText = `${this.formatIdentifier('public')}.${this.formatIdentifier(fullName)}`
      }

      // For PostgreSQL, always show the schema.table format
      suggestions.push({
        label: displayName, // Show schema.tablename in the suggestion list
        kind: this.monaco.languages.CompletionItemKind.Class,
        insertText: insertText, // Insert schema.tablename (unquoted)
        detail: `Table in schema ${schemaName}`,
        documentation: `Columns: ${table.columns.map((c) => c.name).join(', ')}`,
        sortText: '1' + displayName,
        range
      })
    })

    return suggestions
  }

  getColumnSuggestions(
    context: SQLContext,
    schema: DatabaseSchema,
    position: Position,
    range: any
  ): Monaco.languages.CompletionItem[] {
    const suggestions: Monaco.languages.CompletionItem[] = []
    const processedColumns = new Set<string>()

    if (context.availableTables.length > 0) {
      context.availableTables.forEach((tableName) => {
        const tableInfo = schema.tables.get(tableName)
        if (tableInfo) {
          // Parse table name to handle 3-level hierarchy
          const parts = tableName.split('.')
          let displayTableName: string

          if (parts.length === 3) {
            // 3-level: database.schema.table -> show as schema.table
            const [database, schema, table] = parts
            displayTableName = `${schema}.${table}`
          } else if (parts.length === 2) {
            // 2-level: schema.table -> use as is
            displayTableName = tableName
          } else {
            // 1-level: table -> assume public schema
            displayTableName = `public.${tableName}`
          }

          tableInfo.columns.forEach((column) => {
            const qualifiedName = `${displayTableName}.${column.name}`

            if (!processedColumns.has(column.name)) {
              suggestions.push({
                label: column.name,
                kind: this.monaco.languages.CompletionItemKind.Field,
                insertText: this.formatIdentifier(column.name),
                detail: `${column.type}${column.nullable ? ' (nullable)' : ' NOT NULL'}`,
                documentation: `Column from ${displayTableName}`,
                sortText: '4' + column.name,
                range
              })
              processedColumns.add(column.name)
            }

            suggestions.push({
              label: qualifiedName,
              kind: this.monaco.languages.CompletionItemKind.Field,
              insertText: `${this.formatIdentifier(displayTableName)}.${this.formatIdentifier(column.name)}`,
              detail: column.type,
              documentation: `Fully qualified column name`,
              sortText: '5' + qualifiedName,
              range: {
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: position.lineNumber,
                endColumn: position.column
              }
            })
          })
        }
      })

      context.tableAliases.forEach((tableName, alias) => {
        if (alias !== tableName) {
          const tableInfo = schema.tables.get(tableName)
          if (tableInfo) {
            // Parse table name for display
            const parts = tableName.split('.')
            let displayTableName: string

            if (parts.length === 3) {
              const [database, schema, table] = parts
              displayTableName = `${schema}.${table}`
            } else {
              displayTableName = tableName
            }

            tableInfo.columns.forEach((column) => {
              const aliasedName = `${alias}.${column.name}`
              suggestions.push({
                label: aliasedName,
                kind: this.monaco.languages.CompletionItemKind.Field,
                insertText: `${this.formatIdentifier(alias)}.${this.formatIdentifier(column.name)}`,
                detail: column.type,
                documentation: `Column from ${displayTableName} (aliased as ${alias})`,
                sortText: '6' + aliasedName,
                range
              })
            })
          }
        }
      })
    }

    return suggestions
  }

  getDatabaseSpecificDataTypes(): string[] {
    return [
      'SERIAL',
      'BIGSERIAL',
      'SMALLSERIAL',
      'UUID',
      'JSON',
      'JSONB',
      'HSTORE',
      'ARRAY',
      'INET',
      'CIDR',
      'MACADDR',
      'MACADDR8',
      'POINT',
      'LINE',
      'LSEG',
      'BOX',
      'PATH',
      'POLYGON',
      'CIRCLE',
      'MONEY',
      'BYTEA',
      'BIT',
      'VARBIT',
      'TSVECTOR',
      'TSQUERY',
      'XML',
      'INT4RANGE',
      'INT8RANGE',
      'NUMRANGE',
      'TSRANGE',
      'TSTZRANGE',
      'DATERANGE',
      'INT4MULTIRANGE',
      'INT8MULTIRANGE',
      'NUMMULTIRANGE',
      'TSMULTIRANGE',
      'TSTZMULTIRANGE',
      'DATEMULTIRANGE',
      'TIMESTAMPTZ',
      'TIMETZ'
    ]
  }
}