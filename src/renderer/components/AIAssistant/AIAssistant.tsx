import { useState, useRef, useEffect } from 'react'
import { Box, Flex, Text, Button, ScrollArea, TextArea, Card, Select } from '@radix-ui/themes'
import { MessageRenderer } from './MessageRenderer'
import './AIAssistant.css'
import { aiTools } from '../../ai/aiTools'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: Date
  sqlQuery?: string
  toolCall?: {
    name: string
    description: string
    status: 'running' | 'completed' | 'failed'
  }
}

interface AIContext {
  query?: string
  selectedText?: string
  results?: any[]
  filters?: any[]
  error?: string
  connectionId?: string
  database?: string
}

interface AIAssistantProps {
  context: AIContext
  onExecuteQuery?: (query: string) => void
  onClose?: () => void
}

export function AIAssistant({ context, onExecuteQuery, onClose }: AIAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [provider, setProvider] = useState<'openai' | 'claude' | 'gemini'>(() => {
    const saved = localStorage.getItem('datapup-ai-provider')
    // Validate saved provider
    if (saved && ['openai', 'claude', 'gemini'].includes(saved)) {
      return saved as 'openai' | 'claude' | 'gemini'
    }
    return 'openai' // Default provider
  })
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [showApiKeySetup, setShowApiKeySetup] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Check for API key on mount and when provider changes
  useEffect(() => {
    const checkApiKey = async () => {
      try {
        const result = await window.api.secureStorage.get(`ai-api-key-${provider}`)
        if (result.success && result.value) {
          setApiKey(result.value)
          setShowApiKeySetup(false)
        } else {
          setShowApiKeySetup(true)
        }
      } catch (error) {
        console.error('[AIAssistant] Error checking API key:', error)
        setShowApiKeySetup(true)
      }
    }
    checkApiKey()
  }, [provider])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [messages])

  const addToolMessage = (toolCall: {
    name: string
    description: string
    status: 'running' | 'completed' | 'failed'
  }) => {
    const toolMessage: Message = {
      id: `tool-${Date.now()}`,
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolCall
    }
    setMessages((prev) => [...prev, toolMessage])
    return toolMessage.id
  }

  const updateToolMessage = (messageId: string, status: 'completed' | 'failed') => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId && msg.toolCall
          ? { ...msg, toolCall: { ...msg.toolCall, status } }
          : msg
      )
    )
  }

  // Process tool calls from the LLM response
  async function processToolCalls(
    toolCalls: Array<{ name: string; args: Record<string, unknown> }>,
    connectionId: string,
    database?: string
  ): Promise<Array<{ tool: string; result: unknown }>> {
    const results: Array<{ tool: string; result: unknown }> = []
    for (const toolCall of toolCalls) {
      const toolMessageId = addToolMessage({
        name: toolCall.name,
        description: `Calling ${toolCall.name} with args: ${JSON.stringify(toolCall.args)}`,
        status: 'running'
      })

      try {
        // Tool execution logging (only in development)
        if (process.env.NODE_ENV === 'development') {
          console.log(`⚙️ Executing tool: ${toolCall.name} with args:`, toolCall.args)
        }

        // Map the args based on the tool
        let toolResult: unknown
        const tool = aiTools[toolCall.name as keyof typeof aiTools]

        if (!tool) {
          throw new Error(`Tool ${toolCall.name} not found`)
        }

        // Call the tool with appropriate arguments
        switch (toolCall.name) {
          case 'listDatabases':
            toolResult = await aiTools.listDatabases(connectionId)
            break
          case 'listTables':
            toolResult = await aiTools.listTables(
              connectionId,
              (toolCall.args.database as string) || database
            )
            break
          case 'getTableSchema':
            toolResult = await aiTools.getTableSchema(
              connectionId,
              toolCall.args.table as string,
              (toolCall.args.database as string) || database
            )
            break
          case 'getSampleRows':
            toolResult = await aiTools.getSampleRows(
              connectionId,
              (toolCall.args.database as string) || database || '',
              toolCall.args.table as string,
              (toolCall.args.limit as number) || 5
            )
            break
          case 'searchTables':
            toolResult = await aiTools.searchTables(
              connectionId,
              toolCall.args.pattern as string,
              (toolCall.args.database as string) || database
            )
            break
          case 'searchColumns':
            toolResult = await aiTools.searchColumns(
              connectionId,
              toolCall.args.pattern as string,
              (toolCall.args.database as string) || database
            )
            break
          case 'summarizeSchema':
            toolResult = await aiTools.summarizeSchema(
              connectionId,
              (toolCall.args.database as string) || database
            )
            break
          case 'summarizeTable':
            toolResult = await aiTools.summarizeTable(
              connectionId,
              toolCall.args.table as string,
              (toolCall.args.database as string) || database
            )
            break
          case 'profileTable':
            toolResult = await aiTools.profileTable(
              connectionId,
              toolCall.args.table as string,
              (toolCall.args.database as string) || database
            )
            break
          case 'executeQuery':
            toolResult = await aiTools.executeQuery(connectionId, toolCall.args.sql as string)
            break
          case 'getLastError':
            toolResult = await aiTools.getLastError(connectionId)
            break
          case 'getDocumentation':
            toolResult = await aiTools.getDocumentation(toolCall.args.topic as string)
            break
          default:
            throw new Error(`Unknown tool: ${toolCall.name}`)
        }

        // Tool result logging (only in development)
        if (process.env.NODE_ENV === 'development') {
          console.log(`✅ Tool ${toolCall.name} completed successfully. Result:`, toolResult)
        }

        // Store the result
        results.push({ tool: toolCall.name, result: toolResult })

        // Add tool result as assistant message
        setMessages((prev) => [
          ...prev,
          {
            id: `tool-result-${Date.now()}`,
            role: 'assistant',
            content: `Tool ${toolCall.name} result:\n\`\`\`json\n${JSON.stringify(toolResult, null, 2)}\n\`\`\``,
            timestamp: new Date()
          }
        ])
        updateToolMessage(toolMessageId, 'completed')
      } catch (err) {
        console.error(`[AIAssistant] Tool ${toolCall.name} execution failed:`, err)
        setMessages((prev) => [
          ...prev,
          {
            id: `tool-error-${Date.now()}`,
            role: 'assistant',
            content: `Error calling tool ${toolCall.name}: ${err instanceof Error ? err.message : String(err)}`,
            timestamp: new Date()
          }
        ])
        updateToolMessage(toolMessageId, 'failed')
      }
    }
    return results
  }

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return

    const userInput = inputValue.trim()
    setInputValue('')
    setIsLoading(true)

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userInput,
      timestamp: new Date()
    }

    setMessages((prev) => [...prev, userMessage])

    try {
      // Build conversation context
      const conversationContext = buildConversationContext(messages, userInput)

      // Use natural language query processor
      // Provider logging (only in development)
      if (process.env.NODE_ENV === 'development') {
        console.log('[AIAssistant] Sending provider to backend:', provider)
      }
      const result = await window.api.ai.generateSQL({
        naturalLanguageQuery: userInput,
        connectionId: context.connectionId || '',
        database: context.database || undefined,
        conversationContext: conversationContext,
        provider: provider
      })

      let response: string
      let sqlQuery: string | undefined

      if (result.success) {
        // Process tool calls from the LLM response
        if (result.toolCalls && result.toolCalls.length > 0) {
          // Agent mode: execute tools and get results
          const toolResults = await processToolCalls(
            result.toolCalls,
            context.connectionId || '',
            context.database
          )

          // If we got tool results, we may not need SQL
          if (!result.sqlQuery) {
            response = result.explanation || 'Here are the results from the tools:'
          } else {
            // Both tool results and SQL were generated
            sqlQuery = result.sqlQuery
            response = `Generated SQL Query:\n\`\`\`sql\n${result.sqlQuery}\n\`\`\`\n\n${result.explanation || ''}`

            // If there's an onExecuteQuery callback AND we have SQL, offer to execute the query
            if (onExecuteQuery && sqlQuery) {
              response += '\n\n**Would you like me to execute this query?**'
            }
          }
        } else if (result.sqlQuery) {
          // Only SQL was generated (no tool calls)
          sqlQuery = result.sqlQuery
          response = `Generated SQL Query:\n\`\`\`sql\n${result.sqlQuery}\n\`\`\`\n\n${result.explanation || ''}`

          // If there's an onExecuteQuery callback, offer to execute the query
          if (onExecuteQuery) {
            response += '\n\n**Would you like me to execute this query?**'
          }
        } else {
          // Text-only response (no tool calls or SQL)
          console.log('[AIAssistant] Text response:', result)
          response = result.explanation || "I couldn't generate a response. Please try rephrasing your question."
        }
      } else {
        response = `Error: ${result.error}`
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: new Date(),
        sqlQuery: sqlQuery
      }
      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
        timestamp: new Date()
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const buildConversationContext = (messages: Message[], currentInput: string): string => {
    // Build context from recent messages (last 10 messages to avoid token limits)
    const recentMessages = messages.filter((m) => m.role !== 'tool').slice(-10)

    let context = 'Previous conversation:\n'

    for (const message of recentMessages) {
      const role = message.role === 'user' ? 'User' : 'Assistant'
      // Clean content for context (remove markdown formatting)
      const cleanContent = message.content
        .replace(/```[\s\S]*?```/g, '[SQL Query]')
        .replace(/\*\*/g, '')
        .trim()
      context += `${role}: ${cleanContent}\n`
    }

    context += `\nCurrent request: ${currentInput}\n`

    return context
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleApiKeySubmit = async (key: string) => {
    try {
      const result = await window.api.secureStorage.set(`ai-api-key-${provider}`, key)
      if (result.success) {
        setApiKey(key)
        setShowApiKeySetup(false)
        setApiKeyInput('')
      } else {
        console.error('[AIAssistant] Failed to save API key')
      }
    } catch (error) {
      console.error('[AIAssistant] Error saving API key:', error)
    }
  }

  const handleProviderChange = (newProvider: string) => {
    // Validate provider before saving
    if (['openai', 'claude', 'gemini'].includes(newProvider)) {
      // Provider change logging (only in development)
      if (process.env.NODE_ENV === 'development') {
        console.log('[AIAssistant] Changing provider to:', newProvider)
      }
      setProvider(newProvider as 'openai' | 'claude' | 'gemini')
      localStorage.setItem('datapup-ai-provider', newProvider)
    } else {
      console.error('[AIAssistant] Invalid provider:', newProvider)
    }
  }

  const renderToolCall = (toolCall: {
    name: string
    description: string
    status: 'running' | 'completed' | 'failed'
  }) => {
    const statusStyles = {
      running: { color: 'blue', label: 'Running' },
      completed: { color: 'green', label: 'Completed' },
      failed: { color: 'red', label: 'Failed' }
    }

    const status = statusStyles[toolCall.status]

    return (
      <Card size="1" style={{ padding: '8px 12px' }}>
        <Flex align="center" gap="3">
          <Box style={{ position: 'relative' }}>
            {toolCall.status === 'running' && (
              <Box
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--blue-9)',
                  animation: 'pulse 1.5s ease-in-out infinite'
                }}
              />
            )}
            {toolCall.status === 'completed' && (
              <Box
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--green-9)'
                }}
              />
            )}
            {toolCall.status === 'failed' && (
              <Box
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--red-9)'
                }}
              />
            )}
          </Box>
          <Flex direction="column" gap="1">
            <Text size="2" weight="medium">
              {toolCall.name}
            </Text>
            <Text size="1" color="gray">
              {toolCall.description}
            </Text>
          </Flex>
          <Box style={{ marginLeft: 'auto' }}>
            <Text size="1" color={status.color as 'blue' | 'green' | 'red'} weight="medium">
              {status.label}
            </Text>
          </Box>
        </Flex>
      </Card>
    )
  }

  if (showApiKeySetup) {
    return (
      <Box className="ai-assistant">
        <Flex className="ai-header" justify="between" align="center" p="3">
          <Text size="2" weight="medium">
            AI Assistant Setup
          </Text>
          {onClose && (
            <Button size="1" variant="ghost" onClick={onClose}>
              ×
            </Button>
          )}
        </Flex>
        <Box className="ai-setup" p="3">
          <Card size="1">
            <Flex direction="column" gap="3">
              <Box>
                <Text size="2" weight="medium" mb="2">
                  Choose AI Provider
                </Text>
                <Select.Root value={provider} onValueChange={handleProviderChange}>
                  <Select.Trigger style={{ width: '100%' }} />
                  <Select.Content>
                    <Select.Item value="openai">
                      <Flex direction="column" align="start">
                        <Text size="2">OpenAI</Text>
                        <Text size="1" color="gray">
                          GPT-4 and GPT-3.5 models
                        </Text>
                      </Flex>
                    </Select.Item>
                    <Select.Item value="claude">
                      <Flex direction="column" align="start">
                        <Text size="2">Claude</Text>
                        <Text size="1" color="gray">
                          Anthropic's Claude models
                        </Text>
                      </Flex>
                    </Select.Item>
                    <Select.Item value="gemini">
                      <Flex direction="column" align="start">
                        <Text size="2">Gemini</Text>
                        <Text size="1" color="gray">
                          Google's Gemini models
                        </Text>
                      </Flex>
                    </Select.Item>
                  </Select.Content>
                </Select.Root>
              </Box>

              <Box>
                <Text size="2" weight="medium" mb="2">
                  API Key for{' '}
                  {provider === 'openai' ? 'OpenAI' : provider === 'claude' ? 'Claude' : 'Gemini'}
                </Text>
                <TextArea
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={`Enter your ${provider === 'openai' ? 'OpenAI' : provider === 'claude' ? 'Claude' : 'Gemini'} API key...`}
                  size="2"
                  style={{ fontFamily: 'monospace', minHeight: '60px' }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (apiKeyInput.trim()) handleApiKeySubmit(apiKeyInput.trim())
                    }
                  }}
                />
                <Text size="1" color="gray" mt="1">
                  {provider === 'openai' && 'Get your API key from platform.openai.com'}
                  {provider === 'claude' && 'Get your API key from console.anthropic.com'}
                  {provider === 'gemini' && 'Get your API key from makersuite.google.com'}
                </Text>
              </Box>

              <Flex gap="2" justify="between">
                <Button
                  size="2"
                  onClick={() => {
                    if (apiKeyInput.trim()) handleApiKeySubmit(apiKeyInput.trim())
                  }}
                  disabled={!apiKeyInput.trim()}
                  style={{ flex: 1 }}
                >
                  Save API Key
                </Button>
                <Button size="2" variant="soft" onClick={() => setShowApiKeySetup(false)}>
                  Skip for Now
                </Button>
              </Flex>

              <Card
                size="1"
                style={{ backgroundColor: 'var(--blue-2)', borderColor: 'var(--blue-6)' }}
              >
                <Flex gap="2" align="start">
                  <Text size="1" color="blue" weight="medium">
                    ℹ️
                  </Text>
                  <Text size="1" color="blue">
                    Your API key is stored securely on your device and never sent to our servers.
                    You can change it anytime from the provider dropdown menu.
                  </Text>
                </Flex>
              </Card>
            </Flex>
          </Card>
        </Box>
      </Box>
    )
  }

  return (
    <Box className="ai-assistant">
      <Flex className="ai-header" justify="between" align="center" p="3">
        <Flex align="center" gap="2">
          <Text size="2" weight="medium">
            AI Assistant
          </Text>
          {context.selectedText && (
            <Text size="1" color="gray">
              • Selection
            </Text>
          )}
        </Flex>
        <Flex align="center" gap="2">
          <Select.Root value={provider} onValueChange={handleProviderChange}>
            <Select.Trigger />
            <Select.Content>
              <Select.Item value="openai">OpenAI</Select.Item>
              <Select.Item value="claude">Claude</Select.Item>
              <Select.Item value="gemini">Gemini</Select.Item>
            </Select.Content>
          </Select.Root>
          {onClose && (
            <Button size="1" variant="ghost" onClick={onClose}>
              ×
            </Button>
          )}
        </Flex>
      </Flex>

      <ScrollArea className="ai-messages" ref={scrollAreaRef}>
        {messages.length === 0 ? (
          <Flex className="ai-empty" align="center" justify="center" p="4">
            <Text size="2" color="gray">
              Ask me about your data or for help writing SQL queries
            </Text>
          </Flex>
        ) : (
          <Box p="3">
            {messages.map((message) => (
              <Box key={message.id} mb="3">
                {message.role === 'tool' && message.toolCall ? (
                  <Box className="ai-tool-message">{renderToolCall(message.toolCall)}</Box>
                ) : (
                  <Box className={`ai-message ai-message-${message.role}`}>
                    <Text size="1" color="gray" weight="medium" mb="1">
                      {message.role === 'user' ? 'You' : 'Assistant'}
                    </Text>
                    <Card size="1">
                      <MessageRenderer
                        content={message.content}
                        sqlQuery={message.sqlQuery}
                        onRunQuery={onExecuteQuery}
                      />
                    </Card>
                  </Box>
                )}
              </Box>
            ))}
            {isLoading && (
              <Box className="ai-message ai-message-assistant" mb="3">
                <Text size="1" color="gray" weight="medium" mb="1">
                  Assistant
                </Text>
                <Card size="1">
                  <Flex align="center" gap="2">
                    <Box className="ai-typing-indicator">
                      <span></span>
                      <span></span>
                      <span></span>
                    </Box>
                    <Text size="2" color="gray">
                      Thinking...
                    </Text>
                  </Flex>
                </Card>
              </Box>
            )}
          </Box>
        )}
      </ScrollArea>

      <Box className="ai-input-container" p="3">
        <Box className="ai-input-wrapper">
          <TextArea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your query, data, or request help..."
            size="1"
            style={{ paddingRight: '36px', width: '100%' }}
            disabled={isLoading}
          />
          <Button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isLoading}
            size="1"
            variant="ghost"
            className="ai-send-button"
          >
            →
          </Button>
        </Box>
        {apiKey && (
          <Button
            size="1"
            variant="ghost"
            onClick={() => setShowApiKeySetup(true)}
            style={{ marginTop: '8px' }}
          >
            Configure API Key
          </Button>
        )}
      </Box>
    </Box>
  )
}
