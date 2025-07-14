import { ConversationState } from '../llm/interface'
import { LLMManager } from '../llm/manager'

interface StateUpdateRequest {
  previousState: ConversationState | null
  userQuery: string
  generatedSQL: string
  databaseType: string
}

export class ConversationStateManager {
  private llmManager: LLMManager

  constructor(llmManager: LLMManager) {
    this.llmManager = llmManager
  }

  /**
   * Update the conversation state based on the latest user query and generated SQL
   */
  async updateConversationState(request: StateUpdateRequest): Promise<ConversationState> {
    try {
      const { previousState, userQuery, generatedSQL } = request

      // Create the state update prompt
      const prompt = this.buildStateUpdatePrompt(request)

      // Use a fast, cheap model for state updates (Gemini 1.5 Flash)
      const connectionResult = await this.llmManager.connect('gemini')
      if (!connectionResult.success || !connectionResult.connectionId) {
        throw new Error('Failed to connect to LLM for state update')
      }

      const llmInstance = this.llmManager.getLlmInstance(connectionResult.connectionId)
      if (!llmInstance) {
        throw new Error('LLM instance not available')
      }

      // Generate the updated state using the LLM's generateSQL method with a simple prompt
      const generationRequest = {
        naturalLanguageQuery: `Update conversation state: ${userQuery}`,
        databaseSchema: { database: '', tables: [] },
        databaseType: 'clickhouse',
        sampleData: undefined,
        conversationContext: prompt
      }

      const response = await llmInstance.generateSQL(generationRequest)
      if (!response.success || !response.explanation) {
        throw new Error('Failed to generate state update')
      }

      // Parse the JSON response from the explanation field
      const updatedState = this.parseStateResponse(response.explanation)

      // Cleanup the temporary connection
      await this.llmManager.disconnect(connectionResult.connectionId)

      return updatedState
    } catch (error) {
      console.error('Error updating conversation state:', error)
      // Return a minimal state if parsing fails
      return this.createMinimalState(request.userQuery)
    }
  }

  /**
   * Build the state update prompt
   */
  private buildStateUpdatePrompt(request: StateUpdateRequest): string {
    const { previousState, userQuery, generatedSQL, databaseType } = request

    return `You are a state tracking assistant for a Text-to-SQL system.
Your job is to update a JSON object representing the conversation state based on the latest user query and the generated SQL.

Here is the previous state:
${previousState ? JSON.stringify(previousState, null, 2) : 'null'}

Here is the latest user interaction:
User Query: "${userQuery}"
Generated SQL: "${generatedSQL}"

Now, return a new, updated JSON object that reflects the new state of the conversation. Combine the previous filters with any new ones. If the user removes a filter, update the state accordingly. The new state should be a complete representation.

Rules:
1. Extract table names from the SQL (FROM and JOIN clauses)
2. Extract filters from WHERE clauses
3. Extract GROUP BY columns
4. Extract ORDER BY columns and direction
5. Update the summary to reflect the current query intent
6. Keep the lastUserQuery as the current user query

Return ONLY the JSON object, no additional text or formatting.`
  }

  /**
   * Parse the LLM response to extract the conversation state
   */
  private parseStateResponse(response: string): ConversationState {
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return this.validateAndNormalizeState(parsed)
      }

      throw new Error('No valid JSON found in response')
    } catch (error) {
      console.error('Failed to parse state response:', error)
      throw error
    }
  }

  /**
   * Validate and normalize the parsed state
   */
  private validateAndNormalizeState(parsed: any): ConversationState {
    return {
      tablesInFocus: Array.isArray(parsed.tablesInFocus) ? parsed.tablesInFocus : [],
      filtersApplied: Array.isArray(parsed.filtersApplied) ? parsed.filtersApplied : [],
      groupByColumns: Array.isArray(parsed.groupByColumns) ? parsed.groupByColumns : [],
      orderBy: Array.isArray(parsed.orderBy) ? parsed.orderBy : [],
      lastUserQuery: typeof parsed.lastUserQuery === 'string' ? parsed.lastUserQuery : '',
      summary: typeof parsed.summary === 'string' ? parsed.summary : ''
    }
  }

  /**
   * Create a minimal state when parsing fails
   */
  private createMinimalState(userQuery: string): ConversationState {
    return {
      tablesInFocus: [],
      filtersApplied: [],
      groupByColumns: [],
      orderBy: [],
      lastUserQuery: userQuery,
      summary: `User asked: ${userQuery}`
    }
  }

  /**
   * Format the conversation state for inclusion in the main prompt
   */
  formatStateForPrompt(state: ConversationState): string {
    if (!state || (!state.tablesInFocus.length && !state.filtersApplied.length)) {
      return ''
    }

    return `CONVERSATION CONTEXT:
The user is refining a query. Here is the current state of their request:
${JSON.stringify(state, null, 2)}

Current request: ${state.lastUserQuery}`
  }
}
