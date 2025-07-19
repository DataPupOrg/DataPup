import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { z } from 'zod'
import { DatabaseManager } from '../database/manager'
import { SecureStorage } from '../secureStorage'
import { AITools } from './tools'
import { logger } from '../utils/logger'

interface AgentRequest {
  connectionId: string
  query: string
  database?: string
  provider?: 'openai' | 'claude' | 'gemini'
}

interface AgentResponse {
  success: boolean
  sqlQuery?: string
  explanation?: string
  queryResult?: any
  error?: string
  toolCalls?: Array<{
    name: string
    args: Record<string, unknown>
  }>
}

export class LangChainAgent {
  private databaseManager: DatabaseManager
  private secureStorage: SecureStorage
  private aiTools: AITools
  private agents: Map<string, AgentExecutor> = new Map()

  constructor(databaseManager: DatabaseManager, secureStorage: SecureStorage) {
    this.databaseManager = databaseManager
    this.secureStorage = secureStorage
    this.aiTools = new AITools(databaseManager)
  }

  private async getModel(provider: string = 'openai') {
    const apiKey = await this.secureStorage.get(`ai-api-key-${provider}`)
    if (!apiKey) {
      throw new Error(`No API key found for ${provider}`)
    }

    switch (provider) {
      case 'openai':
        return new ChatOpenAI({
          apiKey,
          modelName: 'gpt-4o-mini',
          temperature: 0.1
        })
      case 'claude':
        return new ChatAnthropic({
          apiKey,
          modelName: 'claude-3-5-sonnet-20241022',
          temperature: 0.1
        })
      case 'gemini':
        return new ChatGoogleGenerativeAI({
          apiKey,
          model: 'gemini-1.5-pro',
          temperature: 0.1
        })
      default:
        throw new Error(`Unsupported provider: ${provider}`)
    }
  }

  private createTools(connectionId: string, database?: string) {
    const tools = [
      new DynamicStructuredTool({
        name: 'listDatabases',
        description: 'Get all available databases',
        schema: z.object({}),
        func: async () => {
          console.log('3, listDatabases')
          const result = await this.aiTools.listDatabases(connectionId)
          return JSON.stringify(result)
        }
      }),
      new DynamicStructuredTool({
        name: 'listTables',
        description: 'Get all tables in a database',
        schema: z.object({
          database: z.string().optional().describe('Database name (optional)')
        }),
        func: async ({ database: db }) => {
          console.log('4, listTables')
          const result = await this.aiTools.listTables(connectionId, db || database)
          return JSON.stringify(result)
        }
      }),
      new DynamicStructuredTool({
        name: 'getTableSchema',
        description: 'Get schema of a specific table',
        schema: z.object({
          table: z.string().describe('Table name'),
          database: z.string().optional().describe('Database name (optional)')
        }),
        func: async ({ table, database: db }) => {
          console.log('5, getTableSchema')
          const result = await this.aiTools.getTableSchema(connectionId, table, db || database)
          return JSON.stringify(result)
        }
      }),
      new DynamicStructuredTool({
        name: 'getSampleRows',
        description: 'Get sample data from a table',
        schema: z.object({
          table: z.string().describe('Table name'),
          database: z.string().optional().describe('Database name'),
          limit: z.number().optional().default(5).describe('Number of rows to return')
        }),
        func: async ({ table, database: db, limit }) => {
          console.log('6, getSampleRows')
          const result = await this.aiTools.getSampleRows(
            connectionId,
            db || database || '',
            table,
            limit
          )
          return JSON.stringify(result)
        }
      }),
      new DynamicStructuredTool({
        name: 'searchTables',
        description: 'Search for tables by name pattern',
        schema: z.object({
          pattern: z.string().describe('Search pattern'),
          database: z.string().optional().describe('Database name (optional)')
        }),
        func: async ({ pattern, database: db }) => {
          console.log('7, searchTables')
          const result = await this.aiTools.searchTables(connectionId, pattern, db || database)
          return JSON.stringify(result)
        }
      }),
      new DynamicStructuredTool({
        name: 'searchColumns',
        description: 'Search for columns by name pattern',
        schema: z.object({
          pattern: z.string().describe('Search pattern'),
          database: z.string().optional().describe('Database name (optional)')
        }),
        func: async ({ pattern, database: db }) => {
          console.log('8, searchColumns')
          const result = await this.aiTools.searchColumns(connectionId, pattern, db || database)
          return JSON.stringify(result)
        }
      }),
      new DynamicStructuredTool({
        name: 'executeQuery',
        description: 'Execute a SQL query and get results',
        schema: z.object({
          sql: z.string().describe('SQL query to execute')
        }),
        func: async ({ sql }) => {
          console.log('9, executeQuery')
          const result = await this.aiTools.executeQuery(connectionId, sql)
          return JSON.stringify(result)
        }
      })
    ]

    return tools
  }

