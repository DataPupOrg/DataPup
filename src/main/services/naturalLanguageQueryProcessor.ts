import { LLMManager } from '../llm/manager'
import {
  SQLGenerationRequest,
  SQLGenerationResponse,
  DatabaseSchema,
  ConversationState,
  ConversationContext,
  Message
} from '../llm/interface'
import { SchemaIntrospector } from './schemaIntrospector'
import { DatabaseManager } from '../database/manager'
import { QueryResult } from '../database/interface'
import { SecureStorage } from '../secureStorage'
import { ApiBasedEmbedding } from '../llm/LlamaIndexEmbedding'
import { SchemaVectorService } from './schemaVectorService'
import { ConversationStateManager } from './conversationStateManager'
import { getLastErrorTool } from './tools/errorTools'
import { ToolManager, Tool } from './ToolManager'

interface NaturalLanguageQueryRequest {
  connectionId: string
  naturalLanguageQuery: string
  database?: string
  includeSampleData?: boolean
  maxSampleRows?: number
  conversationContext?: string
  provider?: 'openai' | 'claude' | 'gemini'
}

interface NaturalLanguageQueryResponse {
  success: boolean
  sqlQuery?: string
  explanation?: string
  queryResult?: QueryResult
  error?: string
  toolCalls?: Array<{
    name: string
    description: string
    status: 'running' | 'completed' | 'failed'
  }>
}

class NaturalLanguageQueryProcessor {
  private llmManager: LLMManager
  private schemaIntrospector: SchemaIntrospector
  private databaseManager: DatabaseManager
  private schemaVectorService: SchemaVectorService
  private conversationStateManager: ConversationStateManager
  private activeConnections: Map<string, string> = new Map() // provider -> llmConnectionId
  private conversationStates: Map<string, ConversationState> = new Map() // connectionId -> state
  private toolManager: ToolManager | null = null
  private allTools: Tool[] = [
    {
      name: 'getLastError',
      description: 'Get the last error that occurred',
      handler: withToolLogging('getLastError', (params: { connectionId: string }) =>
        getLastErrorTool(this.conversationStates, params.connectionId)
      )
    },
    {
      name: 'getDatabaseSchema',
      description: 'Get the schema of the current database',
      handler: withToolLogging(
        'getDatabaseSchema',
        (params: { connectionId: string; database?: string }) =>
          this.schemaIntrospector.getDatabaseSchema(params.connectionId, params.database)
      )
    },
    {
      name: 'getSampleRows',
      description: 'Get sample rows from a table',
      handler: withToolLogging(
        'getSampleRows',
        (params: { connectionId: string; database: string; tableName: string; limit?: number }) =>
          this.schemaIntrospector.getSampleData(
            params.connectionId,
            params.database,
            [params.tableName],
            params.limit
          )
      )
    },
    {
      name: 'getRelevantSchema',
      description: 'Get the most relevant schema elements for a query',
      handler: withToolLogging(
        'getRelevantSchema',
        (params: {
          query: string
          fullSchema: any
          sampleData?: any
          topK?: number
          similarityThreshold?: number
        }) =>
          this.schemaVectorService.getRelevantSchema(
            params.query,
            params.fullSchema,
            params.sampleData,
            params.topK,
            params.similarityThreshold
          )
      )
    },
    // New tools below
    {
      name: 'listDatabases',
      description: 'List all databases',
      handler: withToolLogging('listDatabases', (params: { connectionId: string }) =>
        listDatabasesTool(this.databaseManager, params.connectionId)
      )
    },
    {
      name: 'listTables',
      description: 'List all tables in a database',
      handler: withToolLogging('listTables', (params: { connectionId: string; database: string }) =>
        listTablesTool(this.databaseManager, params.connectionId, params.database)
      )
    },
    {
      name: 'getTableSchema',
      description: 'Get schema for a specific table',
      handler: withToolLogging(
        'getTableSchema',
        (params: { connectionId: string; tableName: string; database?: string }) =>
          getTableSchemaTool(
            this.databaseManager,
            params.connectionId,
            params.tableName,
            params.database
          )
      )
    },
    {
      name: 'executeQuery',
      description: 'Execute a SQL query',
      handler: withToolLogging('executeQuery', (params: { connectionId: string; sql: string }) =>
        executeQueryTool(this.databaseManager, params.connectionId, params.sql)
      )
    },
    {
      name: 'searchTables',
      description: 'Search tables by name',
      handler: withToolLogging(
        'searchTables',
        (params: { connectionId: string; database: string; search: string }) =>
          searchTablesTool(
            this.schemaIntrospector,
            params.connectionId,
            params.database,
            params.search
          )
      )
    },
    {
      name: 'searchColumns',
      description: 'Search columns by name',
      handler: withToolLogging(
        'searchColumns',
        (params: { connectionId: string; database: string; search: string }) =>
          searchColumnsTool(
            this.schemaIntrospector,
            params.connectionId,
            params.database,
            params.search
          )
      )
    },
    {
      name: 'summarizeSchema',
      description: 'Summarize the database schema',
      handler: withToolLogging('summarizeSchema', (params: { schema: any }) =>
        summarizeSchemaTool(params.schema)
      )
    },
    {
      name: 'summarizeTable',
      description: 'Summarize a table schema',
      handler: withToolLogging('summarizeTable', (params: { tableSchema: any }) =>
        summarizeTableTool(params.tableSchema)
      )
    },
    {
      name: 'profileTable',
      description: 'Profile a table using sample data',
      handler: withToolLogging('profileTable', (params: { sampleData: any[] }) =>
        profileTableTool(params.sampleData)
      )
    },
    {
      name: 'getConversationContext',
      description: 'Get the current conversation context',
      handler: withToolLogging('getConversationContext', (params: { connectionId: string }) =>
        getConversationContextTool(this.conversationStates, params.connectionId)
      )
    },
    {
      name: 'setConversationContext',
      description: 'Set the conversation context',
      handler: withToolLogging(
        'setConversationContext',
        (params: { connectionId: string; context: any }) =>
          setConversationContextTool(this.conversationStates, params.connectionId, params.context)
      )
    },
    {
      name: 'getDocumentation',
      description: 'Get documentation or help',
      handler: withToolLogging('getDocumentation', () => getDocumentationTool())
    }
  ]
  private conversationHistory: Map<string, ConversationContext> = new Map()

