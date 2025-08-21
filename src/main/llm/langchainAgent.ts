import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents'
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts'
import { BufferMemory } from 'langchain/memory'
import { z } from 'zod'
import { DatabaseManager } from '../database/manager'
import { SecureStorage } from '../secureStorage'
import { AITools } from './tools'
import { logger } from '../utils/logger'
import { BrowserWindow } from 'electron'

interface AgentRequest {
  connectionId: string
  query: string
  database?: string
  provider?: 'openai' | 'claude' | 'gemini'
  sessionId?: string // For maintaining conversation context
}

interface AgentResponse {
  success: boolean
  message?: string // The complete formatted response
  sqlQuery?: string // Extracted SQL for backwards compatibility
  explanation?: string // Deprecated, use message instead
  queryResult?: any
  error?: string
  toolCalls?: Array<{
    name: string
    args: Record<string, unknown>
  }>
}

interface AgentState {
  currentDatabase?: string
  availableDatabases?: string[]
  exploredTables: Set<string>
  toolResultsCache: Map<string, any>
  lastQuery?: string
  conversationId: string
}

interface AgentSession {
  agent: AgentExecutor
  memory: BufferMemory
  state: AgentState
}

export class LangChainAgent {
  private databaseManager: DatabaseManager
  private secureStorage: SecureStorage
  private aiTools: AITools
  private sessions: Map<string, AgentSession> = new Map()

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
          model: 'claude-3-5-sonnet-20241022',
          temperature: 0.1,
          maxTokens: 4096
        })
      case 'gemini':
        return new ChatGoogleGenerativeAI({
          apiKey,
          model: 'gemini-2.0-flash',
          temperature: 0.1
        })
      default:
        throw new Error(`Unsupported provider: ${provider}`)
    }
  }

  private emitToolEvent(event: string, data: any) {
    // Send to all renderer windows
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send(event, data)
    })
  }

  private createTools(connectionId: string, state: AgentState) {
    const tools = [
      new DynamicStructuredTool({
        name: 'listDatabases',
        description: 'Get all available databases',
        schema: z.object({}),
        func: async () => {
          const cacheKey = 'listDatabases'

          // Check cache first
          if (state.toolResultsCache.has(cacheKey)) {
            logger.debug('Using cached result for listDatabases')
            return JSON.stringify(state.toolResultsCache.get(cacheKey))
          }

          this.emitToolEvent('ai:toolCall', {
            name: 'listDatabases',
            status: 'running',
            args: {}
          })
          const result = await this.aiTools.listDatabases(connectionId)

          // Cache the result
          if (result.success && result.databases) {
            state.toolResultsCache.set(cacheKey, result)
            state.availableDatabases = result.databases
          }

          this.emitToolEvent('ai:toolCall', {
            name: 'listDatabases',
            status: 'completed',
            result
          })
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
          const targetDb = db || state.currentDatabase
          const cacheKey = `listTables:${targetDb || 'default'}`

          // Check cache first
          if (state.toolResultsCache.has(cacheKey)) {
            logger.debug(`Using cached result for listTables in ${targetDb}`)
            return JSON.stringify(state.toolResultsCache.get(cacheKey))
          }

          this.emitToolEvent('ai:toolCall', {
            name: 'listTables',
            status: 'running',
            args: { database: targetDb }
          })

          const result = await this.aiTools.listTables(connectionId, targetDb)

          // Cache the result and track explored tables
          if (result.success && result.tables) {
            state.toolResultsCache.set(cacheKey, result)
            result.tables.forEach((table) => state.exploredTables.add(table))
          }

          this.emitToolEvent('ai:toolCall', {
            name: 'listTables',
            status: 'completed',
            result
          })

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
          const result = await this.aiTools.searchColumns(connectionId, pattern, db || database)
          return JSON.stringify(result)
        }
      }),
      new DynamicStructuredTool({
        name: 'analyzeQueryPerformance',
        description:
          'Analyze SQL query performance using EXPLAIN ANALYZE and provide optimization suggestions',
        schema: z.object({
          sql: z.string().describe('SQL query to analyze for performance'),
          database: z.string().optional().describe('Database name (optional)')
        }),
        func: async ({ sql, database: db }) => {
          const targetDb = db || state.currentDatabase

          this.emitToolEvent('ai:toolCall', {
            name: 'analyzeQueryPerformance',
            status: 'running',
            args: { sql, database: targetDb }
          })

          const result = await this.aiTools.analyzeQueryPerformance(connectionId, sql, targetDb)

          this.emitToolEvent('ai:toolCall', {
            name: 'analyzeQueryPerformance',
            status: 'completed',
            result
          })

          return JSON.stringify(result)
        }
      })
    ]

    return tools
  }

  async processQuery(request: AgentRequest): Promise<AgentResponse> {
    try {
      const { connectionId, query, database, provider = 'openai', sessionId } = request

      // Check if connection is active
      if (!this.databaseManager.isConnected(connectionId)) {
        return {
          success: false,
          error: 'Database connection is not active. Please reconnect and try again.'
        }
      }

      // Get or create session
      const sessionKey = sessionId || `${provider}-${connectionId}-default`
      let session = this.sessions.get(sessionKey)

      if (!session) {
        // Create new session with state
        const state: AgentState = {
          currentDatabase: database,
          availableDatabases: [],
          exploredTables: new Set(),
          toolResultsCache: new Map(),
          conversationId: sessionKey
        }

        const model = await this.getModel(provider)
        const tools = this.createTools(connectionId, state)

        // Create memory with chat history
        // For Claude, we need to be careful about message formatting
        const memory = new BufferMemory({
          memoryKey: 'chat_history',
          inputKey: 'input',
          outputKey: 'output',
          returnMessages: true,
          // Add AI prefix to help with formatting
          aiPrefix: 'Assistant',
          humanPrefix: 'Human'
        })

        const prompt = ChatPromptTemplate.fromMessages([
          [
            'system',
            `You are an intelligent database agent with memory of our conversation. Your job is to help users explore and query their databases.

IMPORTANT RULES:
1. Remember what we've already discussed - don't repeat tool calls unnecessarily
2. Use cached information when available
3. For questions about tables/schemas, use tools like listTables, getTableSchema
4. For data queries, generate appropriate SQL
5. Always verify table exists before generating SQL for it
6. If a table doesn't exist in current database, explore other databases`
          ],
          new MessagesPlaceholder('chat_history'),
          ['human', '{input}'],
          ['placeholder', '{agent_scratchpad}']
        ])

        const agentModel = createToolCallingAgent({
          llm: model,
          tools,
          prompt
        })

        const agent = new AgentExecutor({
          agent: agentModel,
          tools,
          memory,
          maxIterations: 15,
          handleParsingErrors: true,
          verbose: true
        })

        session = { agent, memory, state }
        this.sessions.set(sessionKey, session)

        // Auto-discover available databases when session starts
        try {
          const databasesResult = await this.aiTools.listDatabases(connectionId)

          if (databasesResult.success && databasesResult.databases) {
            session.state.availableDatabases = databasesResult.databases
            session.state.toolResultsCache.set('listDatabases', databasesResult)
          }
        } catch (error) {
          // If auto-discovery fails, continue without it
          console.warn('Failed to auto-discover databases:', error)
        }
      }

      // Update state with current context
      if (database) {
        session.state.currentDatabase = database
      }
      session.state.lastQuery = query

      // Build context-aware input
      const contextInfo = []
      if (session.state.currentDatabase) {
        contextInfo.push(`Current database: ${session.state.currentDatabase}`)
      }
      if (session.state.availableDatabases.length > 0) {
        contextInfo.push(`Available databases: ${session.state.availableDatabases.join(', ')}`)
      }
      if (session.state.exploredTables.size > 0) {
        contextInfo.push(
          `Previously explored tables: ${Array.from(session.state.exploredTables).join(', ')}`
        )
      }

      const contextualInput =
        contextInfo.length > 0 ? `[Context: ${contextInfo.join('. ')}]\n\n${query}` : query

      // Execute the agent with state context
      logger.info(`Processing query with ${provider}: ${query}`)

      logger.debug('Invoking agent with input:', contextualInput)
      const memoryVars = await session.memory.loadMemoryVariables({})
      logger.debug('Memory state:', JSON.stringify(memoryVars, null, 2))

      let result
      try {
        result = await session.agent.invoke({
          input: contextualInput
        })
      } catch (invokeError: any) {
        logger.error('Error during agent invoke:', invokeError)
        logger.error('Error stack:', invokeError.stack)

        // Check if this is a Claude-specific message formatting error
        if (provider === 'claude' && invokeError.message?.includes("reading 'map'")) {
          logger.warn('Claude message formatting error detected, attempting without memory')

          // Create a new agent without memory for this request
          const modelWithoutMemory = await this.getModel(provider)
          const toolsWithoutMemory = this.createTools(connectionId, session.state)

          const promptWithoutMemory = ChatPromptTemplate.fromMessages([
            [
              'system',
              `You are an intelligent database agent. Your job is to help users explore and query their databases.

IMPORTANT RULES:
1. For questions about tables/schemas, use tools like listTables, getTableSchema
2. For data queries, generate appropriate SQL
3. Always verify table exists before generating SQL for it
4. If a table doesn't exist in current database, explore other databases`
            ],
            ['human', '{input}'],
            ['placeholder', '{agent_scratchpad}']
          ])

          const agentWithoutMemory = createToolCallingAgent({
            llm: modelWithoutMemory,
            tools: toolsWithoutMemory,
            prompt: promptWithoutMemory
          })

          const executorWithoutMemory = new AgentExecutor({
            agent: agentWithoutMemory,
            tools: toolsWithoutMemory,
            maxIterations: 5,
            handleParsingErrors: true
          })

          result = await executorWithoutMemory.invoke({
            input: contextualInput
          })
        } else {
          throw invokeError
        }
      }

      logger.debug('Agent result:', result)

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
      // Format the complete response as markdown
      let formattedResponse = outputText

      // Extract SQL for backwards compatibility
      const sqlMatch = outputText.match(/```sql\n([\s\S]*?)\n```/)
      const sqlQuery = sqlMatch ? sqlMatch[1].trim() : undefined

      // If we have intermediate steps, emit tool events
      if (result.intermediateSteps && Array.isArray(result.intermediateSteps)) {
        for (const step of result.intermediateSteps) {
          if (step && step.action && step.action.tool) {
            // Emit completed tool event
            this.emitToolEvent('ai:toolCall', {
              name: step.action.tool,
              status: 'completed',
              args: step.action.toolInput || {}
            })
          }
        }
      }

      return {
        success: true,
        message: formattedResponse,
        sqlQuery, // For backwards compatibility
        explanation: formattedResponse // Deprecated, use message instead
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
    this.sessions.clear()
  }

  async clearSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId)
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
