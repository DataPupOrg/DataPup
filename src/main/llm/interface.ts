export interface LLMConfig {
  provider:
    | 'langchain-openai'
    | 'langchain-claude'
    | 'langchain-gemini'
    | 'langchain-chains-openai'
    | 'langchain-chains-claude'
    | 'langchain-chains-gemini'
  apiKey: string
  model?: string
  temperature?: number
  maxTokens?: number
}

export interface DatabaseSchema {
  database: string
  tables: TableSchema[]
}

export interface TableSchema {
  name: string
  columns: ColumnSchema[]
}

export interface ColumnSchema {
  name: string
  type: string
  nullable?: boolean
  default?: string
}

export interface SQLGenerationRequest {
  naturalLanguageQuery: string
  databaseSchema: DatabaseSchema
  databaseType: string
  sampleData?: Record<string, any[]>
  conversationContext?: string
}

export interface SQLGenerationResponse {
  success: boolean
  sqlQuery?: string
  explanation?: string
  error?: string
}

export interface ValidationRequest {
  sql: string
  databaseType: string
}

export interface ValidationResponse {
  isValid: boolean
  error?: string
}

export interface ToolCall {
  name: string
  description: string
  status: 'running' | 'completed' | 'failed'
  result?: any
  error?: string
}

export interface LLMResponse {
  content: string
  sqlQuery?: string
  explanation?: string
  toolCalls?: ToolCall[]
}

export interface LLMInterface {
  generateSQL(request: SQLGenerationRequest): Promise<SQLGenerationResponse>
  validateQuery(request: ValidationRequest): Promise<ValidationResponse>
  generateExplanation(sql: string, databaseType: string): Promise<string>
  cleanup?(): Promise<void>
}

export interface LLMConnectionInfo {
  provider: string
  model?: string
  isConnected: boolean
  lastUsed?: Date
}
