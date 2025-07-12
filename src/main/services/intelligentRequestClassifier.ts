import { AIRequestType, AIRequest } from '../llm/interface'

export interface RequestClassification {
  type: AIRequestType
  confidence: number
  reasoning: string
}

export class IntelligentRequestClassifier {
  private errorKeywords = [
    'failed',
    'error',
    'failed as well',
    'this failed',
    'fix it',
    'explain the error',
    'what went wrong',
    'why did this fail',
    'failed as well',
    'this failed as well',
    'can you fix it',
    'it failed',
    'failed again',
    'still failing',
    'not working'
  ]

  private explanationKeywords = [
    'explain',
    'what does this do',
    'how does this work',
    'what is this query',
    'tell me about',
    'describe',
    'what is happening',
    'break down'
  ]

  private improvementKeywords = [
    'improve',
    'optimize',
    'better',
    'faster',
    'more efficient',
    'enhance',
    'suggest improvement',
    'how can I improve',
    'make it better'
  ]

  classifyRequest(
    userInput: string,
    context: {
      hasRecentError?: boolean
      lastError?: string
      lastQuery?: string
      conversationHistory?: string[]
    }
  ): RequestClassification {
    const input = userInput.toLowerCase().trim()

    // Check for error analysis requests
    if (this.isErrorAnalysisRequest(input, context)) {
      return {
        type: {
          type: 'analyze_error',
          content: 'User is asking for error analysis',
          context: {
            lastError: context.lastError,
            lastQuery: context.lastQuery
          }
        },
        confidence: 0.9,
        reasoning: 'User input contains error-related keywords and there is recent error context'
      }
    }

    // Check for explanation requests
    if (this.isExplanationRequest(input, context)) {
      return {
        type: {
          type: 'explain_query',
          content: 'User is asking for query explanation',
          context: {
            lastQuery: context.lastQuery
          }
        },
        confidence: 0.8,
        reasoning: 'User input contains explanation-related keywords'
      }
    }

    // Check for improvement requests
    if (this.isImprovementRequest(input, context)) {
      return {
        type: {
          type: 'suggest_improvement',
          content: 'User is asking for query improvement',
          context: {
            lastQuery: context.lastQuery
          }
        },
        confidence: 0.7,
        reasoning: 'User input contains improvement-related keywords'
      }
    }

    // Default to SQL generation
    return {
      type: {
        type: 'generate_sql',
        content: 'User is asking for SQL generation',
        context: {}
      },
      confidence: 0.6,
      reasoning: 'Default classification for natural language to SQL conversion'
    }
  }

  private isErrorAnalysisRequest(
    input: string,
    context: { hasRecentError?: boolean; lastError?: string }
  ): boolean {
    // Check if input contains error-related keywords
    const hasErrorKeywords = this.errorKeywords.some((keyword) => input.includes(keyword))

    // Check if there's recent error context
    const hasErrorContext = context.hasRecentError || !!context.lastError

    return hasErrorKeywords && hasErrorContext
  }

  private isExplanationRequest(input: string, context: { lastQuery?: string }): boolean {
    const hasExplanationKeywords = this.explanationKeywords.some((keyword) =>
      input.includes(keyword)
    )
    const hasQueryContext = !!context.lastQuery

    return hasExplanationKeywords && hasQueryContext
  }

  private isImprovementRequest(input: string, context: { lastQuery?: string }): boolean {
    const hasImprovementKeywords = this.improvementKeywords.some((keyword) =>
      input.includes(keyword)
    )
    const hasQueryContext = !!context.lastQuery

    return hasImprovementKeywords && hasQueryContext
  }

  // Enhanced classification with conversation context
  classifyWithContext(
    userInput: string,
    conversationHistory: string[],
    lastQuery?: string,
    lastError?: string
  ): RequestClassification {
    const context = {
      hasRecentError: !!lastError,
      lastError,
      lastQuery,
      conversationHistory
    }

    return this.classifyRequest(userInput, context)
  }
}
