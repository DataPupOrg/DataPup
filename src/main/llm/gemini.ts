import { GoogleGenerativeAI } from '@google/generative-ai'
import {
  LLMInterface,
  SQLGenerationRequest,
  SQLGenerationResponse,
  ValidationRequest,
  ValidationResponse
} from './interface'
import { BaseLLM } from './base'

export class GeminiLLM extends BaseLLM implements LLMInterface {
  private genAI: GoogleGenerativeAI
  private model: any
  private embeddingModel: any

  constructor(apiKey: string, modelName?: string) {
    super()
    if (!apiKey) {
      throw new Error('Gemini API key is required')
    }

    this.genAI = new GoogleGenerativeAI(apiKey)
    this.model = this.genAI.getGenerativeModel({ model: modelName || 'gemini-1.5-flash' })
    // Initialize the embedding model
    this.embeddingModel = this.genAI.getGenerativeModel({ model: 'text-embedding-004' })
  }

  async generateSQL(request: SQLGenerationRequest): Promise<SQLGenerationResponse> {
    try {
      const prompt = this.buildBasePrompt(request)

      // Log prompt and its length
      this.logPrompt('GEMINI', 'PROMPT', prompt, prompt.length)

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
      const prompt = this.getValidationPrompt(request.databaseType, request.sql)

      // Log validation prompt and its length
      this.logPrompt('GEMINI', 'VALIDATION PROMPT', prompt, prompt.length)

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
      const prompt = this.getExplanationPrompt(databaseType, sql)

      // Log explanation prompt and its length
      this.logPrompt('GEMINI', 'EXPLANATION PROMPT', prompt, prompt.length)

      const result = await this.model.generateContent(prompt)
      const response = await result.response
      return response.text().trim()
    } catch (error) {
      console.error('Error generating explanation:', error)
      throw error
    }
  }

  async embedQuery(text: string): Promise<number[]> {
    try {
      const result = await this.embeddingModel.embedContent(text)
      return result.embedding.values
    } catch (error) {
      console.error('Error generating embedding:', error)
      throw new Error('Failed to generate embedding')
    }
  }

  protected async callSummarizeAPI(prompt: string): Promise<string> {
    try {
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      return response.text().trim()
    } catch (error) {
      console.error('Error generating summary:', error)
      throw new Error('Failed to summarize conversation')
    }
  }

  private parseResponse(response: string): { sql: string; explanation: string } {
    // Extract SQL and explanation from the response
    const sqlMatch = response.match(/SQL:\s*(.*?)(?=\nExplanation:|\n\n|$)/s)
    const explanationMatch = response.match(/Explanation:\s*(.*?)(?=\n\n|$)/s)

    const sql = sqlMatch ? sqlMatch[1].trim() : ''
    const explanation = explanationMatch ? explanationMatch[1].trim() : ''

    return { sql, explanation }
  }
}
