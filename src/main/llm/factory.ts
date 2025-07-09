import { LLMInterface, LLMConfig } from './interface'
import { GeminiLLM } from './gemini'
import { OpenAILLM } from './openai'
import { ClaudeLLM } from './claude'

// Import database context system to ensure it's loaded
import '../database/context'

export class LLMFactory {
  static create(config: LLMConfig): LLMInterface {
    switch (config.provider) {
      case 'gemini':
        return new GeminiLLM(config.apiKey, config.model)
      case 'openai':
        return new OpenAILLM(config.apiKey, config.model)
      case 'claude':
        return new ClaudeLLM(config.apiKey, config.model)
      default:
        throw new Error(`Unsupported LLM provider: ${config.provider}`)
    }
  }

  static getSupportedProviders(): string[] {
    return ['gemini', 'openai', 'claude']
  }
}
