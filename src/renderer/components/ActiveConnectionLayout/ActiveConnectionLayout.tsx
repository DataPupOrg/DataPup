import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Box, Flex, Text, Badge } from '@radix-ui/themes'
import { Button } from '../ui'
import { LeftSidebar } from '../LeftSidebar'
import { QueryWorkspace } from '../QueryWorkspace/QueryWorkspace'
import { ThemeSwitcher } from '../ThemeSwitcher'
import { ChatProvider } from '../../contexts/ChatContext'
import { useState, useEffect, useRef } from 'react'
import './ActiveConnectionLayout.css'

interface ActiveConnectionLayoutProps {
  connectionId: string
  connectionName: string
  onDisconnect?: () => void
}

export function ActiveConnectionLayout({
  connectionId,
  connectionName,
  onDisconnect
}: ActiveConnectionLayoutProps) {
  const [isReadOnly, setIsReadOnly] = useState(false)
  const queryWorkspaceRef = useRef<any>(null)
  const newTabHandlerRef = useRef<(() => void) | null>(null)

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
