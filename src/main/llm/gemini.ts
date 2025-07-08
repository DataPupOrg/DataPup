import { GoogleGenerativeAI } from '@google/generative-ai'
import {
  LLMInterface,
  SQLGenerationRequest,
  SQLGenerationResponse,
  ValidationRequest,
  ValidationResponse,
  DatabaseSchema
} from './interface'
import { databaseContextRegistry } from '../database/context'

export class GeminiLLM implements LLMInterface {
  private genAI: GoogleGenerativeAI
  private model: any

  constructor(apiKey: string, modelName?: string) {
    if (!apiKey) {
      throw new Error('Gemini API key is required')
    }

    this.genAI = new GoogleGenerativeAI(apiKey)
    this.model = this.genAI.getGenerativeModel({ model: modelName || 'gemini-1.5-flash' })
  }

  async generateSQL(request: SQLGenerationRequest): Promise<SQLGenerationResponse> {
    try {
      const prompt = this.buildPrompt(request)

      const result = await this.model.generateContent(prompt)
      const response = await result.response
      const text = response.text()

      // Parse the response to extract SQL and explanation
      const parsed = this.parseResponse(text)

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
      const prompt = `You are a SQL validator. Please validate this ${request.databaseType.toUpperCase()} SQL query and return only "VALID" if it's syntactically correct, or a brief error message if it's not.

Query: ${request.sql}

Response:`

      const result = await this.model.generateContent(prompt)
      const response = await result.response
      const text = response.text().trim()

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
      const prompt = `Explain this ${databaseType.toUpperCase()} SQL query in simple terms:

Query: ${sql}

Provide a brief, clear explanation of what this query does.`

      const result = await this.model.generateContent(prompt)
      const response = await result.response
      return response.text().trim()
    } catch (error) {
      console.error('Error generating explanation:', error)
      throw error
    }
  }

    private buildPrompt(request: SQLGenerationRequest): string {
    const { naturalLanguageQuery, databaseSchema, databaseType, sampleData, conversationContext } =
      request

    // Get database-specific context provider
    const contextProvider = databaseContextRegistry.getProvider(databaseType)

    console.log(`Building prompt for database type: ${databaseType}`)
    console.log(`Context provider found: ${contextProvider ? 'Yes' : 'No'}`)

    let prompt = `You are a SQL expert specializing in ${databaseType.toUpperCase()} databases.
Your task is to convert natural language queries into accurate SQL statements.

${contextProvider ? contextProvider.generatePromptInstructions() : ''}

${
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

Please generate a ${databaseType.toUpperCase()} SQL query that answers this question.

IMPORTANT INSTRUCTIONS:
1. Use only the tables and columns provided in the schema
2. Follow ${databaseType.toUpperCase()} syntax and best practices
3. If the query involves aggregations, use appropriate functions (COUNT, SUM, AVG, etc.)
4. If the query involves date/time operations, use ${databaseType.toUpperCase()} date functions
5. If the query is ambiguous, make reasonable assumptions and explain them
6. Always include a brief explanation of what the query does
7. DO NOT wrap the SQL in markdown code blocks or any other formatting
8. Consider the conversation context when interpreting the current request
9. If the user is referring to a previous query or result, use that context

RESPONSE FORMAT:
SQL: [Your SQL query here - raw SQL only, no markdown]
Explanation: [Brief explanation of what the query does]`

    console.log('Generated prompt length:', prompt.length)
    console.log('Context instructions included:', contextProvider ? 'Yes' : 'No')

    return prompt
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

    // Clean up the SQL - remove any markdown formatting that might have been included
    if (sql) {
      // Remove markdown code blocks
      sql = sql.replace(/```sql\s*/g, '').replace(/```\s*$/g, '')
      // Remove any leading/trailing whitespace
      sql = sql.trim()
    }

    // If we couldn't parse the structured format, try to extract SQL from the response
    if (!sql) {
      // Try to find SQL in markdown code blocks
      const sqlMatch = response.match(/```sql\s*([\s\S]*?)\s*```/)
      if (sqlMatch) {
        sql = sqlMatch[1].trim()
      } else {
        // Try to find SQL in regular code blocks
        const codeMatch = response.match(/```\s*([\s\S]*?)\s*```/)
        if (codeMatch) {
          const codeContent = codeMatch[1].trim()
          // Check if it looks like SQL
          if (
            codeContent.toUpperCase().includes('SELECT') ||
            codeContent.toUpperCase().includes('FROM') ||
            codeContent.toUpperCase().includes('WHERE')
          ) {
            sql = codeContent
          }
        } else {
          // Fallback: try to find SQL-like content in lines
          for (const line of lines) {
            const trimmedLine = line.trim()
            if (
              trimmedLine.toUpperCase().startsWith('SELECT') ||
              trimmedLine.toUpperCase().startsWith('WITH') ||
              trimmedLine.toUpperCase().startsWith('SHOW') ||
              trimmedLine.toUpperCase().startsWith('DESCRIBE')
            ) {
              sql = trimmedLine
              break
            }
          }
        }
      }
    }

    return { sql, explanation }
  }
}
