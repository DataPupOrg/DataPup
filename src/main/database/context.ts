import { DatabaseSchema, TableSchema, ColumnSchema } from '../llm/interface'

export interface DatabaseContext {
  databaseType: string
  displayName: string
  description: string

  // Database-specific functions and syntax
  functions: DatabaseFunctions

  // Database-specific examples and patterns
  examples: DatabaseExamples

  // Database-specific best practices
  bestPractices: string[]

  // Database-specific data types
  dataTypes: DatabaseDataTypes

  // Database-specific query patterns
  queryPatterns: DatabaseQueryPatterns

  // Database-specific constraints and features
  features: DatabaseFeatures

  // Critical syntax warnings that the LLM must follow
  criticalSyntaxWarnings?: string[]
}

export interface DatabaseFunctions {
  random: {
    integer: string
    selection: string
    number: string
  }
  dateTime: {
    current: string
    format: string
    arithmetic: string
  }
  aggregation: {
    count: string
    sum: string
    avg: string
    groupBy: string
  }
  string: {
    concat: string
    substring: string
    replace: string
  }
  sequence: {
    generate: string
    incremental: string
  }
  custom?: Record<string, string> // Database-specific functions
}

export interface DatabaseExamples {
  randomData: string[]
  incrementalIds: string[]
  dateTimeOperations: string[]
  aggregations: string[]
  joins: string[]
  subqueries: string[]
  custom?: Record<string, string[]> // Database-specific examples
}

export interface DatabaseDataTypes {
  integer: string[]
  string: string[]
  dateTime: string[]
  boolean: string[]
  decimal: string[]
  custom?: Record<string, string[]> // Database-specific types
}

export interface DatabaseQueryPatterns {
  insert: string
  select: string
  update: string
  delete: string
  join: string
  subquery: string
  window: string
  custom?: Record<string, string> // Database-specific patterns
}

export interface DatabaseFeatures {
  supportsTransactions: boolean
  supportsForeignKeys: boolean
  supportsIndexes: boolean
  supportsViews: boolean
  supportsStoredProcedures: boolean
  supportsTriggers: boolean
  supportsFullTextSearch: boolean
  custom?: Record<string, boolean> // Database-specific features
}

// Extended TableSchema interface for enhanced context
export interface ExtendedTableSchema extends TableSchema {
  engine?: string
  primaryKeys?: string[]
  uniqueKeys?: string[][]
}

// Base class for database context providers
export abstract class DatabaseContextProvider {
  abstract getContext(): DatabaseContext

  // Enhanced schema formatting with database-specific information
  formatSchema(schema: DatabaseSchema): string {
    const context = this.getContext()
    let formatted = `Database: ${schema.database} (${context.displayName})\n`
    formatted += `Description: ${context.description}\n\n`

    for (const table of schema.tables) {
      formatted += this.formatTable(table, context)
    }

    return formatted
  }

  private formatTable(table: TableSchema, context: DatabaseContext): string {
    let formatted = `Table: ${table.name}\n`

    // Add table-level information if available (extended schema)
    const extendedTable = table as ExtendedTableSchema
    if (extendedTable.engine) {
      formatted += `Engine: ${extendedTable.engine}\n`
    }
    if (extendedTable.primaryKeys && extendedTable.primaryKeys.length > 0) {
      formatted += `Primary Key: ${extendedTable.primaryKeys.join(', ')}\n`
    }

    formatted += 'Columns:\n'
    for (const column of table.columns) {
      formatted += this.formatColumn(column, context)
    }
    formatted += '\n'

    return formatted
  }

  private formatColumn(column: ColumnSchema, context: DatabaseContext): string {
    let formatted = `  - ${column.name}: ${column.type}`

    // Add column constraints
    if (column.nullable === false) {
      formatted += ' NOT NULL'
    }
    if (column.default) {
      formatted += ` DEFAULT ${column.default}`
    }

    formatted += '\n'
    return formatted
  }

    // Generate database-specific prompt instructions
  generatePromptInstructions(): string {
    const context = this.getContext()

    // Simple database identification
    let instructions = `\n${'='.repeat(50)}\n`
    instructions += `${context.displayName.toUpperCase()} DATABASE\n`
    instructions += `${'='.repeat(50)}\n`
    instructions += `You are generating SQL for ${context.displayName}.\n\n`

    // Add critical syntax warnings first (only if they exist)
    const criticalWarnings = this.formatCriticalSyntaxWarnings(context)
    if (criticalWarnings.trim() !== 'CRITICAL SYNTAX RULES:\n- Use exact function names and syntax as specified above\n- Do not use syntax from other database systems\n- Follow the examples provided exactly\n\n') {
      instructions += criticalWarnings
    }

    // Add functions (only if they exist)
    const functions = this.formatFunctions(context.functions)
    if (functions.trim() !== '\nESSENTIAL FUNCTIONS:\n') {
      instructions += functions
    }

    // Add examples (only if they exist)
    const examples = this.formatExamples(context.examples)
    if (examples.trim() !== '\nKEY EXAMPLES:\n') {
      instructions += examples
    }

    // Add best practices
    if (context.bestPractices.length > 0) {
      instructions += `\nBEST PRACTICES:\n`
      context.bestPractices.forEach(practice => {
        instructions += `- ${practice}\n`
      })
    }

    // Add features
    instructions += this.formatFeatures(context.features)

    instructions += `\n${'='.repeat(50)}\n`

    console.log(`Generated instructions for ${context.databaseType}, length:`, instructions.length)
    console.log(`Instructions preview:`, instructions.substring(0, 200) + '...')

    return instructions
  }

