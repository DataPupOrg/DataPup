import { StructuredTool } from '@langchain/core/tools'

// --- SCHEMA INTROSPECTION TOOLS ---

export class GetTableListTool extends StructuredTool {
  name = 'get_table_list'
  description = 'List all tables in the current database.'
  schema = {
    type: 'object' as const,
    properties: {},
    required: []
  }

  async _call(_: object) {
    // TODO: Connect to real database logic
    return JSON.stringify(['users', 'orders', 'products'])
  }
}

export class GetTableSchemaTool extends StructuredTool {
  name = 'get_table_schema'
  description = 'Get the schema (columns, types) for a specific table.'
  schema = {
    type: 'object' as const,
    properties: {
      table: { type: 'string', description: 'The table name' }
    },
    required: ['table']
  }

  async _call({ table }: { table: string }) {
    // TODO: Connect to real database logic
    if (table === 'users') {
      return JSON.stringify([
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'VARCHAR(255)' },
        { name: 'email', type: 'VARCHAR(255)' }
      ])
    }
    return JSON.stringify([])
  }
}

export class GetForeignKeysTool extends StructuredTool {
  name = 'get_foreign_keys'
  description = 'Get foreign key relationships for a table.'
  schema = {
    type: 'object' as const,
    properties: {
      table: { type: 'string', description: 'The table name' }
    },
    required: ['table']
  }

  async _call({ table }: { table: string }) {
    // TODO: Connect to real database logic
    return JSON.stringify([])
  }
}

export class GetIndexesTool extends StructuredTool {
  name = 'get_indexes'
  description = 'Get indexes for a table.'
  schema = {
    type: 'object' as const,
    properties: {
      table: { type: 'string', description: 'The table name' }
    },
    required: ['table']
  }

  async _call({ table }: { table: string }) {
    // TODO: Connect to real database logic
    return JSON.stringify([])
  }
}

// --- SAMPLE DATA TOOLS ---

export class GetSampleRowsTool extends StructuredTool {
  name = 'get_sample_rows'
  description = 'Get sample rows from a table to understand data distribution.'
  schema = {
    type: 'object' as const,
    properties: {
      table: { type: 'string', description: 'The table name' },
      limit: { type: 'number', description: 'Number of sample rows to return (default: 5)' }
    },
    required: ['table']
  }

  async _call({ table, limit = 5 }: { table: string; limit?: number }) {
    // TODO: Connect to real database logic
    if (table === 'users') {
      return JSON.stringify(
        [
          { id: 1, name: 'John Doe', email: 'john@example.com' },
          { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
          { id: 3, name: 'Bob Johnson', email: 'bob@example.com' }
        ].slice(0, limit)
      )
    }
    return JSON.stringify([])
  }
}

export class GetDistinctValuesTool extends StructuredTool {
  name = 'get_distinct_values'
  description = 'Get distinct values for a column (useful for WHERE clause suggestions).'
  schema = {
    type: 'object' as const,
    properties: {
      table: { type: 'string', description: 'The table name' },
      column: { type: 'string', description: 'The column name' },
      limit: { type: 'number', description: 'Number of distinct values to return (default: 10)' }
    },
    required: ['table', 'column']
  }

  async _call({ table, column, limit = 10 }: { table: string; column: string; limit?: number }) {
    // TODO: Connect to real database logic
    if (table === 'users' && column === 'name') {
      return JSON.stringify(['John Doe', 'Jane Smith', 'Bob Johnson', 'Alice Brown'])
    }
    return JSON.stringify([])
  }
}

// --- QUERY EXECUTION TOOLS ---

export class RunSqlQueryTool extends StructuredTool {
  name = 'run_sql_query'
  description = 'Execute a SQL query and return the result (with safety checks).'
  schema = {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'The SQL query to execute' },
      limit: { type: 'number', description: 'Maximum number of rows to return (default: 100)' }
    },
    required: ['query']
  }

  async _call({ query, limit = 100 }: { query: string; limit?: number }) {
    // TODO: Connect to real database logic
    // TODO: Add safety checks (no DROP, DELETE without WHERE, etc.)
    return JSON.stringify({
      success: true,
      rows: [
        { id: 1, name: 'John Doe', email: 'john@example.com' },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com' }
      ],
      rowCount: 2,
      query: query,
      limit: limit
    })
  }
}

