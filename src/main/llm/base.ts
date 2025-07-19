import { SQLGenerationRequest, DatabaseSchema } from './interface'
import { logger } from '../utils/logger'

export abstract class BaseLLM {
  protected getToolInformation(): string {
    return `AVAILABLE TOOLS:
You have access to the following tools that you can call to gather more information:

1. listDatabases - Get all available databases
   Usage: TOOL_CALL: listDatabases()

2. listTables - Get all tables in a database
   Usage: TOOL_CALL: listTables(database="dbname")
   Note: If database parameter is omitted, uses the current database context

3. getTableSchema - Get schema of a specific table
   Usage: TOOL_CALL: getTableSchema(table="tablename", database="dbname")
   Note: If database parameter is omitted, uses the current database context

4. getSampleRows - Get sample data from a table
   Usage: TOOL_CALL: getSampleRows(table="tablename", database="dbname", limit=5)

5. searchTables - Search for tables by name pattern
   Usage: TOOL_CALL: searchTables(pattern="search_term", database="dbname")

6. searchColumns - Search for columns by name pattern
   Usage: TOOL_CALL: searchColumns(pattern="column_name", database="dbname")

7. summarizeSchema - Get a summary of the database schema
   Usage: TOOL_CALL: summarizeSchema(database="dbname")

8. summarizeTable - Get a summary of a specific table
   Usage: TOOL_CALL: summarizeTable(table="tablename", database="dbname")

9. profileTable - Get profiling information for a table
   Usage: TOOL_CALL: profileTable(table="tablename", database="dbname")

10. executeQuery - Execute a SQL query and get results
    Usage: TOOL_CALL: executeQuery(sql="SELECT * FROM table LIMIT 5")

11. getLastError - Get the last error that occurred
    Usage: TOOL_CALL: getLastError()

12. getDocumentation - Get help on a topic
    Usage: TOOL_CALL: getDocumentation(topic="topic_name")

IMPORTANT: When you need to use a tool, format it exactly as shown above with TOOL_CALL: prefix.
Examples:
- If the user asks about available tables: TOOL_CALL: listTables(database="main")
- If you need sample data: TOOL_CALL: getSampleRows(table="users", database="main", limit=3)
- To search for a table: TOOL_CALL: searchTables(pattern="customer", database="main")`
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

        // Show first 3 rows as examples
        const sampleRows = rows.slice(0, 3)
        for (const row of sampleRows) {
          const values = columns.map((col) => row[col]).join(', ')
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

    let prompt = `You are an intelligent database agent specializing in ${databaseType.toUpperCase()} databases.
Your primary task is to help users explore and query their databases efficiently.

IMPORTANT RULES FOR TOOL USAGE VS SQL GENERATION:

Use TOOLS for:
- Listing databases or tables (listDatabases, listTables)
- Getting schema information (getTableSchema, summarizeSchema)
- Searching for table/column names (searchTables, searchColumns)
- Getting sample data for exploration (getSampleRows)
- Profiling table statistics (profileTable)

Generate SQL for:
- Selecting specific data with conditions (e.g., "show students with name X")
- Aggregations (COUNT, SUM, AVG, etc.)
- Joins between tables
- Data modifications (INSERT, UPDATE, DELETE)
- Any query that needs actual data retrieval beyond samples

IMPORTANT: When searching for data (not table names), you must generate SQL, not use searchTables!
Example: "show me students with name sahith" → Generate SQL: SELECT * FROM students WHERE name = 'sahith'

${
  conversationContext
    ? `CONVERSATION CONTEXT:
${conversationContext}

`
    : ''
}CURRENT DATABASE CONTEXT:
Database: ${databaseSchema.database}

AVAILABLE TABLES IN THIS DATABASE:
${this.formatSchema(databaseSchema)}

NOTE: If you need to explore other databases, use the listDatabases tool first, then listTables with the specific database parameter.

${
  sampleData
    ? `SAMPLE DATA:
${this.formatSampleData(sampleData)}

`
    : ''
}${this.getToolInformation()}

USER REQUEST:
"${naturalLanguageQuery}"

DECISION PROCESS:
1. Does the query mention a table not in the current database? Use listDatabases and listTables to explore.
2. Can this be answered with a tool call? If yes, make the appropriate tool call(s).
3. Does this need actual data retrieval? Generate a SQL query.
4. If the table doesn't exist in current database, suggest exploring other databases.

For tool calls, respond with:
TOOL_CALL: toolName(param1="value1", param2="value2")

For SQL queries, respond with:
SQL: [Your SQL query here - raw SQL only, no markdown]
Explanation: [Brief explanation of what the query does]

${this.getCriticalInstructions(databaseType)}`

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
    logger.debug(`=== ${provider.toUpperCase()} ${promptType.toUpperCase()} ===`)
    if (length) {
      logger.debug(`Prompt length: ${length} characters`)
    }
    logger.debug(`Prompt: ${prompt}`)
    logger.debug('='.repeat(50))
  }

  protected parseToolCalls(response: string): Array<{
    name: string
    args: Record<string, unknown>
    rawCall: string
  }> {
    const toolCalls: Array<{ name: string; args: Record<string, unknown>; rawCall: string }> = []

    // Match TOOL_CALL: functionName(arg1="value1", arg2="value2")
    const toolCallRegex = /TOOL_CALL:\s*(\w+)\((.*?)\)/g
    let match

    while ((match = toolCallRegex.exec(response)) !== null) {
      const [rawCall, functionName, argsString] = match
      const args: Record<string, unknown> = {}

      if (argsString.trim()) {
        // Parse arguments: arg="value", arg2=123
        const argRegex = /(\w+)=(?:"([^"]*)"|(\d+)|(\w+))/g
        let argMatch

        while ((argMatch = argRegex.exec(argsString)) !== null) {
          const [, key, stringValue, numberValue, boolValue] = argMatch
          if (stringValue !== undefined) {
            args[key] = stringValue
          } else if (numberValue !== undefined) {
            args[key] = parseInt(numberValue, 10)
          } else if (boolValue !== undefined) {
            args[key] = boolValue === 'true'
          }
        }
      }

      toolCalls.push({
        name: functionName,
        args,
        rawCall
      })
    }

    return toolCalls
  }

  protected extractSqlAndExplanation(response: string): { sql: string; explanation: string } {
    // Remove tool calls from response before parsing SQL
    const cleanedResponse = response.replace(/TOOL_CALL:\s*\w+\(.*?\)/g, '').trim()

    // Extract SQL and explanation from the response
    const sqlMatch = cleanedResponse.match(/SQL:\s*(.*?)(?=\nExplanation:|\n\n|$)/s)
    const explanationMatch = cleanedResponse.match(/Explanation:\s*(.*?)(?=\n\n|$)/s)

    const sql = sqlMatch ? sqlMatch[1].trim() : ''
    const explanation = explanationMatch ? explanationMatch[1].trim() : ''

    return { sql, explanation }
  }
}
