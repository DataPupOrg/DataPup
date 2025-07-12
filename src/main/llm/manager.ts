import {
  LLMInterface,
  LLMConfig,
  LLMConnectionInfo,
  SQLGenerationRequest,
  SQLGenerationResponse,
  ValidationRequest,
  ValidationResponse,
  AIRequest,
  AIResponse
} from './interface'
import { LLMFactory } from './factory'
import { SecureStorage } from '../secureStorage'

export class LLMManager {
  private connections: Map<string, { llm: LLMInterface; config: LLMConfig; lastUsed: Date }> =
    new Map()
  private secureStorage: SecureStorage

  constructor(secureStorage: SecureStorage) {
    this.secureStorage = secureStorage
  }

  async connect(
    provider: 'openai' | 'claude' | 'gemini',
    apiKey?: string
  ): Promise<{ success: boolean; connectionId?: string; error?: string }> {
    try {
      // Use provided API key or fetch from secure storage
      const key = apiKey || this.secureStorage.get(`ai-api-key-${provider}`)
      if (!key) {
        return {
          success: false,
          error: `No API key found for ${provider}. Please provide an API key.`
        }
      }

      const config: LLMConfig = {
        provider,
        apiKey: key
      }

      // Create LLM instance
      const llm = LLMFactory.create(config)

      // Generate connection ID
      const connectionId = `${provider}_${Date.now()}`

      // Store connection
      this.connections.set(connectionId, {
        llm,
        config,
        lastUsed: new Date()
      })

      return {
        success: true,
        connectionId
      }
    } catch (error) {
      console.error(`Failed to connect to ${provider}:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  async disconnect(connectionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const connection = this.connections.get(connectionId)
      if (!connection) {
        return {
          success: false,
          error: 'Connection not found'
        }
      }

      // Cleanup if the LLM has a cleanup method
      if (connection.llm.cleanup) {
        await connection.llm.cleanup()
      }

      this.connections.delete(connectionId)
      return { success: true }
    } catch (error) {
      console.error('Failed to disconnect:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  async generateSQL(
    connectionId: string,
    request: SQLGenerationRequest
  ): Promise<SQLGenerationResponse> {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      return {
        success: false,
        error: 'LLM connection not found'
      }
    }

    return await connection.llm.generateSQL(request)
  }

  async processAIRequest(connectionId: string, request: AIRequest): Promise<AIResponse> {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      return {
        success: false,
        type: 'sql_generation',
        content: '',
        error: 'LLM connection not found'
      }
    }

    return await connection.llm.processAIRequest(request)
  }

  async validateQuery(
    connectionId: string,
    request: ValidationRequest
  ): Promise<ValidationResponse> {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      return {
        isValid: false,
        error: 'Connection not found. Please reconnect to the LLM provider.'
      }
    }

    // Update last used timestamp
    connection.lastUsed = new Date()

    try {
      return await connection.llm.validateQuery(request)
    } catch (error) {
      console.error('Failed to validate query:', error)
      return {
        isValid: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  async generateExplanation(
    connectionId: string,
    sql: string,
    databaseType: string
  ): Promise<string> {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      throw new Error('Connection not found. Please reconnect to the LLM provider.')
    }

    // Update last used timestamp
    connection.lastUsed = new Date()

    return await connection.llm.generateExplanation(sql, databaseType)
  }

  getConnectionInfo(connectionId: string): LLMConnectionInfo | null {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      return null
    }

    return {
      provider: connection.config.provider,
      model: connection.config.model,
      isConnected: true,
      lastUsed: connection.lastUsed
    }
  }

  getAllConnections(): Record<string, LLMConnectionInfo> {
    const connections: Record<string, LLMConnectionInfo> = {}

    for (const [id, connection] of this.connections) {
      connections[id] = {
        provider: connection.config.provider,
        model: connection.config.model,
        isConnected: true,
        lastUsed: connection.lastUsed
      }
    }

    return connections
  }

  isConnected(connectionId: string): boolean {
    return this.connections.has(connectionId)
  }

  async cleanup(): Promise<void> {
    // Disconnect all connections
    for (const connectionId of this.connections.keys()) {
      await this.disconnect(connectionId)
    }
  }
}
