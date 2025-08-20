import React, { createContext, useContext, useState, useRef, useEffect } from 'react'
import { logger } from '../utils/logger'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: Date
  sqlQuery?: string
  toolCall?: {
    name: string
    status: 'running' | 'completed' | 'failed'
  }
}

export interface AIContext {
  connectionId?: string
  database?: string
}

export type AIProvider = 'openai' | 'claude' | 'gemini'

interface ChatContextType {
  // State
  messages: Message[]
  isLoading: boolean
  provider: AIProvider
  apiKey: string | null
  showApiKeySetup: boolean
  sessionId: string

  // Actions
  addMessage: (message: Message) => void
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void
  setIsLoading: (loading: boolean) => void
  setProvider: (provider: AIProvider) => void
  setApiKey: (key: string | null) => void
  setShowApiKeySetup: (show: boolean) => void
  clearChat: () => void

  // AI Operations
  sendMessage: (content: string, context: AIContext, onExecuteQuery?: (query: string) => void) => Promise<void>
  handleApiKeySubmit: (key: string, provider: AIProvider) => Promise<void>
}

const ChatContext = createContext<ChatContextType | undefined>(undefined)

export function useChatContext() {
  const context = useContext(ChatContext)
  if (context === undefined) {
    throw new Error('useChatContext must be used within a ChatProvider')
  }
  return context
}

interface ChatProviderProps {
  children: React.ReactNode
  connectionId: string
}

export function ChatProvider({ children, connectionId }: ChatProviderProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [provider, setProviderState] = useState<AIProvider>(() => {
    const saved = localStorage.getItem('datapup-ai-provider')
    if (saved && ['openai', 'claude', 'gemini'].includes(saved)) {
      return saved as AIProvider
    }
    return 'openai'
  })
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [showApiKeySetup, setShowApiKeySetup] = useState(false)

  // Generate session ID that persists for the lifetime of this provider
  const sessionIdRef = useRef(`session-${connectionId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`)
  const sessionId = sessionIdRef.current

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
        logger.error('Error checking API key:', error)
        setShowApiKeySetup(true)
      }
    }
    checkApiKey()
  }, [provider])

  // Listen for tool call events from backend
  useEffect(() => {
    const handleToolCall = (event: any, data: any) => {
      const toolMessage: Message = {
        id: `tool-${Date.now()}-${Math.random()}`,
        role: 'tool',
        content: '',
        timestamp: new Date(),
        toolCall: {
          name: data.name,
          status: data.status
        }
      }

      setMessages((prev) => {
        // Update existing tool message or add new one
        const existingIndex = prev.findIndex(
          (msg) =>
            msg.role === 'tool' &&
            msg.toolCall?.name === data.name &&
            msg.toolCall?.status === 'running'
        )

        if (existingIndex >= 0 && data.status === 'completed') {
          // Update existing message
          const updated = [...prev]
          updated[existingIndex] = {
            ...updated[existingIndex],
            toolCall: { ...updated[existingIndex].toolCall!, status: 'completed' }
          }
          return updated
        } else {
          // Add new message
          return [...prev, toolMessage]
        }
      })
    }

    // Subscribe to tool call events
    const removeListener = window.api.on('ai:toolCall', handleToolCall)

    return () => {
      removeListener()
    }
  }, [])

  // Clear chat when connection changes
  useEffect(() => {
    setMessages([])
    // Generate new session ID for new connection
    sessionIdRef.current = `session-${connectionId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }, [connectionId])

  const addMessage = (message: Message) => {
    setMessages(prev => [...prev, message])
  }

  const setProvider = (newProvider: AIProvider) => {
    setProviderState(newProvider)
    localStorage.setItem('datapup-ai-provider', newProvider)
  }

  const clearChat = () => {
    setMessages([])
    // Generate new session ID for fresh conversation
    sessionIdRef.current = `session-${connectionId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  const sendMessage = async (content: string, context: AIContext, onExecuteQuery?: (query: string) => void) => {
    if (!content.trim() || isLoading) return

    const userInput = content.trim()
    setIsLoading(true)

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userInput,
      timestamp: new Date()
    }

    addMessage(userMessage)

    try {
      // Use single AI process method with session ID
      const result = await window.api.ai.process({
        query: userInput,
        connectionId: context.connectionId || '',
        database: context.database || undefined,
        provider: provider,
        sessionId: sessionId
      })

      if (result.success) {
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: result.message || result.explanation || 'No response generated.',
          timestamp: new Date(),
          sqlQuery: result.sqlQuery
        }
        addMessage(assistantMessage)
      } else {
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Error: ${result.error || 'Unknown error occurred'}`,
          timestamp: new Date()
        }
        addMessage(errorMessage)
      }
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
        timestamp: new Date()
      }
      addMessage(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  const handleApiKeySubmit = async (key: string, currentProvider: AIProvider) => {
    try {
      const result = await window.api.secureStorage.set(`ai-api-key-${currentProvider}`, key)
      if (result.success) {
        setApiKey(key)
        setShowApiKeySetup(false)
      }
    } catch (error) {
      logger.error('Error saving API key:', error)
    }
  }

  const contextValue: ChatContextType = {
    // State
    messages,
    isLoading,
    provider,
    apiKey,
    showApiKeySetup,
    sessionId,

    // Actions
    addMessage,
    setMessages,
    setIsLoading,
    setProvider,
    setApiKey,
    setShowApiKeySetup,
    clearChat,

    // AI Operations
    sendMessage,
    handleApiKeySubmit
  }

  return (
    <ChatContext.Provider value={contextValue}>
      {children}
    </ChatContext.Provider>
  )
}
