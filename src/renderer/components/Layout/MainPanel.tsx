import { Box, Flex, Text, Button, Heading } from '@radix-ui/themes'
import { Logo } from '../ui'
import { DatabaseConnection } from '../DatabaseConnection/DatabaseConnection'
import { ThemeSwitcher } from '../ThemeSwitcher'
import { ActiveConnectionLayout } from '../ActiveConnectionLayout'
import { ConnectionCard, ConnectionCardSkeleton } from '../ConnectionCard'
import { useState, useEffect } from 'react'
import './MainPanel.css'
import { v4 as uuidv4 } from 'uuid'

interface MainPanelProps {
  activeConnection?: {
    id: string
    name: string
  }
  onConnectionSuccess?: (connection: any) => void
  connectionLoading?: boolean
  loadingConnectionId?: string | null
  savedConnections?: any[]
  onConnectionSelect?: (connection: any) => void
  onConnectionDelete?: (connectionId: string) => void
  onDisconnect?: () => void
}

interface SavedConnection {
  id: string
  name: string
  type: string
  host: string
  port: number
  database: string
  username: string
  secure?: boolean
  lastUsed?: string
  createdAt: string
}

export function MainPanel({
  activeConnection,
  onConnectionSuccess,
  connectionLoading = false,
  loadingConnectionId = null,
  savedConnections = [],
  onConnectionSelect,
  onConnectionDelete,
  onDisconnect
}: MainPanelProps) {
  const [showConnectionForm, setShowConnectionForm] = useState(false)
  const [isLoadingConnections, setIsLoadingConnections] = useState(true)
  const [editingConnection, setEditingConnection] = useState<any>(null)

  // Simulate loading state for demo
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoadingConnections(false)
    }, 1000)
    return () => clearTimeout(timer)
  }, [])

  // Sort connections by last used (most recent first)
  const sortedConnections = [...savedConnections].sort((a, b) => {
    const aDate = a.lastUsed ? new Date(a.lastUsed).getTime() : new Date(a.createdAt).getTime()
    const bDate = b.lastUsed ? new Date(b.lastUsed).getTime() : new Date(b.createdAt).getTime()
    return bDate - aDate
  })

  const handleNewConnection = () => {
    setShowConnectionForm(true)
    setEditingConnection(null)
  }

  const handleEditConnection = (connection: any) => {
    setEditingConnection(connection)
    setShowConnectionForm(true)
  }

  const handleConnectionSuccess = (connection: any) => {
    setShowConnectionForm(false)
    setEditingConnection(null)
    if (onConnectionSuccess) {
      onConnectionSuccess(connection)
    }
  }

  const handleCancelConnection = () => {
    setShowConnectionForm(false)
    setEditingConnection(null)
  }

  const handleConnectionSelect = (connection: any) => {
    console.log('Connection:', connection)
    console.log('Read-only:', connection.readonly)

    // Trigger database connection for the selected saved connection
    if (onConnectionSelect) {
      onConnectionSelect(connection)
    }
  }

  const handleConnectionDelete = (connectionId: string) => {
    if (onConnectionDelete) {
      onConnectionDelete(connectionId)
    }
  }

  const handleTestConnection = async (connection: SavedConnection) => {
    try {
      // Get the full connection with password from secure storage
      const fullConnectionResult = await window.api.connections.getById(connection.id)

      if (!fullConnectionResult.success || !fullConnectionResult.connection) {
        alert('Failed to retrieve connection details for testing')
        return
      }

      const fullConnection = fullConnectionResult.connection

      const result = await window.api.database.testConnection({
        type: fullConnection.type,
        host: fullConnection.host,
        port: fullConnection.port,
        database: fullConnection.database,
        username: fullConnection.username,
        password: fullConnection.password,
        secure: fullConnection.secure
      })

      if (result.success) {
        alert('Connection test successful!')
      } else {
        alert(`Connection test failed: ${result.message}`)
      }
    } catch (error) {
      console.error('Test connection error:', error)
      alert('Test connection error occurred')
    }
  }

  if (!activeConnection) {
    return (
      <Box className="main-panel">
        <Flex direction="column" height="100%">
          {/* Header */}
          <Flex justify="between" align="center" p="4">
            <Flex align="center" gap="3">
              <Logo size={40} withBackground />
              <Heading size="5" weight="bold">
                DataPup
              </Heading>
            </Flex>
            <ThemeSwitcher />
          </Flex>

          {/* Main Content */}
          <Box style={{ flex: 1 }} p="6">
            {showConnectionForm ? (
              <Flex justify="center">
                <Box style={{ maxWidth: '600px', width: '100%' }}>
                  <DatabaseConnection
                    onConnectionSuccess={handleConnectionSuccess}
                    onCancel={handleCancelConnection}
                    inline={true}
                    editingConnection={editingConnection}
                  />
                </Box>
              </Flex>
            ) : sortedConnections.length > 0 || isLoadingConnections ? (
              <Flex direction="column" gap="4">
                <Flex justify="between" align="center" mb="2">
                  <Text size="3" weight="medium">
                    Connections
                  </Text>
                  <Button size="2" onClick={handleNewConnection}>
                    + New Connection
                  </Button>
                </Flex>

                {isLoadingConnections ? (
                  <Flex gap="4" wrap="wrap">
                    {[1, 2, 3].map((i) => (
                      <ConnectionCardSkeleton key={i} />
                    ))}
                  </Flex>
                ) : (
                  <Flex gap="4" wrap="wrap">
                    {sortedConnections.map((connection) => (
                      <ConnectionCard
                        key={connection.id}
                        connection={connection}
                        onSelect={handleConnectionSelect}
                        onDelete={handleConnectionDelete}
                        onEdit={handleEditConnection}
                        onTestConnection={handleTestConnection}
                        isLoadingConnection={
                          connectionLoading && loadingConnectionId === connection.id
                        }
                      />
                    ))}
                  </Flex>
                )}
              </Flex>
            ) : (
              <Flex direction="column" align="center" justify="center" height="100%" gap="4">
                <Text size="6" color="gray">
                  🗄️
                </Text>
                <Text size="3" color="gray">
                  No connections yet
                </Text>
                <Button size="3" onClick={handleNewConnection}>
                  Create your first connection
                </Button>
              </Flex>
            )}
          </Box>
        </Flex>
      </Box>
    )
  }

  return (
    <Box className="main-panel">
      <ActiveConnectionLayout
        connectionId={activeConnection.id}
        connectionName={activeConnection.name}
        onDisconnect={onDisconnect}
      />
    </Box>
  )
}