  async processQuery(request: AgentRequest): Promise<AgentResponse> {
    try {
      const { connectionId, query, database, provider = 'openai' } = request

      // Check if connection is active
      if (!this.databaseManager.isConnected(connectionId)) {
        return {
          success: false,
          error: 'Database connection is not active. Please reconnect and try again.'
        }
      }

      // Get or create agent for this provider
      const agentKey = `${provider}-${connectionId}`
      let agent = this.agents.get(agentKey)

      if (!agent) {
        const model = await this.getModel(provider)
        const tools = this.createTools(connectionId, database)

        const prompt = ChatPromptTemplate.fromMessages([
          [
            'system',
            `You are an intelligent database agent. Your job is to help users explore and query their databases.

IMPORTANT RULES:
1. Use tools to explore the database before generating SQL
2. For questions about tables/schemas, use tools like listTables, getTableSchema
3. For data queries, generate appropriate SQL
4. Always verify table exists before generating SQL for it
5. If a table doesn't exist in current database, explore other databases

Current database context: ${database || 'default'}`
          ],
          ['human', '{input}'],
          ['placeholder', '{agent_scratchpad}']
        ])

        const agentModel = createToolCallingAgent({
          llm: model,
          tools,
          prompt
        })

        agent = new AgentExecutor({
          agent: agentModel,
          tools,
          maxIterations: 5
        })

        this.agents.set(agentKey, agent)
      }

      // Execute the agent
      logger.info(`1, Processing query with ${provider}: ${query}`)
      const result = await agent.invoke({
        input: query
      })
      console.log('2, result', result)
      // Parse the output - it can be a string or array of message objects
      let outputText = ''

      if (typeof result.output === 'string') {
        outputText = result.output
      } else if (Array.isArray(result.output)) {
        // Handle array of message objects
        outputText = result.output
          .filter((msg: any) => msg.type === 'text')
          .map((msg: any) => msg.text)
          .join('\n')
      } else if (result.output && typeof result.output === 'object' && 'text' in result.output) {
        outputText = result.output.text
      }
      console.log('3, outputText', outputText)
      // Check if SQL was generated
      const sqlMatch = outputText.match(/```sql\n([\s\S]*?)\n```/)
      const sqlQuery = sqlMatch ? sqlMatch[1].trim() : undefined

      // Extract explanation (remove SQL blocks if any)
      const explanation = outputText.replace(/```sql\n[\s\S]*?\n```/g, '').trim()

      // Extract tool calls if they exist in the intermediateSteps
      const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = []
      if (result.intermediateSteps && Array.isArray(result.intermediateSteps)) {
        for (const step of result.intermediateSteps) {
          if (step && step.action && step.action.tool) {
            toolCalls.push({
              name: step.action.tool,
              args: step.action.toolInput || {}
            })
          }
        }
      }

      return {
        success: true,
        sqlQuery,
        explanation,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined
      }
    } catch (error) {
      logger.error('Error processing query:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  // Backwards compatibility wrapper
  async processNaturalLanguageQuery(request: any): Promise<AgentResponse> {
    return this.processQuery({
      connectionId: request.connectionId,
      query: request.naturalLanguageQuery,
      database: request.database,
      provider: request.provider
    })
  }

  async generateSQL(request: AgentRequest): Promise<AgentResponse> {
    // For SQL generation, we just process the query
    return this.processQuery(request)
  }

  async generateSQLOnly(request: any): Promise<AgentResponse> {
    return this.generateSQL({
      connectionId: request.connectionId,
      query: request.naturalLanguageQuery,
      database: request.database,
      provider: request.provider
    })
  }

  async cleanup(): Promise<void> {
    this.agents.clear()
  }

  // Additional methods for compatibility
  async getDatabaseSchema(connectionId: string, database?: string): Promise<any> {
    const result = await this.aiTools.listTables(connectionId, database)
    if (result.success && result.tables) {
      const schema = {
        database: database || 'default',
        tables: []
      }

      // Get schema for each table
      for (const tableName of result.tables) {
        const tableSchema = await this.aiTools.getTableSchema(connectionId, tableName, database)
        if (tableSchema.success && tableSchema.schema) {
          schema.tables.push(tableSchema.schema)
        }
      }

      return schema
    }
    return null
  }

  formatSchemaForDisplay(schema: any): string {
    let formatted = `Database: ${schema.database}\n\n`

    for (const table of schema.tables) {
      formatted += `Table: ${table.name}\n`
      for (const column of table.columns) {
        formatted += `  - ${column.name}: ${column.type}\n`
      }
      formatted += '\n'
    }

    return formatted
  }

  async validateGeneratedQuery(
    sql: string,
    connectionId: string
  ): Promise<{ isValid: boolean; error?: string }> {
    // For now, just try to execute with EXPLAIN
    try {
      const result = await this.aiTools.executeQuery(connectionId, `EXPLAIN ${sql}`)
      return { isValid: result.success, error: result.error }
    } catch (error) {
      return { isValid: false, error: error instanceof Error ? error.message : 'Invalid query' }
    }
  }
}
