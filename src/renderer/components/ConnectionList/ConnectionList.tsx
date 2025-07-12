import { useState, useEffect } from 'react'
import { Button, Card, Flex, Text, Badge, Dialog } from '@radix-ui/themes'
import './ConnectionList.css'

interface Connection {
  id: string
  name: string
  type: string
  host: string
  port: number
  database: string
  username: string
  secure?: boolean
  createdAt: string
  lastUsed?: string
}

interface ConnectionListProps {
  onConnectionSelect?: (connection: Connection) => void
  onConnectionDelete?: (connectionId: string) => void
}

export function ConnectionList({ onConnectionSelect, onConnectionDelete }: ConnectionListProps) {
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [connectionToDelete, setConnectionToDelete] = useState<string | null>(null)

  useEffect(() => {
    loadConnections()
  }, [])

  const loadConnections = async () => {
    try {
      setLoading(true)
      const result = await window.api.connections.getAll()
      if (result.success) {
        setConnections(result.connections)
      }
    } catch (error) {
      console.error('Error loading connections:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleConnectionClick = async (connection: Connection) => {
    try {
      // Check if connection is still active
      const isConnected = await window.api.database.isConnected(connection.id)

      if (isConnected.isConnected) {
        // Connection is already active, just select it
        if (onConnectionSelect) {
          onConnectionSelect(connection)
        }
      } else {
        // Try to reconnect
        const result = await window.api.database.connect({
          type: connection.type,
          host: connection.host,
          port: connection.port,
          database: connection.database,
          username: connection.username,
          password: '', // We don't store passwords in the list, user will need to re-enter
          secure: connection.secure,
          saveConnection: false
        })

        if (result.success) {
          // Update last used timestamp
          await window.api.connections.updateLastUsed(connection.id)
          // Reload connections to update timestamps
          loadConnections()

          if (onConnectionSelect) {
            // Create a new connection object with the new connection ID
            const updatedConnection = {
              ...connection,
              id: result.connectionId || connection.id
            }
            onConnectionSelect(updatedConnection)
          }
        } else {
          alert(`Failed to reconnect: ${result.message}`)
        }
      }
    } catch (error) {
      console.error('Error connecting:', error)
      alert('Error connecting to database')
    }
  }

  const handleDeleteClick = (connectionId: string) => {
    setConnectionToDelete(connectionId)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!connectionToDelete) return

    try {
      // First disconnect if connected
      await window.api.database.disconnect(connectionToDelete)

      // Then delete from storage
      const result = await window.api.connections.delete(connectionToDelete)

      if (result.success) {
        // Reload connections
        loadConnections()

        if (onConnectionDelete) {
          onConnectionDelete(connectionToDelete)
        }
      } else {
        alert('Failed to delete connection')
      }
    } catch (error) {
      console.error('Error deleting connection:', error)
      alert('Error deleting connection')
    } finally {
      setDeleteDialogOpen(false)
      setConnectionToDelete(null)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString()
  }

  const getTypeColor = (type: string) => {
    switch (type.toLowerCase()) {
      case 'clickhouse':
        return 'blue'
      case 'postgresql':
        return 'green'
      case 'mysql':
        return 'orange'
      case 'sqlite':
        return 'purple'
      default:
        return 'gray'
    }
  }

  if (loading) {
    return (
      <div className="connection-list">
        <Text size="2" color="gray">
          Loading connections...
        </Text>
      </div>
    )
  }

  if (connections.length === 0) {
    return (
      <div className="connection-list">
        <Text size="2" color="gray">
          No saved connections
        </Text>
      </div>
    )
  }

  return (
    <div className="connection-list">
      <Text size="3" weight="bold" mb="3">
        Saved Connections
      </Text>

      <Flex direction="column" gap="2">
        {connections.map((connection) => (
          <Card key={connection.id} className="connection-card">
            <Flex direction="column" gap="2">
              <Flex justify="between" align="center">
                <Text size="2" weight="bold" truncate>
                  {connection.name}
                </Text>
                <Badge color={getTypeColor(connection.type)}>{connection.type}</Badge>
              </Flex>

              <Text size="1" color="gray">
                {connection.host}:{connection.port} / {connection.database}
              </Text>

              <Text size="1" color="gray">
                Created: {formatDate(connection.createdAt)}
              </Text>

              {connection.lastUsed && (
                <Text size="1" color="gray">
                  Last used: {formatDate(connection.lastUsed)}
                </Text>
              )}

              <Flex gap="2" mt="2">
                <Button
                  size="1"
                  onClick={() => handleConnectionClick(connection)}
                  className="connect-btn"
                >
                  Connect
                </Button>
                <Button
                  size="1"
                  variant="soft"
                  color="red"
                  onClick={() => handleDeleteClick(connection.id)}
                >
                  Delete
                </Button>
              </Flex>
            </Flex>
          </Card>
        ))}
      </Flex>

      {/* Delete Confirmation Dialog */}
      <Dialog.Root open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <Dialog.Content>
          <Dialog.Title>Delete Connection</Dialog.Title>
          <Dialog.Description size="2" mb="4">
            Are you sure you want to delete this connection? This action cannot be undone.
          </Dialog.Description>

          <Flex gap="3" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray">
                Cancel
              </Button>
            </Dialog.Close>
            <Button color="red" onClick={handleDeleteConfirm}>
              Delete
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  )
}
