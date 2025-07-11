import { useState, useRef, useEffect } from 'react'
import { Box, Flex, Text, Button, ScrollArea, TextArea, Card, Select } from '@radix-ui/themes'
import { MessageRenderer } from './MessageRenderer'
import './AIAssistant.css'

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
  const [provider, setProvider] = useState(
    () => localStorage.getItem('datapup-ai-provider') || 'openai'
  )
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [showApiKeySetup, setShowApiKeySetup] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Check for API key on mount and when provider changes
  useEffect(() => {
    const checkApiKey = async () => {
      try {
        const result = await (window.api as any).secureStorage.get(`ai-api-key-${provider}`)
        if (result.success && result.value) {
          setApiKey(result.value)
          setShowApiKeySetup(false)
        } else {
          setShowApiKeySetup(true)
        }
      } catch (error) {
        console.error('Error checking API key:', error)
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
      const result = await (window.api as any).naturalLanguageQuery.generateSQL({
        naturalLanguageQuery: userInput,
        connectionId: context.connectionId || '',
        database: context.database || undefined,
        conversationContext: conversationContext,
        provider: provider
      })

      // Display tool calls if they exist
      if (result.toolCalls) {
        for (const toolCall of result.toolCalls) {
          const toolMessageId = addToolMessage(toolCall)
          // Update status after a short delay for completed/failed states
          if (toolCall.status !== 'running') {
            setTimeout(() => updateToolMessage(toolMessageId, toolCall.status), 100)
          }
        }
      }

      let response: string
      let sqlQuery: string | undefined

      if (result.success) {
        sqlQuery = result.sqlQuery
        response = `Generated SQL Query:\n\`\`\`sql\n${result.sqlQuery}\n\`\`\`\n\n${result.explanation || ''}`

        // If there's an onExecuteQuery callback, offer to execute the query
        if (onExecuteQuery) {
          response += '\n\n**Would you like me to execute this query?**'
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
      const result = await (window.api as any).secureStorage.set(`ai-api-key-${provider}`, key)
      if (result.success) {
        setApiKey(key)
        setShowApiKeySetup(false)
        setApiKeyInput('')
      } else {
        console.error('Failed to save API key')
      }
    } catch (error) {
      console.error('Error saving API key:', error)
    }
  }

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider)
    localStorage.setItem('datapup-ai-provider', newProvider)
  }

  const renderToolCall = (toolCall: {
    name: string
    description: string
    status: 'running' | 'completed' | 'failed'
  }) => {
    const icon =
      toolCall.status === 'running' ? '⏳' : toolCall.status === 'completed' ? '✅' : '❌'
    const color =
      toolCall.status === 'running' ? 'blue' : toolCall.status === 'completed' ? 'green' : 'red'

    return (
      <Flex align="center" gap="2">
        <Text size="2">{icon}</Text>
        <Text size="1" color={color as any}>
          {toolCall.name}: {toolCall.description}
        </Text>
      </Flex>
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
            <Flex direction="column" gap="2">
              <Flex align="center" gap="2">
                <Text size="1">Provider:</Text>
                <Select.Root value={provider} onValueChange={handleProviderChange}>
                  <Select.Trigger size="1" />
                  <Select.Content>
                    <Select.Item value="openai">OpenAI</Select.Item>
                    <Select.Item value="claude">Claude</Select.Item>
                    <Select.Item value="gemini">Gemini</Select.Item>
                  </Select.Content>
                </Select.Root>
              </Flex>
              <Text size="1">
                Enter your{' '}
                {provider === 'openai' ? 'OpenAI' : provider === 'claude' ? 'Claude' : 'Gemini'} API
                key:
              </Text>
              <TextArea
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={`Enter your ${provider === 'openai' ? 'OpenAI' : provider === 'claude' ? 'Claude' : 'Gemini'} API key...`}
                size="1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (apiKeyInput.trim()) handleApiKeySubmit(apiKeyInput.trim())
                  }
                }}
              />
              <Flex gap="1">
                <Button
                  size="1"
                  onClick={() => {
                    if (apiKeyInput.trim()) handleApiKeySubmit(apiKeyInput.trim())
                  }}
                  disabled={!apiKeyInput.trim()}
                >
                  Save API Key
                </Button>
                <Button size="1" variant="soft" onClick={() => setShowApiKeySetup(false)}>
                  Skip for Now
                </Button>
              </Flex>
              <Text size="1" color="gray">
                Your API key is stored locally and never sent to our servers.
              </Text>
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
            <Select.Trigger size="1" />
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
