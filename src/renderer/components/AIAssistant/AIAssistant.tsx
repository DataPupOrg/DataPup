import { useState, useRef, useEffect } from 'react'
import { Box, Flex, Text, Button, ScrollArea, TextArea, Card, Select } from '@radix-ui/themes'
import { Trash2 } from 'lucide-react'
import { MessageRenderer } from './MessageRenderer'
import { useChatContext, type AIContext } from '../../contexts/ChatContext'
import './AIAssistant.css'

interface AIAssistantProps {
  context: AIContext
  onExecuteQuery?: (query: string) => void
  onClose?: () => void
}

export function AIAssistant({ context, onExecuteQuery, onClose }: AIAssistantProps) {
  const {
    messages,
    isLoading,
    provider,
    showApiKeySetup,
    sendMessage,
    handleApiKeySubmit,
    setProvider,
    clearChat
  } = useChatContext()

  const [inputValue, setInputValue] = useState('')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)


  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [messages])

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return

    const userInput = inputValue.trim()
    setInputValue('')

    await sendMessage(userInput, context, onExecuteQuery)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleApiKeySubmitLocal = async (key: string) => {
    await handleApiKeySubmit(key, provider)
    setApiKeyInput('')
  }

  const handleProviderChange = (newProvider: string) => {
    if (['openai', 'claude', 'gemini'].includes(newProvider)) {
      setProvider(newProvider as 'openai' | 'claude' | 'gemini')
    }
  }

  const renderToolCall = (toolCall: {
    name: string
    status: 'running' | 'completed' | 'failed'
  }) => {
    const statusStyles = {
      running: { color: 'blue', label: 'Running', icon: '⚡' },
      completed: { color: 'green', label: 'Completed', icon: '✓' },
      failed: { color: 'red', label: 'Failed', icon: '✗' }
    }

    const status = statusStyles[toolCall.status]

    return (
      <Card size="1" style={{ padding: '8px 12px', marginBottom: '4px' }}>
        <Flex align="center" gap="2">
          <Text size="1" color={status.color as any}>
            {status.icon}
          </Text>
          <Text size="1">{toolCall.name}</Text>
          <Text size="1" color="gray" style={{ marginLeft: 'auto' }}>
            {status.label}
          </Text>
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
                    <Select.Item value="openai">OpenAI</Select.Item>
                    <Select.Item value="claude">Claude</Select.Item>
                    <Select.Item value="gemini">Gemini</Select.Item>
                  </Select.Content>
                </Select.Root>
              </Box>

              <Box>
                <Text size="2" weight="medium" mb="2">
                  API Key
                </Text>
                <TextArea
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={`Enter your ${provider} API key...`}
                  size="2"
                  style={{ fontFamily: 'monospace', minHeight: '60px' }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (apiKeyInput.trim()) handleApiKeySubmitLocal(apiKeyInput.trim())
                    }
                  }}
                />
              </Box>

              <Button
                size="2"
                onClick={() => {
                  if (apiKeyInput.trim()) handleApiKeySubmitLocal(apiKeyInput.trim())
                }}
                disabled={!apiKeyInput.trim()}
              >
                Save API Key
              </Button>
            </Flex>
          </Card>
        </Box>
      </Box>
    )
  }

  return (
    <Box className="ai-assistant">
      <Flex className="ai-header" justify="between" align="center" p="3">
        <Text size="2" weight="medium">
          AI Assistant
        </Text>
        <Flex align="center" gap="2">
          <Select.Root value={provider} onValueChange={handleProviderChange}>
            <Select.Trigger />
            <Select.Content>
              <Select.Item value="openai">OpenAI</Select.Item>
              <Select.Item value="claude">Claude</Select.Item>
              <Select.Item value="gemini">Gemini</Select.Item>
            </Select.Content>
          </Select.Root>
          {messages.length > 0 && (
            <Button
              size="1"
              variant="ghost"
              onClick={clearChat}
              title="Clear chat history"
            >
              <Trash2 size={16} />
            </Button>
          )}
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
                  renderToolCall(message.toolCall)
                ) : (
                  <Box className={`ai-message ai-message-${message.role}`}>
                    <Text size="1" color="gray" weight="medium" mb="1">
                      {message.role === 'user' ? 'You' : 'Assistant'}
                    </Text>
                    <Card size="1" className="ai-message-content">
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
            placeholder="Ask about your data or request help..."
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
      </Box>
    </Box>
  )
}
