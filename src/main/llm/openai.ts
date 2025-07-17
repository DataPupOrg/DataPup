import {
  LLMInterface,
  SQLGenerationRequest,
  SQLGenerationResponse,
  ValidationRequest,
  ValidationResponse
} from './interface'
import { BaseLLM } from './base'

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string
    }
  }>
}

export class OpenAILLM extends BaseLLM implements LLMInterface {
  private apiKey: string
  private model: string
  private apiUrl = 'https://api.openai.com/v1/chat/completions'

  constructor(apiKey: string, model?: string) {
    super()
    if (!apiKey) {
      throw new Error('OpenAI API key is required')
    }

    this.apiKey = apiKey
    this.model = model || 'gpt-4o-mini'
  }

  async generateSQL(request: SQLGenerationRequest): Promise<SQLGenerationResponse> {
    try {
      const messages = this.buildMessages(request)

      // Log messages and their total length
      const totalLength = messages.reduce((sum, msg) => sum + msg.content.length, 0)
      this.logPrompt('OPENAI', 'MESSAGES', JSON.stringify(messages, null, 2), totalLength)

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.1,
          max_tokens: 1000
        })
      })

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`)
      }

      const data: OpenAIResponse = await response.json()
      const text = data.choices[0]?.message?.content?.trim() || ''

      // Parse the response to extract SQL and explanation
      const parsed = this.parseResponse(text)

      const llmResponse = {
        success: true,
        sqlQuery: parsed.sql,
        explanation: parsed.explanation
      }
      console.log('[LLM RESPONSE][OpenAI][generateSQL]', llmResponse)
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

      const messages: OpenAIMessage[] = [
        {
          role: 'system',
          content:
            'You are a SQL validator. Return only "VALID" if the query is syntactically correct, or a brief error message if not.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]

      // Log validation messages and their total length
      const totalLength = messages.reduce((sum, msg) => sum + msg.content.length, 0)
      this.logPrompt(
        'OPENAI',
        'VALIDATION MESSAGES',
        JSON.stringify(messages, null, 2),
        totalLength
      )

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0,
          max_tokens: 100
        })
      })

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`)
      }

      const data: OpenAIResponse = await response.json()
      const text = data.choices[0]?.message?.content?.trim() || ''

      if (text.toUpperCase() === 'VALID') {
        const validResp = { isValid: true }
        console.log('[LLM RESPONSE][OpenAI][validateQuery]', validResp)
        return validResp
      } else {
        const invalidResp = { isValid: false, error: text }
        console.log('[LLM RESPONSE][OpenAI][validateQuery]', invalidResp)
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

      const messages: OpenAIMessage[] = [
        {
          role: 'system',
          content: 'You are a SQL expert. Explain SQL queries in simple, clear terms.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]

      // Log explanation messages and their total length
      const totalLength = messages.reduce((sum, msg) => sum + msg.content.length, 0)
      this.logPrompt(
        'OPENAI',
        'EXPLANATION MESSAGES',
        JSON.stringify(messages, null, 2),
        totalLength
      )

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.3,
          max_tokens: 200
        })
      })

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`)
      }

      const data: OpenAIResponse = await response.json()
      const explanation =
        data.choices[0]?.message?.content?.trim() || 'Unable to generate explanation'
      console.log('[LLM RESPONSE][OpenAI][generateExplanation]', explanation)
      return explanation
    } catch (error) {
      console.error('Error generating explanation:', error)
      throw error
    }
  }

  async embedQuery(text: string): Promise<number[]> {
    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: text
        })
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`OpenAI API error: ${response.status} - ${error}`)
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
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: prompt }
      ]
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.1,
          max_tokens: 256
        })
      })
      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`)
      }
      const data = await response.json()
      const summary = data.choices[0]?.message?.content?.trim() || ''
      console.log('[LLM RESPONSE][OpenAI][summarize]', summary)
      return summary
    } catch (error) {
      console.error('Error generating summary:', error)
      throw new Error('Failed to summarize conversation')
    }
  }

  private buildMessages(request: SQLGenerationRequest): OpenAIMessage[] {
    const basePrompt = this.buildBasePrompt(request)

    // Split the base prompt into system and user parts for OpenAI
    const systemPrompt = `You are a SQL expert. Follow the instructions carefully and respond in the exact format requested.`
    const userContent = basePrompt

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ]
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
