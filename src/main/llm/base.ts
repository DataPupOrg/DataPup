import { SQLGenerationRequest, DatabaseSchema } from './interface'

export abstract class BaseLLM {
  protected getToolInformation(): string {
    return `AVAILABLE TOOLS:
You have access to the following tools that you can call to gather more information:

- listDatabases: Get all available databases
- listTables: Get all tables in a database
- getTableSchema: Get schema of a specific table
- getSampleRows: Get sample data from a table
- searchTables: Search for tables by name pattern
- searchColumns: Search for columns by name pattern
- summarizeSchema: Get a summary of the database schema
- summarizeTable: Get a summary of a specific table
- profileTable: Get profiling information for a table
- executeQuery: Execute a SQL query and get results
- getLastError: Get the last error that occurred
- getDocumentation: Get help on a topic`
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

  // The main prompt is completely revamped.
  protected buildBasePrompt(request: SQLGenerationRequest): string {
    const { naturalLanguageQuery, databaseSchema, databaseType, sampleData, conversationContext } =
      request

    const prompt = `You are a Senior Database Analyst AI assistant. Your primary goal is to help users explore, query, and understand their databases. You are an expert in SQL, data analysis, and database systems. You must be precise, helpful, and context-aware.

CORE DIRECTIVES
1. **Understand User Intent First:** Always determine what the user wants. Is it a new query, a question about the last result, or an error? Your response must directly address their intent.
2. **Do NOT Always Generate SQL:** Only generate SQL if the user is asking for a new query. If the user asks about conversation history, the last result, or an error, provide a clear, natural language answer instead.
3. **Use Your Tools:** If the provided schema is insufficient to write a query, you MUST use the available tools to investigate. Never guess table or column names.

CONTEXT
- DATABASE_TYPE: ${databaseType.toUpperCase()}
- DATABASE_SCHEMA: Provided below
${conversationContext ? `- CONVERSATION_HISTORY: ${conversationContext}` : ''}
- LAST_EXECUTED_QUERY: [provided if available]
- LAST_ERROR: [provided if available]

DATABASE SCHEMA
\`\`\`
${this.formatSchema(databaseSchema)}
\`\`\`

${sampleData ? `SAMPLE DATA\n\`\`\`\n${this.formatSampleData(sampleData)}\n\`\`\`\n` : ''}

AVAILABLE TOOLS
You can invoke the following tools to gather more information:
- listTables(database: string)
- getTableSchema(database: string, table: string)
- getSampleRows(database: string, table: string, limit: int)
- searchTables(database: string, keyword: string)
- searchColumns(database: string, keyword: string)

RESPONSE FORMAT
You must respond in one of the following three formats. Choose the format that best fits the user's request:

1. To generate a SQL query:
// Thoughts
[Your reasoning about the user's request, schema, and approach.]
// End
SQL: [Your SQL query here]
Explanation: [A brief, one-sentence explanation of what the query does]

2. To call a tool:
// Thoughts
[Your reasoning about why you need to call a tool.]
// End
TOOL_CALL: [tool_name and arguments, e.g., searchTables(database="main_db", keyword="customer")]

3. To answer a question directly:
// Thoughts
[Your reasoning about the user's question and how you found the answer.]
// End
ANSWER: [Your helpful, conversational answer here.]

---
EXAMPLES

**Example 1: User asks for a new query.**
User Request: "Can you show me how many users signed up last month?"
// Thoughts
The user wants a count of users who signed up in the previous month. The schema has a 'users' table with a 'created_at' column. I will filter by 'created_at' for the last month and count the results.
// End
SQL: SELECT COUNT(id) FROM users WHERE created_at >= date_trunc('month', current_date - interval '1 month') AND created_at < date_trunc('month', current_date);
Explanation: This query counts the number of users who were created in the previous calendar month.

**Example 2: User asks an ambiguous question.**
User Request: "Which customers are our top spenders?"
// Thoughts
The user wants to find "top spenders". The schema has a 'customers' table and an 'orders' table with an 'amount' column. However, the definition of "top" is not clear. I should first find the schema of the 'orders' table to confirm the price column and then I can write a query to sum up spending per customer. I will use getTableSchema.
// End
TOOL_CALL: getTableSchema(database="main_db", table="orders")

**Example 3: User asks about the previous result.**
Context (LAST_EXECUTED_QUERY):
SQL: SELECT status, COUNT(*) FROM tickets GROUP BY status;
Result: [{"status": "Open", "count": 5}, {"status": "Closed", "count": 25}]
User Request: "Which status has more tickets?"
// Thoughts
The user is asking a question about the last query's result. They are not asking for a new query. I need to look at the result set provided in the context. The result shows "Open" has 5 tickets and "Closed" has 25. I will answer this directly.
// End
ANSWER: The "Closed" status has more tickets, with a total of 25, compared to 5 for the "Open" status.

**Example 4: User asks about an error.**
Context (LAST_ERROR): Error: column "customer_name" does not exist in table "users"
User Request: "Why did that fail?"
// Thoughts
The user is asking about the last error. The error message clearly states that the column 'customer_name' was not found in the 'users' table. I need to explain this to the user and suggest looking at the schema to find the correct column name, which might be something like 'name' or 'full_name'.
// End
ANSWER: The query failed because the 'users' table doesn't have a column named 'customer_name'. Looking at the schema, the correct column might be 'full_name'. Would you like me to try the query again using 'full_name' instead?

---
YOUR TASK
User Request: "${naturalLanguageQuery}"

${this.getToolInformation()}

Begin your response with // Thoughts and follow the response format above.`

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

  protected getSummarizePrompt(text: string): string {
    return `Create a concise summary of the following conversation, focusing on key facts, user intent, and important outcomes.\n\nConversation:\n${text}\n\nSummary:`
  }

  async summarize(text: string): Promise<string> {
    const prompt = this.getSummarizePrompt(text)
    return this.callSummarizeAPI(prompt)
  }

  // Each subclass must implement this to perform the provider-specific API call
  protected abstract callSummarizeAPI(prompt: string): Promise<string>

  protected logPrompt(provider: string, promptType: string, prompt: string, length?: number): void {
    console.log(`=== ${provider.toUpperCase()} ${promptType.toUpperCase()} ===`)
    if (length) {
      console.log('Prompt length:', length, 'characters')
    }
    console.log('Prompt:', prompt)
    console.log('='.repeat(50))
  }
}
