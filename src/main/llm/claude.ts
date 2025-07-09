import {
  LLMInterface,
  SQLGenerationRequest,
  SQLGenerationResponse,
  ValidationRequest,
  ValidationResponse,
  DatabaseSchema
} from './interface'
import { databaseContextRegistry } from '../database/context'

interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ClaudeResponse {
  content: Array<{
    type: 'text'
    text: string
  }>
}

export class ClaudeLLM implements LLMInterface {
  private apiKey: string
  private model: string
  private apiUrl = 'https://api.anthropic.com/v1/messages'

  constructor(apiKey: string, model?: string) {
    if (!apiKey) {
      throw new Error('Claude API key is required')
    }

    this.apiKey = apiKey
    this.model = model || 'claude-3-opus-20240229'
  }

  async generateSQL(request: SQLGenerationRequest): Promise<SQLGenerationResponse> {
    try {
      const { systemPrompt, userMessage } = this.buildPromptMessages(request)

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1000,
          temperature: 0.1,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: userMessage
            }
          ]
        })
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Claude API error: ${response.status} - ${error}`)
      }

      const data: ClaudeResponse = await response.json()
      const content = data.content[0]?.text || ''

      // Parse the response to extract SQL and explanation
      const parsed = this.parseResponse(content)

      return {
        success: true,
        sqlQuery: parsed.sql,
        explanation: parsed.explanation
      }
    } catch (error) {
      console.error('Error generating SQL query:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  async validateQuery(request: ValidationRequest): Promise<ValidationResponse> {
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 100,
          temperature: 0,
          system: `You are a SQL validator. Validate ${request.databaseType.toUpperCase()} SQL queries for syntax correctness.`,
          messages: [
            {
              role: 'user',
              content: `Please validate this SQL query and return only "VALID" if it's syntactically correct, or a brief error message if it's not.

Query: ${request.sql}

Response:`
            }
          ]
        })
      })

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`)
      }

      const data: ClaudeResponse = await response.json()
      const text = data.content[0]?.text?.trim() || ''

      if (text.toUpperCase() === 'VALID') {
        return { isValid: true }
      } else {
        return { isValid: false, error: text }
      }
    } catch (error) {
      console.error('Error validating query:', error)
      return { isValid: false, error: 'Failed to validate query' }
    }
  }

  async generateExplanation(sql: string, databaseType: string): Promise<string> {
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 200,
          temperature: 0.3,
          system: 'You are a SQL expert. Explain SQL queries in simple, clear terms.',
          messages: [
            {
              role: 'user',
              content: `Explain this ${databaseType.toUpperCase()} SQL query in simple terms:

Query: ${sql}

Provide a brief, clear explanation of what this query does.`
            }
          ]
        })
      })

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`)
      }

      const data: ClaudeResponse = await response.json()
      return data.content[0]?.text?.trim() || 'Unable to generate explanation'
    } catch (error) {
      console.error('Error generating explanation:', error)
      throw error
    }
  }

  private buildPromptMessages(request: SQLGenerationRequest): {
    systemPrompt: string
    userMessage: string
  } {
    const { naturalLanguageQuery, databaseSchema, databaseType, sampleData, conversationContext } =
      request

    // Get database-specific context provider
    const contextProvider = databaseContextRegistry.getProvider(databaseType)

    const systemPrompt = `You are Claude, a SQL expert specializing in ${databaseType.toUpperCase()} databases.
Your task is to convert natural language queries into accurate SQL statements.

${contextProvider ? contextProvider.generatePromptInstructions() : ''}

IMPORTANT INSTRUCTIONS:
1. Use only the tables and columns provided in the schema
2. Follow ${databaseType.toUpperCase()} syntax and best practices
3. If the query involves aggregations, use appropriate functions (COUNT, SUM, AVG, etc.)
4. If the query involves date/time operations, use ${databaseType.toUpperCase()} date functions
5. If the query is ambiguous, make reasonable assumptions and explain them
6. Always include a brief explanation of what the query does
7. DO NOT wrap the SQL in markdown code blocks or any other formatting
8. Consider the conversation context when interpreting the current request

RESPONSE FORMAT:
SQL: [Your SQL query here - raw SQL only, no markdown]
Explanation: [Brief explanation of what the query does]`

    const userMessage = `${
      conversationContext
        ? `CONVERSATION CONTEXT:
${conversationContext}

`
        : ''
    }DATABASE SCHEMA:
${contextProvider ? contextProvider.formatSchema(databaseSchema) : this.formatSchema(databaseSchema)}

${
  sampleData
    ? `SAMPLE DATA:
${this.formatSampleData(sampleData)}

`
    : ''
}NATURAL LANGUAGE QUERY:
"${naturalLanguageQuery}"

Please generate a ${databaseType.toUpperCase()} SQL query that answers this question.`

    return { systemPrompt, userMessage }
  }

  private formatSchema(schema: DatabaseSchema): string {
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

  private formatSampleData(sampleData: Record<string, any[]>): string {
    let formatted = ''

    for (const [tableName, rows] of Object.entries(sampleData)) {
      if (rows.length > 0) {
        formatted += `Table: ${tableName}\n`
        const columns = Object.keys(rows[0])
        formatted += `Columns: ${columns.join(', ')}\n`
        formatted += 'Sample rows:\n'

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

  private parseResponse(response: string): { sql: string; explanation: string } {
    const lines = response.split('\n')
    let sql = ''
    let explanation = ''
    let inSqlSection = false
    let inExplanationSection = false

    for (const line of lines) {
      const trimmedLine = line.trim()

      if (trimmedLine.startsWith('SQL:')) {
        inSqlSection = true
        inExplanationSection = false
        sql = trimmedLine.substring(4).trim()
      } else if (trimmedLine.startsWith('Explanation:')) {
        inSqlSection = false
        inExplanationSection = true
        explanation = trimmedLine.substring(12).trim()
      } else if (inSqlSection && trimmedLine) {
        sql += ' ' + trimmedLine
      } else if (inExplanationSection && trimmedLine) {
        explanation += ' ' + trimmedLine
      }
    }

    // Clean up SQL if needed
    if (sql) {
      sql = sql
        .replace(/```sql\s*/g, '')
        .replace(/```\s*$/g, '')
        .trim()
    }

    return { sql, explanation }
  }
}
