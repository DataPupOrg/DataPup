export interface LLMConfig {
  provider: 'openai' | 'claude' | 'gemini'
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

// New interfaces for enhanced AI functionality
export interface ErrorAnalysisRequest {
  sqlQuery: string
  errorMessage: string
  databaseSchema: DatabaseSchema
  databaseType: string
  conversationContext?: string
}

export interface ErrorAnalysisResponse {
  success: boolean
  analysis?: string
  suggestedFix?: string
  correctedQuery?: string
  error?: string
}

export interface AIRequestType {
  type: 'generate_sql' | 'analyze_error' | 'explain_query' | 'suggest_improvement'
  content: string
  context?: any
}

export interface AIRequest {
  requestType: AIRequestType
  naturalLanguageQuery?: string
  sqlQuery?: string
  errorMessage?: string
  databaseSchema: DatabaseSchema
  databaseType: string
  sampleData?: Record<string, any[]>
  conversationContext?: string
}

export interface AIResponse {
  success: boolean
  type: 'sql_generation' | 'error_analysis' | 'query_explanation' | 'improvement_suggestion'
  content: string
  sqlQuery?: string
  correctedQuery?: string
  explanation?: string
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
  analyzeError(request: ErrorAnalysisRequest): Promise<ErrorAnalysisResponse>
  processAIRequest(request: AIRequest): Promise<AIResponse>
  cleanup?(): Promise<void>
}

export interface LLMConnectionInfo {
  provider: string
  model?: string
  isConnected: boolean
  lastUsed?: Date
}