export class ExplainSqlQueryTool extends StructuredTool {
  name = 'explain_sql_query'
  description = 'Get the query plan or explanation for a SQL statement.'
  schema = {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'The SQL query to explain' }
    },
    required: ['query']
  }

  async _call({ query }: { query: string }) {
    // TODO: Connect to real database logic
    return JSON.stringify({
      plan: `EXPLAIN ${query}`,
      steps: ['1. Scan table users', '2. Apply filter id > 0', '3. Return matching rows'],
      estimatedCost: 'low'
    })
  }
}

// --- VALIDATION & CORRECTION TOOLS ---

export class ValidateSqlSyntaxTool extends StructuredTool {
  name = 'validate_sql_syntax'
  description = 'Check if a SQL query is valid for the current database.'
  schema = {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'The SQL query to validate' }
    },
    required: ['query']
  }

  async _call({ query }: { query: string }) {
    // TODO: Connect to real database logic
    const isValid = !query.toLowerCase().includes('drop') && query.trim().length > 0
    return JSON.stringify({
      isValid,
      error: isValid ? null : 'Query contains potentially dangerous operations'
    })
  }
}

export class SuggestCorrectionTool extends StructuredTool {
  name = 'suggest_correction'
  description = 'Given an error message, suggest a corrected query.'
  schema = {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'The original SQL query' },
      error: { type: 'string', description: 'The error message from the database' }
    },
    required: ['query', 'error']
  }

  async _call({ query, error }: { query: string; error: string }) {
    // TODO: Connect to real database logic
    return JSON.stringify({
      correctedQuery: query.replace(/drop/i, 'SELECT'),
      explanation: 'Replaced DROP with SELECT for safety'
    })
  }
}

// --- METADATA & DOCUMENTATION TOOLS ---

export class GetTableDescriptionTool extends StructuredTool {
  name = 'get_table_description'
  description = 'Get comments or documentation for a table.'
  schema = {
    type: 'object' as const,
    properties: {
      table: { type: 'string', description: 'The table name' }
    },
    required: ['table']
  }

  async _call({ table }: { table: string }) {
    // TODO: Connect to real database logic
    const descriptions: Record<string, string> = {
      users: 'Stores user account information including name and email',
      orders: 'Contains customer order details and status',
      products: 'Product catalog with pricing and inventory information'
    }
    return JSON.stringify({
      table,
      description: descriptions[table] || 'No description available'
    })
  }
}

export class GetColumnDescriptionTool extends StructuredTool {
  name = 'get_column_description'
  description = 'Get comments or documentation for a specific column.'
  schema = {
    type: 'object' as const,
    properties: {
      table: { type: 'string', description: 'The table name' },
      column: { type: 'string', description: 'The column name' }
    },
    required: ['table', 'column']
  }

  async _call({ table, column }: { table: string; column: string }) {
    // TODO: Connect to real database logic
    const descriptions: Record<string, Record<string, string>> = {
      users: {
        id: 'Primary key, auto-incrementing user identifier',
        name: "User's full name",
        email: "User's email address (unique)"
      }
    }
    return JSON.stringify({
      table,
      column,
      description: descriptions[table]?.[column] || 'No description available'
    })
  }
}

export class ListRecentQueriesTool extends StructuredTool {
  name = 'list_recent_queries'
  description = 'Get a history of recent queries for context.'
  schema = {
    type: 'object' as const,
    properties: {
      limit: { type: 'number', description: 'Number of recent queries to return (default: 10)' }
    },
    required: []
  }

  async _call({ limit = 10 }: { limit?: number }) {
    // TODO: Connect to real database logic
    return JSON.stringify(
      [
        { query: 'SELECT * FROM users', timestamp: '2024-01-01T10:00:00Z' },
        { query: 'SELECT COUNT(*) FROM orders', timestamp: '2024-01-01T09:30:00Z' },
        { query: 'SELECT name, email FROM users WHERE id > 0', timestamp: '2024-01-01T09:00:00Z' }
      ].slice(0, limit)
    )
  }
}

// --- DATA EXPORT/IMPORT TOOLS ---

export class ExportQueryResultTool extends StructuredTool {
  name = 'export_query_result'
  description = 'Export the result of a query to CSV, JSON, etc.'
  schema = {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'The SQL query to execute and export' },
      format: {
        type: 'string',
        description: 'Export format (csv, json, excel)',
        enum: ['csv', 'json', 'excel']
      },
      filename: { type: 'string', description: 'Output filename (optional)' }
    },
    required: ['query', 'format']
  }

  async _call({ query, format, filename }: { query: string; format: string; filename?: string }) {
    // TODO: Connect to real database logic
    return JSON.stringify({
      success: true,
      filename: filename || `export_${Date.now()}.${format}`,
      rowCount: 2,
      message: `Exported ${format.toUpperCase()} file successfully`
    })
  }
}

