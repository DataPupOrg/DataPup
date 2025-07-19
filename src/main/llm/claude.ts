import {
  LLMInterface,
  SQLGenerationRequest,
  SQLGenerationResponse,
  ValidationRequest,
  ValidationResponse
} from './interface'
import { BaseLLM } from './base'
import { logger } from '../utils/logger'

interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ClaudeResponse {
  content: Array<{
    type: 'text'
    text: string
  }>
}

export class ClaudeLLM extends BaseLLM implements LLMInterface {
  private apiKey: string
  private model: string
  private apiUrl = 'https://api.anthropic.com/v1/messages'

  constructor(apiKey: string, model?: string) {
    super()
    if (!apiKey) {
      throw new Error('Claude API key is required')
    }

    this.apiKey = apiKey
    this.model = model || 'claude-3-5-sonnet-20241022'
  }

  async generateSQL(request: SQLGenerationRequest): Promise<SQLGenerationResponse> {
    try {
      const { systemPrompt, userMessage } = this.buildPromptMessages(request)

      // Log prompts and their lengths
      const totalLength = systemPrompt.length + userMessage.length
      this.logPrompt(
        'CLAUDE',
        'PROMPTS',
        `System: ${systemPrompt}\n\nUser: ${userMessage}`,
        totalLength
      )

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1000,
          temperature: 0.1,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: userMessage
            }
          ]
        })
      })

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`)
      }

      const data: ClaudeResponse = await response.json()
      const text = data.content[0]?.text?.trim() || ''

      // Parse tool calls first
      const toolCalls = this.parseToolCalls(text)

      // Parse the response to extract SQL and explanation
      const parsed = this.parseResponse(text)

      return {
        success: true,
        sqlQuery: parsed.sql,
        explanation: parsed.explanation,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined
      }
    } catch (error) {
      logger.error('Error generating SQL query:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  async validateQuery(request: ValidationRequest): Promise<ValidationResponse> {
    try {
      const prompt = this.getValidationPrompt(request.databaseType, request.sql)

      const systemPrompt =
        'You are a SQL validator. Return only "VALID" if the query is syntactically correct, or a brief error message if not.'
      const userMessage = prompt

      // Log validation prompts and their lengths
      const totalLength = systemPrompt.length + userMessage.length
      this.logPrompt(
        'CLAUDE',
        'VALIDATION PROMPTS',
        `System: ${systemPrompt}\n\nUser: ${userMessage}`,
        totalLength
      )

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 100,
          temperature: 0,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: userMessage
            }
          ]
        })
      })

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`)
      }

      const data: ClaudeResponse = await response.json()
      const text = data.content[0]?.text?.trim() || ''

      if (text.toUpperCase() === 'VALID') {
        return { isValid: true }
      } else {
        return { isValid: false, error: text }
      }
    } catch (error) {
      logger.error('Error validating query:', error)
      return { isValid: false, error: 'Failed to validate query' }
    }
  }

  async generateExplanation(sql: string, databaseType: string): Promise<string> {
    try {
      const prompt = this.getExplanationPrompt(databaseType, sql)

      const systemPrompt = 'You are a SQL expert. Explain SQL queries in simple, clear terms.'
      const userMessage = prompt

      // Log explanation prompts and their lengths
      const totalLength = systemPrompt.length + userMessage.length
      this.logPrompt(
        'CLAUDE',
        'EXPLANATION PROMPTS',
        `System: ${systemPrompt}\n\nUser: ${userMessage}`,
        totalLength
      )

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 200,
          temperature: 0.3,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: userMessage
            }
          ]
        })
      })

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`)
      }

      const data: ClaudeResponse = await response.json()
      return data.content[0]?.text?.trim() || 'Unable to generate explanation'
    } catch (error) {
      logger.error('Error generating explanation:', error)
      throw error
    }
  }

  async embedQuery(text: string): Promise<number[]> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'text-embedding-v3',
          input: text
        })
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Claude API error: ${response.status} - ${error}`)
      }

      const data = await response.json()
      return data.data[0].embedding
    } catch (error) {
      console.error('Error generating embedding:', error)
      throw new Error('Failed to generate embedding')
    }
  }

  private buildPromptMessages(request: SQLGenerationRequest): {
    systemPrompt: string
    userMessage: string
  } {
    const basePrompt = this.buildBasePrompt(request)

    // Split the base prompt into system and user parts for Claude
    const systemPrompt = `You are Claude, a SQL expert. Follow the instructions carefully and respond in the exact format requested.`
    const userMessage = basePrompt

    return { systemPrompt, userMessage }
  }

  private parseResponse(response: string): { sql: string; explanation: string } {
    // Use the base class method to extract SQL and explanation
    return this.extractSqlAndExplanation(response)
  }
}
