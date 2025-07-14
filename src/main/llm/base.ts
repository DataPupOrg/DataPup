import { SQLGenerationRequest, DatabaseSchema } from './interface'

export abstract class BaseLLM {
  protected getToolInformation(): string {
    return `AVAILABLE TOOLS:
You have access to the following tools that you can call to gather more information:

- listDatabases: Get all available databases
- listTables: Get all tables in a database (usage: "call listTables in database [dbname]")
- getTableSchema: Get schema of a specific table (usage: "call getTableSchema on table [tablename] in database [dbname]")
- getSampleRows: Get sample data from a table (usage: "call getSampleRows on table [tablename] in database [dbname] limit [number]")
- searchTables: Search for tables by name pattern (usage: "call searchTables for [pattern] in database [dbname]")
- searchColumns: Search for columns by name pattern (usage: "call searchColumns for [pattern] in database [dbname]")
- summarizeSchema: Get a summary of the database schema (usage: "call summarizeSchema for database [dbname]")
- summarizeTable: Get a summary of a specific table (usage: "call summarizeTable on table [tablename] in database [dbname]")
- profileTable: Get profiling information for a table (usage: "call profileTable on table [tablename] in database [dbname]")
- executeQuery: Execute a SQL query and get results (usage: "call executeQuery with [sql]")
- getLastError: Get the last error that occurred (usage: "call getLastError")
- getDocumentation: Get help on a topic (usage: "call getDocumentation for [topic]")

If you need more information to answer the user's question, you can call these tools. For example:
- If the user asks about a table that's not in the schema, call listTables to see what's available
- If you need sample data to understand the structure, call getSampleRows
- If you want to search for similar tables, call searchTables
- If you want to execute a query to verify it works, call executeQuery`
  }

  protected getCriticalInstructions(databaseType: string): string {
    return `CRITICAL INSTRUCTIONS:
1. Use ONLY the tables and columns provided in the schema above
2. DO NOT assume table names that are not in the schema
3. If the requested table doesn't exist, suggest the closest available table or explain what's available
4. Follow ${databaseType.toUpperCase()} syntax and best practices
5. If the query involves aggregations, use appropriate functions (COUNT, SUM, AVG, etc.)
6. If the query involves date/time operations, use ${databaseType.toUpperCase()} date functions
7. If the query is ambiguous, make reasonable assumptions and explain them
8. Always include a brief explanation of what the query does
9. DO NOT wrap the SQL in markdown code blocks or any other formatting
10. Consider the conversation context when interpreting the current request
11. If the user is referring to a previous query or result, use that context`
  }

  protected formatSchema(schema: DatabaseSchema): string {
    let formatted = `Database: ${schema.database}\n\n`

    for (const table of schema.tables) {
      formatted += `Table: ${table.name}\n`
      for (const column of table.columns) {
        const nullable =
          column.nullable !== undefined ? (column.nullable ? 'NULL' : 'NOT NULL') : ''
        const defaultValue = column.default ? ` DEFAULT ${column.default}` : ''
        formatted += `  - ${column.name}: ${column.type}${nullable}${defaultValue}\n`
      }
      formatted += '\n'
    }

    return formatted
  }

  protected formatSampleData(sampleData: Record<string, any[]>): string {
    let formatted = ''

    for (const [tableName, rows] of Object.entries(sampleData)) {
      if (rows.length > 0) {
        formatted += `Table: ${tableName}\n`
        const columns = Object.keys(rows[0])
        formatted += `Columns: ${columns.join(', ')}\n`
        formatted += 'Sample rows:\n'

        // Show only 1-2 rows to reduce prompt size
        const sampleRows = rows.slice(0, Math.min(2, rows.length))
        for (const row of sampleRows) {
          const values = columns
            .map((col) => {
              let value = row[col]
              // Truncate long string values to reduce prompt size
              if (typeof value === 'string' && value.length > 150) {
                value = value.substring(0, 150) + '...'
              }
              return value
            })
            .join(', ')
          formatted += `  [${values}]\n`
        }
        formatted += '\n'
      }
    }

    return formatted
  }

  protected buildBasePrompt(request: SQLGenerationRequest): string {
    const { naturalLanguageQuery, databaseSchema, databaseType, sampleData, conversationContext } =
      request

    let prompt = `You are a SQL expert specializing in ${databaseType.toUpperCase()} databases.
Your task is to convert natural language queries into accurate SQL statements.

${
  conversationContext
    ? `CONVERSATION CONTEXT:
${conversationContext}

`
    : ''
}DATABASE SCHEMA:
${this.formatSchema(databaseSchema)}

${
  sampleData
    ? `SAMPLE DATA:
${this.formatSampleData(sampleData)}

`
    : ''
}NATURAL LANGUAGE QUERY:
"${naturalLanguageQuery}"

Please generate a ${databaseType.toUpperCase()} SQL query that answers this question.

${this.getCriticalInstructions(databaseType)}

${this.getToolInformation()}

RESPONSE FORMAT:
SQL: [Your SQL query here - raw SQL only, no markdown]
Explanation: [Brief explanation of what the query does]`

    return prompt
  }

  protected getValidationPrompt(databaseType: string, sql: string): string {
    return `You are a SQL validator. Please validate this ${databaseType.toUpperCase()} SQL query and return only "VALID" if it's syntactically correct, or a brief error message if it's not.

Query: ${sql}

Response:`
  }

  protected getExplanationPrompt(databaseType: string, sql: string): string {
    return `Explain this ${databaseType.toUpperCase()} SQL query in simple terms:

Query: ${sql}

Provide a brief, clear explanation of what this query does.`
  }

  protected logPrompt(provider: string, promptType: string, prompt: string, length?: number): void {
    console.log(`=== ${provider.toUpperCase()} ${promptType.toUpperCase()} ===`)
    if (length) {
      console.log('Prompt length:', length, 'characters')
    }
    console.log('Prompt:', prompt)
    console.log('='.repeat(50))
  }
}