export class ImportDataTool extends StructuredTool {
  name = 'import_data'
  description = 'Import data from a file into a table.'
  schema = {
    type: 'object' as const,
    properties: {
      table: { type: 'string', description: 'The target table name' },
      filepath: { type: 'string', description: 'Path to the file to import' },
      format: {
        type: 'string',
        description: 'File format (csv, json, excel)',
        enum: ['csv', 'json', 'excel']
      },
      options: { type: 'string', description: 'Additional import options as JSON string' }
    },
    required: ['table', 'filepath', 'format']
  }

  async _call({
    table,
    filepath,
    format,
    options
  }: {
    table: string
    filepath: string
    format: string
    options?: string
  }) {
    // TODO: Connect to real database logic
    return JSON.stringify({
      success: true,
      importedRows: 10,
      message: `Imported ${format.toUpperCase()} file into table ${table}`
    })
  }
}

// --- USER CONTEXT TOOLS ---

export class GetUserPreferencesTool extends StructuredTool {
  name = 'get_user_preferences'
  description = 'Get user preferences for query generation and display.'
  schema = {
    type: 'object' as const,
    properties: {},
    required: []
  }

  async _call() {
    // TODO: Connect to real user preferences
    return JSON.stringify({
      preferredLanguage: 'SQL',
      resultLimit: 100,
      showQueryPlan: false,
      autoFormatQueries: true,
      theme: 'dark'
    })
  }
}

export class GetActiveConnectionInfoTool extends StructuredTool {
  name = 'get_active_connection_info'
  description = 'Get information about the currently active database connection.'
  schema = {
    type: 'object' as const,
    properties: {},
    required: []
  }

  async _call() {
    // TODO: Connect to real connection manager
    return JSON.stringify({
      databaseType: 'ClickHouse',
      databaseName: 'analytics',
      server: 'localhost:8123',
      username: 'default',
      isConnected: true,
      connectionId: 'conn_123'
    })
  }
}

// --- AI ASSISTANT TOOLS ---

export class SummarizeQueryResultTool extends StructuredTool {
  name = 'summarize_query_result'
  description = 'Generate a natural language summary of query results.'
  schema = {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'The SQL query that was executed' },
      resultData: { type: 'string', description: 'JSON string of the query result data' },
      summaryType: {
        type: 'string',
        description: 'Type of summary (brief, detailed, insights)',
        enum: ['brief', 'detailed', 'insights']
      }
    },
    required: ['query', 'resultData']
  }

  async _call({
    query,
    resultData,
    summaryType = 'brief'
  }: {
    query: string
    resultData: string
    summaryType?: string
  }) {
    // TODO: Connect to real AI summarization
    return JSON.stringify({
      summary: `Query returned ${JSON.parse(resultData).length} rows with user data`,
      keyInsights: ['Most users have valid email addresses', 'Data spans multiple time periods'],
      recommendations: ['Consider adding more user metadata', 'Implement data validation']
    })
  }
}

export class GenerateVisualizationTool extends StructuredTool {
  name = 'generate_visualization'
  description = 'Suggest appropriate visualizations for query results.'
  schema = {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'The SQL query that was executed' },
      resultData: { type: 'string', description: 'JSON string of the query result data' },
      visualizationType: {
        type: 'string',
        description: 'Preferred chart type (auto, bar, line, pie, scatter)',
        enum: ['auto', 'bar', 'line', 'pie', 'scatter']
      }
    },
    required: ['query', 'resultData']
  }

  async _call({
    query,
    resultData,
    visualizationType = 'auto'
  }: {
    query: string
    resultData: string
    visualizationType?: string
  }) {
    // TODO: Connect to real visualization logic
    return JSON.stringify({
      recommendedChart: 'bar',
      chartConfig: {
        xAxis: 'name',
        yAxis: 'count',
        title: 'User Distribution'
      },
      dataPoints: 3,
      message: 'Bar chart recommended for categorical data',
      query: query,
      resultData: resultData,
      visualizationType: visualizationType
    })
  }
}

// --- SECURITY & SAFETY TOOLS ---

