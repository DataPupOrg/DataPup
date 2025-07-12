import { LLMInterface, LLMConfig } from './interface'
import {
  LangchainOpenAILLM,
  LangchainGeminiLLM,
  LangchainClaudeLLM,
  LangchainChainsLLM
} from './langchain'

// Import database context system to ensure it's loaded
import '../database/context'

export class LLMFactory {
  static create(config: LLMConfig): LLMInterface {
    switch (config.provider) {
      case 'langchain-gemini':
        return new LangchainGeminiLLM(config.apiKey, config.model)
      case 'langchain-openai':
        return new LangchainOpenAILLM(config.apiKey, config.model)
      case 'langchain-claude':
        return new LangchainClaudeLLM(config.apiKey, config.model)
      case 'langchain-chains-gemini':
        return new LangchainChainsLLM('gemini', config.apiKey, config.model)
      case 'langchain-chains-openai':
        return new LangchainChainsLLM('openai', config.apiKey, config.model)
      case 'langchain-chains-claude':
        return new LangchainChainsLLM('claude', config.apiKey, config.model)
      default:
        throw new Error(`Unsupported LLM provider: ${config.provider}`)
    }
  }

  static getSupportedProviders(): string[] {
    return [
      'langchain-gemini',
      'langchain-openai',
      'langchain-claude',
      'langchain-chains-gemini',
      'langchain-chains-openai',
      'langchain-chains-claude'
    ]
  }
}
