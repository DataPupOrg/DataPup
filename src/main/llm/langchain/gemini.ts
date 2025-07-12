import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { BaseLangchainLLM } from './base'

export class LangchainGeminiLLM extends BaseLangchainLLM {
  constructor(apiKey: string, modelName?: string) {
    if (!apiKey) {
      throw new Error('Gemini API key is required')
    }

    const model = new ChatGoogleGenerativeAI({
      apiKey,
      model: modelName || 'gemini-1.5-flash',
      temperature: 0.1,
      maxOutputTokens: 2000
    })

    super(model)
  }
}