  constructor(databaseManager: DatabaseManager, secureStorage: SecureStorage) {
    this.databaseManager = databaseManager
    this.schemaIntrospector = new SchemaIntrospector(databaseManager)
    this.schemaVectorService = new SchemaVectorService()
    this.llmManager = new LLMManager(secureStorage)
    this.conversationStateManager = new ConversationStateManager(this.llmManager)
    // ToolManager will be initialized after LLM connection is established
  }

  async processNaturalLanguageQuery(
    request: NaturalLanguageQueryRequest
  ): Promise<NaturalLanguageQueryResponse> {
    try {
      console.log('DEBUG: Received request with provider:', request.provider)
      const {
        connectionId,
        naturalLanguageQuery,
        database,
        includeSampleData = true,
        maxSampleRows = 2,
        provider = 'gemini'
      } = request

      // Validate provider
      const validProviders = ['gemini', 'openai', 'claude']
      if (provider && !validProviders.includes(provider)) {
        console.error('DEBUG: Invalid provider received:', provider)
        return {
          success: false,
          error: `Invalid provider: ${provider}. Supported providers: ${validProviders.join(', ')}`
        }
      }
      const toolCalls: Array<{
        name: string
        description: string
        status: 'running' | 'completed' | 'failed'
      }> = []

      // Check if connection is active
      if (!this.databaseManager.isConnected(connectionId)) {
        return {
          success: false,
          error: 'Database connection is not active. Please reconnect and try again.'
        }
      }

      // Get or create LLM connection
      let llmConnectionId = this.activeConnections.get(provider)
      if (!llmConnectionId || !this.llmManager.isConnected(llmConnectionId)) {
        toolCalls.push({
          name: 'Connect to LLM',
          description: `Connecting to ${provider}...`,
          status: 'running'
        })
        const connectResult = await this.llmManager.connect(provider)
        if (!connectResult.success || !connectResult.connectionId) {
          toolCalls[toolCalls.length - 1].status = 'failed'
          return {
            success: false,
            error: connectResult.error || 'Failed to connect to LLM provider',
            toolCalls
          }
        }
        llmConnectionId = connectResult.connectionId
        this.activeConnections.set(provider, llmConnectionId)
        toolCalls[toolCalls.length - 1].status = 'completed'
      }

      // Get database schema
      toolCalls.push({
        name: 'Fetch Schema',
        description: 'Getting database schema...',
        status: 'running'
      })
      console.log('Getting database schema...')
      const fullSchema = await this.schemaIntrospector.getDatabaseSchema(connectionId, database)
      if (!fullSchema) {
        toolCalls[toolCalls.length - 1].status = 'failed'
        return {
          success: false,
          error: 'Failed to retrieve database schema. Please check your connection.',
          toolCalls
        }
      }
      console.log(
        'DEBUG: Available tables:',
        fullSchema.tables.map((t: any) => t.name)
      )

      // Check if database is empty
      if (fullSchema.tables.length === 0) {
        toolCalls[toolCalls.length - 1].status = 'failed'
        return {
          success: false,
          error:
            'No tables found in the database. Please create some tables first or connect to a database with data.',
          toolCalls
        }
      }

      // Get sample data if requested
      let fullSampleData: Record<string, any[]> = {}
      if (includeSampleData) {
        toolCalls.push({
          name: 'Fetch Sample Data',
          description: 'Getting sample data...',
          status: 'running'
        })
        console.log('Getting sample data...')
        const tableNames = fullSchema.tables.map((table: any) => table.name)
        fullSampleData = await this.schemaIntrospector.getSampleData(
          connectionId,
          fullSchema.database,
          tableNames,
          maxSampleRows
        )
        toolCalls[toolCalls.length - 1].status = 'completed'
      }

      // Use SchemaVectorService to prune schema and sample data
      toolCalls.push({
        name: 'Prune Schema',
        description: 'Using AI to identify relevant tables and columns...',
        status: 'running'
      })
      console.log('🔍 Using SchemaVectorService to prune schema...')
      const prunedResult = await this.schemaVectorService.getRelevantSchema(
        naturalLanguageQuery,
        fullSchema,
        fullSampleData
      )
      const schema = prunedResult.schema
      const sampleData = prunedResult.sampleData
      toolCalls[toolCalls.length - 1].status = 'completed'

      // Intercept: If pruned schema is empty, trigger a searchTables tool call or direct answer
      if (!schema.tables || schema.tables.length === 0) {
        // Try to extract a table name from the user's query (simple heuristic: last word after 'from' or 'table')
        const match = /(?:from|table)\s+(\w+)/i.exec(naturalLanguageQuery)
        const searchTerm = match ? match[1] : naturalLanguageQuery.split(' ').slice(-1)[0]
        toolCalls.push({
          name: 'searchTables',
          description: `Searching for tables matching '${searchTerm}'...`,
          status: 'running'
        })
        return {
          success: false,
          error: `No relevant tables found for your request. Searching for tables matching '${searchTerm}'.`,
          toolCalls: [
            ...toolCalls,
            {
              name: 'searchTables',
              description: `TOOL_CALL: searchTables(database="${database || fullSchema.database}", keyword="${searchTerm}")`,
              status: 'completed'
            }
          ]
        }
      }

      // Get database type from connection info
      const connectionInfo = this.databaseManager.getConnectionInfo(connectionId)
      const databaseType = connectionInfo
        ? this.getDatabaseTypeFromConnection(connectionInfo)
        : 'clickhouse'

      // Set up API-based embedding using the active LLM
      toolCalls.push({
        name: 'Setup Embedding Model',
        description: `Setting up ${provider} embedding model...`,
        status: 'running'
      })
      const llmInstance = this.llmManager.getLlmInstance(llmConnectionId)
      if (!llmInstance) {
        toolCalls[toolCalls.length - 1].status = 'failed'
        return {
          success: false,
          error: 'LLM not connected',
          toolCalls
        }
      }
      // Initialize ToolManager if not already done
      if (!this.toolManager) {
        this.toolManager = new ToolManager(this.allTools, llmInstance)
      }
      // Use ToolManager to select relevant tools for the user query
      const selectedTools = await this.toolManager.selectTools(naturalLanguageQuery)
      console.log(
        'Selected tools for this query:',
        selectedTools.map((t) => t.name)
      )
      toolCalls[toolCalls.length - 1].status = 'completed'

      // Generate SQL query using LLM
      toolCalls.push({
        name: 'Generate SQL',
        description: `Generating SQL with ${provider}...`,
        status: 'running'
      })
      console.log(`Generating SQL query with ${provider}...`)

      // Get current conversation state for this connection
      const currentState = this.conversationStates.get(connectionId) || null

      // Format conversation context using structured state
      const conversationContext = currentState
        ? this.conversationStateManager.formatStateForPrompt(currentState)
        : undefined

      const generationRequest: SQLGenerationRequest = {
        naturalLanguageQuery: request.naturalLanguageQuery,
        databaseSchema: schema,
        databaseType,
        sampleData,
        conversationContext: this.conversationHistory.get(request.connectionId)
      }

      const generationResponse = await this.llmManager.generateSQL(
        llmConnectionId,
        generationRequest
      )

      if (!generationResponse.success || !generationResponse.sqlQuery) {
        toolCalls[toolCalls.length - 1].status = 'failed'
        return {
          success: false,
          error: generationResponse.error || 'Failed to generate SQL query',
          toolCalls
        }
      }
      toolCalls[toolCalls.length - 1].status = 'completed'

      // Execute the generated SQL query
      toolCalls.push({
        name: 'Execute Query',
        description: 'Executing SQL query...',
        status: 'running'
      })
      console.log('Executing generated SQL query...')
      const queryResult = await this.databaseManager.query(
        connectionId,
        generationResponse.sqlQuery
      )
      toolCalls[toolCalls.length - 1].status = queryResult.success ? 'completed' : 'failed'

      // Update conversation state after successful SQL generation
      if (queryResult.success && generationResponse.sqlQuery) {
        try {
          const updatedState = await this.conversationStateManager.updateConversationState({
            previousState: this.conversationStates.get(connectionId) || null,
            userQuery: naturalLanguageQuery,
            generatedSQL: generationResponse.sqlQuery,
            databaseType
          })
          // Always update lastError in the state
          updatedState.lastError = queryResult.error || undefined
          this.conversationStates.set(connectionId, updatedState)
          console.log('✅ Updated conversation state:', updatedState)
        } catch (error) {
          console.warn('⚠️ Failed to update conversation state:', error)
        }
      } else if (!queryResult.success && queryResult.error) {
        // If the query failed, update the lastError in the state
        const prevState = this.conversationStates.get(connectionId) || {
          tablesInFocus: [],
          filtersApplied: [],
          groupByColumns: [],
          orderBy: [],
          lastUserQuery: naturalLanguageQuery,
          summary: ''
        }
        this.conversationStates.set(connectionId, {
          ...prevState,
          lastError: queryResult.error
        })
      }

      await this.manageConversationHistory(
        request.connectionId,
        llmConnectionId,
        request.naturalLanguageQuery,
        generationResponse
      )

      return {
        success: true,
        sqlQuery: generationResponse.sqlQuery,
        explanation: generationResponse.explanation,
        queryResult,
        toolCalls
      }
    } catch (error) {
      console.error('Error processing natural language query:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  async generateSQLOnly(request: NaturalLanguageQueryRequest): Promise<
    SQLGenerationResponse & {
      toolCalls?: Array<{
        name: string
        description: string
        status: 'running' | 'completed' | 'failed'
      }>
    }
  > {
    try {
      console.log('DEBUG: generateSQLOnly received request with provider:', request.provider)
      const {
        connectionId,
        naturalLanguageQuery,
        database,
        includeSampleData = true,
        maxSampleRows = 2,
        provider = 'gemini'
      } = request

      // Validate provider
      const validProviders = ['gemini', 'openai', 'claude']
      if (provider && !validProviders.includes(provider)) {
        console.error('DEBUG: Invalid provider received in generateSQLOnly:', provider)
        return {
          success: false,
          error: `Invalid provider: ${provider}. Supported providers: ${validProviders.join(', ')}`
        }
      }
      const toolCalls: Array<{
        name: string
        description: string
        status: 'running' | 'completed' | 'failed'
      }> = []

      // Check if connection is active
      if (!this.databaseManager.isConnected(connectionId)) {
        return {
          success: false,
          error: 'Database connection is not active. Please reconnect and try again.',
          toolCalls
        }
      }

      // Get or create LLM connection
      let llmConnectionId = this.activeConnections.get(provider)
      if (!llmConnectionId || !this.llmManager.isConnected(llmConnectionId)) {
        toolCalls.push({
          name: 'Connect to LLM',
          description: `Connecting to ${provider}...`,
          status: 'running'
        })
        const connectResult = await this.llmManager.connect(provider)
        if (!connectResult.success || !connectResult.connectionId) {
          toolCalls[toolCalls.length - 1].status = 'failed'
          return {
            success: false,
            error: connectResult.error || 'Failed to connect to LLM provider',
            toolCalls
          }
        }
        llmConnectionId = connectResult.connectionId
        this.activeConnections.set(provider, llmConnectionId)
        toolCalls[toolCalls.length - 1].status = 'completed'
      }

      // Get database schema
      toolCalls.push({
        name: 'Fetch Schema',
        description: 'Getting database schema...',
        status: 'running'
      })
      const fullSchema = await this.schemaIntrospector.getDatabaseSchema(connectionId, database)
      if (!fullSchema) {
        toolCalls[toolCalls.length - 1].status = 'failed'
        return {
          success: false,
          error: 'Failed to retrieve database schema. Please check your connection.',
          toolCalls
        }
      }
      toolCalls[toolCalls.length - 1].status = 'completed'

      // Get sample data if requested
      let fullSampleData: Record<string, any[]> = {}
      if (includeSampleData) {
        toolCalls.push({
          name: 'Fetch Sample Data',
          description: 'Getting sample data...',
          status: 'running'
        })
        const tableNames = fullSchema.tables.map((table: any) => table.name)
        fullSampleData = await this.schemaIntrospector.getSampleData(
          connectionId,
          fullSchema.database,
          tableNames,
          maxSampleRows
        )
        toolCalls[toolCalls.length - 1].status = 'completed'
      }

      // Use SchemaVectorService to prune schema and sample data
      toolCalls.push({
        name: 'Prune Schema',
        description: 'Using AI to identify relevant tables and columns...',
        status: 'running'
      })
      console.log('🔍 Using SchemaVectorService to prune schema...')
      const prunedResult = await this.schemaVectorService.getRelevantSchema(
        naturalLanguageQuery,
        fullSchema,
        fullSampleData
      )
      const schema = prunedResult.schema
      const sampleData = prunedResult.sampleData
      toolCalls[toolCalls.length - 1].status = 'completed'

      // Intercept: If pruned schema is empty, trigger a searchTables tool call or direct answer
      if (!schema.tables || schema.tables.length === 0) {
        // Try to extract a table name from the user's query (simple heuristic: last word after 'from' or 'table')
        const match = /(?:from|table)\s+(\w+)/i.exec(naturalLanguageQuery)
        const searchTerm = match ? match[1] : naturalLanguageQuery.split(' ').slice(-1)[0]
        toolCalls.push({
          name: 'searchTables',
          description: `Searching for tables matching '${searchTerm}'...`,
          status: 'running'
        })
        return {
          success: false,
          error: `No relevant tables found for your request. Searching for tables matching '${searchTerm}'.`,
          toolCalls: [
            ...toolCalls,
            {
              name: 'searchTables',
              description: `TOOL_CALL: searchTables(database="${database || fullSchema.database}", keyword="${searchTerm}")`,
              status: 'completed'
            }
          ]
        }
      }

      // Get database type from connection info
      const connectionInfo = this.databaseManager.getConnectionInfo(connectionId)
      const databaseType = connectionInfo
        ? this.getDatabaseTypeFromConnection(connectionInfo)
        : 'clickhouse'

      // Generate SQL query using LLM
      toolCalls.push({
        name: 'Generate SQL',
        description: `Generating SQL with ${provider}...`,
        status: 'running'
      })
      // Get current conversation state for this connection
      const currentState = this.conversationStates.get(connectionId) || null

      // Format conversation context using structured state
      const conversationContext = currentState
        ? this.conversationStateManager.formatStateForPrompt(currentState)
        : undefined

      const generationRequest: SQLGenerationRequest = {
        naturalLanguageQuery,
        databaseSchema: schema,
        databaseType,
        sampleData: Object.keys(sampleData).length > 0 ? sampleData : undefined,
        conversationContext
      }

      const result = await this.llmManager.generateSQL(llmConnectionId, generationRequest)
      toolCalls[toolCalls.length - 1].status = result.success ? 'completed' : 'failed'

      // Update conversation state after successful SQL generation
      if (result.success && result.sqlQuery) {
        try {
          const updatedState = await this.conversationStateManager.updateConversationState({
            previousState: this.conversationStates.get(connectionId) || null,
            userQuery: naturalLanguageQuery,
            generatedSQL: result.sqlQuery,
            databaseType
          })
          this.conversationStates.set(connectionId, updatedState)
          console.log('✅ Updated conversation state:', updatedState)
        } catch (error) {
          console.warn('⚠️ Failed to update conversation state:', error)
        }
      }

      return { ...result, toolCalls }
    } catch (error) {
      console.error('Error generating SQL only:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  async getDatabaseSchema(connectionId: string, database?: string): Promise<DatabaseSchema | null> {
    return await this.schemaIntrospector.getDatabaseSchema(connectionId, database)
  }

  async validateGeneratedQuery(
    sql: string,
    connectionId: string,
    provider: 'openai' | 'claude' | 'gemini' = 'gemini'
  ): Promise<{ isValid: boolean; error?: string }> {
    try {
      const connectionInfo = this.databaseManager.getConnectionInfo(connectionId)
      const databaseType = connectionInfo
        ? this.getDatabaseTypeFromConnection(connectionInfo)
        : 'clickhouse'

      // Get or create LLM connection
      let llmConnectionId = this.activeConnections.get(provider)
      if (!llmConnectionId || !this.llmManager.isConnected(llmConnectionId)) {
        const connectResult = await this.llmManager.connect(provider)
        if (!connectResult.success || !connectResult.connectionId) {
          return { isValid: false, error: 'Failed to connect to LLM provider' }
        }
        llmConnectionId = connectResult.connectionId
        this.activeConnections.set(provider, llmConnectionId)
      }

      return await this.llmManager.validateQuery(llmConnectionId, { sql, databaseType })
    } catch (error) {
      console.error('Error validating query:', error)
      return { isValid: false, error: 'Failed to validate query' }
    }
  }

  /**
   * Dispatch a tool call from the LLM agent
   */
  async dispatchToolCall(
    toolName: string,
    params: { connectionId: string; [key: string]: any }
  ): Promise<any> {
    switch (toolName) {
      case 'getLastError':
        return await getLastErrorTool(this.conversationStates, params.connectionId)
      // Add more tools here as needed
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  // Add this method to allow tool lookup by name
  public getToolByName(name: string): ((args: any) => Promise<any>) | undefined {
    const tool = this.allTools.find((t) => t.name === name)
    return tool ? tool.handler : undefined
  }

  private async manageConversationHistory(
    connectionId: string,
    llmConnectionId: string,
    userQuery: string,
    assistantResponse: SQLGenerationResponse
  ): Promise<void> {
    let context = this.conversationHistory.get(connectionId)
    if (!context) {
      context = { summary: '', messages: [] }
    }
    context.messages.push({ role: 'user', content: userQuery })
    const assistantContent = assistantResponse.sqlQuery
      ? `SQL: ${assistantResponse.sqlQuery}\nExplanation: ${assistantResponse.explanation}`
      : assistantResponse.error || 'I could not process the request.'
    context.messages.push({ role: 'assistant', content: assistantContent })
    const MAX_MESSAGES = 6
    if (context.messages.length >= MAX_MESSAGES) {
      const messagesToSummarize = context.messages.slice(0, -2)
      const textToSummarize = messagesToSummarize.map((m) => `${m.role}: ${m.content}`).join('\n')
      const newSummary = await this.llmManager.summarize(
        llmConnectionId,
        `${context.summary}\n${textToSummarize}`
      )
      context.summary = newSummary
      context.messages = context.messages.slice(-2)
    }
    this.conversationHistory.set(connectionId, context)
  }

  private getDatabaseTypeFromConnection(connectionInfo: {
    host: string
    port: number
    database: string
  }): string {
    // For now, we only support ClickHouse, but this can be extended
    // In the future, we could store the database type in the connection info
    return 'clickhouse'
  }

  formatSchemaForDisplay(schema: DatabaseSchema): string {
    return this.schemaIntrospector.formatSchemaForDisplay(schema)
  }

  async cleanup(): Promise<void> {
    await this.llmManager.cleanup()
  }
}

// Utility to wrap a tool handler with logging
function withToolLogging(toolName: string, handler: (...args: any[]) => Promise<any>) {
  return async function (...args: any[]) {
    const params = args[0]
    console.log(
      `[TOOL LOG] Tool used: ${toolName} | Params:`,
      params,
      '| Timestamp:',
      new Date().toISOString()
    )
    return handler(...args)
  }
}

// TOOL IMPLEMENTATIONS START

// List all databases
async function listDatabasesTool(
  databaseManager: DatabaseManager,
  connectionId: string
): Promise<string[]> {
  const result = await databaseManager.getDatabases(connectionId)
  if (result.success && result.databases) return result.databases
  throw new Error(result.message || 'Failed to list databases')
}

// List all tables in a database
async function listTablesTool(
  databaseManager: DatabaseManager,
  connectionId: string,
  database: string
): Promise<string[]> {
  const result = await databaseManager.getTables(connectionId, database)
  if (result.success && result.tables) return result.tables
  throw new Error(result.message || 'Failed to list tables')
}

// Get schema for a specific table
async function getTableSchemaTool(
  databaseManager: DatabaseManager,
  connectionId: string,
  tableName: string,
  database?: string
): Promise<any> {
  const result = await databaseManager.getTableSchema(connectionId, tableName, database)
  if (result.success && result.schema) return result.schema
  throw new Error(result.message || 'Failed to get table schema')
}

// Execute a SQL query
async function executeQueryTool(
  databaseManager: DatabaseManager,
  connectionId: string,
  sql: string
): Promise<any> {
  const result = await databaseManager.query(connectionId, sql)
  if (result.success) return result.data
  throw new Error(result.error || 'Failed to execute query')
}

// Search tables by name
async function searchTablesTool(
  schemaIntrospector: SchemaIntrospector,
  connectionId: string,
  database: string,
  search: string
): Promise<string[]> {
  const tables = await schemaIntrospector.getRelevantTables(connectionId, database, search)
  return tables
}

// Search columns by name
async function searchColumnsTool(
  schemaIntrospector: SchemaIntrospector,
  connectionId: string,
  database: string,
  search: string
): Promise<any[]> {
  // Get the schema for the database
  const schema = await schemaIntrospector.getDatabaseSchema(connectionId, database)
  if (!schema) return []
  const matches: Array<{ table: string; column: string; type: string }> = []
  for (const table of schema.tables) {
    for (const column of table.columns) {
      if (column.name.toLowerCase().includes(search.toLowerCase())) {
        matches.push({ table: table.name, column: column.name, type: column.type })
      }
    }
  }
  return matches
}

// Summarize the database schema
async function summarizeSchemaTool(schema: any): Promise<string> {
  if (!schema || !schema.tables) return 'No schema information available.'
  let summary = `Database: ${schema.database}\nTables: ${schema.tables.length}\n`
  for (const table of schema.tables) {
    summary += `- ${table.name} (${table.columns.length} columns)\n`
  }
  return summary
}

// Summarize a table schema
async function summarizeTableTool(tableSchema: any): Promise<string> {
  if (!tableSchema || !tableSchema.name || !tableSchema.columns)
    return 'No table schema information available.'
  let summary = `Table: ${tableSchema.name}\nColumns:\n`
  for (const column of tableSchema.columns) {
    summary += `- ${column.name}: ${column.type}`
    if (column.nullable !== undefined) summary += column.nullable ? ' (nullable)' : ' (not null)'
    if (column.default !== undefined) summary += ` [default: ${column.default}]`
    summary += '\n'
  }
  return summary
}

// Profile a table using sample data
async function profileTableTool(sampleData: any[]): Promise<string> {
  if (!sampleData || sampleData.length === 0) return 'No sample data available.'
  const columns = Object.keys(sampleData[0])
  let summary = `Sample Data Profile (first ${sampleData.length} rows):\n`
  for (const col of columns) {
    const values = sampleData.map((row) => row[col])
    const unique = new Set(values)
    summary += `- ${col}: ${unique.size} unique values, type: ${typeof values[0]}\n`
  }
  return summary
}

// Get conversation context
async function getConversationContextTool(
  conversationStates: Map<string, ConversationState>,
  connectionId: string
): Promise<any> {
  return conversationStates.get(connectionId) || {}
}

// Set conversation context
async function setConversationContextTool(
  conversationStates: Map<string, ConversationState>,
  connectionId: string,
  context: any
): Promise<string> {
  conversationStates.set(connectionId, context)
  return 'Conversation context updated.'
}

// Get documentation/help
async function getDocumentationTool(): Promise<string> {
  return `Available Tools:\n\n- getLastError: Get the last error that occurred\n- getDatabaseSchema: Get the schema of the current database\n- getSampleRows: Get sample rows from a table\n- getRelevantSchema: Get the most relevant schema elements for a query\n- listDatabases: List all databases\n- listTables: List all tables in a database\n- getTableSchema: Get schema for a specific table\n- executeQuery: Execute a SQL query\n- searchTables: Search tables by name\n- searchColumns: Search columns by name\n- summarizeSchema: Summarize the database schema\n- summarizeTable: Summarize a table schema\n- profileTable: Profile a table using sample data\n- getConversationContext: Get the current conversation context\n- setConversationContext: Set the conversation context\n- getDocumentation: Get documentation or help`
}
// TOOL IMPLEMENTATIONS END

export { NaturalLanguageQueryProcessor }
export type { NaturalLanguageQueryRequest, NaturalLanguageQueryResponse }
