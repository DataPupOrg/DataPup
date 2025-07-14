import { ConversationState } from '../../llm/interface'

// This function should be called by your tool dispatcher when the LLM calls getLastError
export async function getLastErrorTool(
  conversationStates: Map<string, ConversationState>,
  connectionId: string
): Promise<string> {
  const state = conversationStates.get(connectionId)
  return state?.lastError || 'No recent error found.'
}
