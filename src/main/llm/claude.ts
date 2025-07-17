import {
  LLMInterface,
  SQLGenerationRequest,
  SQLGenerationResponse,
  ValidationRequest,
  ValidationResponse
} from './interface'
import { BaseLLM } from './base'

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

      // Parse the response to extract SQL and explanation
      const parsed = this.parseResponse(text)

      const llmResponse = {
        success: true,
        sqlQuery: parsed.sql,
        explanation: parsed.explanation
      }
      console.log('[LLM RESPONSE][Claude][generateSQL]', llmResponse)
      return llmResponse
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
        const validResp = { isValid: true }
        console.log('[LLM RESPONSE][Claude][validateQuery]', validResp)
        return validResp
      } else {
        const invalidResp = { isValid: false, error: text }
        console.log('[LLM RESPONSE][Claude][validateQuery]', invalidResp)
        return invalidResp
      }
    } catch (error) {
      console.error('Error validating query:', error)
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
      const explanation = data.content[0]?.text?.trim() || 'Unable to generate explanation'
      console.log('[LLM RESPONSE][Claude][generateExplanation]', explanation)
      return explanation
    } catch (error) {
      console.error('Error generating explanation:', error)
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

  protected async callSummarizeAPI(prompt: string): Promise<string> {
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 256,
          temperature: 0.1,
          system: '',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      })
      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`)
      }
      const data = await response.json()
      const summary = data.content[0]?.text?.trim() || ''
      console.log('[LLM RESPONSE][Claude][summarize]', summary)
      return summary
    } catch (error) {
      console.error('Error generating summary:', error)
      throw new Error('Failed to summarize conversation')
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
    // Extract SQL and explanation from the response
    const sqlMatch = response.match(/SQL:\s*(.*?)(?=\nExplanation:|\n\n|$)/s)
    const explanationMatch = response.match(/Explanation:\s*(.*?)(?=\n\n|$)/s)

    const sql = sqlMatch ? sqlMatch[1].trim() : ''
    const explanation = explanationMatch ? explanationMatch[1].trim() : ''

    return { sql, explanation }
  }
}
