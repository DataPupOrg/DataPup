import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Box, Flex, Text, Badge } from '@radix-ui/themes'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../ui'
import { LeftSidebar } from '../LeftSidebar'
import { QueryWorkspace } from '../QueryWorkspace/QueryWorkspace'
import { ThemeSwitcher } from '../ThemeSwitcher'
import { ChatProvider } from '../../contexts/ChatContext'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import './ActiveConnectionLayout.css'

interface ActiveConnectionLayoutProps {
  connectionId: string
  connectionName: string
  database: string
  onDisconnect?: () => void
}

export function ActiveConnectionLayout({
  connectionId,
  connectionName,
  database,
  onDisconnect
}: ActiveConnectionLayoutProps) {
  const [isReadOnly, setIsReadOnly] = useState(false)
  const [showSearchBar, setShowSearchBar] = useState(false)
  const [tables, setTables] = useState<string[]>([])
  const [query, setQuery] = useState<string>('')
  const [debouncedQuery, setDebouncedQuery] = useState<string>('')
  const [activeTableEntry, setActiveTableEntry] = useState<number>(0)
  const queryWorkspaceRef = useRef<any>(null)
  const newTabHandlerRef = useRef<(() => void) | null>(null)
  const searchBarRef = useRef<any>(null)

  useEffect(() => {
    const checkReadOnly = async () => {
      try {
        const response = await window.api.database.isReadOnly(connectionId)
        setIsReadOnly(response.isReadOnly || false)
      } catch (error) {
        console.error('Error checking read-only status:', error)
      }
    }
    checkReadOnly()
  }, [connectionId])

  // debounce the search query
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query)
    }, 300) // 300ms debounce

    return () => clearTimeout(handler)
  }, [query])

  // fetch tables for search
  const loadTables = useCallback(async () => {
    let tables = [] as string[]
    try {
      const result = await window.api.database.getTables(connectionId, database)
      if (result.success && result.tables) {
        tables = result.tables
      }
    } catch (error) {
      console.error('Error loading databases:', error)
    } finally {
      setTables(tables)
    }
  }, [connectionId, database])

  useEffect(() => {
    loadTables()
  }, [loadTables])

  // Global keyboard shortcut for Cmd+N / Ctrl+N
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'n') {
        event.preventDefault()
        if (newTabHandlerRef.current) {
          newTabHandlerRef.current()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  // Keyboard shorcut for Quick Table Search (Cmd + P / Ctrl + P)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'p') {
        event.preventDefault()
        setShowSearchBar(true)
      }
      if (event.key === 'Escape') {
        setShowSearchBar(false)
        setQuery('')
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  useEffect(() => {
    if (showSearchBar && searchBarRef.current) {
      searchBarRef.current.focus()
    }
  }, [showSearchBar])

  const handleOpenTableTab = (database: string, tableName: string) => {
    if (window.openTableTab) {
      window.openTableTab(database, tableName)
    }
  }

  const handleSelectQuery = (query: string, name?: string) => {
    if (queryWorkspaceRef.current?.updateActiveTabQuery) {
      queryWorkspaceRef.current.updateActiveTabQuery(query, name)
    }
  }

  const handleRunQuery = (query: string) => {
    if (queryWorkspaceRef.current?.executeQueryDirectly) {
      queryWorkspaceRef.current.executeQueryDirectly(query)
    }
  }

  const handleExecuteQueryFromAI = (query: string) => {
    if (queryWorkspaceRef.current?.executeQueryFromAI) {
      queryWorkspaceRef.current.executeQueryFromAI(query)
    }
  }
  const filteredResults = useMemo(
    () =>
      debouncedQuery
        ? tables.filter((tableName) =>
            tableName.toLowerCase().includes(debouncedQuery.toLowerCase())
          )
        : [],
    [debouncedQuery, tables]
  )
  const handleKeyDownInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveTableEntry((prev) => Math.min(prev + 1, filteredResults.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveTableEntry((prev) => Math.max(prev - 1, 0))
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      setShowSearchBar(false)
      handleOpenTableTab(database, filteredResults[activeTableEntry])
      setDebouncedQuery('')
      setActiveTableEntry(0)
    }
  }

  return (
    <ChatProvider connectionId={connectionId}>
      <Box className="active-connection-layout">
        {/* Header bar */}
        <Flex className="connection-header" justify="between" align="center" p="2">
          <Flex align="center" gap="2">
            <Text size="2" weight="medium">
              {connectionName}
            </Text>
            {isReadOnly && (
              <Badge size="1" color="amber" variant="soft">
                READ-ONLY
              </Badge>
            )}
          </Flex>
          <Dialog.Root open={showSearchBar} onOpenChange={setShowSearchBar}>
            <Dialog.Content className="dialog-content">
              <Flex direction="column" className="search-container">
                <input
                  ref={searchBarRef}
                  type="text"
                  placeholder="Search tables..."
                  className="table-search"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDownInput}
                />
                <Flex direction="column">
                  {filteredResults.map((tableName, idx) => (
                    <Text
                      key={idx}
                      className={`search-result ${idx === activeTableEntry ? 'search-result-active' : ''}`}
                      size="4"
                    >
                      {tableName}
                    </Text>
                  ))}
                </Flex>
              </Flex>
            </Dialog.Content>
          </Dialog.Root>
          <Flex align="center" gap="2">
            <ThemeSwitcher size="1" />
            <Button size="1" variant="soft" color="red" onClick={onDisconnect}>
              Disconnect
            </Button>
          </Flex>
        </Flex>

        <PanelGroup direction="horizontal" className="panel-group">
          {/* Left sidebar with navigation */}
          <Panel defaultSize={20} minSize={15} maxSize={40} className="explorer-panel">
            <LeftSidebar
              connectionId={connectionId}
              connectionName={connectionName}
              onTableDoubleClick={handleOpenTableTab}
              onSelectQuery={handleSelectQuery}
              onRunQuery={handleRunQuery}
              onExecuteQueryFromAI={handleExecuteQueryFromAI}
            />
          </Panel>

          <PanelResizeHandle className="resize-handle" />

          {/* Right side with query workspace */}
          <Panel defaultSize={80} className="workspace-panel">
            <QueryWorkspace
              ref={queryWorkspaceRef}
              connectionId={connectionId}
              connectionName={connectionName}
              onOpenTableTab={handleOpenTableTab}
              onRegisterNewTabHandler={(handler) => {
                newTabHandlerRef.current = handler
              }}
            />
          </Panel>
        </PanelGroup>
      </Box>
    </ChatProvider>
  )
}
