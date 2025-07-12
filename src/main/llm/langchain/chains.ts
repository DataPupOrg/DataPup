import { ChatOpenAI } from '@langchain/openai'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatAnthropic } from '@langchain/anthropic'
import { BaseLanguageModel } from '@langchain/core/language_models/base'
import { LLMChain } from 'langchain/chains'
import { PromptTemplate } from '@langchain/core/prompts'
import {
  LLMInterface,
  SQLGenerationRequest,
  SQLGenerationResponse,
  ValidationRequest,
  ValidationResponse
} from '../interface'
import { databaseContextRegistry } from '../../database/context'

export class LangchainChainsLLM implements LLMInterface {
  private model: BaseLanguageModel
  private provider: string

  constructor(provider: 'openai' | 'gemini' | 'claude', apiKey: string, modelName?: string) {
    this.provider = provider

    switch (provider) {
      case 'openai':
        this.model = new ChatOpenAI({
          openAIApiKey: apiKey,
          modelName: modelName || 'gpt-4o-mini',
          temperature: 0.1,
          maxTokens: 2000
        })
        break
      case 'gemini':
        this.model = new ChatGoogleGenerativeAI({
          apiKey,
          model: modelName || 'gemini-1.5-flash',
          temperature: 0.1,
          maxOutputTokens: 2000
        })
        break
      case 'claude':
        this.model = new ChatAnthropic({
          apiKey,
          modelName: modelName || 'claude-3-5-sonnet-20241022',
          temperature: 0.1,
          maxTokens: 2000
        })
        break
      default:
        throw new Error(`Unsupported provider: ${provider}`)
    }
  }

  async generateSQL(request: SQLGenerationRequest): Promise<SQLGenerationResponse> {
    try {
      const contextProvider = databaseContextRegistry.getProvider(request.databaseType)
      const databaseContext = contextProvider ? contextProvider.generatePromptInstructions() : ''
      const schema = contextProvider
        ? contextProvider.formatSchema(request.databaseSchema)
        : this.formatSchema(request.databaseSchema)
      const sampleData = request.sampleData ? this.formatSampleData(request.sampleData) : ''

      const prompt = PromptTemplate.fromTemplate(`
You are a SQL expert specializing in {databaseType} databases.
Your task is to convert natural language queries into accurate SQL statements.

{databaseContext}

DATABASE SCHEMA:
{schema}

{sampleData}

NATURAL LANGUAGE QUERY:
"{naturalLanguageQuery}"

Please generate a {databaseType} SQL query that answers this question.

IMPORTANT INSTRUCTIONS:
1. Use only the tables and columns provided in the schema
2. Follow {databaseType} syntax and best practices
3. If the query involves aggregations, use appropriate functions (COUNT, SUM, AVG, etc.)
4. If the query involves date/time operations, use {databaseType} date functions
5. If the query is ambiguous, make reasonable assumptions and explain them
6. Always include a brief explanation of what the query does
7. DO NOT wrap the SQL in markdown code blocks or any other formatting
8. Consider the conversation context when interpreting the current request
9. If the user is referring to a previous query or result, use that context

RESPONSE FORMAT:
SQL: [Your SQL query here - raw SQL only, no markdown]
Explanation: [Brief explanation of what the query does]
`)

      const chain = new LLMChain({
        llm: this.model,
        prompt
      })

      const result = await chain.invoke({
        databaseType: request.databaseType,
        databaseContext,
        schema,
        sampleData,
        naturalLanguageQuery: request.naturalLanguageQuery
      })

      const response = result.text
      const parsed = this.parseResponse(response)

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
      const prompt = PromptTemplate.fromTemplate(`
You are a SQL validator for {databaseType} databases.
Please validate this SQL query and return only "VALID" if it's syntactically correct, or a brief error message if it's not.

Query: {sql}

Response:`)

      const chain = new LLMChain({
        llm: this.model,
        prompt
      })

      const result = await chain.invoke({
        databaseType: request.databaseType,
        sql: request.sql
      })

      const text = result.text.trim()

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
      const prompt = PromptTemplate.fromTemplate(`
Explain this {databaseType} SQL query in simple terms:

Query: {sql}

Provide a brief, clear explanation of what this query does.`)

      const chain = new LLMChain({
        llm: this.model,
        prompt
      })

      const result = await chain.invoke({
        databaseType: databaseType,
        sql: sql
      })

      return result.text.trim()
    } catch (error) {
      console.error('Error generating explanation:', error)
      throw error
    }
  }

  private formatSchema(schema: any): string {
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
        sql += (sql ? '\n' : '') + trimmedLine
      } else if (inExplanationSection && trimmedLine) {
        explanation += (explanation ? '\n' : '') + trimmedLine
      }
    }

    // Fallback parsing if structured format not found
    if (!sql && !explanation) {
      const sqlMatch = response.match(/```sql\s*([\s\S]*?)\s*```/)
      if (sqlMatch) {
        sql = sqlMatch[1].trim()
      } else {
        // Try to extract SQL from the response
        const lines = response.split('\n')
        const sqlLines: string[] = []
        const explanationLines: string[] = []
        let foundSql = false

        for (const line of lines) {
          const trimmed = line.trim()
          if (
            trimmed &&
            (trimmed.toUpperCase().includes('SELECT') ||
              trimmed.toUpperCase().includes('INSERT') ||
              trimmed.toUpperCase().includes('UPDATE') ||
              trimmed.toUpperCase().includes('DELETE') ||
              trimmed.toUpperCase().includes('WITH'))
          ) {
            foundSql = true
            sqlLines.push(trimmed)
          } else if (foundSql && trimmed) {
            explanationLines.push(trimmed)
          }
        }

        sql = sqlLines.join('\n')
        explanation = explanationLines.join('\n')
      }
    }

    return { sql, explanation }
  }

  async cleanup?(): Promise<void> {
    // Langchain models don't typically need cleanup
  }
}
