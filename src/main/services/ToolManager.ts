import { Node } from 'llamaindex'
import { VectorStoreIndex } from 'llamaindex'
import { ApiBasedEmbedding } from '../llm/LlamaIndexEmbedding'
import { LLMInterface } from '../llm/interface'
import {
  Document,
  VectorStoreIndex,
  Settings,
  Gemini // Use the built-in Gemini provider
} from 'llamaindex'

export interface Tool {
  name: string
  description: string
  handler: (...args: any[]) => Promise<any>
}

export class ToolManager {
  private tools: Tool[]
  private toolIndex: VectorStoreIndex | null = null
  private toolRetriever: any = null

  constructor(tools: Tool[], llm: LLMInterface) {
    this.tools = tools
    this.initIndex(llm)
  }

  private async initIndex(llm: LLMInterface) {
    const embedding = new ApiBasedEmbedding(llm)
    // Create LlamaIndex Documents from your tools
    const toolDocs = this.tools.map(
      (tool) =>
        new Node({
          text: `Tool Name: ${tool.name}\nDescription: ${tool.description}`,
          metadata: { tool_name: tool.name }
        })
    )
    // Create the vector index
    this.toolIndex = await VectorStoreIndex.fromDocuments(toolDocs, { embedModel: embedding })
    // Create a retriever for top-K relevant tools
    this.toolRetriever = this.toolIndex.asRetriever({ similarityTopK: 3 })
  }

  // Select the most relevant tools for a user query
  async selectTools(userQuery: string): Promise<Tool[]> {
    if (!this.toolRetriever) throw new Error('Tool index not initialized')
    const relevantToolDocs: Array<{ metadata: { tool_name: string } }> =
      await this.toolRetriever.retrieve(userQuery)
    const selectedNames = relevantToolDocs.map((doc) => doc.metadata.tool_name)
    return this.tools.filter((tool) => selectedNames.includes(tool.name))
  }
}
