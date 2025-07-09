import { LLMManager } from '../llm/manager'
import { SQLGenerationRequest, SQLGenerationResponse, DatabaseSchema } from '../llm/interface'
import { SchemaIntrospector } from './schemaIntrospector'
import { DatabaseManager } from '../database/manager'
import { QueryResult } from '../database/interface'
import { SecureStorage } from '../secureStorage'

// Import database context system to ensure it's loaded
import '../database/context'

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
  private activeConnections: Map<string, string> = new Map() // provider -> llmConnectionId

  constructor(databaseManager: DatabaseManager, secureStorage: SecureStorage) {
    this.databaseManager = databaseManager
    this.schemaIntrospector = new SchemaIntrospector(databaseManager)
    this.llmManager = new LLMManager(secureStorage)
  }

  async processNaturalLanguageQuery(
    request: NaturalLanguageQueryRequest
  ): Promise<NaturalLanguageQueryResponse> {
    try {
      const {
        connectionId,
        naturalLanguageQuery,
        database,
        includeSampleData = true,
        maxSampleRows = 3,
        provider = 'gemini'
      } = request
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
      const schema = await this.schemaIntrospector.getDatabaseSchema(connectionId, database)
      if (!schema) {
        toolCalls[toolCalls.length - 1].status = 'failed'
        return {
          success: false,
          error: 'Failed to retrieve database schema. Please check your connection.',
          toolCalls
        }
      }
      toolCalls[toolCalls.length - 1].status = 'completed'

      // Get sample data if requested
      let sampleData: Record<string, any[]> = {}
      if (includeSampleData) {
        toolCalls.push({
          name: 'Fetch Sample Data',
          description: 'Getting sample data...',
          status: 'running'
        })
        console.log('Getting sample data...')
        const tableNames = schema.tables.map((table) => table.name)
        sampleData = await this.schemaIntrospector.getSampleData(
          connectionId,
          schema.database,
          tableNames,
          maxSampleRows
        )
        toolCalls[toolCalls.length - 1].status = 'completed'
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
      console.log(`Generating SQL query with ${provider}...`)
      const generationRequest: SQLGenerationRequest = {
        naturalLanguageQuery,
        databaseSchema: schema,
        databaseType,
        sampleData: Object.keys(sampleData).length > 0 ? sampleData : undefined,
        conversationContext: request.conversationContext
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

      return {
        success: queryResult.success,
        sqlQuery: generationResponse.sqlQuery,
        explanation: generationResponse.explanation,
        queryResult,
        toolCalls,
        error: queryResult.success ? undefined : queryResult.error || queryResult.message
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
      const {
        connectionId,
        naturalLanguageQuery,
        database,
        includeSampleData = true,
        maxSampleRows = 3,
        provider = 'gemini'
      } = request
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
      const schema = await this.schemaIntrospector.getDatabaseSchema(connectionId, database)
      if (!schema) {
        toolCalls[toolCalls.length - 1].status = 'failed'
        return {
          success: false,
          error: 'Failed to retrieve database schema. Please check your connection.',
          toolCalls
        }
      }
      toolCalls[toolCalls.length - 1].status = 'completed'

      // Get sample data if requested
      let sampleData: Record<string, any[]> = {}
      if (includeSampleData) {
        toolCalls.push({
          name: 'Fetch Sample Data',
          description: 'Getting sample data...',
          status: 'running'
        })
        const tableNames = schema.tables.map((table) => table.name)
        sampleData = await this.schemaIntrospector.getSampleData(
          connectionId,
          schema.database,
          tableNames,
          maxSampleRows
        )
        toolCalls[toolCalls.length - 1].status = 'completed'
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
      const generationRequest: SQLGenerationRequest = {
        naturalLanguageQuery,
        databaseSchema: schema,
        databaseType,
        sampleData: Object.keys(sampleData).length > 0 ? sampleData : undefined,
        conversationContext: request.conversationContext
      }

      const result = await this.llmManager.generateSQL(llmConnectionId, generationRequest)
      toolCalls[toolCalls.length - 1].status = result.success ? 'completed' : 'failed'

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

export { NaturalLanguageQueryProcessor }
export type { NaturalLanguageQueryRequest, NaturalLanguageQueryResponse }
