import { ChatOpenAI } from '@langchain/openai'
import { BaseLangchainLLM } from './base'

export class LangchainOpenAILLM extends BaseLangchainLLM {
  constructor(apiKey: string, modelName?: string) {
    if (!apiKey) {
      throw new Error('OpenAI API key is required')
    }

    const model = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: modelName || 'gpt-4o-mini',
      temperature: 0.1,
      maxTokens: 2000
    })

    super(model)
  }
}