    // Format critical syntax warnings that the LLM must follow
  private formatCriticalSyntaxWarnings(context: DatabaseContext): string {
    let warnings = 'CRITICAL SYNTAX RULES:\n'

    // Add database-specific critical warnings
    if (context.criticalSyntaxWarnings && context.criticalSyntaxWarnings.length > 0) {
      context.criticalSyntaxWarnings.forEach(warning => {
        warnings += `- ${warning}\n`
      })
    } else {
      // Fallback to hardcoded warnings for backward compatibility
      if (context.databaseType === 'clickhouse') {
        warnings += '- Random numbers: Use rand() % N + 1 for random integers (NOT rand(1,N))\n'
        warnings += '- Random selection: Use arrayRand([item1, item2, item3]) for random selection\n'
        warnings += '- Sequences: Use numbers(n) to generate sequences 0 to n-1\n'
        warnings += '- Incremental IDs: Use number + COALESCE((SELECT max(id) FROM table), 0)\n'
        warnings += '- Date functions: Use now(), toDate(), toDateTime() for dates\n'
        warnings += '- Aggregations: Use count(), sum(), avg(), uniq() for aggregations\n'
        warnings += '- GROUP BY: All non-aggregated columns in SELECT must be in GROUP BY clause\n'
        warnings += '- GROUP BY: Use any() or argMax() for non-aggregated columns when grouping by primary key\n'
      }
    }

    // Add generic warnings that apply to most databases
    warnings += '- Use exact function names and syntax as specified above\n'
    warnings += '- Do not use syntax from other database systems\n'
    warnings += '- Follow the examples provided exactly\n\n'

    return warnings
  }

      private formatFunctions(functions: DatabaseFunctions): string {
    let formatted = '\nESSENTIAL FUNCTIONS:\n'

    // Random functions
    formatted += `- Random integer: ${functions.random.integer}\n`
    formatted += `- Random selection: ${functions.random.selection}\n`

    // DateTime functions
    formatted += `- Current timestamp: ${functions.dateTime.current}\n`

    // Aggregation functions
    formatted += `- Count: ${functions.aggregation.count}\n`
    formatted += `- Sum: ${functions.aggregation.sum}\n`
    formatted += `- Average: ${functions.aggregation.avg}\n`
    formatted += `- Group By: ${functions.aggregation.groupBy}\n`

    // Sequence functions
    formatted += `- Generate sequence: ${functions.sequence.generate}\n`
    formatted += `- Incremental ID: ${functions.sequence.incremental}\n`

    // Custom functions (only essential ones)
    if (functions.custom) {
      Object.entries(functions.custom).forEach(([name, description]) => {
        formatted += `- ${name}: ${description}\n`
      })
    }

    return formatted
  }

    private formatExamples(examples: DatabaseExamples): string {
    let formatted = '\nKEY EXAMPLES:\n'

    // Show one example from each category
    if (examples.randomData.length > 0) {
      formatted += `Random Data: ${examples.randomData[0]}\n`
    }

    if (examples.incrementalIds.length > 0) {
      formatted += `Incremental IDs: ${examples.incrementalIds[0]}\n`
    }

    if (examples.joins.length > 0) {
      formatted += `JOINs: ${examples.joins[0]}\n`
    }

    // Custom examples (only essential ones)
    if (examples.custom) {
      Object.entries(examples.custom).forEach(([category, categoryExamples]) => {
        if (categoryExamples.length > 0) {
          formatted += `${category}: ${categoryExamples[0]}\n`
        }
      })
    }

    return formatted
  }

  private formatFeatures(features: DatabaseFeatures): string {
    let formatted = '\nFEATURES:\n'

    const featureList = [
      { name: 'Transactions', value: features.supportsTransactions },
      { name: 'Foreign Keys', value: features.supportsForeignKeys },
      { name: 'Indexes', value: features.supportsIndexes },
      { name: 'Views', value: features.supportsViews },
      { name: 'Stored Procedures', value: features.supportsStoredProcedures },
      { name: 'Triggers', value: features.supportsTriggers },
      { name: 'Full-Text Search', value: features.supportsFullTextSearch }
    ]

    featureList.forEach(feature => {
      formatted += `- ${feature.name}: ${feature.value ? 'Supported' : 'Not Supported'}\n`
    })

    // Custom features
    if (features.custom) {
      Object.entries(features.custom).forEach(([name, supported]) => {
        formatted += `- ${name}: ${supported ? 'Supported' : 'Not Supported'}\n`
      })
    }

    return formatted
  }
}

// Context provider registry
export class DatabaseContextRegistry {
  private providers: Map<string, DatabaseContextProvider> = new Map()

  register(databaseType: string, provider: DatabaseContextProvider): void {
    this.providers.set(databaseType.toLowerCase(), provider)
  }

  getProvider(databaseType: string): DatabaseContextProvider | null {
    return this.providers.get(databaseType.toLowerCase()) || null
  }

  getSupportedTypes(): string[] {
    return Array.from(this.providers.keys())
  }

  hasProvider(databaseType: string): boolean {
    return this.providers.has(databaseType.toLowerCase())
  }
}

// Global registry instance
export const databaseContextRegistry = new DatabaseContextRegistry()
