import { BaseLanguageModel } from '@langchain/core/language_models/base'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import {
  LLMInterface,
  SQLGenerationRequest,
  SQLGenerationResponse,
  ValidationRequest,
  ValidationResponse,
  DatabaseSchema,
  ErrorAnalysisRequest,
  ErrorAnalysisResponse,
  AIRequest,
  AIResponse
} from '../interface'
import { databaseContextRegistry } from '../../database/context'

export abstract class BaseLangchainLLM implements LLMInterface {
  protected model: BaseLanguageModel

  constructor(model: BaseLanguageModel) {
    this.model = model
  }

  async generateSQL(request: SQLGenerationRequest): Promise<SQLGenerationResponse> {
    try {
      const prompt = this.buildPrompt(request)
      const messages = [
        new SystemMessage(
          'You are a SQL expert. Generate accurate SQL queries based on the provided schema and natural language query.'
        ),
        new HumanMessage(prompt)
      ]

      const response = await this.model.invoke(messages)
      const text = response.content as string

      console.log('Langchain Response:', text)

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

      const messages = [
        new SystemMessage(
          'You are a SQL validator. Return only "VALID" for correct queries or a brief error message for invalid ones.'
        ),
        new HumanMessage(prompt)
      ]

      const response = await this.model.invoke(messages)
      const text = (response.content as string).trim()

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

      const messages = [
        new SystemMessage(
          'You are a SQL expert. Provide clear, simple explanations of SQL queries.'
        ),
        new HumanMessage(prompt)
      ]

      const response = await this.model.invoke(messages)
      return (response.content as string).trim()
    } catch (error) {
      console.error('Error generating explanation:', error)
      throw error
    }
  }

  async analyzeError(request: ErrorAnalysisRequest): Promise<ErrorAnalysisResponse> {
    try {
      const prompt = this.buildErrorAnalysisPrompt(request)
      const messages = [
        new SystemMessage(
          'You are a SQL expert. Analyze errors and provide clear explanations and fixes.'
        ),
        new HumanMessage(prompt)
      ]

      const response = await this.model.invoke(messages)
      const text = (response.content as string).trim()

      return this.parseErrorAnalysisResponse(text)
    } catch (error) {
      console.error('Error analyzing SQL error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  async processAIRequest(request: AIRequest): Promise<AIResponse> {
    try {
      switch (request.requestType.type) {
        case 'generate_sql': {
          const sqlResponse = await this.generateSQL({
            naturalLanguageQuery: request.naturalLanguageQuery!,
            databaseSchema: request.databaseSchema,
            databaseType: request.databaseType,
            sampleData: request.sampleData,
            conversationContext: request.conversationContext
          })
          return {
            success: sqlResponse.success,
            type: 'sql_generation',
            content: sqlResponse.sqlQuery || '',
            sqlQuery: sqlResponse.sqlQuery,
            explanation: sqlResponse.explanation,
            error: sqlResponse.error
          }
        }

        case 'analyze_error': {
          const errorResponse = await this.analyzeError({
            sqlQuery: request.sqlQuery!,
            errorMessage: request.errorMessage!,
            databaseSchema: request.databaseSchema,
            databaseType: request.databaseType,
            conversationContext: request.conversationContext
          })
          return {
            success: errorResponse.success,
            type: 'error_analysis',
            content: errorResponse.analysis || '',
            correctedQuery: errorResponse.correctedQuery,
            explanation: errorResponse.suggestedFix,
            error: errorResponse.error
          }
        }

        case 'explain_query': {
          const explanation = await this.generateExplanation(
            request.sqlQuery!,
            request.databaseType
          )
          return {
            success: true,
            type: 'query_explanation',
            content: explanation,
            explanation: explanation
          }
        }

        default:
          return {
            success: false,
            type: 'sql_generation',
            content: '',
            error: 'Unsupported request type'
          }
      }
    } catch (error) {
      console.error('Error processing AI request:', error)
      return {
        success: false,
        type: 'sql_generation',
        content: '',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  protected buildPrompt(request: SQLGenerationRequest): string {
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

  protected formatSchema(schema: any): string {
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

  protected parseResponse(response: string): { sql: string; explanation: string } {
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

  private buildErrorAnalysisPrompt(request: ErrorAnalysisRequest): string {
    const { sqlQuery, errorMessage, databaseSchema, databaseType, conversationContext } = request

    return `You are a SQL expert specializing in ${databaseType.toUpperCase()} databases.
Your task is to analyze SQL errors and provide clear explanations and fixes.

${conversationContext ? `CONVERSATION CONTEXT:\n${conversationContext}\n\n` : ''}DATABASE SCHEMA:
${this.formatSchema(databaseSchema)}

FAILED SQL QUERY:
${sqlQuery}

ERROR MESSAGE:
${errorMessage}

Please analyze this error and provide:
1. A clear explanation of what went wrong
2. A suggested fix for the issue
3. A corrected SQL query if possible

RESPONSE FORMAT:
Analysis: [Clear explanation of the error]
Fix: [Suggested fix or approach]
Corrected SQL: [Fixed SQL query if applicable]`
  }

  private parseErrorAnalysisResponse(response: string): ErrorAnalysisResponse {
    const lines = response.split('\n')
    let analysis = ''
    let suggestedFix = ''
    let correctedQuery = ''
    let inAnalysis = false
    let inFix = false
    let inCorrectedSQL = false

    for (const line of lines) {
      const trimmedLine = line.trim()

      if (trimmedLine.startsWith('Analysis:')) {
        inAnalysis = true
        inFix = false
        inCorrectedSQL = false
        analysis = trimmedLine.substring(9).trim()
      } else if (trimmedLine.startsWith('Fix:')) {
        inAnalysis = false
        inFix = true
        inCorrectedSQL = false
        suggestedFix = trimmedLine.substring(4).trim()
      } else if (trimmedLine.startsWith('Corrected SQL:')) {
        inAnalysis = false
        inFix = false
        inCorrectedSQL = true
        correctedQuery = trimmedLine.substring(14).trim()
      } else if (inAnalysis && trimmedLine) {
        analysis += ' ' + trimmedLine
      } else if (inFix && trimmedLine) {
        suggestedFix += ' ' + trimmedLine
      } else if (inCorrectedSQL && trimmedLine) {
        correctedQuery += ' ' + trimmedLine
      }
    }

    return {
      success: true,
      analysis: analysis.trim(),
      suggestedFix: suggestedFix.trim(),
      correctedQuery: correctedQuery.trim()
    }
  }

  async cleanup?(): Promise<void> {
    // Langchain models don't typically need cleanup
  }
}
