import { ChatAnthropic } from '@langchain/anthropic'
import { BaseLangchainLLM } from './base'

export class LangchainClaudeLLM extends BaseLangchainLLM {
  constructor(apiKey: string, modelName?: string) {
    if (!apiKey) {
      throw new Error('Claude API key is required')
    }

    const model = new ChatAnthropic({
      apiKey,
      modelName: modelName || 'claude-3-5-sonnet-20241022',
      temperature: 0.1,
      maxTokens: 2000
    })

    super(model)
  }
}
