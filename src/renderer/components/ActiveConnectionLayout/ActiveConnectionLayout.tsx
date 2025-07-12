import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Box, Flex, Text, Badge } from '@radix-ui/themes'
import { Button } from '../ui'
import { DatabaseExplorer } from '../DatabaseExplorer/DatabaseExplorer'
import { QueryWorkspace } from '../QueryWorkspace/QueryWorkspace'
import { ThemeSwitcher } from '../ThemeSwitcher'
import { useState, useEffect } from 'react'
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
  
  const handleOpenTableTab = (database: string, tableName: string) => {
    if (window.openTableTab) {
      window.openTableTab(database, tableName)
    }
  }

  return (
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
        {/* Left sidebar with database explorer */}
        <Panel defaultSize={20} minSize={15} maxSize={40} className="explorer-panel">
          <DatabaseExplorer
            connectionId={connectionId}
            connectionName={connectionName}
            onTableDoubleClick={handleOpenTableTab}
          />
        </Panel>

        <PanelResizeHandle className="resize-handle" />

        {/* Right side with query workspace */}
        <Panel defaultSize={80} className="workspace-panel">
          <QueryWorkspace
            connectionId={connectionId}
            connectionName={connectionName}
            onOpenTableTab={handleOpenTableTab}
          />
        </Panel>
      </PanelGroup>
    </Box>
  )
}