export class CheckQuerySafetyTool extends StructuredTool {
  name = 'check_query_safety'
  description = 'Check if a SQL query is safe to execute (no dangerous operations).'
  schema = {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'The SQL query to check for safety' }
    },
    required: ['query']
  }

  async _call({ query }: { query: string }) {
    const dangerousKeywords = ['DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'GRANT', 'REVOKE']
    const hasDangerousKeywords = dangerousKeywords.some((keyword) =>
      query.toUpperCase().includes(keyword)
    )

    return JSON.stringify({
      isSafe: !hasDangerousKeywords,
      warnings: hasDangerousKeywords ? ['Query contains potentially dangerous operations'] : [],
      recommendations: hasDangerousKeywords
        ? ['Consider using SELECT instead', 'Add WHERE clause for safety']
        : []
    })
  }
}

export class RequestUserConfirmationTool extends StructuredTool {
  name = 'request_user_confirmation'
  description = 'Request user confirmation for potentially dangerous operations.'
  schema = {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        description: 'Description of the operation requiring confirmation'
      },
      query: { type: 'string', description: 'The SQL query that needs confirmation' },
      riskLevel: {
        type: 'string',
        description: 'Risk level (low, medium, high)',
        enum: ['low', 'medium', 'high']
      }
    },
    required: ['operation', 'query', 'riskLevel']
  }

  async _call({
    operation,
    query,
    riskLevel
  }: {
    operation: string
    query: string
    riskLevel: string
  }) {
    // TODO: Connect to real UI confirmation dialog
    return JSON.stringify({
      requiresConfirmation: riskLevel === 'high',
      message: `Please confirm ${operation}: ${query}`,
      riskLevel,
      suggestedAlternative:
        riskLevel === 'high' ? 'Consider using SELECT first to preview data' : null
    })
  }
}

// --- TOOL EXPORTS & UTILITIES ---

// Export all tools for easy importing
export const allTools = [
  // Schema Introspection Tools
  new GetTableListTool(),
  new GetTableSchemaTool(),
  new GetForeignKeysTool(),
  new GetIndexesTool(),

  // Sample Data Tools
  new GetSampleRowsTool(),
  new GetDistinctValuesTool(),

  // Query Execution Tools
  new RunSqlQueryTool(),
  new ExplainSqlQueryTool(),

  // Validation & Correction Tools
  new ValidateSqlSyntaxTool(),
  new SuggestCorrectionTool(),

  // Metadata & Documentation Tools
  new GetTableDescriptionTool(),
  new GetColumnDescriptionTool(),
  new ListRecentQueriesTool(),

  // Data Export/Import Tools
  new ExportQueryResultTool(),
  new ImportDataTool(),

  // User Context Tools
  new GetUserPreferencesTool(),
  new GetActiveConnectionInfoTool(),

  // AI Assistant Tools
  new SummarizeQueryResultTool(),
  new GenerateVisualizationTool(),

  // Security & Safety Tools
  new CheckQuerySafetyTool(),
  new RequestUserConfirmationTool()
]

// Utility function to get tools by category
export const getToolsByCategory = {
  schema: [
    new GetTableListTool(),
    new GetTableSchemaTool(),
    new GetForeignKeysTool(),
    new GetIndexesTool()
  ],
  sampleData: [new GetSampleRowsTool(), new GetDistinctValuesTool()],
  execution: [new RunSqlQueryTool(), new ExplainSqlQueryTool()],
  validation: [new ValidateSqlSyntaxTool(), new SuggestCorrectionTool()],
  metadata: [
    new GetTableDescriptionTool(),
    new GetColumnDescriptionTool(),
    new ListRecentQueriesTool()
  ],
  exportImport: [new ExportQueryResultTool(), new ImportDataTool()],
  userContext: [new GetUserPreferencesTool(), new GetActiveConnectionInfoTool()],
  aiAssistant: [new SummarizeQueryResultTool(), new GenerateVisualizationTool()],
  security: [new CheckQuerySafetyTool(), new RequestUserConfirmationTool()]
}

// Utility function to get essential tools for basic SQL generation
export const getEssentialTools = () => [
  new GetTableListTool(),
  new GetTableSchemaTool(),
  new GetSampleRowsTool(),
  new RunSqlQueryTool(),
  new ValidateSqlSyntaxTool(),
  new CheckQuerySafetyTool()
]

// Utility function to get advanced tools for complex operations
export const getAdvancedTools = () => [
  ...getEssentialTools(),
  new GetDistinctValuesTool(),
  new ExplainSqlQueryTool(),
  new SuggestCorrectionTool(),
  new ExportQueryResultTool(),
  new SummarizeQueryResultTool(),
  new GenerateVisualizationTool()
]
