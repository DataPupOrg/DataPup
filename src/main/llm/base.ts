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

    const prompt = `You are a world-class software engineer specializing in database interactions. Your task is to write precise, efficient, and correct SQL queries based on user requests.

### CONTEXT
- **Database Type**: ${databaseType.toUpperCase()}
- **User's Goal**: The user wants to query the database to get an answer to their question.
${conversationContext ? `- **Previous Conversation**:\n${conversationContext}` : ''}

### DATABASE SCHEMA
Here is the schema of the database you are working with:
\`\`\`
${this.formatSchema(databaseSchema)}
\`\`\`

${
  sampleData
    ? `### SAMPLE DATA\nHere is some sample data from the tables:\n\`\`\`\n${this.formatSampleData(sampleData)}\n\`\`\`\n`
    : ''
}

### CRITICAL INSTRUCTIONS
1.  **Analyze the Request**: Before writing any SQL, take a step back and analyze the user's natural language query. Understand the intent and the specific data being requested.
2.  **Adhere to the Schema**: You MUST ONLY use the tables and columns provided in the schema. Do not invent table or column names.
3.  **Use Tools if Needed**: If the schema is insufficient to answer the question (e.g., the user mentions a column that you don't see), you MUST use the available tools to investigate. For example, if the user asks for 'customer emails' and you only see a 'users' table, use 'getTableSchema on table users' to see if an email column exists.
4.  **SQL Syntax**: The generated SQL must be valid for ${databaseType.toUpperCase()}.
5.  **Output Format**: You must provide your response in the following format. Do not add any extra explanations or text outside of this format. The SQL query should not be in a markdown block.

// Thoughts
I need to...
1.  Identify the key pieces of information in the user's request.
2.  Map these pieces to the available tables and columns in the schema.
3.  (If necessary) Realize that I need more information and decide which tool to call.
4.  Construct the SQL query step-by-step.
5.  Provide a concise explanation.
// End
SQL: [Your SQL query here]
Explanation: [A brief, one-sentence explanation of what the query does]

---
### EXAMPLES

**GOOD EXAMPLE 1**
Natural Language Query: "Show me the total number of orders for each customer"

// Thoughts
1.  The user wants the total number of orders. This implies a 'COUNT'.
2.  They want it "for each customer", which implies a 'GROUP BY' on a customer identifier.
3.  The schema has an 'orders' table with 'order_id' and 'customer_id', and a 'customers' table with 'customer_id' and 'customer_name'.
4.  I will need to join 'customers' and 'orders' on 'customer_id'.
5.  I will count the orders and group by the customer's name.
// End
SQL: SELECT c.customer_name, COUNT(o.order_id) AS total_orders FROM customers c JOIN orders o ON c.customer_id = o.customer_id GROUP BY c.customer_name;
Explanation: This query counts the total number of orders for each customer by joining the customers and orders tables.

**BAD EXAMPLE 1**
Natural Language Query: "Find all products in the 'electronics' category"
*Incorrect thought process leads to a bad result if the schema doesn't have a categories table.*

// Thoughts
1. The user wants products from the 'electronics' category.
2. The schema has a 'products' table but no 'categories' table. I cannot fulfill this request with the given schema.
3. I need to see what tables are available to find something related to categories.
4. I will call the 'listTables' tool.
// End
call listTables in database ${databaseSchema.database}

---

### YOUR TASK

Natural Language Query: "${naturalLanguageQuery}"

${this.getToolInformation()}

Begin your response with "// Thoughts".`

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
